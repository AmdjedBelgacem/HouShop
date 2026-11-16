use crate::db;
use crate::transfer::{
    CategoryScanResult, CategoryTransferSummary, DeviceDataSummary, DeviceInfo, DevicePlatform,
    StartTransferRequest, TransferCategory, TransferEngine, TransferLogRecord,
    TransferSessionRecord, TransferSummaryReport, WifiServerInfo, WifiServerManager,
};
use crate::transfer::detector::DeviceDetector;
use crate::transfer::virtual_device::VirtualDeviceProvider;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

/// Whether the helper tools that talk to phones over USB are installed.
/// Without them a phone is simply never detected, so the interface needs to
/// say so instead of just showing "no phone connected".
#[derive(serde::Serialize)]
pub struct PhoneToolStatus {
    /// `adb`, needed for Android and HarmonyOS phones.
    pub adb: bool,
    /// libimobiledevice (`idevice_id`, `ideviceinfo`), needed for iPhones.
    pub ios: bool,
}

#[tauri::command]
pub async fn get_phone_tool_status(
    detector: State<'_, Arc<DeviceDetector>>,
) -> Result<PhoneToolStatus, String> {
    let detector = detector.inner().clone();
    // `is_available` runs the tools synchronously, so keep it off the async threads.
    tokio::task::spawn_blocking(move || PhoneToolStatus {
        adb: detector.adb().is_available(),
        ios: detector.ios().is_available(),
    })
    .await
    .map_err(|e| format!("Tool check failed: {}", e))
}

#[tauri::command]
pub async fn list_transfer_devices(
    detector: State<'_, Arc<DeviceDetector>>,
) -> Result<Vec<DeviceInfo>, String> {
    Ok(detector.scan_all_devices().await)
}

#[tauri::command]
pub async fn refresh_transfer_devices(
    app: AppHandle,
    detector: State<'_, Arc<DeviceDetector>>,
) -> Result<Vec<DeviceInfo>, String> {
    let devices = detector.scan_all_devices().await;
    detector.poll_and_emit_events(&app).await;
    Ok(devices)
}

#[tauri::command]
pub async fn enable_virtual_devices(
    enabled: bool,
    app: AppHandle,
    detector: State<'_, Arc<DeviceDetector>>,
) -> Result<Vec<DeviceInfo>, String> {
    detector.set_virtual_devices_enabled(enabled);
    let devices = detector.scan_all_devices().await;
    detector.poll_and_emit_events(&app).await;
    Ok(devices)
}

#[tauri::command]
pub async fn scan_device_data(
    device_id: String,
    detector: State<'_, Arc<DeviceDetector>>,
) -> Result<DeviceDataSummary, String> {
    let device = detector
        .get_device(&device_id)
        .await
        .ok_or_else(|| format!("Device {} not found", device_id))?;

    let categories: Vec<CategoryScanResult> = if device.is_virtual || device.platform == DevicePlatform::Android {
        let raw = if device.is_virtual {
            VirtualDeviceProvider::scan_categories(&device.id)
        } else {
            detector.adb().scan_categories(&device.id).await.unwrap_or_default()
        };
        raw.into_iter()
            .map(|(cat, count, bytes)| CategoryScanResult {
                category: cat,
                item_count: count,
                total_bytes: bytes,
                available: count > 0,
                note: None,
            })
            .collect()
    } else {
        // iPhone: counted from the phone itself; what can't be read says so.
        detector.ios().scan_categories(&device.id).await
    };

    let total_items: u64 = categories.iter().map(|c| c.item_count).sum();
    let total_bytes: u64 = categories.iter().map(|c| c.total_bytes).sum();

    Ok(DeviceDataSummary {
        device_id,
        categories,
        total_items,
        total_bytes,
    })
}

#[tauri::command]
pub async fn start_phone_transfer(
    app: AppHandle,
    req: StartTransferRequest,
    engine: State<'_, Arc<TransferEngine>>,
) -> Result<TransferSessionRecord, String> {
    engine.start_transfer(app, req).await
}

#[tauri::command]
pub async fn pause_phone_transfer(
    engine: State<'_, Arc<TransferEngine>>,
) -> Result<(), String> {
    engine.pause_transfer().await
}

#[tauri::command]
pub async fn resume_phone_transfer(
    engine: State<'_, Arc<TransferEngine>>,
) -> Result<(), String> {
    engine.resume_transfer().await
}

#[tauri::command]
pub async fn cancel_phone_transfer(
    engine: State<'_, Arc<TransferEngine>>,
) -> Result<(), String> {
    engine.cancel_transfer().await
}

#[tauri::command]
pub async fn get_transfer_sessions(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<TransferSessionRecord>, String> {
    sqlx::query_as::<_, TransferSessionRecord>(
        "SELECT * FROM transfer_sessions ORDER BY id DESC LIMIT 50",
    )
    .fetch_all(&*pool)
    .await
    .map_err(|e| format!("Failed to fetch transfer sessions: {}", e))
}

#[tauri::command]
pub async fn get_transfer_logs(
    session_id: i64,
    pool: State<'_, SqlitePool>,
) -> Result<Vec<TransferLogRecord>, String> {
    sqlx::query_as::<_, TransferLogRecord>(
        "SELECT * FROM transfer_logs WHERE session_id = ? ORDER BY id ASC LIMIT 200",
    )
    .bind(session_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| format!("Failed to fetch transfer logs: {}", e))
}

#[tauri::command]
pub async fn get_transfer_summary(
    session_id: i64,
    pool: State<'_, SqlitePool>,
) -> Result<TransferSummaryReport, String> {
    let session = sqlx::query_as::<_, TransferSessionRecord>(
        "SELECT * FROM transfer_sessions WHERE id = ?",
    )
    .bind(session_id)
    .fetch_one(&*pool)
    .await
    .map_err(|e| format!("Session {} not found: {}", session_id, e))?;

    let logs = sqlx::query_as::<_, TransferLogRecord>(
        "SELECT * FROM transfer_logs WHERE session_id = ?",
    )
    .bind(session_id)
    .fetch_all(&*pool)
    .await
    .unwrap_or_default();

    let mut transferred_items = 0u64;
    let mut skipped_items = 0u64;
    let mut failed_items = 0u64;
    let mut breakdown: HashMap<String, (u64, u64, u64)> = HashMap::new();

    for l in &logs {
        let entry = breakdown
            .entry(l.category.clone())
            .or_insert((0, 0, 0));
        match l.status.as_str() {
            "success" => {
                transferred_items += 1;
                entry.0 += 1;
            }
            "skipped" => {
                skipped_items += 1;
                entry.0 += 1;
            }
            "failed" => {
                failed_items += 1;
                entry.1 += 1;
            }
            _ => {}
        }
        entry.2 += l.item_size.max(0) as u64;
    }

    // Duration from the session's own timestamps; at least 1s so speed math works
    let parse_db_time = |s: &str| {
        chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").ok()
    };
    let duration_seconds = match (
        parse_db_time(&session.started_at),
        session.completed_at.as_deref().and_then(parse_db_time),
    ) {
        (Some(start), Some(end)) => (end - start).num_seconds().max(0) as u64,
        _ => 1,
    }
    .max(1);

    let transferred_bytes = session.transferred_bytes.max(0) as u64;
    let average_speed_mbps = if transferred_bytes > 0 {
        transferred_bytes as f32 / (1024.0 * 1024.0) / duration_seconds as f32
    } else {
        0.0
    };

    let categories_breakdown = breakdown
        .into_iter()
        .filter_map(|(cat, (count, failed, bytes))| {
            TransferCategory::from_str_opt(&cat).map(|c| CategoryTransferSummary {
                category: c,
                transferred_count: count,
                failed_count: failed,
                total_bytes: bytes,
            })
        })
        .collect();

    Ok(TransferSummaryReport {
        session_id: session.id,
        session_uuid: session.session_uuid,
        source_device_name: session.source_device_name,
        source_platform: session.source_platform,
        target_device_name: session.target_device_name,
        target_platform: session.target_platform,
        status: crate::transfer::TransferStatus::from_str(&session.status),
        total_items: session.total_items as u64,
        transferred_items: if transferred_items > 0 { transferred_items } else { session.transferred_items as u64 },
        skipped_items,
        failed_items,
        total_bytes: session.total_bytes as u64,
        transferred_bytes,
        duration_seconds,
        average_speed_mbps,
        categories_breakdown,
    })
}

#[tauri::command]
pub async fn start_wifi_transfer_server(
    app: AppHandle,
    wifi_mgr: State<'_, Arc<Mutex<WifiServerManager>>>,
) -> Result<WifiServerInfo, String> {
    let upload_dir = db::get_transfers_dir(&app)?.join("wifi_uploads");
    let _ = std::fs::create_dir_all(&upload_dir);
    let mut mgr = wifi_mgr.lock().await;
    mgr.start(upload_dir).await
}

#[tauri::command]
pub async fn stop_wifi_transfer_server(
    wifi_mgr: State<'_, Arc<Mutex<WifiServerManager>>>,
) -> Result<(), String> {
    let mut mgr = wifi_mgr.lock().await;
    mgr.stop();
    Ok(())
}

#[tauri::command]
pub async fn get_wifi_transfer_server_info(
    wifi_mgr: State<'_, Arc<Mutex<WifiServerManager>>>,
) -> Result<Option<WifiServerInfo>, String> {
    let mgr = wifi_mgr.lock().await;
    Ok(mgr.get_info())
}

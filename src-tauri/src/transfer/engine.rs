use super::detector::DeviceDetector;
use super::normalizer::calculate_file_sha256;
use super::pipeline::StagingPipeline;
use super::types::{
    CategoryTransferSummary, DeviceConnectionState, DeviceInfo, DevicePlatform,
    StartTransferRequest, TransferCategory, TransferProgressEvent, TransferSessionRecord,
    TransferStatus, TransferSummaryReport,
};
use super::virtual_device::VirtualDeviceProvider;
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;

pub struct ActiveSessionState {
    pub session_id: i64,
    pub session_uuid: String,
    pub is_paused: Arc<AtomicBool>,
    pub is_cancelled: Arc<AtomicBool>,
}

pub struct TransferEngine {
    detector: Arc<DeviceDetector>,
    pool: SqlitePool,
    base_transfers_dir: PathBuf,
    active_session: Arc<RwLock<Option<ActiveSessionState>>>,
}

impl TransferEngine {
    pub fn new(detector: Arc<DeviceDetector>, pool: SqlitePool, base_transfers_dir: PathBuf) -> Self {
        Self {
            detector,
            pool,
            base_transfers_dir,
            active_session: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn is_running(&self) -> bool {
        self.active_session.read().await.is_some()
    }

    pub async fn pause_transfer(&self) -> Result<(), String> {
        let guard = self.active_session.read().await;
        if let Some(session) = guard.as_ref() {
            session.is_paused.store(true, Ordering::SeqCst);
            let _ = sqlx::query("UPDATE transfer_sessions SET status = 'paused' WHERE id = ?")
                .bind(session.session_id)
                .execute(&self.pool)
                .await;
            Ok(())
        } else {
            Err("No active transfer to pause".to_string())
        }
    }

    pub async fn resume_transfer(&self) -> Result<(), String> {
        let guard = self.active_session.read().await;
        if let Some(session) = guard.as_ref() {
            session.is_paused.store(false, Ordering::SeqCst);
            let _ = sqlx::query("UPDATE transfer_sessions SET status = 'in_progress' WHERE id = ?")
                .bind(session.session_id)
                .execute(&self.pool)
                .await;
            Ok(())
        } else {
            Err("No active transfer to resume".to_string())
        }
    }

    pub async fn cancel_transfer(&self) -> Result<(), String> {
        let guard = self.active_session.read().await;
        if let Some(session) = guard.as_ref() {
            session.is_cancelled.store(true, Ordering::SeqCst);
            let _ = sqlx::query("UPDATE transfer_sessions SET status = 'cancelled', completed_at = datetime('now') WHERE id = ?")
                .bind(session.session_id)
                .execute(&self.pool)
                .await;
            Ok(())
        } else {
            Err("No active transfer to cancel".to_string())
        }
    }

    /// Orchestrates the entire phone data migration.
    pub async fn start_transfer(
        &self,
        app: AppHandle,
        req: StartTransferRequest,
    ) -> Result<TransferSessionRecord, String> {
        // Ensure no other transfer is running
        if self.is_running().await {
            return Err("A transfer is already running. Please wait or cancel it.".to_string());
        }

        let source = self
            .detector
            .get_device(&req.source_device_id)
            .await
            .ok_or_else(|| format!("Source device {} not found", req.source_device_id))?;

        let target = self
            .detector
            .get_device(&req.target_device_id)
            .await
            .ok_or_else(|| format!("Target device {} not found", req.target_device_id))?;

        if source.connection_state != DeviceConnectionState::Connected {
            return Err(format!("Source device is not ready: {:?}", source.connection_state));
        }

        if target.connection_state != DeviceConnectionState::Connected {
            return Err(format!("Target device is not ready: {:?}", target.connection_state));
        }

        // Only Android (over ADB) can be read for real, and Android/HarmonyOS can be written to.
        // Anything else used to stage sample data and report it as transferred, so refuse it here.
        if !source.is_virtual && source.platform != DevicePlatform::Android {
            return Err(format!(
                "Reading data from {} devices is not supported yet. No data was transferred.",
                source.platform
            ));
        }
        if !target.is_virtual
            && target.platform != DevicePlatform::Android
            && target.platform != DevicePlatform::HarmonyOs
        {
            return Err(format!(
                "Writing data to {} devices is not supported yet. No data was transferred.",
                target.platform
            ));
        }

        let session_uuid = uuid::Uuid::new_v4().to_string();
        let selected_categories_json = serde_json::to_string(&req.categories).unwrap_or_default();

        // Insert into SQLite
        let insert_res = sqlx::query(
            "INSERT INTO transfer_sessions (
                session_uuid, source_device_id, source_device_name, source_platform,
                target_device_id, target_device_name, target_platform, status,
                selected_categories
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'in_progress', ?)"
        )
        .bind(&session_uuid)
        .bind(&source.id)
        .bind(&source.name)
        .bind(source.platform.to_string())
        .bind(&target.id)
        .bind(&target.name)
        .bind(target.platform.to_string())
        .bind(&selected_categories_json)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to record transfer session: {}", e))?;

        let session_id = insert_res.last_insert_rowid();

        let is_paused = Arc::new(AtomicBool::new(false));
        let is_cancelled = Arc::new(AtomicBool::new(false));

        {
            let mut guard = self.active_session.write().await;
            *guard = Some(ActiveSessionState {
                session_id,
                session_uuid: session_uuid.clone(),
                is_paused: is_paused.clone(),
                is_cancelled: is_cancelled.clone(),
            });
        }

        // Spawn transfer task
        let pool_clone = self.pool.clone();
        let active_session_ref = self.active_session.clone();
        let base_dir_clone = self.base_transfers_dir.clone();
        let detector_clone = self.detector.clone();
        let session_uuid_clone = session_uuid.clone();
        let categories: Vec<TransferCategory> = req
            .categories
            .iter()
            .filter_map(|c| TransferCategory::from_str_opt(c))
            .collect();

        tokio::spawn(async move {
            let res = execute_migration_task(
                app.clone(),
                pool_clone.clone(),
                detector_clone,
                base_dir_clone,
                session_id,
                session_uuid_clone.clone(),
                source,
                target,
                categories,
                is_paused,
                is_cancelled,
            )
            .await;

            let mut guard = active_session_ref.write().await;
            *guard = None;

            match res {
                Ok(report) => {
                    let _ = app.emit("transfer-completed", &report);
                }
                Err(err_msg) => {
                    let _ = sqlx::query("UPDATE transfer_sessions SET status = 'failed', error_message = ?, completed_at = datetime('now') WHERE id = ?")
                        .bind(&err_msg)
                        .bind(session_id)
                        .execute(&pool_clone)
                        .await;
                    let _ = app.emit("transfer-error", &err_msg);
                }
            }
        });

        // Return initial session record
        let record = sqlx::query_as::<_, TransferSessionRecord>(
            "SELECT * FROM transfer_sessions WHERE id = ?",
        )
        .bind(session_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        Ok(record)
    }
}

async fn execute_migration_task(
    app: AppHandle,
    pool: SqlitePool,
    detector: Arc<DeviceDetector>,
    base_transfers_dir: PathBuf,
    session_id: i64,
    session_uuid: String,
    source: DeviceInfo,
    target: DeviceInfo,
    categories: Vec<TransferCategory>,
    is_paused: Arc<AtomicBool>,
    is_cancelled: Arc<AtomicBool>,
) -> Result<TransferSummaryReport, String> {
    let start_time = Instant::now();
    let staging = StagingPipeline::new(&base_transfers_dir, &session_uuid)?;

    // ------------------------------------------------------------------
    // Phase 1 — Stage every selected category up front. Staging first lets
    // progress, ETA and byte totals be computed from the files that will
    // actually move (the scan estimate is only advisory and would leave the
    // progress bar stuck near 0% when staged bytes differ from it).
    // ------------------------------------------------------------------
    let mut staged_by_cat: Vec<(TransferCategory, Vec<PathBuf>)> = Vec::new();
    let mut staging_failures: Vec<(TransferCategory, String)> = Vec::new();

    for cat in &categories {
        if is_cancelled.load(Ordering::SeqCst) {
            break;
        }
        wait_while_paused(&is_paused, &is_cancelled).await;

        let stage_res = if source.is_virtual {
            VirtualDeviceProvider::stage_virtual_data(staging.session_dir(), *cat)
        } else if source.platform == DevicePlatform::Android {
            stage_android_category(detector.adb(), &source.id, staging.session_dir(), *cat).await
        } else {
            stage_ios_category(staging.session_dir(), *cat).await
        };

        match stage_res {
            Ok(files) => staged_by_cat.push((*cat, files)),
            // A single failing category must not abort the whole migration —
            // record it as a failed item and keep going with the rest.
            Err(err) => staging_failures.push((*cat, err)),
        }
    }

    // Honest totals derived from the staged files themselves
    let mut total_items = 0u64;
    let mut total_bytes = 0u64;
    for (_, files) in &staged_by_cat {
        for f in files {
            total_items += 1;
            total_bytes += std::fs::metadata(f).map(|m| m.len()).unwrap_or(0);
        }
    }

    // Check target storage space
    if target.storage_free_bytes > 0 && total_bytes > target.storage_free_bytes {
        return Err(format!(
            "Insufficient storage on destination device (Needs {:.1} GB, Free: {:.1} GB)",
            total_bytes as f64 / (1024.0 * 1024.0 * 1024.0),
            target.storage_free_bytes as f64 / (1024.0 * 1024.0 * 1024.0)
        ));
    }

    let mut transferred_items = 0u64;
    let mut transferred_bytes = 0u64;
    let mut skipped_items = 0u64;
    let mut failed_items = 0u64;
    let mut category_summaries = Vec::new();

    // Surface category-level staging failures in the audit log
    for (cat, err) in &staging_failures {
        failed_items += 1;
        let _ = sqlx::query(
            "INSERT INTO transfer_logs (session_id, category, item_name, item_size, status, error_message)
             VALUES (?, ?, ?, 0, 'failed', ?)"
        )
        .bind(session_id)
        .bind(cat.as_str())
        .bind(format!("{} extraction", cat.as_str()))
        .bind(err)
        .execute(&pool)
        .await;
    }

    // ------------------------------------------------------------------
    // Phase 2 — Push every staged file to the destination device.
    // ------------------------------------------------------------------
    for (cat, files) in &staged_by_cat {
        if is_cancelled.load(Ordering::SeqCst) {
            break;
        }
        wait_while_paused(&is_paused, &is_cancelled).await;
        if is_cancelled.load(Ordering::SeqCst) {
            break;
        }

        let cat_start_items = transferred_items;
        let cat_start_bytes = transferred_bytes;
        let mut cat_failed = 0u64;

        for file_path in files {
            if is_cancelled.load(Ordering::SeqCst) {
                break;
            }
            wait_while_paused(&is_paused, &is_cancelled).await;
            if is_cancelled.load(Ordering::SeqCst) {
                break;
            }

            let file_name = file_path.file_name().unwrap_or_default().to_string_lossy().to_string();
            let file_size = std::fs::metadata(file_path).map(|m| m.len()).unwrap_or(0);
            let checksum = calculate_file_sha256(file_path).unwrap_or_default();

            // Push to target device
            let push_res = push_to_target(&detector, &target, *cat, file_path, &file_name).await;

            match push_res {
                Ok(dedup) => {
                    if dedup {
                        skipped_items += 1;
                    } else {
                        transferred_items += 1;
                    }
                    transferred_bytes += file_size;

                    // Log in SQLite
                    let _ = sqlx::query(
                        "INSERT INTO transfer_logs (session_id, category, item_name, item_size, status, checksum)
                         VALUES (?, ?, ?, ?, ?, ?)"
                    )
                    .bind(session_id)
                    .bind(cat.as_str())
                    .bind(&file_name)
                    .bind(file_size as i64)
                    .bind(if dedup { "skipped" } else { "success" })
                    .bind(&checksum)
                    .execute(&pool)
                    .await;
                }
                Err(err) => {
                    failed_items += 1;
                    cat_failed += 1;
                    let _ = sqlx::query(
                        "INSERT INTO transfer_logs (session_id, category, item_name, item_size, status, error_message)
                         VALUES (?, ?, ?, ?, 'failed', ?)"
                    )
                    .bind(session_id)
                    .bind(cat.as_str())
                    .bind(&file_name)
                    .bind(file_size as i64)
                    .bind(&err)
                    .execute(&pool)
                    .await;
                }
            }

            // Emit live progress. Speed is reported in MB/s (megabytes per
            // second) to match the UI labels.
            let elapsed_secs = start_time.elapsed().as_secs().max(1);
            let speed_bps = transferred_bytes / elapsed_secs;
            let speed_mbps = transferred_bytes as f32 / (1024.0 * 1024.0) / elapsed_secs as f32;
            let remaining_bytes = total_bytes.saturating_sub(transferred_bytes);
            let eta = if speed_bps > 0 {
                remaining_bytes / speed_bps
            } else {
                0
            };
            let pct = if total_bytes > 0 {
                ((transferred_bytes as f32 / total_bytes as f32) * 100.0).clamp(0.0, 100.0)
            } else {
                100.0
            };

            let _ = app.emit(
                "transfer-progress",
                &TransferProgressEvent {
                    session_uuid: session_uuid.clone(),
                    status: TransferStatus::InProgress,
                    current_category: Some(*cat),
                    current_item_name: Some(file_name),
                    current_item_index: transferred_items + skipped_items + failed_items,
                    total_items,
                    transferred_bytes,
                    total_bytes,
                    progress_percentage: pct,
                    speed_bytes_per_sec: speed_bps,
                    speed_mbps,
                    eta_seconds: eta,
                    elapsed_seconds: elapsed_secs,
                    error_message: None,
                },
            );

            // Small breathing room for smooth UI updates
            tokio::time::sleep(tokio::time::Duration::from_millis(25)).await;
        }

        category_summaries.push(CategoryTransferSummary {
            category: *cat,
            transferred_count: transferred_items - cat_start_items,
            failed_count: cat_failed,
            total_bytes: transferred_bytes - cat_start_bytes,
        });
    }

    let is_canc = is_cancelled.load(Ordering::SeqCst);
    let final_status = if is_canc {
        TransferStatus::Cancelled
    } else if failed_items > 0 && transferred_items == 0 {
        TransferStatus::Failed
    } else {
        TransferStatus::Completed
    };

    // Update SQLite session record
    let _ = sqlx::query(
        "UPDATE transfer_sessions SET
            status = ?, total_items = ?, transferred_items = ?,
            total_bytes = ?, transferred_bytes = ?, completed_at = datetime('now')
         WHERE id = ?"
    )
    .bind(final_status.to_string())
    .bind(total_items as i64)
    .bind(transferred_items as i64)
    .bind(total_bytes as i64)
    .bind(transferred_bytes as i64)
    .bind(session_id)
    .execute(&pool)
    .await;

    // Virtual / iOS destinations keep the migrated bundle on the desktop side,
    // so archive it instead of wiping the scratchpad. Real Android/HarmonyOS
    // pushes land on the device itself — the scratchpad can go.
    if target.is_virtual || target.platform == DevicePlatform::Ios {
        staging.archive();
    } else {
        staging.purge();
    }

    let duration_secs = start_time.elapsed().as_secs().max(1);
    let avg_speed_mbps = transferred_bytes as f32 / (1024.0 * 1024.0) / duration_secs as f32;

    Ok(TransferSummaryReport {
        session_id,
        session_uuid,
        source_device_name: source.name,
        source_platform: source.platform.to_string(),
        target_device_name: target.name,
        target_platform: target.platform.to_string(),
        status: final_status,
        total_items,
        transferred_items,
        skipped_items,
        failed_items,
        total_bytes,
        transferred_bytes,
        duration_seconds: duration_secs,
        average_speed_mbps: avg_speed_mbps,
        categories_breakdown: category_summaries,
    })
}

/// Blocks until the transfer is resumed or cancelled. Cancel always wins so a
/// paused transfer can still be stopped from the UI.
async fn wait_while_paused(is_paused: &AtomicBool, is_cancelled: &AtomicBool) {
    while is_paused.load(Ordering::SeqCst) && !is_cancelled.load(Ordering::SeqCst) {
        tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
    }
}

async fn stage_android_category(
    adb: &super::adb::AdbManager,
    serial: &str,
    session_dir: &Path,
    category: TransferCategory,
) -> Result<Vec<PathBuf>, String> {
    let cat_dir = session_dir.join(category.as_str());
    let _ = std::fs::create_dir_all(&cat_dir);
    let mut files = Vec::new();

    match category {
        TransferCategory::Contacts => {
            let vcf = cat_dir.join("contacts.vcf");
            let _ = adb.extract_contacts(serial, &vcf).await?;
            files.push(vcf);
        }
        TransferCategory::Messages => {
            let xml = cat_dir.join("sms_backup.xml");
            let _ = adb.extract_messages(serial, &xml).await?;
            files.push(xml);
        }
        TransferCategory::Calls => {
            let xml = cat_dir.join("calls_backup.xml");
            let _ = adb.extract_call_logs(serial, &xml).await?;
            files.push(xml);
        }
        _ => {
            // For photos/media, pull up to 10 items for transfer
            let remote_dir = match category {
                TransferCategory::Photos => "/sdcard/DCIM/Camera",
                TransferCategory::Videos => "/sdcard/Movies",
                TransferCategory::Audio => "/sdcard/Music",
                TransferCategory::Documents => "/sdcard/Download",
                _ => "/sdcard/Pictures",
            };
            // Do not create the destination first: `adb pull <dir> <existing dir>` nests the
            // folder inside it, so adb must create `bundle` itself as a copy of the remote folder.
            let local_dest = cat_dir.join("bundle");
            let _ = adb.pull_file(serial, remote_dir, &local_dest).await;

            if let Ok(entries) = std::fs::read_dir(&local_dest) {
                for e in entries.flatten() {
                    if e.path().is_file() {
                        files.push(e.path());
                    }
                }
            }

            // An empty folder means nothing to transfer for this category. Real data is never
            // replaced with sample files.
        }
    }

    Ok(files)
}

async fn stage_ios_category(
    _session_dir: &Path,
    _category: TransferCategory,
) -> Result<Vec<PathBuf>, String> {
    Err("Reading data from iPhone is not supported yet. No sample data was substituted.".into())
}

async fn push_to_target(
    detector: &Arc<DeviceDetector>,
    target: &DeviceInfo,
    category: TransferCategory,
    file_path: &Path,
    file_name: &str,
) -> Result<bool, String> {
    if target.is_virtual {
        // Virtual target: successful simulation with small simulated write delay
        tokio::time::sleep(tokio::time::Duration::from_millis(15)).await;
        return Ok(false);
    }

    if target.platform == DevicePlatform::Android || target.platform == DevicePlatform::HarmonyOs {
        let remote_folder = match category {
            TransferCategory::Photos => "/sdcard/Pictures/HouSwitch",
            TransferCategory::Videos => "/sdcard/Movies/HouSwitch",
            TransferCategory::Audio => "/sdcard/Music/HouSwitch",
            TransferCategory::Documents => "/sdcard/Download/HouSwitch",
            TransferCategory::Contacts => "/sdcard/Download",
            TransferCategory::Messages | TransferCategory::Calls => "/sdcard/Download/HouSwitchBackup",
            _ => "/sdcard/Download",
        };

        let remote_path = format!("{}/{}", remote_folder, file_name);
        // adb push does not reliably create nested directories on every device —
        // make sure the destination folder exists before pushing.
        let _ = detector.adb().ensure_remote_dir(&target.id, remote_folder).await;
        detector.adb().push_file(&target.id, file_path, &remote_path).await?;
        Ok(false)
    } else {
        // Unsupported target. Never report this as a transferred item.
        Err(format!(
            "Writing data to {} devices is not supported yet. Nothing was written.",
            target.platform
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transfer::TransferLogRecord;
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn test_virtual_device_staging_all_categories() {
        let temp_dir = std::env::temp_dir().join(format!("houswitch_stage_test_{}", uuid::Uuid::new_v4()));
        let _ = std::fs::create_dir_all(&temp_dir);

        for cat in TransferCategory::all() {
            let files = VirtualDeviceProvider::stage_virtual_data(&temp_dir, *cat).unwrap();
            assert!(!files.is_empty(), "Category {:?} should produce staged files", cat);
            for f in files {
                assert!(f.is_file(), "File {:?} should exist on disk", f);
                assert!(std::fs::metadata(&f).unwrap().len() > 0, "File {:?} should not be empty", f);
            }
        }

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_transfer_database_schema_and_operations() {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();

        // Run transfer schema
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS transfer_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_uuid TEXT NOT NULL UNIQUE,
                source_device_id TEXT NOT NULL,
                source_device_name TEXT NOT NULL,
                source_platform TEXT NOT NULL,
                target_device_id TEXT NOT NULL,
                target_device_name TEXT NOT NULL,
                target_platform TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                total_items INTEGER NOT NULL DEFAULT 0,
                transferred_items INTEGER NOT NULL DEFAULT 0,
                total_bytes INTEGER NOT NULL DEFAULT 0,
                transferred_bytes INTEGER NOT NULL DEFAULT 0,
                selected_categories TEXT NOT NULL DEFAULT '[]',
                error_message TEXT,
                started_at TEXT NOT NULL DEFAULT (datetime('now')),
                completed_at TEXT
            )"
        ).execute(&pool).await.unwrap();

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS transfer_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                category TEXT NOT NULL,
                item_name TEXT NOT NULL,
                item_size INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'pending',
                error_message TEXT,
                checksum TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (session_id) REFERENCES transfer_sessions(id) ON DELETE CASCADE
            )"
        ).execute(&pool).await.unwrap();

        // Test insert session
        let insert_res = sqlx::query(
            "INSERT INTO transfer_sessions (
                session_uuid, source_device_id, source_device_name, source_platform,
                target_device_id, target_device_name, target_platform, status,
                selected_categories
            ) VALUES ('test-uuid', 's1', 'Galaxy S24', 'android', 't1', 'iPhone 15', 'ios', 'in_progress', '[\"contacts\"]')"
        ).execute(&pool).await.unwrap();

        let session_id = insert_res.last_insert_rowid();

        // Test insert log
        sqlx::query(
            "INSERT INTO transfer_logs (session_id, category, item_name, item_size, status, checksum)
             VALUES (?, 'contacts', 'contacts.vcf', 1024, 'success', 'abc123hash')"
        )
        .bind(session_id)
        .execute(&pool)
        .await
        .unwrap();

        let logs = sqlx::query_as::<_, TransferLogRecord>("SELECT * FROM transfer_logs WHERE session_id = ?")
            .bind(session_id)
            .fetch_all(&pool)
            .await
            .unwrap();

        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].item_name, "contacts.vcf");
        assert_eq!(logs[0].status, "success");
    }
}

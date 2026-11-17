use crate::commands::printer::PrintOpts;
use crate::diagnostics::types::{
    DeviceInspectionRecord, DiagnosticServerInfo, FullDeviceDiagnosticReport, SaveInspectionRequest,
};
use crate::diagnostics::DiagnosticEngine;
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::{AppHandle, State};

pub struct DiagnosticState {
    pub engine: Arc<DiagnosticEngine>,
}

impl DiagnosticState {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            engine: Arc::new(DiagnosticEngine::new(pool)),
        }
    }
}

#[tauri::command]
pub async fn probe_device(
    state: State<'_, DiagnosticState>,
    device_id: String,
    platform: Option<String>,
) -> Result<FullDeviceDiagnosticReport, String> {
    state
        .engine
        .probe_device(&device_id, platform.as_deref())
        .await
}

#[tauri::command]
pub async fn start_diagnostic_server(
    app: AppHandle,
    state: State<'_, DiagnosticState>,
) -> Result<DiagnosticServerInfo, String> {
    let mut server = state.engine.server_manager.lock().await;

    // Already running — hand back the live info so the PIN/QR stay valid and a
    // connected phone companion is never dropped by an unnecessary restart.
    if let Some(existing) = server.get_info() {
        return Ok(existing);
    }

    server.start(Some(app.clone())).await
}

#[tauri::command]
pub async fn send_mobile_diagnostic_command(
    state: State<'_, DiagnosticState>,
    action: String,
    params: Option<serde_json::Value>,
) -> Result<(), String> {
    let server = state.engine.server_manager.lock().await;
    server.send_command(action, params)
}

#[tauri::command]
pub async fn launch_mobile_companion_on_device(
    device_id: String,
    platform: String,
    connect_url: String,
) -> Result<String, String> {
    if platform.to_lowercase() == "android" {
        let output = crate::transfer::adb::adb_command()
            .args([
                "-s",
                &device_id,
                "shell",
                "am",
                "start",
                "-a",
                "android.intent.action.VIEW",
                "-d",
                &connect_url,
            ])
            .output()
            .await
            .map_err(|e| format!("Failed to execute adb: {}", e))?;

        if output.status.success() {
            Ok("Diagnostic companion app launched on Android phone screen".into())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    } else {
        Ok("Point iPhone Camera at the on-screen QR code to open companion suite".into())
    }
}

#[tauri::command]
pub async fn stop_diagnostic_server(
    state: State<'_, DiagnosticState>,
) -> Result<(), String> {
    let mut server = state.engine.server_manager.lock().await;
    server.stop();
    Ok(())
}

#[tauri::command]
pub async fn get_diagnostic_server_info(
    state: State<'_, DiagnosticState>,
) -> Result<Option<DiagnosticServerInfo>, String> {
    let server = state.engine.server_manager.lock().await;
    Ok(server.get_info())
}

#[derive(serde::Deserialize)]
pub struct TestUpdateItem {
    pub key: String,
    pub passed: bool,
    pub details: Option<String>,
}

#[tauri::command]
pub async fn update_report_test(
    state: State<'_, DiagnosticState>,
    mut report: FullDeviceDiagnosticReport,
    test_key: String,
    passed: bool,
    details: Option<String>,
) -> Result<FullDeviceDiagnosticReport, String> {
    state
        .engine
        .update_hardware_test(&mut report, &test_key, passed, details);
    Ok(report)
}

#[tauri::command]
pub async fn batch_update_report_tests(
    state: State<'_, DiagnosticState>,
    mut report: FullDeviceDiagnosticReport,
    updates: Vec<TestUpdateItem>,
) -> Result<FullDeviceDiagnosticReport, String> {
    let list: Vec<(String, bool, Option<String>)> = updates
        .into_iter()
        .map(|u| (u.key, u.passed, u.details))
        .collect();
    state.engine.batch_update_hardware_tests(&mut report, list);
    Ok(report)
}

#[tauri::command]
pub async fn save_device_inspection(
    state: State<'_, DiagnosticState>,
    req: SaveInspectionRequest,
) -> Result<DeviceInspectionRecord, String> {
    state.engine.save_inspection(req).await
}

#[tauri::command]
pub async fn list_device_inspections(
    state: State<'_, DiagnosticState>,
    limit: Option<i64>,
) -> Result<Vec<DeviceInspectionRecord>, String> {
    state.engine.list_inspections(limit.unwrap_or(50)).await
}

#[tauri::command]
pub async fn get_device_inspection(
    state: State<'_, DiagnosticState>,
    id: i64,
) -> Result<DeviceInspectionRecord, String> {
    state.engine.get_inspection_by_id(id).await
}

#[derive(serde::Serialize)]
pub struct VirtualDeviceOption {
    pub id: String,
    pub name: String,
    pub brand: String,
    pub os: String,
}

#[tauri::command]
pub async fn list_virtual_diagnostic_devices() -> Result<Vec<VirtualDeviceOption>, String> {
    let list = crate::diagnostics::virtual_probe::list_virtual_devices();
    let items = list
        .into_iter()
        .map(|(id, name, brand, os)| VirtualDeviceOption {
            id: id.into(),
            name: name.into(),
            brand: brand.into(),
            os: os.into(),
        })
        .collect();
    Ok(items)
}

#[derive(serde::Deserialize)]
pub struct ConvertToVariantRequest {
    pub inspection_id: i64,
    pub product_id: i64,
    pub variant_name: Option<String>,
    pub cost_price: f64,
    pub selling_price: f64,
    pub quantity: i64,
}

#[derive(serde::Serialize)]
pub struct ConvertToVariantResponse {
    pub variant_id: i64,
    pub inspection_uuid: String,
    pub message: String,
}

#[tauri::command]
pub async fn convert_inspection_to_variant(
    state: State<'_, DiagnosticState>,
    db_pool: State<'_, SqlitePool>,
    req: ConvertToVariantRequest,
) -> Result<ConvertToVariantResponse, String> {
    let inspection = state.engine.get_inspection_by_id(req.inspection_id).await?;

    let variant_name = req.variant_name.unwrap_or_else(|| {
        format!(
            "[Grade {}] {} (SN: {})",
            inspection.calculated_grade,
            inspection.model,
            inspection.serial_number.as_deref().unwrap_or("N/A")
        )
    });

    let condition_note = format!(
        "Grade: {} (Score: {}/100). Battery Health: {}% ({} Cycles). IMEI: {}. Passed Tests: {}/{}. Inspection #{}",
        inspection.calculated_grade,
        inspection.score,
        inspection.battery_health,
        inspection.battery_cycles,
        inspection.imei1.as_deref().unwrap_or("N/A"),
        inspection.passed_tests_count,
        inspection.total_tests_count,
        inspection.inspection_uuid
    );

    let barcode = inspection.imei1.clone().unwrap_or_else(|| {
        format!("INS-{}", inspection.id)
    });

    let sku = format!("HOU-CHK-{}", inspection.inspection_uuid);

    let res = sqlx::query(
        r#"
        INSERT INTO product_variants (
            product_id, variant_name, condition_note, quantity,
            cost_price, selling_price, barcode, sku, inspection_id,
            low_stock_threshold
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        "#,
    )
    .bind(req.product_id)
    .bind(&variant_name)
    .bind(&condition_note)
    .bind(req.quantity)
    .bind(req.cost_price)
    .bind(req.selling_price)
    .bind(&barcode)
    .bind(&sku)
    .bind(req.inspection_id)
    .execute(db_pool.inner())
    .await
    .map_err(|e| format!("Failed to create product variant from inspection: {}", e))?;

    Ok(ConvertToVariantResponse {
        variant_id: res.last_insert_rowid(),
        inspection_uuid: inspection.inspection_uuid,
        message: "Successfully created product variant linked to inspection certificate".into(),
    })
}

#[tauri::command]
pub async fn print_inspection_label(
    state: State<'_, DiagnosticState>,
    inspection_id: i64,
    printer_name: Option<String>,
    opts: Option<PrintOpts>,
) -> Result<(), String> {
    let inspection = state.engine.get_inspection_by_id(inspection_id).await?;

    // Build TSPL command stream for thermal label
    let opts = opts.unwrap_or_default();
    let mut tspl = String::new();

    tspl.push_str(&format!("SIZE {} mm, {} mm\n", opts.label_width_mm, opts.label_height_mm));
    tspl.push_str(&format!("GAP {} mm, 0 mm\n", opts.gap_mm));
    tspl.push_str(&format!("DENSITY {}\n", opts.density));
    tspl.push_str(&format!("DIRECTION {}\n", opts.direction));
    tspl.push_str("CLS\n");

    // Header
    tspl.push_str("TEXT 20,20,\"3\",0,1,1,\"HOUSHOP CERTIFIED\"\n");
    tspl.push_str(&format!("TEXT 20,55,\"2\",0,1,1,\"{}\"\n", inspection.model));
    tspl.push_str(&format!("TEXT 20,85,\"2\",0,1,1,\"GRADE: {}\"\n", inspection.calculated_grade));
    tspl.push_str(&format!("TEXT 20,115,\"1\",0,1,1,\"Battery: {}% ({} Cyc)\"\n", inspection.battery_health, inspection.battery_cycles));
    tspl.push_str(&format!("TEXT 20,140,\"1\",0,1,1,\"IMEI: {}\"\n", inspection.imei1.as_deref().unwrap_or("N/A")));
    tspl.push_str(&format!("TEXT 20,165,\"1\",0,1,1,\"Score: {}/100 ({} passed)\"\n", inspection.score, inspection.passed_tests_count));

    // Barcode for IMEI or Inspection UUID
    let bar_val = inspection.imei1.as_deref().unwrap_or(&inspection.inspection_uuid);
    tspl.push_str(&format!("BARCODE 20,195,\"128\",40,1,0,2,2,\"{}\"\n", bar_val));
    tspl.push_str(&format!("TEXT 20,245,\"1\",0,1,1,\"#{}\"\n", inspection.inspection_uuid));

    tspl.push_str(&format!("PRINT {},1\n", opts.copies.max(1)));

    #[cfg(target_os = "windows")]
    {
        let printer = match printer_name {
            Some(p) => p,
            None => {
                let printers = crate::commands::printer::list_printers().await?;
                printers.into_iter().next().ok_or_else(|| "No printer found on Windows".to_string())?
            }
        };

        crate::commands::printer::print_label_tspl(printer, tspl.into_bytes()).await?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        // On macOS/Linux dev environments, log the TSPL output
        println!("[TSPL Diagnostic Label Output]:\n{}", tspl);
        let _ = printer_name;
    }

    Ok(())
}

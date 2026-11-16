use crate::commands::printer::PrintOpts;
use crate::wipe::types::{
    ExecuteWipeRequest, PreWipeAuditResult, SanitizationRecord, WipeLabelOpts,
};
use crate::wipe::WipeEngine;
use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::{AppHandle, State};

pub struct WipeState {
    pub engine: Arc<WipeEngine>,
}

impl WipeState {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            engine: Arc::new(WipeEngine::new(pool)),
        }
    }
}

#[tauri::command]
pub async fn inspect_device_locks(
    _state: State<'_, WipeState>,
    device_id: String,
    platform: Option<String>,
) -> Result<PreWipeAuditResult, String> {
    let inspector = crate::wipe::LockInspector::new();
    inspector
        .inspect_device(&device_id, platform.as_deref())
        .await
}

#[tauri::command]
pub async fn launch_account_removal_screen(
    device_id: String,
    platform: String,
) -> Result<String, String> {
    let inspector = crate::wipe::LockInspector::new();
    inspector
        .launch_account_removal_screen(&device_id, &platform)
        .await
}

#[tauri::command]
pub async fn execute_wipe(
    app: AppHandle,
    state: State<'_, WipeState>,
    req: ExecuteWipeRequest,
) -> Result<SanitizationRecord, String> {
    state.engine.execute_wipe(Some(&app), req).await
}

#[tauri::command]
pub async fn list_sanitization_records(
    db_pool: State<'_, SqlitePool>,
    limit: Option<i64>,
) -> Result<Vec<SanitizationRecord>, String> {
    let cert_mgr = crate::wipe::CertificateManager::new(db_pool.inner().clone());
    cert_mgr.list_records(limit.unwrap_or(50)).await
}

#[tauri::command]
pub async fn get_sanitization_record(
    db_pool: State<'_, SqlitePool>,
    id: i64,
) -> Result<SanitizationRecord, String> {
    let cert_mgr = crate::wipe::CertificateManager::new(db_pool.inner().clone());
    cert_mgr.get_record_by_id(id).await
}

#[derive(serde::Deserialize)]
pub struct ConvertSanitizationToVariantRequest {
    pub sanitization_id: i64,
    pub product_id: i64,
    pub variant_name: Option<String>,
    pub cost_price: f64,
    pub selling_price: f64,
    pub quantity: i64,
}

#[derive(serde::Serialize)]
pub struct ConvertSanitizationToVariantResponse {
    pub variant_id: i64,
    pub certificate_number: String,
    pub message: String,
}

#[tauri::command]
pub async fn convert_sanitization_to_variant(
    db_pool: State<'_, SqlitePool>,
    req: ConvertSanitizationToVariantRequest,
) -> Result<ConvertSanitizationToVariantResponse, String> {
    let cert_mgr = crate::wipe::CertificateManager::new(db_pool.inner().clone());
    let record = cert_mgr.get_record_by_id(req.sanitization_id).await?;

    let variant_name = req.variant_name.unwrap_or_else(|| {
        format!(
            "[Sanitized] {} (SN: {})",
            record.model,
            record.serial_number.as_deref().unwrap_or("N/A")
        )
    });

    let condition_note = format!(
        "NIST SP 800-88 Purged (Cryptographic Erase). Factory Clean OOBE. Cert: {}. Model: {}. IMEI: {}. Wiped by: {}",
        record.certificate_number,
        record.model,
        record.imei.as_deref().unwrap_or("N/A"),
        record.technician_name
    );

    let barcode = record
        .imei
        .clone()
        .unwrap_or_else(|| record.certificate_number.clone());

    let sku = format!("WIPE-{}", &record.wipe_uuid[..8.min(record.wipe_uuid.len())]);

    let res = sqlx::query(
        r#"
        INSERT INTO product_variants (
            product_id, variant_name, condition_note, quantity,
            cost_price, selling_price, barcode, sku, sanitization_id,
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
    .bind(req.sanitization_id)
    .execute(db_pool.inner())
    .await
    .map_err(|e| format!("Failed to create product variant from sanitization: {}", e))?;

    Ok(ConvertSanitizationToVariantResponse {
        variant_id: res.last_insert_rowid(),
        certificate_number: record.certificate_number,
        message: "Successfully created product variant linked to sanitization certificate".into(),
    })
}

#[tauri::command]
pub async fn print_wipe_label(
    db_pool: State<'_, SqlitePool>,
    record_id: i64,
    printer_name: Option<String>,
    opts: Option<PrintOpts>,
) -> Result<(), String> {
    let cert_mgr = crate::wipe::CertificateManager::new(db_pool.inner().clone());
    let record = cert_mgr.get_record_by_id(record_id).await?;

    let print_opts = opts.unwrap_or_default();
    let wipe_opts = WipeLabelOpts {
        label_width_mm: print_opts.label_width_mm,
        label_height_mm: print_opts.label_height_mm,
        copies: print_opts.copies,
    };

    let tspl = cert_mgr.build_tspl_label(&record, wipe_opts);

    #[cfg(target_os = "windows")]
    {
        let printer = match printer_name {
            Some(p) => p,
            None => {
                let printers = crate::commands::printer::list_printers().await?;
                printers
                    .into_iter()
                    .next()
                    .ok_or_else(|| "No printer found on Windows".to_string())?
            }
        };

        crate::commands::printer::print_label_tspl(printer, tspl.into_bytes()).await?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        println!("[TSPL Sanitization Label Output]:\n{}", tspl);
        let _ = printer_name;
    }

    Ok(())
}

mod commands;
mod db;
mod diagnostics;
mod models;
mod session;
mod transfer;
mod wipe;
use std::sync::Arc;
use tauri::image::Image;
use tauri::Manager;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let pool = tauri::async_runtime::block_on(async move {
                db::init_db(&app_handle).await
            })
            .expect("Failed to initialize database");

            let transfers_dir = db::get_transfers_dir(app.handle()).unwrap_or_else(|_| std::path::PathBuf::from("./transfers"));
            let detector = Arc::new(transfer::DeviceDetector::new());
            let engine = Arc::new(transfer::TransferEngine::new(detector.clone(), pool.clone(), transfers_dir));
            let wifi_mgr = Arc::new(tokio::sync::Mutex::new(transfer::WifiServerManager::new()));
            let diagnostic_state = commands::diagnostics::DiagnosticState::new(pool.clone());
            let wipe_state = commands::wipe::WipeState::new(pool.clone());

            app.manage(pool);
            app.manage(session::SessionState::default());
            app.manage(detector.clone());
            app.manage(engine);
            app.manage(wifi_mgr);
            app.manage(diagnostic_state);
            app.manage(wipe_state);

            // Spawn continuous USB auto-detection task (polls every 2 seconds)
            let detector_poller = detector.clone();
            let app_handle_poller = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_millis(2000));
                loop {
                    interval.tick().await;
                    detector_poller.poll_and_emit_events(&app_handle_poller).await;
                }
            });

            println!("Database, HouSwitch Transfer, and HouCheck Diagnostic Engines initialized successfully");
            // Apply custom shop logo as the native window / dock / taskbar icon
            // before the webview finishes loading, so the OS chrome matches branding
            // from the first frame (including the loading splash).
            apply_stored_app_icon(app.handle());
            // Apply the custom shop name to the OS window title if one is stored.
            if let Some(name) = read_app_shop_name(app.handle()) {
                set_window_title(app.handle(), &name);
            }
            Ok(())
        })
        // Every command passes through the session guard: nothing outside the
        // public list runs unless a user is signed in.
        .invoke_handler(session::guard(tauri::generate_handler![
            commands::auth::login,
            commands::auth::logout,
            commands::auth::session_user,
            commands::auth::get_current_user,
            commands::auth::has_users,
            commands::auth::create_initial_admin,
            commands::auth::change_password,
            commands::product::get_products,
            commands::product::get_product_by_barcode,
            commands::product::find_barcode_conflicts,
            commands::product::search_products,
            commands::product::get_low_stock_products,
            commands::product::create_product,
            commands::product::update_product,
            commands::product::delete_product,
            commands::product::delete_variant,
            commands::product::move_variants_to_product,
            commands::product::get_categories,
            commands::product::create_category,
            commands::product::delete_category,
            commands::product::get_product_variants,
            commands::product::is_barcode_taken,
            commands::reservation::get_reservations,
            commands::reservation::get_active_reservations,
            commands::reservation::create_reservation,
            commands::reservation::complete_reservation,
            commands::reservation::cancel_reservation,
            commands::reservation::get_reservation_stats,
            commands::sale::create_sale,
            commands::sale::get_sales,
            commands::sale::get_sales_by_date,
            commands::sale::get_sales_summary,
            commands::sale::delete_sale,
            commands::returns::create_return,
            commands::returns::get_returns,
            commands::returns::get_returns_summary,
            commands::customer::get_customers,
            commands::customer::get_customer_by_id,
            commands::customer::search_customers,
            commands::customer::create_customer,
            commands::customer::update_customer,
            commands::customer::delete_customer,
            commands::customer::get_customers_with_stats,
            commands::customer::get_customer_stats,
            commands::inventory::add_stock,
            commands::inventory::get_inventory_transactions,
            commands::dashboard::get_dashboard_stats,
            commands::dashboard::get_daily_report,
            commands::dashboard::get_reports_by_range,
            commands::dashboard::get_inventory_valuation,
            commands::printer::list_printers,
            commands::printer::print_label,
            commands::transfer::get_phone_tool_status,
            commands::transfer::list_transfer_devices,
            commands::transfer::refresh_transfer_devices,
            commands::transfer::enable_virtual_devices,
            commands::transfer::scan_device_data,
            commands::transfer::start_phone_transfer,
            commands::transfer::pause_phone_transfer,
            commands::transfer::resume_phone_transfer,
            commands::transfer::cancel_phone_transfer,
            commands::transfer::get_transfer_sessions,
            commands::transfer::get_transfer_logs,
            commands::transfer::get_transfer_summary,
            commands::transfer::start_wifi_transfer_server,
            commands::transfer::stop_wifi_transfer_server,
            commands::transfer::get_wifi_transfer_server_info,
            commands::diagnostics::probe_device,
            commands::diagnostics::start_diagnostic_server,
            commands::diagnostics::stop_diagnostic_server,
            commands::diagnostics::get_diagnostic_server_info,
            commands::diagnostics::update_report_test,
            commands::diagnostics::save_device_inspection,
            commands::diagnostics::list_device_inspections,
            commands::diagnostics::get_device_inspection,
            commands::diagnostics::list_virtual_diagnostic_devices,
            commands::diagnostics::convert_inspection_to_variant,
            commands::diagnostics::print_inspection_label,
            commands::diagnostics::send_mobile_diagnostic_command,
            commands::diagnostics::launch_mobile_companion_on_device,
            commands::wipe::inspect_device_locks,
            commands::wipe::launch_account_removal_screen,
            commands::wipe::execute_wipe,
            commands::wipe::list_sanitization_records,
            commands::wipe::get_sanitization_record,
            commands::wipe::convert_sanitization_to_variant,
            commands::wipe::print_wipe_label,
            save_image,
            save_app_logo,
            get_app_logo,
            clear_app_logo,
            save_app_shop_name,
            get_app_shop_name,
            clear_app_shop_name,
            ]))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Update the OS window / taskbar title from the shop name.
/// Falls back to the bundle default when the name is empty.
fn set_window_title(app: &tauri::AppHandle, name: &str) {
    let title = if name.trim().is_empty() {
        "Shop Management - POS & Inventory".to_string()
    } else {
        format!("{} - POS & Inventory", name.trim())
    };
    let window = app
        .get_webview_window("main")
        .or_else(|| app.webview_windows().into_values().next());
    if let Some(win) = window {
        if let Err(e) = win.set_title(&title) {
            eprintln!("Failed to set window title: {}", e);
        }
    }
}

/// Locate `branding/logo.*` if present.
fn find_logo_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let branding_dir = db::get_branding_dir(app).ok()?;
    for name in ["logo.png", "logo.jpg", "logo.jpeg", "logo.webp", "logo.gif"] {
        let p = branding_dir.join(name);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

/// Set the main window icon from the on-disk custom logo (PNG preferred).
/// Updates dock (macOS) / taskbar (Windows) for the running app.
fn apply_stored_app_icon(app: &tauri::AppHandle) {
    let Some(path) = find_logo_path(app) else {
        return;
    };
    // image-png feature: PNG is reliable; other formats may fail — ignore quietly.
    let icon = match Image::from_path(&path) {
        Ok(i) => i,
        Err(e) => {
            eprintln!("Failed to load app logo icon from {}: {}", path.display(), e);
            return;
        }
    };
    // Prefer the primary window label from tauri.conf ("main" is the default when
    // only one window is declared without an explicit label — try both).
    let window = app
        .get_webview_window("main")
        .or_else(|| app.webview_windows().into_values().next());
    if let Some(win) = window {
        if let Err(e) = win.set_icon(icon) {
            eprintln!("Failed to set window icon: {}", e);
        }
    }
}

fn decode_data_url_or_base64(data: &str) -> Result<Vec<u8>, String> {
    let base64_data = if data.contains(',') {
        data.split(',').nth(1).unwrap_or(data)
    } else {
        data
    };
    base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        base64_data.trim(),
    )
    .map_err(|e| format!("Failed to decode image: {}", e))
}

fn clear_logo_files(branding_dir: &std::path::Path) {
    for name in ["logo.png", "logo.jpg", "logo.jpeg", "logo.webp", "logo.gif"] {
        let p = branding_dir.join(name);
        let _ = std::fs::remove_file(p);
    }
}

#[tauri::command]
async fn save_image(app: tauri::AppHandle, data: String, filename: String) -> Result<String, String> {
    let images_dir = db::get_images_dir(&app)?;
    let bytes = decode_data_url_or_base64(&data)?;
    let ext = std::path::Path::new(&filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");
    let unique_name = format!(
        "{}_{}.{}",
        uuid::Uuid::new_v4(),
        std::path::Path::new(&filename)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("image"),
        ext
    );
    let file_path = images_dir.join(&unique_name);
    std::fs::write(&file_path, bytes).map_err(|e| format!("Failed to save image: {}", e))?;
    Ok(file_path.to_string_lossy().to_string())
}

/// Persist the shop logo under `<app_data>/branding/logo.png`.
/// Always stores PNG so the native window icon path can load it with `image-png`.
/// Also applies the logo as the OS window / dock / taskbar icon immediately.
/// Returns the absolute path.
#[tauri::command]
async fn save_app_logo(
    app: tauri::AppHandle,
    data: String,
    filename: Option<String>,
) -> Result<String, String> {
    let _ = filename; // kept for API compatibility with the frontend
    let branding_dir = db::get_branding_dir(&app)?;
    let bytes = decode_data_url_or_base64(&data)?;
    if bytes.is_empty() {
        return Err("Empty image data".to_string());
    }
    // Cap at 8 MB so a huge photo can't fill the app data dir.
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("Logo image is too large (max 8 MB)".to_string());
    }
    clear_logo_files(&branding_dir);
    // Always write logo.png — frontend normalizes the upload to PNG before send.
    let file_path = branding_dir.join("logo.png");
    std::fs::write(&file_path, bytes).map_err(|e| format!("Failed to save logo: {}", e))?;
    // Update native icon right away (dock / taskbar / title bar).
    apply_stored_app_icon(&app);
    Ok(file_path.to_string_lossy().to_string())
}

/// Return the absolute path of the custom shop logo, if one has been uploaded.
#[tauri::command]
async fn get_app_logo(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(find_logo_path(&app).map(|p| p.to_string_lossy().to_string()))
}

/// Remove the custom shop logo (UI falls back to the bundled default).
/// Restores the bundled window icon when possible.
#[tauri::command]
async fn clear_app_logo(app: tauri::AppHandle) -> Result<(), String> {
    let branding_dir = db::get_branding_dir(&app)?;
    clear_logo_files(&branding_dir);
    // Restore the icon baked into the app binary.
    if let Some(icon) = app.default_window_icon().cloned() {
        let window = app
            .get_webview_window("main")
            .or_else(|| app.webview_windows().into_values().next());
        if let Some(win) = window {
            let _ = win.set_icon(icon);
        }
    }
    Ok(())
}

/// Persist the shop name under `<app_data>/branding/shop_name.txt`.
/// An empty name restores the default. Also updates the OS window title.
#[tauri::command]
async fn save_app_shop_name(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let branding_dir = db::get_branding_dir(&app)?;
    let trimmed = name.trim();
    let file_path = branding_dir.join("shop_name.txt");
    if trimmed.is_empty() {
        let _ = std::fs::remove_file(&file_path);
    } else {
        std::fs::write(&file_path, trimmed.as_bytes())
            .map_err(|e| format!("Failed to save shop name: {}", e))?;
    }
    set_window_title(&app, trimmed);
    Ok(())
}

/// Read the stored custom shop name (sync helper used by the command + startup).
fn read_app_shop_name(app: &tauri::AppHandle) -> Option<String> {
    let branding_dir = db::get_branding_dir(app).ok()?;
    let file_path = branding_dir.join("shop_name.txt");
    if !file_path.is_file() {
        return None;
    }
    let name = std::fs::read_to_string(&file_path).ok()?;
    let name = name.trim().to_string();
    if name.is_empty() { None } else { Some(name) }
}

/// Return the custom shop name, if one has been saved.
#[tauri::command]
async fn get_app_shop_name(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(read_app_shop_name(&app))
}

/// Remove the custom shop name and restore the default title.
#[tauri::command]
async fn clear_app_shop_name(app: tauri::AppHandle) -> Result<(), String> {
    let branding_dir = db::get_branding_dir(&app)?;
    let _ = std::fs::remove_file(branding_dir.join("shop_name.txt"));
    set_window_title(&app, "");
    Ok(())
}

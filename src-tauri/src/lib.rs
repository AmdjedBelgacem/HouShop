mod commands;
mod db;
mod models;
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
            app.manage(pool);
            println!("Database initialized successfully");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth::login,
            commands::auth::get_current_user,
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
            commands::printer::list_printers,
            commands::printer::print_label,
            save_image,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
#[tauri::command]
async fn save_image(app: tauri::AppHandle, data: String, filename: String) -> Result<String, String> {
    let images_dir = db::get_images_dir(&app)?;
    let base64_data = if data.contains(",") {
        data.split(",").nth(1).unwrap_or(&data)
    } else {
        &data
    };
    let bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        base64_data,
    )
    .map_err(|e| format!("Failed to decode image: {}", e))?;
    let ext = std::path::Path::new(&filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");
    let unique_name = format!("{}_{}.{}", uuid::Uuid::new_v4(),
        std::path::Path::new(&filename).file_stem().and_then(|s| s.to_str()).unwrap_or("image"),
        ext);
    let file_path = images_dir.join(&unique_name);
    std::fs::write(&file_path, bytes)
        .map_err(|e| format!("Failed to save image: {}", e))?;
    Ok(file_path.to_string_lossy().to_string())
}

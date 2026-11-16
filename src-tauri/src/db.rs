use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;
pub fn get_db_path(app: &AppHandle) -> Result<String, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    fs::create_dir_all(&app_data).map_err(|e| format!("Failed to create app data dir: {}", e))?;
    let db_path = app_data.join("shop.db");
    Ok(db_path.to_string_lossy().to_string())
}
pub async fn init_db(app: &AppHandle) -> Result<SqlitePool, String> {
    let db_path = get_db_path(app)?;
    let db_url = format!("sqlite:{}?mode=rwc", db_path);
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&db_url)
        .await
        .map_err(|e| format!("Failed to connect to database: {}", e))?;
    run_migrations(&pool).await?;
    seed_if_empty(&pool).await?;
    Ok(pool)
}
async fn run_migrations(pool: &SqlitePool) -> Result<(), String> {
    let migration_sql = include_str!("../migrations/20240101000001_init/up.sql");
    sqlx::query(migration_sql)
        .execute(pool)
        .await
        .map_err(|e| format!("Migration failed: {}", e))?;
    let _ = sqlx::query("ALTER TABLE products ADD COLUMN description TEXT").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE products ADD COLUMN sku TEXT").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE customers ADD COLUMN email TEXT").execute(pool).await;
    let _ = sqlx::query(
        "CREATE TABLE IF NOT EXISTS product_variants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            variant_name TEXT NOT NULL,
            condition_note TEXT,
            quantity INTEGER NOT NULL DEFAULT 0,
            cost_price REAL NOT NULL DEFAULT 0.0,
            selling_price REAL NOT NULL DEFAULT 0.0,
            barcode TEXT,
            sku TEXT,
            image_path TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        )"
    ).execute(pool).await;
    let _ = sqlx::query(
        "CREATE TABLE IF NOT EXISTS reservations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            variant_id INTEGER,
            quantity INTEGER NOT NULL DEFAULT 1,
            deposit_amount REAL NOT NULL DEFAULT 0.0,
            total_price REAL NOT NULL DEFAULT 0.0,
            remaining_amount REAL NOT NULL DEFAULT 0.0,
            status TEXT NOT NULL DEFAULT 'active',
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
            FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL
        )"
    ).execute(pool).await;
    // Returns: a customer hands back items from a past sale. Each row links to
    // the original sale item, records how many units came back, the refund given,
    // and a reason. create_return restocks the variant and adjusts the sale's
    // totals, so a return is both an inventory correction and a money record.
    let _ = sqlx::query(
        "CREATE TABLE IF NOT EXISTS returns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sale_id INTEGER NOT NULL,
            sale_item_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            variant_id INTEGER,
            quantity INTEGER NOT NULL,
            refund_amount REAL NOT NULL DEFAULT 0.0,
            reason TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
            FOREIGN KEY (sale_item_id) REFERENCES sale_items(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
            FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL
        )"
    ).execute(pool).await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_returns_sale ON returns(sale_id)").execute(pool).await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_returns_sale_item ON returns(sale_item_id)").execute(pool).await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id)").execute(pool).await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_reservations_customer ON reservations(customer_id)").execute(pool).await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_reservations_product ON reservations(product_id)").execute(pool).await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status)").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE product_variants ADD COLUMN image_path TEXT").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE sale_items ADD COLUMN variant_id INTEGER").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE sale_items ADD COLUMN variant_name TEXT").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE inventory_transactions ADD COLUMN variant_id INTEGER").execute(pool).await;
    // --- Variants become the single source of truth for stock/price/barcode/SKU.
    // Each variant gets its own low-stock threshold (alert is per variant), and
    // barcode/SKU are enforced unique so generated values can't collide across
    // variants. These run guarded by IF NOT EXISTS / try/ignore so they're safe
    // to apply repeatedly on existing databases.
    let _ = sqlx::query("ALTER TABLE product_variants ADD COLUMN low_stock_threshold INTEGER NOT NULL DEFAULT 5").execute(pool).await;
    let _ = sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_variants_barcode ON product_variants(barcode) WHERE barcode IS NOT NULL"
    ).execute(pool).await;
    let _ = sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_variants_sku ON product_variants(sku) WHERE sku IS NOT NULL"
    ).execute(pool).await;

    // --- HouSwitch: Phone Data Transfer Module tables
    let _ = sqlx::query(
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
    ).execute(pool).await;

    let _ = sqlx::query(
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
    ).execute(pool).await;

    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_transfer_sessions_status ON transfer_sessions(status)").execute(pool).await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_transfer_sessions_created ON transfer_sessions(started_at)").execute(pool).await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_transfer_logs_session ON transfer_logs(session_id)").execute(pool).await;

    // --- HouCheck: Universal Phone Diagnostic & Hardware Inspection tables
    let _ = sqlx::query(
        "CREATE TABLE IF NOT EXISTS device_inspections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            inspection_uuid TEXT NOT NULL UNIQUE,
            device_id TEXT NOT NULL,
            device_name TEXT NOT NULL,
            brand TEXT NOT NULL,
            model TEXT NOT NULL,
            platform TEXT NOT NULL,
            os_version TEXT NOT NULL,
            imei1 TEXT,
            imei2 TEXT,
            serial_number TEXT,
            battery_health INTEGER NOT NULL DEFAULT 100,
            battery_cycles INTEGER NOT NULL DEFAULT 0,
            battery_design_mah INTEGER NOT NULL DEFAULT 0,
            battery_actual_mah INTEGER NOT NULL DEFAULT 0,
            parts_audit JSON NOT NULL DEFAULT '{}',
            hardware_tests JSON NOT NULL DEFAULT '{}',
            score INTEGER NOT NULL DEFAULT 100,
            calculated_grade TEXT NOT NULL DEFAULT 'A+',
            passed_tests_count INTEGER NOT NULL DEFAULT 0,
            total_tests_count INTEGER NOT NULL DEFAULT 28,
            lock_status JSON NOT NULL DEFAULT '{}',
            technician_notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"
    ).execute(pool).await;

    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_device_inspections_uuid ON device_inspections(inspection_uuid)").execute(pool).await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_device_inspections_imei ON device_inspections(imei1)").execute(pool).await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_device_inspections_created ON device_inspections(created_at)").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE product_variants ADD COLUMN inspection_id INTEGER").execute(pool).await;

    // --- HouWipe: Universal Phone Sanitization, Account Removal & Secure Wipe System
    let _ = sqlx::query(
        "CREATE TABLE IF NOT EXISTS sanitization_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            wipe_uuid TEXT NOT NULL UNIQUE,
            device_id TEXT NOT NULL,
            device_name TEXT NOT NULL,
            brand TEXT NOT NULL,
            model TEXT NOT NULL,
            platform TEXT NOT NULL,
            os_version TEXT NOT NULL,
            imei TEXT,
            imei2 TEXT,
            serial_number TEXT,
            storage_capacity TEXT,
            wipe_method TEXT NOT NULL,
            nist_standard TEXT NOT NULL DEFAULT 'NIST SP 800-88 Rev. 1 Purge',
            pre_wipe_accounts_removed BOOLEAN NOT NULL DEFAULT 1,
            pre_wipe_lock_audit JSON NOT NULL DEFAULT '{}',
            post_wipe_oobe_verified BOOLEAN NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'completed',
            technician_name TEXT NOT NULL,
            notes TEXT,
            duration_seconds INTEGER NOT NULL DEFAULT 0,
            certificate_number TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"
    ).execute(pool).await;

    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_sanitization_uuid ON sanitization_records(wipe_uuid)").execute(pool).await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_sanitization_imei ON sanitization_records(imei)").execute(pool).await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_sanitization_cert ON sanitization_records(certificate_number)").execute(pool).await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_sanitization_created ON sanitization_records(created_at)").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE product_variants ADD COLUMN sanitization_id INTEGER").execute(pool).await;
    // Backfill: any legacy product that has no variants yet gets a single
    // "Default" variant cloned from the product's own (now-dormant) columns, so
    // it remains sellable after the model change. Idempotent — only touches
    // products that still have zero variants.
    backfill_default_variants(pool).await;
    sqlx::query("PRAGMA journal_mode=WAL;")
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to set WAL mode: {}", e))?;
    sqlx::query("PRAGMA foreign_keys=ON;")
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to enable foreign keys: {}", e))?;
    Ok(())
}
/// Seeds starter categories and sample products into a brand-new database.
/// No user account is created here. The first administrator is created on the setup
/// screen (`create_initial_admin`), so no default password ships with the app.
async fn seed_if_empty(pool: &SqlitePool) -> Result<(), String> {
    let category_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM categories")
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to count categories: {}", e))?;
    if category_count.0 > 0 {
        return Ok(());
    }
    let categories = vec![
        "Smartphones",
        "Tablets",
        "Laptops",
        "Chargers",
        "Earbuds",
        "Headsets",
        "Cases & Covers",
        "Screen Protectors",
        "Cables",
        "Power Banks",
        "Speakers",
        "Smartwatches",
        "Accessories",
    ];
    for cat in &categories {
        sqlx::query("INSERT OR IGNORE INTO categories (name) VALUES (?)")
            .bind(cat)
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to seed category: {}", e))?;
    }
    let sample_products = vec![
        ("iPhone 15 Pro Max", "Smartphones", 15, 899.00, 1199.00, "194253978456"),
        ("Samsung Galaxy S24 Ultra", "Smartphones", 12, 799.00, 1099.00, "8806095169045"),
        ("iPad Air M2", "Tablets", 8, 499.00, 699.00, "194253978123"),
        ("MacBook Air 13\"", "Laptops", 5, 899.00, 1199.00, "194253978789"),
        ("Anker 65W GaN Charger", "Chargers", 25, 25.00, 49.99, "6934965100011"),
        ("AirPods Pro 2", "Earbuds", 20, 180.00, 249.00, "194253978457"),
        ("Sony WH-1000XM5", "Headsets", 10, 250.00, 399.00, "027242922825"),
        ("iPhone 15 Silicone Case", "Cases & Covers", 40, 15.00, 39.99, "194253978001"),
        ("USB-C to Lightning Cable 1m", "Cables", 50, 5.00, 19.99, "6934965100028"),
        ("Anker PowerCore 20000mAh", "Power Banks", 15, 35.00, 59.99, "6934965100035"),
    ];
    for (name, category, qty, cost, price, barcode) in sample_products {
        let category_id: Option<(i64,)> =
            sqlx::query_as("SELECT id FROM categories WHERE name = ?")
                .bind(category)
                .fetch_optional(pool)
                .await
                .map_err(|e| format!("Failed to find category: {}", e))?;
        if let Some((cat_id,)) = category_id {
            sqlx::query(
                "INSERT INTO products (name, category_id, quantity, cost_price, selling_price, barcode, low_stock_threshold) VALUES (?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(name)
            .bind(cat_id)
            .bind(qty)
            .bind(cost)
            .bind(price)
            .bind(barcode)
            .bind(5_i64)
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to seed product: {}", e))?;
        }
    }
    Ok(())
}
/// Backfill a single "Default" variant for every product that has no variants
/// yet. Variants are now the single source of truth for stock, prices, barcode,
/// and SKU — so a legacy product with zero variants would become unsellable.
/// Cloning the product's own columns into one Default variant keeps existing
/// data working transparently. Idempotent: re-runs only touch products still
/// missing variants. Rows whose barcode/SKU would collide with an existing
/// variant are nulled out rather than failing the whole backfill.
async fn backfill_default_variants(pool: &SqlitePool) {
    // Products that still have no variants.
    let orphans: Result<Vec<(i64, Option<String>, i64, f64, f64, Option<String>, Option<String>, i64)>, _> = sqlx::query_as(
        r#"SELECT p.id, p.name, p.quantity, p.cost_price, p.selling_price,
                  p.barcode, p.sku, p.low_stock_threshold
           FROM products p
           WHERE NOT EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id)"#,
    )
    .fetch_all(pool)
    .await;

    let orphans = match orphans {
        Ok(rows) => rows,
        Err(e) => {
            eprintln!("Backfill scan failed: {}", e);
            return;
        }
    };
    for (id, name, qty, cost, price, barcode, sku, threshold) in orphans {
        // Null out barcode/SKU if another variant already owns them, to avoid a
        // unique-index violation. The merchant can regenerate unique ones later.
        let barcode_safe = match &barcode {
            Some(b) if !b.is_empty() => {
                let taken: Result<(i64,), _> = sqlx::query_as(
                    "SELECT COUNT(*) FROM product_variants WHERE barcode = ?",
                )
                .bind(b)
                .fetch_one(pool)
                .await;
                match taken {
                    Ok((c,)) if c > 0 => None,
                    _ => barcode.clone(),
                }
            }
            _ => None,
        };
        let sku_safe = match &sku {
            Some(s) if !s.is_empty() => {
                let taken: Result<(i64,), _> = sqlx::query_as(
                    "SELECT COUNT(*) FROM product_variants WHERE sku = ?",
                )
                .bind(s)
                .fetch_one(pool)
                .await;
                match taken {
                    Ok((c,)) if c > 0 => None,
                    _ => sku.clone(),
                }
            }
            _ => None,
        };
        let variant_name = name.unwrap_or_else(|| "Default".to_string());
        let res = sqlx::query(
            r#"INSERT INTO product_variants
               (product_id, variant_name, condition_note, quantity, cost_price, selling_price,
                barcode, sku, image_path, low_stock_threshold)
               VALUES (?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?)"#,
        )
        .bind(id)
        .bind(&variant_name)
        .bind(qty)
        .bind(cost)
        .bind(price)
        .bind(&barcode_safe)
        .bind(&sku_safe)
        .bind(threshold)
        .execute(pool)
        .await;
        if let Err(e) = res {
            eprintln!("Backfill insert failed for product {}: {}", id, e);
        }
    }
}
pub fn get_images_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let images_dir = app_data.join("images");
    fs::create_dir_all(&images_dir)
        .map_err(|e| format!("Failed to create images dir: {}", e))?;
    Ok(images_dir)
}

/// App branding assets (custom logo, etc.) live under `<app_data>/branding/`.
pub fn get_branding_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let branding_dir = app_data.join("branding");
    fs::create_dir_all(&branding_dir)
        .map_err(|e| format!("Failed to create branding dir: {}", e))?;
    Ok(branding_dir)
}

/// Base staging directory for phone data transfers under `<app_data>/transfers/`.
pub fn get_transfers_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let transfers_dir = app_data.join("transfers");
    fs::create_dir_all(&transfers_dir)
        .map_err(|e| format!("Failed to create transfers dir: {}", e))?;
    Ok(transfers_dir)
}

/// Session-specific scratch directory `<app_data>/transfers/temp/<session_uuid>/`.
#[allow(dead_code)]
pub fn get_transfers_temp_dir(app: &AppHandle, session_uuid: &str) -> Result<PathBuf, String> {
    let base = get_transfers_dir(app)?;
    let session_dir = base.join("temp").join(session_uuid);
    fs::create_dir_all(&session_dir)
        .map_err(|e| format!("Failed to create session temp dir: {}", e))?;
    Ok(session_dir)
}

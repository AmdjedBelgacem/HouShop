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
async fn seed_if_empty(pool: &SqlitePool) -> Result<(), String> {
    let user_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to count users: {}", e))?;
    if user_count.0 > 0 {
        return Ok(());
    }
    let password_hash =
        bcrypt::hash("admin123", 4).map_err(|e| format!("Bcrypt error: {}", e))?;
    sqlx::query("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
        .bind("admin")
        .bind(&password_hash)
        .bind("admin")
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to seed admin user: {}", e))?;
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

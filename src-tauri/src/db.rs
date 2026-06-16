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
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id)").execute(pool).await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_reservations_customer ON reservations(customer_id)").execute(pool).await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_reservations_product ON reservations(product_id)").execute(pool).await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status)").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE product_variants ADD COLUMN image_path TEXT").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE sale_items ADD COLUMN variant_id INTEGER").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE sale_items ADD COLUMN variant_name TEXT").execute(pool).await;
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

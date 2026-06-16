use sqlx::SqlitePool;
use tauri::State;
use crate::models::{
    Category, CreateCategory, CreateProduct, CreateVariant, Product, ProductVariant,
    ProductWithCategory, UpdateProduct, UpdateVariant,
};
#[tauri::command]
pub async fn get_categories(pool: State<'_, SqlitePool>) -> Result<Vec<Category>, String> {
    sqlx::query_as("SELECT * FROM categories ORDER BY name")
        .fetch_all(pool.inner())
        .await
        .map_err(|e| format!("Failed to fetch categories: {}", e))
}
#[tauri::command]
pub async fn create_category(
    pool: State<'_, SqlitePool>,
    data: CreateCategory,
) -> Result<Category, String> {
    let result = sqlx::query("INSERT INTO categories (name) VALUES (?)")
        .bind(&data.name)
        .execute(pool.inner())
        .await
        .map_err(|e| format!("Failed to create category: {}", e))?;
    let id = result.last_insert_rowid();
    sqlx::query_as("SELECT * FROM categories WHERE id = ?")
        .bind(id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Failed to fetch created category: {}", e))
}
#[tauri::command]
pub async fn delete_category(pool: State<'_, SqlitePool>, id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM categories WHERE id = ?")
        .bind(id)
        .execute(pool.inner())
        .await
        .map_err(|e| format!("Failed to delete category: {}", e))?;
    Ok(())
}
#[tauri::command]
pub async fn get_products(pool: State<'_, SqlitePool>) -> Result<Vec<ProductWithCategory>, String> {
    sqlx::query_as(
        r#"
        SELECT p.id, p.name, p.category_id, c.name as category_name,
               p.quantity, p.cost_price, p.selling_price, p.barcode,
               p.image_path, p.description, p.sku, p.low_stock_threshold,
               p.created_at, p.updated_at
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        ORDER BY p.name
        "#,
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Failed to fetch products: {}", e))
}
#[tauri::command]
pub async fn get_product_by_barcode(
    pool: State<'_, SqlitePool>,
    barcode: String,
) -> Result<ProductWithCategory, String> {
    sqlx::query_as(
        r#"
        SELECT p.id, p.name, p.category_id, c.name as category_name,
               p.quantity, p.cost_price, p.selling_price, p.barcode,
               p.image_path, p.description, p.sku, p.low_stock_threshold,
               p.created_at, p.updated_at
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.barcode = ?
        "#,
    )
    .bind(&barcode)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| format!("Failed to search product: {}", e))?
    .ok_or("Product not found".to_string())
}
#[tauri::command]
pub async fn search_products(
    pool: State<'_, SqlitePool>,
    query: String,
) -> Result<Vec<ProductWithCategory>, String> {
    let search = format!("%{}%", query);
    sqlx::query_as(
        r#"
        SELECT p.id, p.name, p.category_id, c.name as category_name,
               p.quantity, p.cost_price, p.selling_price, p.barcode,
               p.image_path, p.description, p.sku, p.low_stock_threshold,
               p.created_at, p.updated_at
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.name LIKE ? OR p.barcode LIKE ?
        ORDER BY p.name
        LIMIT 20
        "#,
    )
    .bind(&search)
    .bind(&search)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Failed to search products: {}", e))
}
#[tauri::command]
pub async fn get_low_stock_products(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<ProductWithCategory>, String> {
    sqlx::query_as(
        r#"
        SELECT p.id, p.name, p.category_id, c.name as category_name,
               p.quantity, p.cost_price, p.selling_price, p.barcode,
               p.image_path, p.description, p.sku, p.low_stock_threshold,
               p.created_at, p.updated_at
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.quantity <= p.low_stock_threshold
        ORDER BY p.quantity ASC
        "#,
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Failed to fetch low stock products: {}", e))
}
#[tauri::command]
pub async fn create_product(
    pool: State<'_, SqlitePool>,
    data: CreateProduct,
) -> Result<Product, String> {
    let result = sqlx::query(
        r#"INSERT INTO products (name, category_id, quantity, cost_price, selling_price, barcode, image_path, description, sku, low_stock_threshold)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(&data.name)
    .bind(data.category_id)
    .bind(data.quantity.unwrap_or(0))
    .bind(data.cost_price)
    .bind(data.selling_price)
    .bind(&data.barcode)
    .bind(&data.image_path)
    .bind(&data.description)
    .bind(&data.sku)
    .bind(data.low_stock_threshold.unwrap_or(5))
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Failed to create product: {}", e))?;
    let id = result.last_insert_rowid();
    sqlx::query_as("SELECT * FROM products WHERE id = ?")
        .bind(id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Failed to fetch created product: {}", e))
}
#[tauri::command]
pub async fn update_product(
    pool: State<'_, SqlitePool>,
    data: UpdateProduct,
) -> Result<Product, String> {
    sqlx::query(
        r#"UPDATE products
           SET name = ?, category_id = ?, cost_price = ?, selling_price = ?,
               barcode = ?, image_path = ?, description = ?, sku = ?,
               low_stock_threshold = ?, updated_at = datetime('now')
           WHERE id = ?"#,
    )
    .bind(&data.name)
    .bind(data.category_id)
    .bind(data.cost_price)
    .bind(data.selling_price)
    .bind(&data.barcode)
    .bind(&data.image_path)
    .bind(&data.description)
    .bind(&data.sku)
    .bind(data.low_stock_threshold.unwrap_or(5))
    .bind(data.id)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Failed to update product: {}", e))?;
    sqlx::query_as("SELECT * FROM products WHERE id = ?")
        .bind(data.id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Failed to fetch updated product: {}", e))
}
#[tauri::command]
pub async fn delete_product(pool: State<'_, SqlitePool>, id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM products WHERE id = ?")
        .bind(id)
        .execute(pool.inner())
        .await
        .map_err(|e| format!("Failed to delete product: {}", e))?;
    Ok(())
}
#[tauri::command]
pub async fn get_product_variants(
    pool: State<'_, SqlitePool>,
    product_id: i64,
) -> Result<Vec<ProductVariant>, String> {
    sqlx::query_as(
        "SELECT * FROM product_variants WHERE product_id = ? ORDER BY variant_name",
    )
    .bind(product_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Failed to fetch variants: {}", e))
}
#[tauri::command]
pub async fn create_variant(
    pool: State<'_, SqlitePool>,
    data: CreateVariant,
) -> Result<ProductVariant, String> {
    let result = sqlx::query(
        r#"INSERT INTO product_variants (product_id, variant_name, condition_note, quantity, cost_price, selling_price, barcode, sku, image_path)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(data.product_id)
    .bind(&data.variant_name)
    .bind(&data.condition_note)
    .bind(data.quantity.unwrap_or(0))
    .bind(data.cost_price)
    .bind(data.selling_price)
    .bind(&data.barcode)
    .bind(&data.sku)
    .bind(&data.image_path)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Failed to create variant: {}", e))?;
    let id = result.last_insert_rowid();
    sqlx::query_as("SELECT * FROM product_variants WHERE id = ?")
        .bind(id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Failed to fetch created variant: {}", e))
}
#[tauri::command]
pub async fn update_variant(
    pool: State<'_, SqlitePool>,
    data: UpdateVariant,
) -> Result<ProductVariant, String> {
    sqlx::query(
        r#"UPDATE product_variants
           SET variant_name = ?, condition_note = ?, quantity = ?, cost_price = ?,
               selling_price = ?, barcode = ?, sku = ?, image_path = ?, updated_at = datetime('now')
           WHERE id = ?"#,
    )
    .bind(&data.variant_name)
    .bind(&data.condition_note)
    .bind(data.quantity.unwrap_or(0))
    .bind(data.cost_price)
    .bind(data.selling_price)
    .bind(&data.barcode)
    .bind(&data.sku)
    .bind(&data.image_path)
    .bind(data.id)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Failed to update variant: {}", e))?;
    sqlx::query_as("SELECT * FROM product_variants WHERE id = ?")
        .bind(data.id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Failed to fetch updated variant: {}", e))
}
#[tauri::command]
pub async fn delete_variant(pool: State<'_, SqlitePool>, id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM product_variants WHERE id = ?")
        .bind(id)
        .execute(pool.inner())
        .await
        .map_err(|e| format!("Failed to delete variant: {}", e))?;
    Ok(())
}

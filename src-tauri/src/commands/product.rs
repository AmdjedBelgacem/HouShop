use sqlx::{SqlitePool, Transaction};
use tauri::State;
use crate::models::{
    BarcodeLookup, Category, CreateCategory, CreateProduct, Product, ProductVariant,
    ProductWithCategory, UpdateProduct, VariantInput,
};

// Variants are the single source of truth for stock/price/barcode/SKU. These
// column aliases are reused by every product-list query so the aggregate shape
// matches `ProductWithCategory` exactly. The product's own (now-dormant) columns
// supply the descriptive/catalog fields and `image_path`/`description`.
const PRODUCT_AGGREGATE_SELECT: &str = r#"
    SELECT p.id, p.name, p.category_id, c.name AS category_name,
           COALESCE(s.qty, 0)        AS quantity,
           COALESCE(s.cost, 0)       AS cost_price,
           COALESCE(s.price, 0)      AS selling_price,
           s.barcode                 AS barcode,
           p.image_path, p.description, p.sku, p.low_stock_threshold,
           COALESCE(s.vc, 0)         AS variant_count,
           p.created_at, p.updated_at
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN (
        SELECT product_id,
               SUM(quantity)                      AS qty,
               MIN(cost_price)                    AS cost,
               MIN(selling_price)                 AS price,
               (SELECT pv2.barcode FROM product_variants pv2
                  WHERE pv2.product_id = product_variants.product_id
                    AND pv2.barcode IS NOT NULL
                  LIMIT 1)                        AS barcode,
               COUNT(*)                           AS vc
        FROM product_variants
        GROUP BY product_id
    ) s ON s.product_id = p.id
"#;

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
    let sql = format!("{} ORDER BY p.name", PRODUCT_AGGREGATE_SELECT);
    sqlx::query_as(&sql)
        .fetch_all(pool.inner())
        .await
        .map_err(|e| format!("Failed to fetch products: {}", e))
}

#[tauri::command]
pub async fn get_product_by_barcode(
    pool: State<'_, SqlitePool>,
    barcode: String,
) -> Result<BarcodeLookup, String> {
    // Barcodes now live only on variants. Look up the variant whose barcode
    // matches, then resolve its parent product. The matched variant is returned
    // so checkout auto-selects it instead of re-opening the picker.
    let variant = sqlx::query_as::<_, ProductVariant>(
        r#"
        SELECT id, product_id, variant_name, condition_note, quantity,
               cost_price, selling_price, barcode, sku, image_path,
               low_stock_threshold, created_at, updated_at
        FROM product_variants
        WHERE barcode = ?
        LIMIT 1
        "#,
    )
    .bind(&barcode)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| format!("Failed to search variant: {}", e))?
    .ok_or("Product not found".to_string())?;

    let sql = format!("{} WHERE p.id = ?", PRODUCT_AGGREGATE_SELECT);
    let product = sqlx::query_as::<_, ProductWithCategory>(&sql)
        .bind(variant.product_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Failed to fetch product: {}", e))?;

    Ok(BarcodeLookup { product, variant: Some(variant) })
}

#[tauri::command]
pub async fn search_products(
    pool: State<'_, SqlitePool>,
    query: String,
) -> Result<Vec<ProductWithCategory>, String> {
    let search = format!("%{}%", query);
    let sql = format!("{} WHERE p.name LIKE ? ORDER BY p.name LIMIT 20", PRODUCT_AGGREGATE_SELECT);
    sqlx::query_as(&sql)
        .bind(&search)
        .fetch_all(pool.inner())
        .await
        .map_err(|e| format!("Failed to search products: {}", e))
}

#[tauri::command]
pub async fn get_low_stock_products(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<ProductWithCategory>, String> {
    // "Low stock" means at least one of the product's variants is at or below
    // its own threshold. We surface the product (not each variant) to keep the
    // dashboard list at product granularity.
    let sql = format!(
        r#"{}
           WHERE EXISTS (
               SELECT 1 FROM product_variants pv
               WHERE pv.product_id = p.id
                 AND pv.quantity <= pv.low_stock_threshold
           )
           ORDER BY p.name"#,
        PRODUCT_AGGREGATE_SELECT
    );
    sqlx::query_as(&sql)
        .fetch_all(pool.inner())
        .await
        .map_err(|e| format!("Failed to fetch low stock products: {}", e))
}

/// Insert one variant, normalizing empty strings to NULL so the unique indexes
/// (which only cover non-NULL barcode/sku) don't reject duplicate empties.
/// Returns the new variant row.
async fn insert_variant(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    product_id: i64,
    v: &VariantInput,
) -> Result<ProductVariant, String> {
    let barcode = normalize_optional(&v.barcode);
    let sku = normalize_optional(&v.sku);
    let result = sqlx::query(
        r#"INSERT INTO product_variants
           (product_id, variant_name, condition_note, quantity, cost_price, selling_price,
            barcode, sku, image_path, low_stock_threshold)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(product_id)
    .bind(&v.variant_name)
    .bind(normalize_optional(&v.condition_note))
    .bind(v.quantity.unwrap_or(0))
    .bind(v.cost_price)
    .bind(v.selling_price)
    .bind(&barcode)
    .bind(&sku)
    .bind(normalize_optional(&v.image_path))
    .bind(v.low_stock_threshold.unwrap_or(5))
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("Failed to create variant '{}': {}", v.variant_name, e))?;
    let id = result.last_insert_rowid();
    sqlx::query_as(
        r#"SELECT id, product_id, variant_name, condition_note, quantity,
                  cost_price, selling_price, barcode, sku, image_path,
                  low_stock_threshold, created_at, updated_at
           FROM product_variants WHERE id = ?"#,
    )
    .bind(id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| format!("Failed to fetch created variant: {}", e))
}

/// Update an existing variant (must belong to `product_id`). Empty barcode/SKU
/// are normalized to NULL for the same reason as `insert_variant`.
async fn update_variant_row(
    tx: &mut Transaction<'_, sqlx::Sqlite>,
    product_id: i64,
    v: &VariantInput,
) -> Result<(), String> {
    let id = v.id.ok_or("Variant id required for update")?;
    let barcode = normalize_optional(&v.barcode);
    let sku = normalize_optional(&v.sku);
    sqlx::query(
        r#"UPDATE product_variants
           SET variant_name = ?, condition_note = ?, quantity = ?, cost_price = ?,
               selling_price = ?, barcode = ?, sku = ?, image_path = ?,
               low_stock_threshold = ?, updated_at = datetime('now')
           WHERE id = ? AND product_id = ?"#,
    )
    .bind(&v.variant_name)
    .bind(normalize_optional(&v.condition_note))
    .bind(v.quantity.unwrap_or(0))
    .bind(v.cost_price)
    .bind(v.selling_price)
    .bind(&barcode)
    .bind(&sku)
    .bind(normalize_optional(&v.image_path))
    .bind(v.low_stock_threshold.unwrap_or(5))
    .bind(id)
    .bind(product_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("Failed to update variant '{}': {}", v.variant_name, e))?;
    Ok(())
}

#[tauri::command]
pub async fn create_product(
    pool: State<'_, SqlitePool>,
    data: CreateProduct,
) -> Result<Product, String> {
    if data.variants.is_empty() {
        return Err("At least one variant is required".to_string());
    }
    let mut tx = pool
        .inner()
        .begin()
        .await
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;
    // Parent product is a descriptive/catalog entity only; the sellable data
    // lives in its variants. Legacy numeric columns are seeded to 0 since they
    // are no longer read anywhere.
    let result = sqlx::query(
        r#"INSERT INTO products (name, category_id, quantity, cost_price, selling_price,
                                 barcode, image_path, description, sku, low_stock_threshold)
           VALUES (?, ?, 0, 0, 0, NULL, ?, ?, NULL, 5)"#,
    )
    .bind(&data.name)
    .bind(data.category_id)
    .bind(&data.image_path)
    .bind(&data.description)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to create product: {}", e))?;
    let id = result.last_insert_rowid();
    for v in &data.variants {
        insert_variant(&mut tx, id, v).await?;
    }
    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit product: {}", e))?;
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
    if data.variants.is_empty() {
        return Err("At least one variant is required".to_string());
    }
    let mut tx = pool
        .inner()
        .begin()
        .await
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;
    sqlx::query(
        r#"UPDATE products
           SET name = ?, category_id = ?, image_path = ?, description = ?, updated_at = datetime('now')
           WHERE id = ?"#,
    )
    .bind(&data.name)
    .bind(data.category_id)
    .bind(&data.image_path)
    .bind(&data.description)
    .bind(data.id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to update product: {}", e))?;
    // Reconcile variants to the desired set: keep+update the ones with an id,
    // insert the new ones, delete any existing variant not in the payload.
    let keep_ids: Vec<i64> = data.variants.iter().filter_map(|v| v.id).collect();
    let existing: Vec<(i64,)> = sqlx::query_as("SELECT id FROM product_variants WHERE product_id = ?")
        .bind(data.id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| format!("Failed to load existing variants: {}", e))?;
    let to_delete: Vec<i64> = existing
        .into_iter()
        .map(|(id,)| id)
        .filter(|id| !keep_ids.contains(id))
        .collect();
    for id in &to_delete {
        sqlx::query("DELETE FROM product_variants WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to delete variant: {}", e))?;
    }
    for v in &data.variants {
        if v.id.is_some() {
            update_variant_row(&mut tx, data.id, v).await?;
        } else {
            insert_variant(&mut tx, data.id, v).await?;
        }
    }
    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit product update: {}", e))?;
    sqlx::query_as("SELECT * FROM products WHERE id = ?")
        .bind(data.id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Failed to fetch updated product: {}", e))
}

#[tauri::command]
pub async fn delete_product(pool: State<'_, SqlitePool>, id: i64) -> Result<(), String> {
    // ON DELETE CASCADE on product_variants removes the variants too.
    sqlx::query("DELETE FROM products WHERE id = ?")
        .bind(id)
        .execute(pool.inner())
        .await
        .map_err(|e| format!("Failed to delete product: {}", e))?;
    Ok(())
}

/// Delete a single variant. A product must keep at least one variant (it's the
/// sellable unit), so this refuses to remove the last one. Related rows are safe:
/// `sale_items.variant_id` and `returns.variant_id` are `ON DELETE SET NULL`,
/// and `inventory_transactions.variant_id` has no FK constraint.
#[tauri::command]
pub async fn delete_variant(
    pool: State<'_, SqlitePool>,
    id: i64,
) -> Result<(), String> {
    // Guard: never leave a product with zero variants (it'd be unsellable).
    let parent: Option<(i64,)> = sqlx::query_as("SELECT product_id FROM product_variants WHERE id = ?")
        .bind(id)
        .fetch_optional(pool.inner())
        .await
        .map_err(|e| format!("Failed to find variant: {}", e))?;
    let product_id = match parent {
        Some((pid,)) => pid,
        None => return Ok(()), // already gone — idempotent
    };
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM product_variants WHERE product_id = ?")
        .bind(product_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Failed to count variants: {}", e))?;
    if count.0 <= 1 {
        return Err("Cannot delete the last variant of a product".to_string());
    }
    sqlx::query("DELETE FROM product_variants WHERE id = ?")
        .bind(id)
        .execute(pool.inner())
        .await
        .map_err(|e| format!("Failed to delete variant: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn get_product_variants(
    pool: State<'_, SqlitePool>,
    product_id: i64,
) -> Result<Vec<ProductVariant>, String> {
    sqlx::query_as(
        r#"SELECT id, product_id, variant_name, condition_note, quantity,
                  cost_price, selling_price, barcode, sku, image_path,
                  low_stock_threshold, created_at, updated_at
           FROM product_variants WHERE product_id = ? ORDER BY variant_name"#,
    )
    .bind(product_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Failed to fetch variants: {}", e))
}

/// Treat whitespace-only/empty strings as SQL NULL. SQLite's unique partial
/// indexes skip NULLs but enforce uniqueness on non-NULL values, so this lets a
/// merchant leave barcode/SKU blank on some variants while keeping the filled
/// ones unique.
fn normalize_optional(s: &Option<String>) -> Option<String> {
    s.as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Check whether a barcode is already used by any variant. Barcodes must be
/// unique across the whole catalog (two products can't share one), enforced by a
/// unique partial index; this command lets the frontend detect collisions before
/// saving (e.g. when auto-generating) instead of failing the insert.
///
/// `exclude_variant_id` lets a variant "keep" its own barcode when editing.
#[tauri::command]
pub async fn is_barcode_taken(
    pool: State<'_, SqlitePool>,
    barcode: String,
    exclude_variant_id: Option<i64>,
) -> Result<bool, String> {
    let barcode = barcode.trim();
    if barcode.is_empty() {
        return Ok(false);
    }
    let taken: (i64,) = match exclude_variant_id {
        Some(vid) => sqlx::query_as(
            "SELECT COUNT(*) FROM product_variants WHERE barcode = ? AND id != ?",
        )
        .bind(barcode)
        .bind(vid)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Failed to check barcode: {}", e))?,
        None => sqlx::query_as("SELECT COUNT(*) FROM product_variants WHERE barcode = ?")
            .bind(barcode)
            .fetch_one(pool.inner())
            .await
            .map_err(|e| format!("Failed to check barcode: {}", e))?,
    };
    Ok(taken.0 > 0)
}

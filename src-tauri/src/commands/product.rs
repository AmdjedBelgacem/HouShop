use sqlx::{SqlitePool, Transaction};
use tauri::State;
use crate::models::{
    BarcodeConflictCheck, BarcodeConflictVariant, BarcodeLookup, Category, CreateCategory,
    CreateProduct, Product, ProductVariant, ProductWithCategory, UpdateProduct, VariantInput,
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
pub async fn find_barcode_conflicts(
    pool: State<'_, SqlitePool>,
    checks: Vec<BarcodeConflictCheck>,
) -> Result<Vec<BarcodeConflictVariant>, String> {
    let mut conflicts = Vec::new();
    for check in checks {
        let barcode = check.barcode.trim();
        if barcode.is_empty() {
            continue;
        }

        let mut rows = match check.exclude_variant_id {
            Some(exclude_id) => sqlx::query_as::<_, BarcodeConflictVariant>(
                r#"
                SELECT pv.barcode AS barcode,
                       pv.id AS variant_id,
                       pv.variant_name AS variant_name,
                       p.id AS product_id,
                       p.name AS product_name,
                       c.name AS category_name,
                       pv.sku AS sku,
                       pv.quantity AS quantity,
                       pv.selling_price AS selling_price
                FROM product_variants pv
                JOIN products p ON pv.product_id = p.id
                LEFT JOIN categories c ON p.category_id = c.id
                WHERE pv.barcode = ? AND pv.id != ?
                ORDER BY p.name, pv.variant_name
                "#,
            )
            .bind(barcode)
            .bind(exclude_id)
            .fetch_all(pool.inner())
            .await
            .map_err(|e| format!("Failed to find barcode conflicts: {}", e))?,
            None => sqlx::query_as::<_, BarcodeConflictVariant>(
                r#"
                SELECT pv.barcode AS barcode,
                       pv.id AS variant_id,
                       pv.variant_name AS variant_name,
                       p.id AS product_id,
                       p.name AS product_name,
                       c.name AS category_name,
                       pv.sku AS sku,
                       pv.quantity AS quantity,
                       pv.selling_price AS selling_price
                FROM product_variants pv
                JOIN products p ON pv.product_id = p.id
                LEFT JOIN categories c ON p.category_id = c.id
                WHERE pv.barcode = ?
                ORDER BY p.name, pv.variant_name
                "#,
            )
            .bind(barcode)
            .fetch_all(pool.inner())
            .await
            .map_err(|e| format!("Failed to find barcode conflicts: {}", e))?,
        };
        conflicts.append(&mut rows);
    }
    Ok(conflicts)
}

#[tauri::command]
pub async fn search_products(
    pool: State<'_, SqlitePool>,
    query: String,
) -> Result<Vec<ProductWithCategory>, String> {
    let q = query.trim();
    if q.is_empty() {
        return get_products(pool).await;
    }

    let search = format!("%{}%", q);
    let sql = format!(
        r#"
        {}
        WHERE p.name LIKE ?
           OR p.description LIKE ?
           OR p.sku LIKE ?
           OR c.name LIKE ?
           OR s.barcode LIKE ?
           OR CAST(COALESCE(s.qty, 0) AS TEXT) LIKE ?
           OR CAST(COALESCE(s.cost, 0) AS TEXT) LIKE ?
           OR CAST(COALESCE(s.price, 0) AS TEXT) LIKE ?
           OR EXISTS (
                SELECT 1
                FROM product_variants pv
                WHERE pv.product_id = p.id
                  AND (
                    pv.variant_name LIKE ?
                    OR pv.condition_note LIKE ?
                    OR pv.barcode LIKE ?
                    OR pv.sku LIKE ?
                    OR CAST(pv.quantity AS TEXT) LIKE ?
                    OR CAST(pv.cost_price AS TEXT) LIKE ?
                    OR CAST(pv.selling_price AS TEXT) LIKE ?
                  )
           )
        ORDER BY p.name
        LIMIT 100
        "#,
        PRODUCT_AGGREGATE_SELECT
    );
    sqlx::query_as(&sql)
        .bind(&search)
        .bind(&search)
        .bind(&search)
        .bind(&search)
        .bind(&search)
        .bind(&search)
        .bind(&search)
        .bind(&search)
        .bind(&search)
        .bind(&search)
        .bind(&search)
        .bind(&search)
        .bind(&search)
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

/// Move selected variants to another product. This is for correcting catalog
/// mistakes where variants were added under the wrong product/category. The
/// variant rows keep their stock, barcode, SKU, prices, and ids; only their
/// parent product changes. Related rows that also carry `variant_id` are updated
/// so future lookups don't show mismatched product/variant pairs.
#[tauri::command]
pub async fn move_variants_to_product(
    pool: State<'_, SqlitePool>,
    variant_ids: Vec<i64>,
    target_product_id: i64,
) -> Result<(), String> {
    if variant_ids.is_empty() {
        return Err("Select at least one variant to move".to_string());
    }

    let target_exists: Option<(i64,)> = sqlx::query_as("SELECT id FROM products WHERE id = ?")
        .bind(target_product_id)
        .fetch_optional(pool.inner())
        .await
        .map_err(|e| format!("Failed to check target product: {}", e))?;
    if target_exists.is_none() {
        return Err("Target product not found".to_string());
    }

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("Failed to start variant move: {}", e))?;

    for variant_id in variant_ids {
        let parent: Option<(i64,)> = sqlx::query_as(
            "SELECT product_id FROM product_variants WHERE id = ?",
        )
        .bind(variant_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| format!("Failed to find variant: {}", e))?;

        let source_product_id = match parent {
            Some((pid,)) => pid,
            None => return Err(format!("Variant {} not found", variant_id)),
        };

        if source_product_id == target_product_id {
            continue;
        }

        let remaining: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM product_variants WHERE product_id = ? AND id != ?",
        )
        .bind(source_product_id)
        .bind(variant_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| format!("Failed to count source variants: {}", e))?;

        if remaining.0 <= 0 {
            return Err("Cannot move the last variant out of a product".to_string());
        }

        sqlx::query(
            "UPDATE product_variants SET product_id = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .bind(target_product_id)
        .bind(variant_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to move variant: {}", e))?;

        sqlx::query("UPDATE inventory_transactions SET product_id = ? WHERE variant_id = ?")
            .bind(target_product_id)
            .bind(variant_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to update inventory history: {}", e))?;

        sqlx::query("UPDATE sale_items SET product_id = ? WHERE variant_id = ?")
            .bind(target_product_id)
            .bind(variant_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to update sales history: {}", e))?;

        sqlx::query("UPDATE reservations SET product_id = ? WHERE variant_id = ?")
            .bind(target_product_id)
            .bind(variant_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to update reservations: {}", e))?;

        sqlx::query("UPDATE returns SET product_id = ? WHERE variant_id = ?")
            .bind(target_product_id)
            .bind(variant_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to update returns: {}", e))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit variant move: {}", e))?;
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

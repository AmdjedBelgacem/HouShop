use sqlx::SqlitePool;
use tauri::State;
use crate::models::{CreateSale, Sale, SaleItemWithProduct, SaleWithItems, SalesSummary};
#[tauri::command]
pub async fn create_sale(
    pool: State<'_, SqlitePool>,
    data: CreateSale,
) -> Result<Sale, String> {
    let mut tx = pool
        .inner()
        .begin()
        .await
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;
    let total_amount: f64 = data
        .items
        .iter()
        .map(|item| item.unit_price * item.quantity as f64)
        .sum();
    let total_cost: f64 = data
        .items
        .iter()
        .map(|item| item.unit_cost * item.quantity as f64)
        .sum();
    let profit = total_amount - total_cost;
    let sale_result = sqlx::query(
        r#"INSERT INTO sales (customer_id, total_amount, total_cost, profit, payment_method, notes)
           VALUES (?, ?, ?, ?, ?, ?)"#,
    )
    .bind(data.customer_id)
    .bind(total_amount)
    .bind(total_cost)
    .bind(profit)
    .bind(data.payment_method.as_deref().unwrap_or("cash"))
    .bind(&data.notes)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to create sale: {}", e))?;
    let sale_id = sale_result.last_insert_rowid();
    for item in &data.items {
        sqlx::query(
            r#"INSERT INTO sale_items (sale_id, product_id, variant_id, variant_name, quantity, unit_price, unit_cost, subtotal)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)"#,
        )
        .bind(sale_id)
        .bind(item.product_id)
        .bind(item.variant_id)
        .bind(&item.variant_name)
        .bind(item.quantity)
        .bind(item.unit_price)
        .bind(item.unit_cost)
        .bind(item.unit_price * item.quantity as f64)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to insert sale item: {}", e))?;
        // Stock lives on variants. A sale item must carry a variant_id; legacy
        // items without one (pre-migration data) simply skip the stock update.
        if let Some(vid) = item.variant_id {
            sqlx::query("UPDATE product_variants SET quantity = quantity - ?, updated_at = datetime('now') WHERE id = ?")
                .bind(item.quantity)
                .bind(vid)
                .execute(&mut *tx)
                .await
                .map_err(|e| format!("Failed to update variant stock: {}", e))?;
        }
    }
    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit sale: {}", e))?;
    sqlx::query_as("SELECT * FROM sales WHERE id = ?")
        .bind(sale_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Failed to fetch sale: {}", e))
}
#[tauri::command]
pub async fn get_sales(pool: State<'_, SqlitePool>) -> Result<Vec<SaleWithItems>, String> {
    let sales: Vec<Sale> = sqlx::query_as("SELECT * FROM sales ORDER BY created_at DESC")
        .fetch_all(pool.inner())
        .await
        .map_err(|e| format!("Failed to fetch sales: {}", e))?;
    let mut result = Vec::new();
    for sale in sales {
        let items: Vec<SaleItemWithProduct> = sqlx::query_as(
            r#"
            SELECT si.id, si.sale_id, si.product_id, p.name as product_name,
                   p.image_path as product_image,
                   si.variant_id, si.variant_name,
                   si.quantity, si.unit_price, si.unit_cost, si.subtotal
            FROM sale_items si
            JOIN products p ON si.product_id = p.id
            WHERE si.sale_id = ?
            "#,
        )
        .bind(sale.id)
        .fetch_all(pool.inner())
        .await
        .map_err(|e| format!("Failed to fetch sale items: {}", e))?;
        result.push(SaleWithItems { sale, items });
    }
    Ok(result)
}
#[tauri::command]
pub async fn get_sales_summary(pool: State<'_, SqlitePool>) -> Result<SalesSummary, String> {
    let totals: (f64, i64) = sqlx::query_as(
        "SELECT COALESCE(SUM(total_amount), 0.0), COUNT(*) FROM sales"
    )
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("DB error: {}", e))?;
    let avg_transaction = if totals.1 > 0 { totals.0 / totals.1 as f64 } else { 0.0 };
    let pending: (i64, f64) = sqlx::query_as(
        "SELECT COUNT(*), COALESCE(SUM(total_amount), 0.0) FROM sales WHERE profit <= 0"
    )
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("DB error: {}", e))?;
    Ok(SalesSummary {
        total_sales: totals.0,
        total_transactions: totals.1,
        avg_transaction,
        pending_count: pending.0,
        pending_amount: pending.1,
    })
}
#[tauri::command]
pub async fn get_sales_by_date(
    pool: State<'_, SqlitePool>,
    date: String,
) -> Result<Vec<SaleWithItems>, String> {
    let date_filter = format!("{}%", date);
    let sales: Vec<Sale> = sqlx::query_as(
        "SELECT * FROM sales WHERE created_at LIKE ? ORDER BY created_at DESC",
    )
    .bind(&date_filter)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Failed to fetch sales: {}", e))?;
    let mut result = Vec::new();
    for sale in sales {
        let items: Vec<SaleItemWithProduct> = sqlx::query_as(
            r#"
            SELECT si.id, si.sale_id, si.product_id, p.name as product_name,
                   p.image_path as product_image,
                   si.variant_id, si.variant_name,
                   si.quantity, si.unit_price, si.unit_cost, si.subtotal
            FROM sale_items si
            JOIN products p ON si.product_id = p.id
            WHERE si.sale_id = ?
            "#,
        )
        .bind(sale.id)
        .fetch_all(pool.inner())
        .await
        .map_err(|e| format!("Failed to fetch sale items: {}", e))?;
        result.push(SaleWithItems { sale, items });
    }
    Ok(result)
}
#[tauri::command]
pub async fn delete_sale(
    pool: State<'_, SqlitePool>,
    id: i64,
) -> Result<(), String> {
    let mut tx = pool
        .inner()
        .begin()
        .await
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;
    let items: Vec<(i64, Option<i64>, i64)> = sqlx::query_as(
        "SELECT product_id, variant_id, quantity FROM sale_items WHERE sale_id = ?",
    )
    .bind(id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| format!("Failed to fetch sale items: {}", e))?;
    for (product_id, variant_id, quantity) in &items {
        if let Some(vid) = variant_id {
            sqlx::query("UPDATE product_variants SET quantity = quantity + ?, updated_at = datetime('now') WHERE id = ?")
                .bind(quantity)
                .bind(vid)
                .execute(&mut *tx)
                .await
                .map_err(|e| format!("Failed to restore variant stock: {}", e))?;
        }
        // Legacy items (pre-migration, no variant_id) have no restockable row;
        // the product's own quantity column is dormant, so we skip them.
        let _ = product_id;
    }
    sqlx::query("DELETE FROM sales WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to delete sale: {}", e))?;
    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit: {}", e))?;
    Ok(())
}

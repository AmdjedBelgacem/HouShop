use sqlx::SqlitePool;
use tauri::State;
use crate::models::CreateInventoryTransaction;
use crate::models::InventoryTransaction;
#[tauri::command]
pub async fn add_stock(
    pool: State<'_, SqlitePool>,
    data: CreateInventoryTransaction,
) -> Result<InventoryTransaction, String> {
    // Stock is tracked per variant. Resolve the target variant from the request
    // (preferred) or fall back to the product's first variant so legacy callers
    // that don't pass variant_id still restock something meaningful.
    let variant_id = match data.variant_id {
        Some(vid) => vid,
        None => {
            let row: (i64,) = sqlx::query_as(
                "SELECT id FROM product_variants WHERE product_id = ? ORDER BY id LIMIT 1",
            )
            .bind(data.product_id)
            .fetch_one(pool.inner())
            .await
            .map_err(|e| format!("Product has no variant to restock: {}", e))?;
            row.0
        }
    };
    let mut tx = pool
        .inner()
        .begin()
        .await
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;
    let total_cost = data.unit_cost * data.quantity as f64;
    let tx_type = data.transaction_type.as_deref().unwrap_or("purchase");
    let result = sqlx::query(
        r#"INSERT INTO inventory_transactions (product_id, variant_id, quantity, transaction_type, unit_cost, total_cost, supplier_id, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(data.product_id)
    .bind(variant_id)
    .bind(data.quantity)
    .bind(tx_type)
    .bind(data.unit_cost)
    .bind(total_cost)
    .bind(data.supplier_id)
    .bind(&data.notes)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to record transaction: {}", e))?;
    let tx_id = result.last_insert_rowid();
    sqlx::query("UPDATE product_variants SET quantity = quantity + ?, updated_at = datetime('now') WHERE id = ?")
        .bind(data.quantity)
        .bind(variant_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to update variant stock: {}", e))?;
    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit: {}", e))?;
    sqlx::query_as("SELECT * FROM inventory_transactions WHERE id = ?")
        .bind(tx_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Failed to fetch transaction: {}", e))
}
#[tauri::command]
pub async fn get_inventory_transactions(
    pool: State<'_, SqlitePool>,
    product_id: Option<i64>,
) -> Result<Vec<InventoryTransaction>, String> {
    match product_id {
        Some(pid) => {
            sqlx::query_as(
                "SELECT * FROM inventory_transactions WHERE product_id = ? ORDER BY created_at DESC",
            )
            .bind(pid)
            .fetch_all(pool.inner())
            .await
            .map_err(|e| format!("Failed to fetch transactions: {}", e))
        }
        None => {
            sqlx::query_as("SELECT * FROM inventory_transactions ORDER BY created_at DESC LIMIT 100")
                .fetch_all(pool.inner())
                .await
                .map_err(|e| format!("Failed to fetch transactions: {}", e))
        }
    }
}

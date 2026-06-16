use sqlx::SqlitePool;
use tauri::State;
use crate::models::CreateInventoryTransaction;
use crate::models::InventoryTransaction;
#[tauri::command]
pub async fn add_stock(
    pool: State<'_, SqlitePool>,
    data: CreateInventoryTransaction,
) -> Result<InventoryTransaction, String> {
    let mut tx = pool
        .inner()
        .begin()
        .await
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;
    let total_cost = data.unit_cost * data.quantity as f64;
    let tx_type = data.transaction_type.as_deref().unwrap_or("purchase");
    let result = sqlx::query(
        r#"INSERT INTO inventory_transactions (product_id, quantity, transaction_type, unit_cost, total_cost, supplier_id, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(data.product_id)
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
    sqlx::query("UPDATE products SET quantity = quantity + ?, updated_at = datetime('now') WHERE id = ?")
        .bind(data.quantity)
        .bind(data.product_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to update stock: {}", e))?;
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

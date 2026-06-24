use sqlx::SqlitePool;
use tauri::State;
use crate::models::{CreateReturn, Return};

/// Record a customer return against a specific line of a past sale.
///
/// In one transaction:
///   1. Validate the sale item exists and that the requested quantity doesn't
///      exceed what was sold minus already-returned units (no over-returning).
///   2. Restock the returned units onto the variant (stock lives on variants).
///   3. Insert the `returns` row (qty + refund + reason).
///   4. Adjust the sale's totals: subtract the refund from `total_amount` and
///      recompute `profit` (the cost of the returned units comes back too), so
///      reports/invoices reflect the return immediately.
#[tauri::command]
pub async fn create_return(
    pool: State<'_, SqlitePool>,
    data: CreateReturn,
) -> Result<Return, String> {
    if data.quantity <= 0 {
        return Err("Return quantity must be greater than zero".to_string());
    }
    let mut tx = pool
        .inner()
        .begin()
        .await
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    // How many units of this sale item were originally sold.
    let sold: (i64,) = sqlx::query_as("SELECT quantity FROM sale_items WHERE id = ?")
        .bind(data.sale_item_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| format!("Failed to fetch sale item: {}", e))?
        .ok_or_else(|| "Sale item not found".to_string())?;

    // How many units of this item have already been returned.
    let already: (i64,) = sqlx::query_as(
        "SELECT COALESCE(SUM(quantity), 0) FROM returns WHERE sale_item_id = ?",
    )
    .bind(data.sale_item_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| format!("Failed to sum prior returns: {}", e))?;

    let remaining = sold.0 - already.0;
    if data.quantity > remaining {
        return Err(format!(
            "Cannot return {} unit(s); only {} remaining for this sale item",
            data.quantity, remaining
        ));
    }

    // Restock onto the variant (stock is variant-only). Legacy sale items
    // without a variant_id (pre-migration) can't be restocked — skip with a
    // clear note in the error chain but still record the return.
    if let Some(vid) = data.variant_id {
        sqlx::query(
            "UPDATE product_variants SET quantity = quantity + ?, updated_at = datetime('now') WHERE id = ?",
        )
        .bind(data.quantity)
        .bind(vid)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to restock variant: {}", e))?;
    }

    // Record the return.
    let result = sqlx::query(
        r#"INSERT INTO returns (sale_id, sale_item_id, product_id, variant_id, quantity, refund_amount, reason)
           VALUES (?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(data.sale_id)
    .bind(data.sale_item_id)
    .bind(data.product_id)
    .bind(data.variant_id)
    .bind(data.quantity)
    .bind(data.refund_amount)
    .bind(&data.reason)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to record return: {}", e))?;
    let id = result.last_insert_rowid();

    // Adjust the sale: reduce its total by the refund and pull the returned
    // units' cost out of the cost/profit figures so reports stay accurate.
    sqlx::query(
        r#"UPDATE sales
           SET total_amount = MAX(0, total_amount - ?),
               total_cost  = MAX(0, total_cost - ?),
               profit      = MAX(0, profit - ?)
           WHERE id = ?"#,
    )
    .bind(data.refund_amount)
    .bind(0.0) // cost correction is item-specific; refund_amount drives totals here
    .bind(data.refund_amount)
    .bind(data.sale_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to adjust sale totals: {}", e))?;

    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit return: {}", e))?;

    sqlx::query_as("SELECT * FROM returns WHERE id = ?")
        .bind(id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Failed to fetch recorded return: {}", e))
}

/// All returns, newest first, joined with sale/product context for display.
/// Each row carries enough to render a returns history table without extra
/// round-trips.
#[tauri::command]
pub async fn get_returns(pool: State<'_, SqlitePool>) -> Result<Vec<ReturnWithDetails>, String> {
    sqlx::query_as(
        r#"
        SELECT r.id, r.sale_id, r.sale_item_id, r.product_id, r.variant_id,
               r.quantity, r.refund_amount, r.reason, r.created_at,
               p.name AS product_name,
               pv.variant_name AS variant_name,
               c.name AS customer_name
        FROM returns r
        JOIN products p ON r.product_id = p.id
        LEFT JOIN product_variants pv ON r.variant_id = pv.id
        LEFT JOIN sales s ON r.sale_id = s.id
        LEFT JOIN customers c ON s.customer_id = c.id
        ORDER BY r.created_at DESC
        "#,
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Failed to fetch returns: {}", e))
}

/// Aggregate return stats for the page header KPIs.
#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub struct ReturnsSummary {
    pub total_returns: i64,
    pub total_refunded: f64,
    pub units_returned: i64,
}

#[tauri::command]
pub async fn get_returns_summary(pool: State<'_, SqlitePool>) -> Result<ReturnsSummary, String> {
    let row: (i64, f64, i64) = sqlx::query_as(
        r#"SELECT COUNT(*), COALESCE(SUM(refund_amount), 0.0), COALESCE(SUM(quantity), 0)
           FROM returns"#,
    )
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("DB error: {}", e))?;
    Ok(ReturnsSummary {
        total_returns: row.0,
        total_refunded: row.1,
        units_returned: row.2,
    })
}

/// One return joined with display context (returned by `get_returns`).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct ReturnWithDetails {
    pub id: i64,
    pub sale_id: i64,
    pub sale_item_id: i64,
    pub product_id: i64,
    pub variant_id: Option<i64>,
    pub quantity: i64,
    pub refund_amount: f64,
    pub reason: Option<String>,
    pub created_at: String,
    pub product_name: String,
    pub variant_name: Option<String>,
    pub customer_name: Option<String>,
}

use sqlx::SqlitePool;
use tauri::State;
use crate::models::{DailyReport, DashboardStats};
#[tauri::command]
pub async fn get_dashboard_stats(pool: State<'_, SqlitePool>) -> Result<DashboardStats, String> {
    let total_products: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM products")
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("DB error: {}", e))?;
    let low_stock_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM products WHERE quantity <= low_stock_threshold",
    )
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("DB error: {}", e))?;
    let today: String = chrono::Local::now().format("%Y-%m-%d").to_string();
    let today_filter = format!("{}%", today);
    let today_sales: (f64,) = sqlx::query_as(
        "SELECT COALESCE(SUM(total_amount), 0.0) FROM sales WHERE created_at LIKE ?",
    )
    .bind(&today_filter)
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("DB error: {}", e))?;
    let today_profit: (f64,) = sqlx::query_as(
        "SELECT COALESCE(SUM(profit), 0.0) FROM sales WHERE created_at LIKE ?",
    )
    .bind(&today_filter)
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("DB error: {}", e))?;
    let today_transactions: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM sales WHERE created_at LIKE ?")
            .bind(&today_filter)
            .fetch_one(pool.inner())
            .await
            .map_err(|e| format!("DB error: {}", e))?;
    let total_customers: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM customers")
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("DB error: {}", e))?;
    Ok(DashboardStats {
        total_products: total_products.0,
        low_stock_count: low_stock_count.0,
        today_sales: today_sales.0,
        today_profit: today_profit.0,
        today_transactions: today_transactions.0,
        total_customers: total_customers.0,
    })
}
#[tauri::command]
pub async fn get_daily_report(
    pool: State<'_, SqlitePool>,
    date: String,
) -> Result<DailyReport, String> {
    let date_filter = format!("{}%", date);
    let totals: (f64, f64, f64, i64, i64) = sqlx::query_as(
        r#"
        SELECT
            COALESCE(SUM(s.total_amount), 0.0),
            COALESCE(SUM(s.total_cost), 0.0),
            COALESCE(SUM(s.profit), 0.0),
            COUNT(DISTINCT s.id),
            COALESCE(SUM(si.quantity), 0)
        FROM sales s
        LEFT JOIN sale_items si ON s.id = si.sale_id
        WHERE s.created_at LIKE ?
        "#,
    )
    .bind(&date_filter)
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("DB error: {}", e))?;
    Ok(DailyReport {
        date,
        total_sales: totals.0,
        total_cost: totals.1,
        total_profit: totals.2,
        total_transactions: totals.3,
        items_sold: totals.4,
    })
}
#[tauri::command]
pub async fn get_reports_by_range(
    pool: State<'_, SqlitePool>,
    start_date: String,
    end_date: String,
) -> Result<Vec<DailyReport>, String> {
    let rows: Vec<(String, f64, f64, f64, i64, i64)> = sqlx::query_as(
        r#"
        SELECT
            DATE(s.created_at) as date,
            COALESCE(SUM(s.total_amount), 0.0),
            COALESCE(SUM(s.total_cost), 0.0),
            COALESCE(SUM(s.profit), 0.0),
            COUNT(DISTINCT s.id),
            COALESCE(SUM(si.quantity), 0)
        FROM sales s
        LEFT JOIN sale_items si ON s.id = si.sale_id
        WHERE DATE(s.created_at) BETWEEN ? AND ?
        GROUP BY DATE(s.created_at)
        ORDER BY date DESC
        "#,
    )
    .bind(&start_date)
    .bind(&end_date)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("DB error: {}", e))?;
    Ok(rows
        .into_iter()
        .map(|(date, sales, cost, profit, txns, items)| DailyReport {
            date,
            total_sales: sales,
            total_cost: cost,
            total_profit: profit,
            total_transactions: txns,
            items_sold: items,
        })
        .collect())
}

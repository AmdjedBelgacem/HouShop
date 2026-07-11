use sqlx::SqlitePool;
use std::collections::BTreeMap;
use tauri::State;
use crate::models::{
    DailyReport, DashboardStats, InventoryValuationCategory, InventoryValuationProduct,
    InventoryValuationSummary, InventoryValuationVariant,
};
#[tauri::command]
pub async fn get_dashboard_stats(pool: State<'_, SqlitePool>) -> Result<DashboardStats, String> {
    let total_products: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM products")
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("DB error: {}", e))?;
    let low_stock_count: (i64,) = sqlx::query_as(
        r#"SELECT COUNT(DISTINCT p.id) FROM products p
           WHERE EXISTS (
               SELECT 1 FROM product_variants pv
               WHERE pv.product_id = p.id
                 AND pv.quantity <= pv.low_stock_threshold
           )"#,
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

#[tauri::command]
pub async fn get_inventory_valuation(
    pool: State<'_, SqlitePool>,
) -> Result<InventoryValuationSummary, String> {
    let rows: Vec<(
        Option<i64>,
        Option<String>,
        i64,
        String,
        i64,
        String,
        i64,
        f64,
        f64,
    )> = sqlx::query_as(
        r#"
        SELECT p.category_id,
               c.name AS category_name,
               p.id AS product_id,
               p.name AS product_name,
               pv.id AS variant_id,
               pv.variant_name,
               pv.quantity,
               pv.cost_price,
               pv.selling_price
        FROM product_variants pv
        JOIN products p ON pv.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        ORDER BY COALESCE(c.name, 'Uncategorized'), p.name, pv.variant_name
        "#,
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Failed to calculate inventory valuation: {}", e))?;

    let mut categories: BTreeMap<String, InventoryValuationCategory> = BTreeMap::new();
    let mut overall = InventoryValuationSummary {
        quantity: 0,
        total_cost: 0.0,
        projected_revenue: 0.0,
        projected_profit: 0.0,
        categories: Vec::new(),
    };

    for (category_id, category_name, product_id, product_name, variant_id, variant_name, quantity, unit_cost, unit_price) in rows {
        let category_label = category_name.clone().unwrap_or_else(|| "Uncategorized".to_string());
        let total_cost = quantity as f64 * unit_cost;
        let projected_revenue = quantity as f64 * unit_price;
        let projected_profit = projected_revenue - total_cost;
        let variant = InventoryValuationVariant {
            id: variant_id,
            variant_name,
            quantity,
            unit_cost,
            unit_price,
            total_cost,
            projected_revenue,
            projected_profit,
        };

        let category = categories.entry(category_label.clone()).or_insert_with(|| InventoryValuationCategory {
            id: category_id,
            name: category_label,
            quantity: 0,
            total_cost: 0.0,
            projected_revenue: 0.0,
            projected_profit: 0.0,
            products: Vec::new(),
        });

        let product_idx = match category.products.iter().position(|p| p.id == product_id) {
            Some(idx) => idx,
            None => {
                category.products.push(InventoryValuationProduct {
                    id: product_id,
                    name: product_name,
                    category_id,
                    category_name: category_name.clone(),
                    quantity: 0,
                    total_cost: 0.0,
                    projected_revenue: 0.0,
                    projected_profit: 0.0,
                    variants: Vec::new(),
                });
                category.products.len() - 1
            }
        };

        let product = &mut category.products[product_idx];
        product.quantity += quantity;
        product.total_cost += total_cost;
        product.projected_revenue += projected_revenue;
        product.projected_profit += projected_profit;
        product.variants.push(variant);

        category.quantity += quantity;
        category.total_cost += total_cost;
        category.projected_revenue += projected_revenue;
        category.projected_profit += projected_profit;

        overall.quantity += quantity;
        overall.total_cost += total_cost;
        overall.projected_revenue += projected_revenue;
        overall.projected_profit += projected_profit;
    }

    overall.categories = categories.into_values().collect();
    Ok(overall)
}

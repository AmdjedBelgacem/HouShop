use sqlx::SqlitePool;
use tauri::State;
use crate::models::{CreateCustomer, Customer, CustomerStats, CustomerWithStats, UpdateCustomer};
#[tauri::command]
pub async fn get_customers(pool: State<'_, SqlitePool>) -> Result<Vec<Customer>, String> {
    sqlx::query_as("SELECT * FROM customers ORDER BY name")
        .fetch_all(pool.inner())
        .await
        .map_err(|e| format!("Failed to fetch customers: {}", e))
}
#[tauri::command]
pub async fn get_customer_by_id(
    pool: State<'_, SqlitePool>,
    id: i64,
) -> Result<Customer, String> {
    sqlx::query_as("SELECT * FROM customers WHERE id = ?")
        .bind(id)
        .fetch_optional(pool.inner())
        .await
        .map_err(|e| format!("Failed to fetch customer: {}", e))?
        .ok_or("Customer not found".to_string())
}
#[tauri::command]
pub async fn search_customers(
    pool: State<'_, SqlitePool>,
    query: String,
) -> Result<Vec<Customer>, String> {
    let search = format!("%{}%", query);
    sqlx::query_as(
        "SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY name LIMIT 20",
    )
    .bind(&search)
    .bind(&search)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Failed to search customers: {}", e))
}
#[tauri::command]
pub async fn create_customer(
    pool: State<'_, SqlitePool>,
    data: CreateCustomer,
) -> Result<Customer, String> {
    let result = sqlx::query(
        r#"INSERT INTO customers (name, phone, email, address, notes, photo_path, party_type)
           VALUES (?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(&data.name)
    .bind(&data.phone)
    .bind(&data.email)
    .bind(&data.address)
    .bind(&data.notes)
    .bind(&data.photo_path)
    .bind(data.party_type.as_deref().unwrap_or("customer"))
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Failed to create customer: {}", e))?;
    let id = result.last_insert_rowid();
    sqlx::query_as("SELECT * FROM customers WHERE id = ?")
        .bind(id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Failed to fetch created customer: {}", e))
}
#[tauri::command]
pub async fn update_customer(
    pool: State<'_, SqlitePool>,
    data: UpdateCustomer,
) -> Result<Customer, String> {
    sqlx::query(
        r#"UPDATE customers
           SET name = ?, phone = ?, email = ?, address = ?, notes = ?, photo_path = ?,
               party_type = ?, updated_at = datetime('now')
           WHERE id = ?"#,
    )
    .bind(&data.name)
    .bind(&data.phone)
    .bind(&data.email)
    .bind(&data.address)
    .bind(&data.notes)
    .bind(&data.photo_path)
    .bind(data.party_type.as_deref().unwrap_or("customer"))
    .bind(data.id)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Failed to update customer: {}", e))?;
    sqlx::query_as("SELECT * FROM customers WHERE id = ?")
        .bind(data.id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Failed to fetch updated customer: {}", e))
}
#[tauri::command]
pub async fn delete_customer(pool: State<'_, SqlitePool>, id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM customers WHERE id = ?")
        .bind(id)
        .execute(pool.inner())
        .await
        .map_err(|e| format!("Failed to delete customer: {}", e))?;
    Ok(())
}
#[tauri::command]
pub async fn get_customers_with_stats(pool: State<'_, SqlitePool>) -> Result<Vec<CustomerWithStats>, String> {
    sqlx::query_as(
        r#"SELECT
            c.id, c.name, c.phone, c.email, c.address, c.notes, c.photo_path, c.party_type,
            c.created_at, c.updated_at,
            COALESCE(s.order_count, 0) as order_count,
            COALESCE(s.total_spent, 0.0) as total_spent,
            s.last_order_date
        FROM customers c
        LEFT JOIN (
            SELECT customer_id,
                   COUNT(*) as order_count,
                   SUM(total_amount) as total_spent,
                   MAX(created_at) as last_order_date
            FROM sales WHERE customer_id IS NOT NULL
            GROUP BY customer_id
        ) s ON c.id = s.customer_id
        ORDER BY c.name"#,
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Failed to fetch customers: {}", e))
}
#[tauri::command]
pub async fn get_customer_stats(pool: State<'_, SqlitePool>) -> Result<CustomerStats, String> {
    let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM customers")
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("DB error: {}", e))?;
    let month_start = format!("{}-01", chrono::Local::now().format("%Y-%m"));
    let month_filter = format!("{}%", month_start);
    let new_month: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM customers WHERE created_at LIKE ?"
    )
    .bind(&month_filter)
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("DB error: {}", e))?;
    let avg_val: (f64,) = sqlx::query_as(
        "SELECT COALESCE(SUM(total_amount) / NULLIF(COUNT(DISTINCT customer_id), 0), 0.0) FROM sales WHERE customer_id IS NOT NULL"
    )
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("DB error: {}", e))?;
    Ok(CustomerStats {
        total_customers: total.0,
        new_this_month: new_month.0,
        avg_lifetime_value: avg_val.0,
    })
}

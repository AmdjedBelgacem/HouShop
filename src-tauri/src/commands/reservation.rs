use sqlx::SqlitePool;
use tauri::State;
use crate::models::{
    CreateReservation, Reservation, ReservationStats, ReservationWithDetails,
};
#[tauri::command]
pub async fn get_reservations(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<ReservationWithDetails>, String> {
    sqlx::query_as(
        r#"
        SELECT r.id, r.customer_id, c.name as customer_name,
               r.product_id, p.name as product_name,
               r.variant_id, pv.variant_name,
               r.quantity, r.deposit_amount, r.total_price, r.remaining_amount,
               r.status, r.notes, r.created_at, r.updated_at
        FROM reservations r
        JOIN customers c ON r.customer_id = c.id
        JOIN products p ON r.product_id = p.id
        LEFT JOIN product_variants pv ON r.variant_id = pv.id
        ORDER BY r.created_at DESC
        "#,
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Failed to fetch reservations: {}", e))
}
#[tauri::command]
pub async fn get_active_reservations(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<ReservationWithDetails>, String> {
    sqlx::query_as(
        r#"
        SELECT r.id, r.customer_id, c.name as customer_name,
               r.product_id, p.name as product_name,
               r.variant_id, pv.variant_name,
               r.quantity, r.deposit_amount, r.total_price, r.remaining_amount,
               r.status, r.notes, r.created_at, r.updated_at
        FROM reservations r
        JOIN customers c ON r.customer_id = c.id
        JOIN products p ON r.product_id = p.id
        LEFT JOIN product_variants pv ON r.variant_id = pv.id
        WHERE r.status = 'active'
        ORDER BY r.created_at DESC
        "#,
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Failed to fetch active reservations: {}", e))
}
#[tauri::command]
pub async fn create_reservation(
    pool: State<'_, SqlitePool>,
    data: CreateReservation,
) -> Result<Reservation, String> {
    let quantity = data.quantity.unwrap_or(1);
    let remaining = data.total_price - data.deposit_amount;
    let available: (i64,) = if let Some(variant_id) = data.variant_id {
        sqlx::query_as(
            r#"SELECT COALESCE(pv.quantity, 0) - COALESCE(
                (SELECT SUM(r.quantity) FROM reservations r WHERE r.variant_id = ? AND r.status = 'active'), 0
            ) as available FROM product_variants pv WHERE pv.id = ?"#,
        )
        .bind(variant_id)
        .bind(variant_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Failed to check stock: {}", e))?
    } else {
        sqlx::query_as(
            r#"SELECT COALESCE(p.quantity, 0) - COALESCE(
                (SELECT SUM(r.quantity) FROM reservations r WHERE r.product_id = ? AND r.variant_id IS NULL AND r.status = 'active'), 0
            ) as available FROM products p WHERE p.id = ?"#,
        )
        .bind(data.product_id)
        .bind(data.product_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Failed to check stock: {}", e))?
    };
    if available.0 < quantity {
        return Err(format!(
            "Insufficient available stock. Available: {}, Requested: {}",
            available.0, quantity
        ));
    }
    let result = sqlx::query(
        r#"INSERT INTO reservations (customer_id, product_id, variant_id, quantity, deposit_amount, total_price, remaining_amount, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(data.customer_id)
    .bind(data.product_id)
    .bind(data.variant_id)
    .bind(quantity)
    .bind(data.deposit_amount)
    .bind(data.total_price)
    .bind(remaining)
    .bind(&data.notes)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Failed to create reservation: {}", e))?;
    let id = result.last_insert_rowid();
    sqlx::query_as("SELECT * FROM reservations WHERE id = ?")
        .bind(id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Failed to fetch reservation: {}", e))
}
#[tauri::command]
pub async fn complete_reservation(
    pool: State<'_, SqlitePool>,
    id: i64,
) -> Result<Reservation, String> {
    let mut tx = pool
        .inner()
        .begin()
        .await
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;
    let reservation: Reservation = sqlx::query_as("SELECT * FROM reservations WHERE id = ?")
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| format!("Failed to fetch reservation: {}", e))?;
    if reservation.status != "active" {
        return Err("Reservation is not active".to_string());
    }
    let total_amount = reservation.total_price;
    let total_cost: f64 = sqlx::query_as(
        "SELECT COALESCE(cost_price, 0.0) FROM products WHERE id = ?",
    )
    .bind(reservation.product_id)
    .fetch_one(&mut *tx)
    .await
    .map(|r: (f64,)| r.0)
    .unwrap_or(0.0)
    * reservation.quantity as f64;
    let profit = total_amount - total_cost;
    let sale_result = sqlx::query(
        r#"INSERT INTO sales (customer_id, total_amount, total_cost, profit, payment_method, notes)
           VALUES (?, ?, ?, ?, 'cash', ?)"#,
    )
    .bind(reservation.customer_id)
    .bind(total_amount)
    .bind(total_cost)
    .bind(profit)
    .bind(&format!("Completed reservation #{}", reservation.id))
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to create sale: {}", e))?;
    let sale_id = sale_result.last_insert_rowid();
    let unit_price = if reservation.quantity > 0 {
        reservation.total_price / reservation.quantity as f64
    } else {
        reservation.total_price
    };
    let unit_cost = total_cost / reservation.quantity.max(1) as f64;
    sqlx::query(
        r#"INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, unit_cost, subtotal)
           VALUES (?, ?, ?, ?, ?, ?)"#,
    )
    .bind(sale_id)
    .bind(reservation.product_id)
    .bind(reservation.quantity)
    .bind(unit_price)
    .bind(unit_cost)
    .bind(total_amount)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to insert sale item: {}", e))?;
    if let Some(variant_id) = reservation.variant_id {
        sqlx::query("UPDATE product_variants SET quantity = quantity - ?, updated_at = datetime('now') WHERE id = ?")
            .bind(reservation.quantity)
            .bind(variant_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to update variant stock: {}", e))?;
    } else {
        sqlx::query("UPDATE products SET quantity = quantity - ?, updated_at = datetime('now') WHERE id = ?")
            .bind(reservation.quantity)
            .bind(reservation.product_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to update stock: {}", e))?;
    }
    sqlx::query(
        "UPDATE reservations SET status = 'completed', updated_at = datetime('now') WHERE id = ?",
    )
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to update reservation: {}", e))?;
    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit: {}", e))?;
    sqlx::query_as("SELECT * FROM reservations WHERE id = ?")
        .bind(id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Failed to fetch reservation: {}", e))
}
#[tauri::command]
pub async fn cancel_reservation(
    pool: State<'_, SqlitePool>,
    id: i64,
) -> Result<Reservation, String> {
    sqlx::query(
        "UPDATE reservations SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?",
    )
    .bind(id)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Failed to cancel reservation: {}", e))?;
    sqlx::query_as("SELECT * FROM reservations WHERE id = ?")
        .bind(id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Failed to fetch reservation: {}", e))
}
#[tauri::command]
pub async fn get_reservation_stats(
    pool: State<'_, SqlitePool>,
) -> Result<ReservationStats, String> {
    let active: (i64, f64) = sqlx::query_as(
        "SELECT COUNT(*), COALESCE(SUM(deposit_amount), 0.0) FROM reservations WHERE status = 'active'",
    )
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("DB error: {}", e))?;
    let cancelled: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM reservations WHERE status = 'cancelled'",
    )
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("DB error: {}", e))?;
    Ok(ReservationStats {
        active_count: active.0,
        total_deposits: active.1,
        pending_completion: active.0,
        cancelled_count: cancelled.0,
    })
}

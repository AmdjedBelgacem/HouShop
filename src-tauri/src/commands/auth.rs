use sqlx::SqlitePool;
use tauri::State;
use crate::models::{LoginRequest, LoginResponse, User};
#[tauri::command]
pub async fn login(
    pool: State<'_, SqlitePool>,
    request: LoginRequest,
) -> Result<LoginResponse, String> {
    let user: Option<User> =
        sqlx::query_as("SELECT * FROM users WHERE username = ?")
            .bind(&request.username)
            .fetch_optional(pool.inner())
            .await
            .map_err(|e| format!("Database error: {}", e))?;
    let user = user.ok_or("Invalid username or password")?;
    let valid = bcrypt::verify(&request.password, &user.password_hash)
        .map_err(|e| format!("Password verification error: {}", e))?;
    if !valid {
        return Err("Invalid username or password".to_string());
    }
    let token = uuid::Uuid::new_v4().to_string();
    Ok(LoginResponse { user, token })
}
#[tauri::command]
pub async fn get_current_user(
    pool: State<'_, SqlitePool>,
    username: String,
) -> Result<User, String> {
    let user: Option<User> =
        sqlx::query_as("SELECT * FROM users WHERE username = ?")
            .bind(&username)
            .fetch_optional(pool.inner())
            .await
            .map_err(|e| format!("Database error: {}", e))?;
    user.ok_or("User not found".to_string())
}

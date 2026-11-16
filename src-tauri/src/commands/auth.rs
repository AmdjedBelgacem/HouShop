use serde::Deserialize;
use sqlx::SqlitePool;
use tauri::State;
use crate::models::{LoginRequest, LoginResponse, User};
use crate::session::SessionState;
#[tauri::command]
pub async fn login(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
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
    session.start(user.clone());
    Ok(LoginResponse { user, token })
}

/// The signed-in user, if any. Lets the interface restore its state after a
/// reload without ever trusting what it stored locally.
#[tauri::command]
pub fn session_user(session: State<'_, SessionState>) -> Option<User> {
    session.user()
}

#[tauri::command]
pub fn logout(session: State<'_, SessionState>) {
    session.end();
}

const MIN_PASSWORD_LEN: usize = 8;
/// bcrypt work factor for every stored password (the library default, 12).
const PASSWORD_COST: u32 = bcrypt::DEFAULT_COST;

/// True once at least one account exists. When false, the app shows the setup screen.
#[tauri::command]
pub async fn has_users(pool: State<'_, SqlitePool>) -> Result<bool, String> {
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {}", e))?;
    Ok(count > 0)
}

/// Creates the first administrator. Only succeeds while the users table is empty,
/// so it cannot be used to add accounts later.
#[tauri::command]
pub async fn create_initial_admin(
    pool: State<'_, SqlitePool>,
    username: String,
    password: String,
) -> Result<(), String> {
    let username = username.trim().to_string();
    if username.is_empty() {
        return Err("Username is required".into());
    }
    if password.len() < MIN_PASSWORD_LEN {
        return Err(format!("Password must be at least {} characters", MIN_PASSWORD_LEN));
    }
    let hash = bcrypt::hash(&password, PASSWORD_COST)
        .map_err(|e| format!("Password hashing failed: {}", e))?;

    let result = sqlx::query(
        "INSERT INTO users (username, password_hash, role)
         SELECT ?, ?, 'admin' WHERE NOT EXISTS (SELECT 1 FROM users)",
    )
    .bind(&username)
    .bind(&hash)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Database error: {}", e))?;

    if result.rows_affected() == 0 {
        return Err("An administrator account already exists".into());
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub username: String,
    pub current_password: String,
    pub new_password: String,
}

/// Changes a password after re-checking the current one.
#[tauri::command]
pub async fn change_password(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    request: ChangePasswordRequest,
) -> Result<(), String> {
    // Only the signed-in account's own password can be changed here.
    match session.user() {
        Some(u) if u.username == request.username => {}
        _ => return Err("You can only change the password of the signed-in account".into()),
    }
    if request.new_password.len() < MIN_PASSWORD_LEN {
        return Err(format!("Password must be at least {} characters", MIN_PASSWORD_LEN));
    }

    let user: Option<User> = sqlx::query_as("SELECT * FROM users WHERE username = ?")
        .bind(&request.username)
        .fetch_optional(pool.inner())
        .await
        .map_err(|e| format!("Database error: {}", e))?;
    let user = user.ok_or("User not found")?;

    let valid = bcrypt::verify(&request.current_password, &user.password_hash)
        .map_err(|e| format!("Password verification error: {}", e))?;
    if !valid {
        return Err("Current password is incorrect".into());
    }

    let hash = bcrypt::hash(&request.new_password, PASSWORD_COST)
        .map_err(|e| format!("Password hashing failed: {}", e))?;
    sqlx::query("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(&hash)
        .bind(user.id)
        .execute(pool.inner())
        .await
        .map_err(|e| format!("Database error: {}", e))?;
    Ok(())
}
#[tauri::command]
pub async fn get_current_user(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    username: String,
) -> Result<User, String> {
    match session.user() {
        Some(u) if u.username == username => {}
        _ => return Err("Not signed in as this user".into()),
    }
    let user: Option<User> =
        sqlx::query_as("SELECT * FROM users WHERE username = ?")
            .bind(&username)
            .fetch_optional(pool.inner())
            .await
            .map_err(|e| format!("Database error: {}", e))?;
    user.ok_or("User not found".to_string())
}

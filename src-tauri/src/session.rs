//! Backend session: who is signed in, enforced for every command.
//!
//! The signed-in user is kept in memory and also remembered in a small file in
//! the app data folder, so closing and reopening the app keeps them signed in
//! until they choose to sign out (`remember` / `forget` / `restore`).
//! `guard` is called from the central invoke handler in `lib.rs`; any command
//! not listed in `PUBLIC_COMMANDS` is rejected unless a user is signed in.
//! New commands are therefore protected by default.

use crate::models::User;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Commands that must work before anyone has signed in: the sign-in and
/// first-run setup screens, and the branding shown on them.
pub const PUBLIC_COMMANDS: &[&str] = &[
    "login",
    "has_users",
    "create_initial_admin",
    "session_user",
    "logout",
    "get_app_logo",
    "get_app_shop_name",
];

struct ActiveSession {
    user: User,
}

#[derive(Default)]
pub struct SessionState(Mutex<Option<ActiveSession>>);

impl SessionState {
    pub fn start(&self, user: User) {
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(ActiveSession { user });
    }

    pub fn end(&self) {
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    pub fn is_active(&self) -> bool {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).is_some()
    }

    pub fn user(&self) -> Option<User> {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .map(|s| s.user.clone())
    }
}

const SESSION_FILE: &str = "session.json";

fn session_file(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join(SESSION_FILE))
}

/// Remember who signed in so the next launch can restore the session.
pub fn remember(app: &AppHandle, user_id: i64) {
    if let Some(file) = session_file(app) {
        write_remembered(&file, user_id);
    }
}

/// Forget the remembered session (called on sign-out).
pub fn forget(app: &AppHandle) {
    if let Some(file) = session_file(app) {
        let _ = std::fs::remove_file(file);
    }
}

fn write_remembered(file: &Path, user_id: i64) {
    let _ = std::fs::write(file, serde_json::json!({ "user_id": user_id }).to_string());
}

fn read_remembered(file: &Path) -> Option<i64> {
    let text = std::fs::read_to_string(file).ok()?;
    serde_json::from_str::<serde_json::Value>(&text).ok()?.get("user_id")?.as_i64()
}

/// Restores the remembered session at startup. The account must still exist;
/// if it was deleted the remembered session is dropped.
pub async fn restore(app: &AppHandle, pool: &sqlx::SqlitePool, state: &SessionState) {
    let Some(file) = session_file(app) else { return };
    let Some(id) = read_remembered(&file) else { return };
    match sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
    {
        Ok(Some(user)) => state.start(user),
        Ok(None) => {
            let _ = std::fs::remove_file(file);
        }
        Err(_) => {} // database trouble: stay signed out, keep the file
    }
}

/// Whether a command may run given the current session.
pub fn is_allowed(command: &str, session: &SessionState) -> bool {
    PUBLIC_COMMANDS.contains(&command) || session.is_active()
}

/// Wraps the app's command handler so every command is checked first.
pub fn guard<R, F>(handler: F) -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static
where
    R: tauri::Runtime,
    F: Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static,
{
    use tauri::Manager;
    move |invoke| {
        let command = invoke.message.command().to_string();
        let webview = invoke.message.webview();
        let allowed = {
            let session = webview.state::<SessionState>();
            is_allowed(&command, &session)
        };
        if !allowed {
            invoke.resolver.reject("Not signed in");
            return true;
        }
        handler(invoke)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user() -> User {
        User {
            id: 1,
            username: "admin".into(),
            password_hash: String::new(),
            role: "admin".into(),
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn blocks_protected_commands_until_signed_in() {
        let s = SessionState::default();
        assert!(!is_allowed("get_products", &s));
        assert!(!is_allowed("execute_wipe", &s));
        s.start(user());
        assert!(is_allowed("get_products", &s));
    }

    #[test]
    fn public_commands_always_allowed() {
        let s = SessionState::default();
        for c in PUBLIC_COMMANDS {
            assert!(is_allowed(c, &s), "{c}");
        }
    }

    #[test]
    fn remembered_session_round_trips() {
        let dir = std::env::temp_dir().join(format!("houshop-session-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join(SESSION_FILE);
        assert_eq!(read_remembered(&file), None);
        write_remembered(&file, 7);
        assert_eq!(read_remembered(&file), Some(7));
        std::fs::write(&file, "garbage").unwrap();
        assert_eq!(read_remembered(&file), None);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn logout_blocks_again() {
        let s = SessionState::default();
        s.start(user());
        s.end();
        assert!(!is_allowed("create_sale", &s));
        assert!(s.user().is_none());
    }

    // End-to-end: real IPC requests through the same `guard` that lib.rs uses.
    mod ipc {
        use super::*;
        use tauri::ipc::{CallbackFn, InvokeBody};
        use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
        use tauri::webview::InvokeRequest;
        use tauri::{Manager, WebviewWindowBuilder};

        #[tauri::command]
        fn get_products() -> &'static str {
            "secret"
        }
        #[tauri::command]
        fn has_users() -> bool {
            true
        }

        fn call(w: &tauri::WebviewWindow<tauri::test::MockRuntime>, cmd: &str) -> Result<String, String> {
            let res = get_ipc_response(
                w,
                InvokeRequest {
                    cmd: cmd.into(),
                    callback: CallbackFn(0),
                    error: CallbackFn(1),
                    url: "tauri://localhost".parse().unwrap(),
                    body: InvokeBody::default(),
                    headers: Default::default(),
                    invoke_key: INVOKE_KEY.to_string(),
                },
            );
            match res {
                Ok(body) => Ok(body.deserialize::<serde_json::Value>().unwrap().to_string()),
                Err(e) => Err(e.to_string()),
            }
        }

        #[test]
        fn guard_blocks_then_allows_real_ipc_calls() {
            let app = mock_builder()
                .manage(SessionState::default())
                .invoke_handler(guard(tauri::generate_handler![get_products, has_users]))
                .build(mock_context(noop_assets()))
                .unwrap();
            let w = WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();

            // Signed out: protected command rejected, public one works.
            let blocked = call(&w, "get_products").unwrap_err();
            assert!(blocked.contains("Not signed in"), "{blocked}");
            assert_eq!(call(&w, "has_users").unwrap(), "true");

            // Signed in: the protected command now runs.
            app.state::<SessionState>().start(user());
            assert_eq!(call(&w, "get_products").unwrap(), "\"secret\"");

            // Signed out again: blocked again.
            app.state::<SessionState>().end();
            assert!(call(&w, "get_products").unwrap_err().contains("Not signed in"));
        }
    }
}

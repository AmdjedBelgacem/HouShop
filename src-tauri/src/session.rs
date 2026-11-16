//! Backend session: who is signed in, enforced for every command.
//!
//! The session lives only in memory, so closing the app signs everyone out.
//! `guard` is called from the central invoke handler in `lib.rs`; any command
//! not listed in `PUBLIC_COMMANDS` is rejected unless a user is signed in.
//! New commands are therefore protected by default.

use crate::models::User;
use std::sync::Mutex;

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
    token: String,
    user: User,
}

#[derive(Default)]
pub struct SessionState(Mutex<Option<ActiveSession>>);

impl SessionState {
    pub fn start(&self, token: String, user: User) {
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(ActiveSession { token, user });
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

    pub fn token(&self) -> Option<String> {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .map(|s| s.token.clone())
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
        s.start("t".into(), user());
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
    fn logout_blocks_again() {
        let s = SessionState::default();
        s.start("t".into(), user());
        s.end();
        assert!(!is_allowed("create_sale", &s));
        assert!(s.user().is_none() && s.token().is_none());
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
            app.state::<SessionState>().start("t".into(), user());
            assert_eq!(call(&w, "get_products").unwrap(), "\"secret\"");

            // Signed out again: blocked again.
            app.state::<SessionState>().end();
            assert!(call(&w, "get_products").unwrap_err().contains("Not signed in"));
        }
    }
}

//! Finds and runs the helper programs that talk to phones: `adb` for Android
//! and the libimobiledevice tools for iPhone.
//!
//! The installers ship their own copies (folders `platform-tools` and
//! `imobiledevice` next to the app), so nothing has to be installed on the
//! computer. Those are tried first, then the usual system locations, so a
//! technician's own install still works.

use std::path::{Path, PathBuf};

#[cfg(windows)]
const EXE: &str = ".exe";
#[cfg(not(windows))]
const EXE: &str = "";

/// Folders the installers put the bundled tools in, relative to the app.
/// Port of the adb server this app runs (the default, 5037, is shared with other tools).
pub const ADB_SERVER_PORT: &str = "5038";

const BUNDLE_FOLDERS: &[&str] = &["platform-tools", "imobiledevice", "mtp"];

/// Folders next to the running app that may hold bundled tools.
fn app_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            dirs.push(dir.to_path_buf());
            dirs.push(dir.join("resources"));
            // macOS: <App>.app/Contents/MacOS/<exe> -> Contents/Resources
            dirs.push(dir.join("../Resources"));
            dirs.push(dir.join("../Resources/resources"));
            // `cargo run` / `tauri dev`: target/debug -> src-tauri/resources
            dirs.push(dir.join("../../resources"));
        }
    }
    // Development builds: the folders in the source tree.
    #[cfg(debug_assertions)]
    dirs.push(PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/resources")));

    // The source tree keeps one folder per operating system.
    let os_folder = if cfg!(windows) { "windows" } else { "macos" };
    let with_os: Vec<PathBuf> = dirs.iter().map(|d| d.join(os_folder)).collect();
    dirs.extend(with_os);
    dirs
}

fn candidates(name: &str) -> Vec<PathBuf> {
    let file = format!("{name}{EXE}");
    let mut out: Vec<PathBuf> = Vec::new();

    // An explicit override for adb.
    if name == "adb" {
        if let Some(p) = std::env::var_os("ADB_PATH") {
            out.push(PathBuf::from(p));
        }
    }

    // 1. Bundled with the app.
    for dir in app_dirs() {
        for sub in BUNDLE_FOLDERS {
            out.push(dir.join(sub).join(&file));
            out.push(dir.join(sub).join("bin").join(&file));
        }
        out.push(dir.join(&file));
    }
    out.push(PathBuf::from(format!("./{file}")));

    // 2. Android SDK and common manual installs (adb only).
    if name == "adb" {
        for var in ["ANDROID_HOME", "ANDROID_SDK_ROOT", "ANDROID_SDK"] {
            if let Some(root) = std::env::var_os(var) {
                out.push(PathBuf::from(root).join("platform-tools").join(&file));
            }
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            out.push(PathBuf::from(local).join("Android/Sdk/platform-tools").join(&file));
        }
        if let Some(home) = std::env::var_os("HOME") {
            out.push(PathBuf::from(home).join("Library/Android/sdk/platform-tools").join(&file));
        }
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            let profile = PathBuf::from(profile);
            for sub in [
                "platform-tools",
                "Downloads/platform-tools",
                "Desktop/platform-tools",
                "Documents/platform-tools",
                "adb",
                "scoop/shims",
                "scoop/apps/adb/current/platform-tools",
            ] {
                out.push(profile.join(sub).join(&file));
            }
        }
        for root in [
            "C:/platform-tools",
            "C:/adb",
            "C:/Android/platform-tools",
            "C:/Android/sdk/platform-tools",
            "C:/Program Files/platform-tools",
            "C:/Program Files (x86)/Android/android-sdk/platform-tools",
            "C:/ProgramData/chocolatey/bin",
        ] {
            out.push(PathBuf::from(root).join(&file));
        }
    }

    // 3. Homebrew and other Unix locations.
    for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        out.push(Path::new(dir).join(&file));
    }

    // 4. Every folder on PATH.
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            out.push(dir.join(&file));
        }
    }
    out
}

/// Full path of a tool (`adb`, `ideviceinfo`, ...) or None when it is not
/// available anywhere. Looked up on each call so installing a tool while the
/// app is open works without a restart.
pub fn locate(name: &str) -> Option<PathBuf> {
    candidates(name).into_iter().find(|p| p.is_file())
}

/// True when the tool exists somewhere we can run it from.
pub fn is_available(name: &str) -> bool {
    locate(name).is_some()
}

/// An async command for the tool. Falls back to the bare name (resolved by the
/// OS) when nothing was found, and never opens a console window on Windows.
pub fn command(name: &str) -> tokio::process::Command {
    let program = locate(name).unwrap_or_else(|| PathBuf::from(format!("{name}{EXE}")));
    #[allow(unused_mut)]
    let mut cmd = tokio::process::Command::new(&program);
    if name == "adb" {
        // Run our own adb server. Other programs (3uTools, Android Studio,
        // scrcpy) start their own adb on the default port and, when the
        // versions differ, keep killing each other's server, which makes
        // phones vanish at random.
        cmd.env("ANDROID_ADB_SERVER_PORT", ADB_SERVER_PORT);
    }
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: the device poller runs these tools every two seconds.
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

static ADB_START: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Makes sure our adb server is running before adb is used. Several adb
/// commands starting at once (device polling, a probe, a connection check)
/// would otherwise all try to start the server and fight over its port.
pub async fn ensure_adb_server() {
    if !is_available("adb") {
        return;
    }
    let _guard = ADB_START.lock().await;
    let _ = command("adb").arg("start-server").output().await;
}

/// Stops the adb server this app started, so it does not keep running (and
/// locking its files) after the app closes.
pub fn stop_adb_server() {
    if let Some(adb) = locate("adb") {
        let mut cmd = std::process::Command::new(adb);
        cmd.env("ANDROID_ADB_SERVER_PORT", ADB_SERVER_PORT).arg("kill-server");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        let _ = cmd.output();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidates_prefer_the_bundled_copy() {
        let list = candidates("adb");
        let bundled = list.iter().position(|p| p.to_string_lossy().contains("platform-tools"));
        let brew = list.iter().position(|p| p.starts_with("/opt/homebrew/bin"));
        assert!(bundled.unwrap() < brew.unwrap());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn finds_the_bundled_phone_tools() {
        for tool in ["adb", "idevice_id", "ideviceinfo", "idevicepair", "idevicediagnostics", "afcclient"] {
            let p = locate(tool).unwrap_or_else(|| panic!("{tool} not found"));
            assert!(p.to_string_lossy().contains("resources/macos"), "{tool} -> {}", p.display());
        }
    }

    #[test]
    fn unknown_tool_is_not_found() {
        assert!(locate("definitely-not-a-real-tool-xyz").is_none());
    }
}

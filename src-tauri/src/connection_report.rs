//! "Why isn't my phone showing up?" Gathers what the computer can see about
//! USB phones, without changing anything, so the interface can say what to do.

use serde::Serialize;

#[derive(Serialize, Default, Clone)]
pub struct UsbEntry {
    pub name: String,
    pub vendor_id: String,
    /// Windows driver state: true when the device has a working driver.
    pub driver_ok: bool,
    pub phone_like: bool,
}

#[derive(Serialize, Default, Clone)]
pub struct Hint {
    /// Stable code the interface turns into a sentence.
    pub code: String,
    /// Extra text for the sentence (a device name or serial).
    pub detail: String,
}

#[derive(Serialize, Default)]
pub struct ConnectionReport {
    pub platform: String,
    pub adb_path: Option<String>,
    pub adb_devices: Vec<(String, String)>,
    pub adb_error: Option<String>,
    pub ios_tools: bool,
    pub ios_devices: Vec<String>,
    /// Windows only: Apple's USB service (needed to see an iPhone).
    pub apple_service: Option<bool>,
    pub usb: Vec<UsbEntry>,
    pub hints: Vec<Hint>,
}

/// USB vendor ids of phone makers (4 hex digits, lower case).
const PHONE_VENDORS: &[&str] = &[
    "04e8", "18d1", "2717", "12d1", "22b8", "0bb4", "05c6", "0e8d", "2a70", "22d9", "2d95",
    "1782", "05ac", "19d2", "0fce", "1004", "2ae5", "1bbb", "2b4c", "1ebf", "0489", "109b",
    "17ef", "2970", "29a9", "0b05", "413c", "0502", "1d4d", "2fb8", "2e04",
];

/// Whether a USB device looks like a phone. Apple's vendor id is also used by
/// some third-party keyboards and dongles, so for it the name must say so.
fn looks_like_phone(vendor_id: &str, name: &str, class: &str) -> bool {
    if vendor_id == "05ac" {
        let n = name.to_lowercase();
        return n.contains("iphone") || n.contains("ipad") || n.contains("ipod") || n.contains("apple mobile device");
    }
    PHONE_VENDORS.contains(&vendor_id)
        || ["WPD", "AndroidUsbDeviceClass", "ADB"].iter().any(|c| class.eq_ignore_ascii_case(c))
}

pub fn parse_adb_devices(text: &str) -> Vec<(String, String)> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with("List of") && !l.starts_with('*') && !l.starts_with("adb server"))
        .filter_map(|l| {
            let mut p = l.split_whitespace();
            Some((p.next()?.to_string(), p.next().unwrap_or("unknown").to_string()))
        })
        .collect()
}

/// Turns the raw findings into plain-language hints.
pub fn build_hints(r: &ConnectionReport) -> Vec<Hint> {
    let mut hints = Vec::new();
    let hint = |code: &str, detail: &str| Hint { code: code.into(), detail: detail.into() };

    for (serial, state) in &r.adb_devices {
        match state.as_str() {
            "unauthorized" => hints.push(hint("adb_unauthorized", serial)),
            "offline" => hints.push(hint("adb_offline", serial)),
            _ => {}
        }
    }
    if r.adb_path.is_none() {
        hints.push(hint("adb_missing", ""));
    } else if let Some(e) = &r.adb_error {
        hints.push(hint("adb_failed", e));
    }

    let phones: Vec<&UsbEntry> = r.usb.iter().filter(|u| u.phone_like).collect();
    for p in &phones {
        if !p.driver_ok {
            hints.push(hint("usb_driver_problem", &p.name));
        }
    }
    let android_listed = r.adb_devices.iter().any(|(_, s)| s == "device");
    let apple_listed = !r.ios_devices.is_empty();
    let phone_not_apple = phones.iter().any(|p| p.vendor_id != "05ac");
    let apple_seen = phones.iter().any(|p| p.vendor_id == "05ac");

    if r.adb_devices.is_empty() && phone_not_apple && !android_listed {
        hints.push(hint("phone_seen_no_adb", ""));
    }
    if apple_seen && !apple_listed {
        if r.apple_service == Some(false) {
            hints.push(hint("apple_driver_missing", ""));
        } else if r.ios_tools {
            hints.push(hint("iphone_trust", ""));
        }
    }
    if !apple_seen && r.apple_service == Some(false) && r.ios_devices.is_empty() {
        hints.push(hint("apple_driver_missing", ""));
    }
    if r.platform != "macos" && !r.usb.is_empty() && phones.is_empty() && !android_listed && !apple_listed {
        hints.push(hint("no_usb_phone", ""));
    }
    hints
}

#[cfg(windows)]
pub async fn usb_entries() -> Vec<UsbEntry> {
    let script = "Get-CimInstance Win32_PnPEntity | Where-Object { $_.DeviceID -like 'USB\\VID_*' } | \
        Select-Object Name,PNPClass,ConfigManagerErrorCode,DeviceID | ConvertTo-Json -Compress";
    let out = tokio::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(0x0800_0000)
        .output()
        .await;
    let Ok(out) = out else { return Vec::new() };
    let text = String::from_utf8_lossy(&out.stdout);
    let Ok(value) = serde_json::from_str::<serde_json::Value>(text.trim()) else { return Vec::new() };
    let items = match value {
        serde_json::Value::Array(a) => a,
        v @ serde_json::Value::Object(_) => vec![v],
        _ => Vec::new(),
    };
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for it in items {
        let id = it["DeviceID"].as_str().unwrap_or("").to_lowercase();
        let vid = id.split("vid_").nth(1).map(|s| s.chars().take(4).collect::<String>()).unwrap_or_default();
        let class = it["PNPClass"].as_str().unwrap_or("");
        let name = it["Name"].as_str().unwrap_or("USB device").to_string();
        // Only interface-level entries ("&mi_") repeat the same device.
        if id.contains("&mi_") && !class.eq_ignore_ascii_case("AndroidUsbDeviceClass") && !PHONE_VENDORS.contains(&vid.as_str()) {
            continue;
        }
        let phone_like = looks_like_phone(&vid, &name, class);
        let driver_ok = it["ConfigManagerErrorCode"].as_i64().unwrap_or(0) == 0;
        if seen.insert((name.clone(), vid.clone(), driver_ok)) {
            result.push(UsbEntry { name, vendor_id: vid, driver_ok, phone_like });
        }
    }
    result
}

#[cfg(target_os = "macos")]
pub async fn usb_entries() -> Vec<UsbEntry> {
    let out = tokio::process::Command::new("ioreg").args(["-p", "IOUSB", "-l", "-w0"]).output().await;
    let Ok(out) = out else { return Vec::new() };
    let text = String::from_utf8_lossy(&out.stdout);
    let (mut name, mut result) = (String::new(), Vec::new());
    for line in text.lines() {
        if let Some(v) = line.split("\"USB Product Name\" = \"").nth(1) {
            name = v.trim_end_matches('"').to_string();
        } else if let Some(v) = line.split("\"idVendor\" = ").nth(1) {
            let vid = format!("{:04x}", v.trim().parse::<u32>().unwrap_or(0));
            let n = std::mem::take(&mut name);
            let phone_like = looks_like_phone(&vid, &n, "");
            result.push(UsbEntry { name: n, vendor_id: vid, driver_ok: true, phone_like });
        }
    }
    result
}

#[cfg(not(any(windows, target_os = "macos")))]
pub async fn usb_entries() -> Vec<UsbEntry> {
    Vec::new()
}

#[cfg(windows)]
async fn apple_service_running() -> Option<bool> {
    let out = tokio::process::Command::new("sc")
        .args(["query", "Apple Mobile Device Service"])
        .creation_flags(0x0800_0000)
        .output()
        .await
        .ok()?;
    Some(String::from_utf8_lossy(&out.stdout).contains("RUNNING"))
}
#[cfg(not(windows))]
async fn apple_service_running() -> Option<bool> {
    None
}

pub async fn collect() -> ConnectionReport {
    let mut r = ConnectionReport {
        platform: std::env::consts::OS.replace("macos", "macos"),
        ..Default::default()
    };
    r.adb_path = crate::tools::locate("adb").map(|p| p.display().to_string());
    if r.adb_path.is_some() {
        crate::tools::ensure_adb_server().await;
        match crate::tools::command("adb").args(["devices"]).output().await {
            Ok(o) => {
                r.adb_devices = parse_adb_devices(&String::from_utf8_lossy(&o.stdout));
                if !o.status.success() {
                    r.adb_error = Some(String::from_utf8_lossy(&o.stderr).trim().to_string());
                }
            }
            Err(e) => r.adb_error = Some(e.to_string()),
        }
    }
    r.ios_tools = crate::tools::is_available("idevice_id");
    if r.ios_tools {
        if let Ok(o) = crate::tools::command("idevice_id").arg("-l").output().await {
            r.ios_devices = String::from_utf8_lossy(&o.stdout)
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .map(String::from)
                .collect();
        }
    }
    r.apple_service = apple_service_running().await;
    r.usb = usb_entries().await;
    r.hints = build_hints(&r);
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    fn usb(name: &str, vid: &str, ok: bool) -> UsbEntry {
        UsbEntry { name: name.into(), vendor_id: vid.into(), driver_ok: ok, phone_like: looks_like_phone(vid, name, "") }
    }

    #[test]
    fn apple_keyboard_dongle_is_not_an_iphone() {
        assert!(!looks_like_phone("05ac", "2.4G Wireless Combo", ""));
        assert!(looks_like_phone("05ac", "Apple iPhone", ""));
        assert!(looks_like_phone("05ac", "Apple Mobile Device USB Composite Device", ""));
    }
    fn base() -> ConnectionReport {
        ConnectionReport { platform: "windows".into(), adb_path: Some("adb".into()), ..Default::default() }
    }
    fn codes(r: &ConnectionReport) -> Vec<String> {
        build_hints(r).into_iter().map(|h| h.code).collect()
    }

    #[tokio::test]
    async fn collect_uses_the_bundled_tools_on_this_machine() {
        let r = collect().await;
        println!("{}", serde_json::to_string_pretty(&r).unwrap());
        assert!(r.adb_path.is_some());
        assert!(r.ios_tools);
        assert!(r.adb_error.is_none(), "{:?}", r.adb_error);
    }

    #[test]
    fn parses_adb_output_ignoring_daemon_noise() {
        let d = parse_adb_devices("* daemon not running; starting now\n* daemon started successfully\nList of devices attached\nR58M123\tunauthorized\nemulator-5554\tdevice\n");
        assert_eq!(d, vec![("R58M123".to_string(), "unauthorized".to_string()), ("emulator-5554".to_string(), "device".to_string())]);
    }

    #[test]
    fn unauthorized_phone_says_allow_on_the_phone() {
        let mut r = base();
        r.adb_devices = vec![("R58".into(), "unauthorized".into())];
        assert!(codes(&r).contains(&"adb_unauthorized".to_string()));
    }

    #[test]
    fn phone_with_driver_problem_is_reported() {
        let mut r = base();
        r.usb = vec![usb("SAMSUNG Mobile USB Modem", "04e8", false)];
        let c = codes(&r);
        assert!(c.contains(&"usb_driver_problem".to_string()));
        assert!(c.contains(&"phone_seen_no_adb".to_string()));
    }

    #[test]
    fn nothing_phone_like_on_usb_means_cable_or_mode() {
        let mut r = base();
        r.usb = vec![usb("USB Root Hub", "8087", true)];
        assert!(codes(&r).contains(&"no_usb_phone".to_string()));
    }

    #[test]
    fn iphone_without_apple_service_needs_the_driver() {
        let mut r = base();
        r.apple_service = Some(false);
        r.ios_tools = true;
        r.usb = vec![usb("Apple Mobile Device USB Device", "05ac", true)];
        assert!(codes(&r).contains(&"apple_driver_missing".to_string()));
    }

    #[test]
    fn working_iphone_gives_no_warning() {
        let mut r = base();
        r.apple_service = Some(true);
        r.ios_tools = true;
        r.ios_devices = vec!["0000".into()];
        r.usb = vec![usb("Apple iPhone", "05ac", true)];
        assert!(codes(&r).is_empty());
    }
}

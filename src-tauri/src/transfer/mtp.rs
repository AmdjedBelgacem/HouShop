//! Android phones that only offer file transfer (MTP), i.e. with USB
//! debugging off. They cannot be probed deeply, but their make, model, serial
//! number and storage can still be read without touching any phone setting.
//!
//! macOS reads them with the bundled libmtp (`mtp-detect`); Windows uses the
//! built-in Windows Portable Devices API (see `mtp_wpd`).

use std::time::{Duration, Instant};

#[derive(Debug, Clone, Default, PartialEq)]
pub struct MtpDevice {
    /// Stable id used by the app: `mtp:<serial>` (or `mtp:<bus>-<index>` without one).
    pub id: String,
    pub manufacturer: String,
    pub model: String,
    pub serial: Option<String>,
    pub storage_total_bytes: u64,
    pub storage_free_bytes: u64,
    pub battery_percent: Option<u8>,
}

pub const ID_PREFIX: &str = "mtp:";

/// Wiping, transferring and deep inspection need USB debugging; a phone seen
/// only over file transfer cannot do them, so say why instead of failing oddly.
pub fn require_debugging(device_id: &str) -> Result<(), String> {
    if device_id.starts_with(ID_PREFIX) {
        Err("This phone is connected for file transfer only. Turn on USB debugging on the phone (Settings > Developer options), reconnect it and try again.".into())
    } else {
        Ok(())
    }
}

/// Parses the output of libmtp's `mtp-detect`.
pub fn parse_mtp_detect(text: &str) -> Vec<MtpDevice> {
    let mut devices: Vec<MtpDevice> = Vec::new();
    let mut current: Option<MtpDevice> = None;
    let mut in_storage = false;

    let finish = |cur: &mut Option<MtpDevice>, out: &mut Vec<MtpDevice>| {
        if let Some(mut d) = cur.take() {
            if d.model.is_empty() && d.manufacturer.is_empty() {
                return;
            }
            let index = out.len();
            d.id = match &d.serial {
                Some(s) => format!("{ID_PREFIX}{s}"),
                None => format!("{ID_PREFIX}device-{index}"),
            };
            out.push(d);
        }
    };

    for raw in text.lines() {
        let line = raw.trim();
        if line.starts_with("Device info:") || line.starts_with("Attempting to connect device") {
            // A new device block starts; close the previous one.
            if line.starts_with("Attempting") || current.is_some() {
                finish(&mut current, &mut devices);
            }
            current = Some(MtpDevice::default());
            in_storage = false;
            continue;
        }
        let Some(dev) = current.as_mut() else { continue };
        if let Some(v) = line.strip_prefix("Manufacturer:") {
            dev.manufacturer = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("Model:") {
            dev.model = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("Serial number:") {
            let v = v.trim();
            if !v.is_empty() && v != "(null)" {
                dev.serial = Some(v.to_string());
            }
        } else if line.starts_with("Storage Devices") {
            in_storage = true;
        } else if let Some(v) = line.strip_prefix("MaxCapacity:") {
            if in_storage {
                dev.storage_total_bytes += v.trim().parse::<u64>().unwrap_or(0);
            }
        } else if let Some(v) = line.strip_prefix("FreeSpaceInBytes:") {
            if in_storage {
                dev.storage_free_bytes += v.trim().parse::<u64>().unwrap_or(0);
            }
        } else if let Some(rest) = line.strip_prefix("Battery level") {
            // "Battery level 87 percent" or "Battery level 87 of 100 (87%)"
            let rest = rest.trim();
            let percent = match (rest.find('('), rest.find("%)")) {
                (Some(a), Some(b)) if a < b => rest[a + 1..b].trim().parse::<u8>().ok(),
                _ => rest.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse::<u8>().ok(),
            };
            dev.battery_percent = percent.filter(|p| *p <= 100);
        }
    }
    finish(&mut current, &mut devices);
    devices
}

#[cfg(target_os = "macos")]
async fn scan() -> Vec<MtpDevice> {
    if !crate::tools::is_available("mtp-detect") {
        return Vec::new();
    }
    let run = crate::tools::command("mtp-detect").output();
    // A phone that is locked can make libmtp wait; never block the device list.
    match tokio::time::timeout(Duration::from_secs(8), run).await {
        Ok(Ok(out)) => {
            let mut text = String::from_utf8_lossy(&out.stdout).to_string();
            text.push('\n');
            text.push_str(&String::from_utf8_lossy(&out.stderr));
            parse_mtp_detect(&text)
        }
        _ => Vec::new(),
    }
}

#[cfg(windows)]
async fn scan() -> Vec<MtpDevice> {
    tokio::task::spawn_blocking(super::mtp_wpd::list_devices)
        .await
        .unwrap_or_default()
}

#[cfg(not(any(windows, target_os = "macos")))]
async fn scan() -> Vec<MtpDevice> {
    Vec::new()
}

/// Reading a phone over MTP opens it, so do it at most every few seconds.
const CACHE_FOR: Duration = Duration::from_secs(6);

static CACHE: std::sync::Mutex<Option<(Instant, Vec<MtpDevice>)>> = std::sync::Mutex::new(None);

pub async fn list_devices() -> Vec<MtpDevice> {
    if let Some((at, devices)) = CACHE.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        if at.elapsed() < CACHE_FOR {
            return devices.clone();
        }
    }
    let devices = scan().await;
    *CACHE.lock().unwrap_or_else(|e| e.into_inner()) = Some((Instant::now(), devices.clone()));
    devices
}

/// Looks one device up by the id the app uses for it, ignoring the cache.
pub async fn find_device(id: &str) -> Option<MtpDevice> {
    let devices = scan().await;
    *CACHE.lock().unwrap_or_else(|e| e.into_inner()) = Some((Instant::now(), devices.clone()));
    devices.into_iter().find(|d| d.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "\
libmtp version: 1.1.23

Listing raw device(s)
Device 0 (VID=1782 and PID=4001) is a Unisoc Phone.
   Found 1 raw device(s)
Attempting to connect device
Android device detected, assigning default bug flags
Device info:
   Manufacturer: Unisoc
   Model: Unisoc Phone
   Device version: 1.0
   Serial number: 67719102300330
   Vendor extension ID: 0x00000006
Storage Devices:
   StorageID: 65537
      StorageType: 0x3 fixed RAM storage
      MaxCapacity: 112000000000
      FreeSpaceInBytes: 80000000000
      StorageDescription: Internal storage
   StorageID: 131073
      MaxCapacity: 32000000000
      FreeSpaceInBytes: 1000000000
      StorageDescription: SD card
Battery level 32 of 50 (64%)
OK.
";

    #[test]
    fn parses_a_libmtp_listing() {
        let d = parse_mtp_detect(SAMPLE);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].id, "mtp:67719102300330");
        assert_eq!(d[0].manufacturer, "Unisoc");
        assert_eq!(d[0].model, "Unisoc Phone");
        assert_eq!(d[0].storage_total_bytes, 144_000_000_000);
        assert_eq!(d[0].storage_free_bytes, 81_000_000_000);
        assert_eq!(d[0].battery_percent, Some(64));
    }

    #[test]
    fn no_device_is_an_empty_list() {
        assert!(parse_mtp_detect("libmtp version: 1.1.23\n\nListing raw device(s)\n   No raw devices found.\n").is_empty());
    }

    #[test]
    fn missing_serial_still_gets_an_id() {
        let d = parse_mtp_detect("Device info:\n   Manufacturer: X\n   Model: Y\n   Serial number: (null)\n");
        assert_eq!(d[0].id, "mtp:device-0");
        assert_eq!(d[0].serial, None);
    }
}

use super::types::{
    CategoryScanResult, ConnectionType, DeviceCapabilities, DeviceConnectionState, DeviceInfo,
    DevicePlatform, TransferCategory,
};
use std::path::PathBuf;
use std::process::Stdio;
use tokio::process::Command;

pub struct IosManager {
    tools_available: bool,
    /// Reads the phone's media folders over USB (read-only use only).
    afcclient_path: Option<PathBuf>,
}

impl IosManager {
    pub fn new() -> Self {
        Self {
            tools_available: crate::tools::is_available("idevice_id") || crate::tools::is_available("ideviceinfo"),
            afcclient_path: crate::tools::locate("afcclient"),
        }
    }

    pub fn is_available(&self) -> bool {
        self.tools_available
    }

    /// Lists connected iOS devices using libimobiledevice tools if present.
    pub async fn list_devices(&self) -> Result<Vec<DeviceInfo>, String> {
        if !self.tools_available {
            return Ok(Vec::new());
        }

        let output = crate::tools::command("idevice_id")
            .arg("-l")
            .output()
            .await
            .map_err(|e| format!("Failed to run idevice_id: {}", e))?;

        if !output.status.success() {
            return Ok(Vec::new());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut devices = Vec::new();

        for line in stdout.lines() {
            let udid = line.trim();
            if udid.is_empty() {
                continue;
            }

            // Check pairing status: `idevicepair -u <udid> validate`
            let pair_status = crate::tools::command("idevicepair")
                .args(["-u", udid, "validate"])
                .output()
                .await;

            let is_trusted = pair_status
                .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).contains("SUCCESS"))
                .unwrap_or(false);

            let connection_state = if is_trusted {
                DeviceConnectionState::Connected
            } else {
                DeviceConnectionState::NeedTrust
            };

            // Query device info: `ideviceinfo -u <udid>`
            let mut name = "Apple iPhone".to_string();
            let mut model = "iPhone".to_string();
            let mut os_version = "iOS".to_string();
            let mut battery = None;
            // 0 means "unknown": never show invented storage figures.
            let mut storage_total: u64 = 0;
            let mut storage_free: u64 = 0;

            if let Ok(info_out) = crate::tools::command("ideviceinfo").args(["-u", udid]).output().await {
                if info_out.status.success() {
                    let info_text = String::from_utf8_lossy(&info_out.stdout);
                    for infoline in info_text.lines() {
                        if let Some((k, v)) = infoline.split_once(':') {
                            let key = k.trim();
                            let val = v.trim();
                            match key {
                                "DeviceName" => name = val.to_string(),
                                "ProductType" => model = map_product_type_to_model(val),
                                "ProductVersion" => os_version = format!("iOS {}", val),
                                _ => {}
                            }
                        }
                    }
                }
            }

            // Storage lives in the disk-usage section, not the default one.
            if let Ok(disk_out) = crate::tools::command("ideviceinfo")
                .args(["-u", udid, "-q", "com.apple.disk_usage"])
                .output()
                .await
            {
                if disk_out.status.success() {
                    let (total, free) = parse_disk_usage(&String::from_utf8_lossy(&disk_out.stdout));
                    storage_total = total;
                    storage_free = free;
                }
            }

            // Query battery if available
            if let Ok(bat_out) = crate::tools::command("ideviceinfo").args(["-u", udid, "-q", "com.apple.mobile.battery"]).output().await {
                if bat_out.status.success() {
                    let bat_text = String::from_utf8_lossy(&bat_out.stdout);
                    for bline in bat_text.lines() {
                        if bline.starts_with("BatteryCurrentCapacity:") {
                            if let Some((_, v)) = bline.split_once(':') {
                                battery = v.trim().parse::<u8>().ok();
                            }
                        }
                    }
                }
            }

            let mut caps = DeviceCapabilities::default();
            // iOS restricts direct write of SMS and Call Logs via USB without full device restore
            caps.can_write_messages = false;
            caps.can_write_calls = false;

            devices.push(DeviceInfo {
                id: udid.to_string(),
                name,
                brand: "Apple".to_string(),
                model,
                platform: DevicePlatform::Ios,
                os_version,
                connection_type: ConnectionType::Usb,
                connection_state,
                battery_level: battery,
                is_charging: None,
                storage_total_bytes: storage_total,
                storage_free_bytes: storage_free,
                capabilities: caps,
                is_virtual: false,
            });
        }

        Ok(devices)
    }

    /// Reads one folder on the phone with `afcclient ls -l`. Read-only: this is
    /// the only afcclient command the app ever runs.
    async fn afc_ls(&self, udid: &str, path: &str) -> Result<Vec<AfcEntry>, String> {
        let afc = self
            .afcclient_path
            .as_ref()
            .ok_or_else(|| "afcclient not installed".to_string())?;
        let run = Command::new(afc)
            .args(["-u", udid, "--", "ls", "-l", path])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .output();
        let output = tokio::time::timeout(std::time::Duration::from_secs(60), run)
            .await
            .map_err(|_| format!("Reading {} timed out", path))?
            .map_err(|e| format!("Failed to run afcclient: {}", e))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Ok(parse_afc_ls_long(&String::from_utf8_lossy(&output.stdout)))
    }

    /// Counts what is really on the phone. Photos and videos come from the media
    /// folder (exact counts and sizes); voice recordings from their folder.
    /// Contacts, messages, calls, calendars and documents can't be read over USB
    /// without a full backup, so they are reported as unavailable, never invented.
    pub async fn scan_categories(&self, udid: &str) -> Vec<CategoryScanResult> {
        let unreadable = |note: &str| CategoryScanResult {
            category: TransferCategory::Photos,
            item_count: 0,
            total_bytes: 0,
            available: false,
            note: Some(note.to_string()),
        };
        let needs_backup = |cat: TransferCategory| CategoryScanResult {
            category: cat,
            item_count: 0,
            total_bytes: 0,
            available: false,
            note: Some("needs_backup".into()),
        };

        let mut photos = (0u64, 0u64);
        let mut videos = (0u64, 0u64);
        let mut media_note: Option<String> = None;

        match self.afc_ls(udid, "/DCIM").await {
            Ok(folders) => {
                for dir in folders.iter().filter(|e| e.is_dir && !e.name.starts_with('.')) {
                    match self.afc_ls(udid, &format!("/DCIM/{}", dir.name)).await {
                        Ok(files) => {
                            for f in files.iter().filter(|f| !f.is_dir) {
                                match media_kind(&f.name) {
                                    Some(MediaKind::Photo) => {
                                        photos.0 += 1;
                                        photos.1 += f.size;
                                    }
                                    Some(MediaKind::Video) => {
                                        videos.0 += 1;
                                        videos.1 += f.size;
                                    }
                                    _ => {}
                                }
                            }
                        }
                        Err(_) => media_note = Some("unreadable".into()),
                    }
                }
            }
            Err(e) => {
                eprintln!("iOS media scan failed for {}: {}", udid, e);
                media_note = Some(if self.afcclient_path.is_none() { "tools_missing" } else { "unreadable" }.into());
            }
        }

        // Voice memos. A phone with none has no such folder, which is not an error.
        let mut audio = (0u64, 0u64);
        if let Ok(files) = self.afc_ls(udid, "/Recordings").await {
            for f in files.iter().filter(|f| !f.is_dir) {
                if matches!(media_kind(&f.name), Some(MediaKind::Audio)) {
                    audio.0 += 1;
                    audio.1 += f.size;
                }
            }
        }

        let mut out = Vec::new();
        let media = |cat: TransferCategory, (count, bytes): (u64, u64), note: &Option<String>| CategoryScanResult {
            category: cat,
            item_count: count,
            total_bytes: bytes,
            available: count > 0,
            note: if count > 0 { None } else { note.clone() },
        };
        if media_note.is_some() && photos.0 == 0 && videos.0 == 0 {
            let mut p = unreadable(media_note.as_deref().unwrap_or("unreadable"));
            p.category = TransferCategory::Photos;
            let mut v = unreadable(media_note.as_deref().unwrap_or("unreadable"));
            v.category = TransferCategory::Videos;
            out.push(p);
            out.push(v);
        } else {
            out.push(media(TransferCategory::Photos, photos, &None));
            out.push(media(TransferCategory::Videos, videos, &None));
        }
        out.push(CategoryScanResult {
            category: TransferCategory::Audio,
            item_count: audio.0,
            total_bytes: audio.1,
            available: audio.0 > 0,
            note: Some("voice_memos_only".into()),
        });
        out.push(needs_backup(TransferCategory::Contacts));
        out.push(needs_backup(TransferCategory::Messages));
        out.push(needs_backup(TransferCategory::Calls));
        out.push(needs_backup(TransferCategory::Calendars));
        out.push(needs_backup(TransferCategory::Documents));
        out
    }
}

/// One line of `afcclient ls -l`.
#[derive(Debug, PartialEq)]
pub(crate) struct AfcEntry {
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
}

/// Parses `afcclient ls -l` output, e.g.
/// `-rw-r--r--    1 mobile mobile     122940 02 Nov 2026 16:05:12 IMG_9153.JPG`
pub(crate) fn parse_afc_ls_long(text: &str) -> Vec<AfcEntry> {
    text.lines()
        .filter_map(|line| {
            let t: Vec<&str> = line.split_whitespace().collect();
            if t.len() < 10 {
                return None;
            }
            let perms = t[0];
            let kind = perms.chars().next()?;
            if perms.len() != 10 || !matches!(kind, '-' | 'd' | 'l') {
                return None;
            }
            Some(AfcEntry {
                size: t[4].parse::<u64>().ok()?,
                name: t[9..].join(" "),
                is_dir: kind == 'd',
            })
        })
        .collect()
}

#[derive(Debug, PartialEq)]
pub(crate) enum MediaKind {
    Photo,
    Video,
    Audio,
}

pub(crate) fn media_kind(name: &str) -> Option<MediaKind> {
    let ext = name.rsplit_once('.')?.1.to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" | "heic" | "heif" | "png" | "gif" | "dng" | "tif" | "tiff" | "webp" => {
            Some(MediaKind::Photo)
        }
        "mov" | "mp4" | "m4v" => Some(MediaKind::Video),
        "m4a" | "caf" | "wav" | "mp3" | "aac" | "aif" | "aiff" => Some(MediaKind::Audio),
        _ => None,
    }
}

/// `(total_bytes, free_bytes)` from the phone's disk-usage section; 0 when absent.
pub(crate) fn parse_disk_usage(text: &str) -> (u64, u64) {
    let (mut total, mut free) = (0u64, 0u64);
    for line in text.lines() {
        if let Some((k, v)) = line.split_once(':') {
            match k.trim() {
                "TotalDiskCapacity" => total = v.trim().parse().unwrap_or(0),
                "TotalDataAvailable" => free = v.trim().parse().unwrap_or(0),
                _ => {}
            }
        }
    }
    (total, free)
}

fn map_product_type_to_model(pt: &str) -> String {
    match pt {
        "iPhone17,1" => "iPhone 16 Pro".to_string(),
        "iPhone17,2" => "iPhone 16 Pro Max".to_string(),
        "iPhone17,3" => "iPhone 16".to_string(),
        "iPhone17,4" => "iPhone 16 Plus".to_string(),
        "iPhone17,5" => "iPhone 16e".to_string(),
        "iPhone16,1" => "iPhone 15 Pro".to_string(),
        "iPhone16,2" => "iPhone 15 Pro Max".to_string(),
        "iPhone15,4" => "iPhone 15".to_string(),
        "iPhone15,5" => "iPhone 15 Plus".to_string(),
        "iPhone15,2" => "iPhone 14 Pro".to_string(),
        "iPhone15,3" => "iPhone 14 Pro Max".to_string(),
        "iPhone14,7" => "iPhone 14".to_string(),
        "iPhone14,8" => "iPhone 14 Plus".to_string(),
        "iPhone14,2" => "iPhone 13 Pro".to_string(),
        "iPhone14,3" => "iPhone 13 Pro Max".to_string(),
        "iPhone14,5" => "iPhone 13".to_string(),
        "iPhone13,2" => "iPhone 12".to_string(),
        "iPhone12,1" => "iPhone 11".to_string(),
        _ if pt.starts_with("iPhone") => format!("Apple {}", pt),
        _ if pt.starts_with("iPad") => format!("Apple {}", pt),
        _ => pt.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Lines copied from a real iPhone 16 Pro Max.
    const SAMPLE: &str = "\
-rw-r--r--    1 mobile mobile     122940 02 Nov 2026 16:05:12 IMG_9153.JPG
-rw-r--r--    1 mobile mobile     720071 12 Nov 2026 15:33:50 IMG_9233.HEIC
-rw-r--r--    1 mobile mobile    4014037 14 Nov 2026 00:39:39 IMG_9246.MP4
-rw-r--r--    1 mobile mobile       1560 14 Nov 2026 00:39:40 IMG_9246.AAE
drwxr-xr-x    2 mobile mobile         64 02 Nov 2026 16:05:12 .MISC
";

    #[test]
    fn parses_real_afc_listing_with_sizes() {
        let e = parse_afc_ls_long(SAMPLE);
        assert_eq!(e.len(), 5);
        assert_eq!(e[0], AfcEntry { name: "IMG_9153.JPG".into(), size: 122940, is_dir: false });
        assert_eq!(e[2].size, 4014037);
        assert!(e[4].is_dir && e[4].name == ".MISC");
    }

    #[test]
    fn ignores_noise_lines() {
        assert!(parse_afc_ls_long("afcclient: error\n\n109APPLE\n").is_empty());
    }

    #[test]
    fn classifies_media_by_extension() {
        assert_eq!(media_kind("IMG_1.HEIC"), Some(MediaKind::Photo));
        assert_eq!(media_kind("a.jpg"), Some(MediaKind::Photo));
        assert_eq!(media_kind("clip.MOV"), Some(MediaKind::Video));
        assert_eq!(media_kind("Memo 1.m4a"), Some(MediaKind::Audio));
        assert_eq!(media_kind("IMG_1.AAE"), None);
        assert_eq!(media_kind("noextension"), None);
    }

    #[test]
    fn reads_storage_from_the_disk_usage_section() {
        // Real values from the phone; note the default section has no such keys.
        let text = "AmountDataAvailable: 2940096512\nTotalDataAvailable: 177439203328\nTotalDataCapacity: 245458432000\nTotalDiskCapacity: 256000000000\n";
        assert_eq!(parse_disk_usage(text), (256_000_000_000, 177_439_203_328));
        // Missing keys mean unknown (0), never an invented 128 GB.
        assert_eq!(parse_disk_usage("DeviceName: x\n"), (0, 0));
    }

    /// With a real iPhone attached, the scan must report what is on it: real
    /// photo and video counts, and no invented contacts/calendars.
    #[tokio::test]
    async fn real_iphone_scan_is_not_fabricated() {
        let mgr = IosManager::new();
        let devices = mgr.list_devices().await.unwrap_or_default();
        let Some(dev) = devices.iter().find(|d| d.connection_state == DeviceConnectionState::Connected) else {
            println!("no trusted iPhone attached: skipped");
            return;
        };
        println!("storage: {} total, {} free", dev.storage_total_bytes, dev.storage_free_bytes);
        assert_ne!(dev.storage_total_bytes, 128 * 1024 * 1024 * 1024, "invented default");
        let cats = mgr.scan_categories(&dev.id).await;
        for c in &cats {
            println!("{:?}: {} items, {} bytes, available={}, note={:?}", c.category, c.item_count, c.total_bytes, c.available, c.note);
        }
        let get = |cat: TransferCategory| cats.iter().find(|c| c.category == cat).unwrap();
        assert!(!get(TransferCategory::Contacts).available);
        assert_eq!(get(TransferCategory::Contacts).item_count, 0);
        assert_ne!(get(TransferCategory::Calendars).item_count, 85, "invented number");
        assert_ne!(get(TransferCategory::Contacts).item_count, 680, "invented number");
    }
}

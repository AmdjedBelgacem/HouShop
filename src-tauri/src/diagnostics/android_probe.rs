use crate::diagnostics::grading::{calculate_device_grading, get_standard_28_tests};
use crate::diagnostics::parts_audit::audit_android_parts;
use crate::diagnostics::types::{
    BatteryGasGauge, ComponentStatus, FullDeviceDiagnosticReport, HardwareTestResult,
    SecurityLockStatus,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::process::Command;

pub struct AndroidProbe {
    adb_path: PathBuf,
}

impl AndroidProbe {
    pub fn new() -> Self {
        let adb_path = resolve_adb_tool().unwrap_or_else(|| PathBuf::from("adb"));
        Self { adb_path }
    }

    pub async fn probe_device(
        &self,
        serial: &str,
    ) -> Result<FullDeviceDiagnosticReport, String> {
        // 1. Fetch getprop map
        let props = self.get_all_props(serial).await?;

        // 2. Query battery via dumpsys & sysfs
        let reading = self.query_battery(serial).await;

        // 3. Query storage & RAM
        let (ram_gb, storage_total, storage_free) = self.query_memory_and_storage(serial).await;

        // 4. Query security locks
        let security_locks = self.query_security_locks(serial, &props).await;

        // 5. Query IMEI
        let (imei1, imei2) = self.query_imei(serial).await;

        // Extract metadata
        let brand = props
            .get("ro.product.brand")
            .cloned()
            .unwrap_or_else(|| "Android".into());
        let model = props
            .get("ro.product.model")
            .cloned()
            .unwrap_or_else(|| "Generic Device".into());
        let device_name = format!("{} {}", brand, model);
        let os_version = props
            .get("ro.build.version.release")
            .cloned()
            .unwrap_or_else(|| "14".into());
        let baseband = props.get("gsm.version.baseband").cloned();
        let cpu_arch = props
            .get("ro.product.cpu.abi")
            .cloned()
            .unwrap_or_else(|| "arm64-v8a".into());

        let battery = BatteryGasGauge {
            health_percentage: reading.health_percentage,
            cycle_count: reading.cycle_count,
            design_capacity_mah: reading.design_mah,
            actual_capacity_mah: reading.actual_mah,
            temperature_celsius: reading.temperature_celsius,
            serial_number: props.get("ro.serialno").cloned(),
            // The phone does not say who made the cell, and nothing here checks that
            // the battery is genuine, so neither is claimed.
            manufacturer: None,
            status: ComponentStatus::Unknown,
            current_charge_percentage: reading.charge_percentage,
            is_charging: reading.is_charging,
            estimated: reading.estimated,
        };

        let parts_audit = audit_android_parts(&props);

        let mut hardware_tests: HashMap<String, HardwareTestResult> = HashMap::new();
        for test in get_standard_28_tests() {
            hardware_tests.insert(test.key.clone(), test);
        }

        let grading = calculate_device_grading(&battery, &parts_audit, &security_locks, &hardware_tests);

        Ok(FullDeviceDiagnosticReport {
            device_id: serial.to_string(),
            device_name,
            brand,
            model,
            platform: "Android".into(),
            os_version,
            imei1,
            imei2,
            serial_number: Some(serial.to_string()),
            baseband_version: baseband,
            cpu_architecture: cpu_arch,
            ram_gb,
            storage_total_bytes: storage_total,
            storage_free_bytes: storage_free,
            battery,
            parts_audit,
            security_locks,
            hardware_tests,
            grading,
        })
    }

    async fn get_all_props(&self, serial: &str) -> Result<HashMap<String, String>, String> {
        let output = self.exec_adb(serial, &["shell", "getprop"]).await?;
        let mut props = HashMap::new();

        for line in output.lines() {
            // Lines typically look like: [ro.product.brand]: [samsung]
            if let Some((k, v)) = line.split_once("]: [") {
                let key = k.trim().trim_start_matches('[').to_string();
                let val = v.trim().trim_end_matches(']').to_string();
                props.insert(key, val);
            }
        }

        Ok(props)
    }

    async fn query_battery(&self, serial: &str) -> AndroidBattery {
        let dumpsys = self
            .exec_adb(serial, &["shell", "dumpsys", "battery"])
            .await
            .unwrap_or_default();
        let (charge_percentage, temperature_celsius, is_charging) = parse_dumpsys_battery(&dumpsys);

        let read_u32 = |out: String| out.trim().parse::<u32>().ok();
        // Cycle count from sysfs; many phones don't expose it.
        let cycle_count = read_u32(
            self.exec_adb(
                serial,
                &[
                    "shell",
                    "cat /sys/class/power_supply/battery/cycle_count 2>/dev/null || cat /sys/class/power_supply/bms/battery_cycle 2>/dev/null",
                ],
            )
            .await
            .unwrap_or_default(),
        );
        let design = read_u32(
            self.exec_adb(
                serial,
                &["shell", "cat /sys/class/power_supply/battery/charge_full_design 2>/dev/null"],
            )
            .await
            .unwrap_or_default(),
        )
        .map(microamp_to_mah);
        let actual = read_u32(
            self.exec_adb(
                serial,
                &["shell", "cat /sys/class/power_supply/battery/charge_full 2>/dev/null"],
            )
            .await
            .unwrap_or_default(),
        )
        .map(microamp_to_mah);

        match (design, actual) {
            (Some(d), Some(a)) if d > 0 => AndroidBattery {
                health_percentage: ((a as f32 / d as f32) * 100.0).round().min(100.0) as u8,
                cycle_count: cycle_count.unwrap_or(0),
                design_mah: d,
                actual_mah: a,
                temperature_celsius,
                charge_percentage,
                is_charging,
                estimated: false,
            },
            // Capacity couldn't be read: no invented figures. Health is left neutral
            // and the report is flagged so the page says it wasn't measured.
            _ => AndroidBattery {
                health_percentage: 100,
                cycle_count: cycle_count.unwrap_or(0),
                design_mah: design.unwrap_or(0),
                actual_mah: 0,
                temperature_celsius,
                charge_percentage,
                is_charging,
                estimated: true,
            },
        }
    }

    async fn query_memory_and_storage(&self, serial: &str) -> (f32, u64, u64) {
        // Query MemTotal
        let mem_out = self
            .exec_adb(serial, &["shell", "cat /proc/meminfo 2>/dev/null"])
            .await
            .unwrap_or_default();

        let mut ram_gb = 8.0;
        for line in mem_out.lines() {
            if line.starts_with("MemTotal:") {
                if let Some(kb_str) = line.split_whitespace().nth(1) {
                    if let Ok(kb) = kb_str.parse::<f32>() {
                        ram_gb = (kb / (1024.0 * 1024.0)).round();
                    }
                }
            }
        }

        // Query storage via df
        let df_out = self
            .exec_adb(serial, &["shell", "df -k /data 2>/dev/null"])
            .await
            .unwrap_or_default();

        let mut total_bytes = 256 * 1024 * 1024 * 1024;
        let mut free_bytes = 140 * 1024 * 1024 * 1024;

        for line in df_out.lines().skip(1) {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 4 {
                if let (Ok(total_k), Ok(avail_k)) = (parts[1].parse::<u64>(), parts[3].parse::<u64>()) {
                    total_bytes = total_k * 1024;
                    free_bytes = avail_k * 1024;
                    break;
                }
            }
        }

        (ram_gb, total_bytes, free_bytes)
    }

    async fn query_security_locks(
        &self,
        serial: &str,
        props: &HashMap<String, String>,
    ) -> SecurityLockStatus {
        // Samsung Knox bit check
        let knox_val = props
            .get("ro.boot.warranty_bit")
            .or_else(|| props.get("ro.warranty_bit"))
            .map(|s| s.trim())
            .unwrap_or("0");
        let knox_tripped = knox_val == "1" || knox_val == "0x1";

        // Bootloader lock state
        let bl_locked = props
            .get("ro.boot.flash.locked")
            .map(|s| s.trim() == "1")
            .unwrap_or_else(|| {
                props
                    .get("ro.boot.verifiedbootstate")
                    .map(|s| s.trim() == "green")
                    .unwrap_or(true)
            });

        // FRP lock detection
        let frp_out = self
            .exec_adb(
                serial,
                &["shell", "settings get secure user_setup_complete 2>/dev/null"],
            )
            .await
            .unwrap_or_default();
        let frp_locked = frp_out.trim() == "0";

        // Root detection
        let su_check = self
            .exec_adb(
                serial,
                &[
                    "shell",
                    "which su 2>/dev/null || test -f /system/bin/su && echo 'rooted'",
                ],
            )
            .await
            .unwrap_or_default();
        let is_rooted = su_check.contains("/su") || su_check.contains("rooted");

        SecurityLockStatus {
            icloud_fmi_locked: false,
            fmi_account_masked: None,
            fmi_on: false,
            mdm_enrolled: false,
            carrier_locked: false,
            carrier_name: None,
            knox_tripped,
            frp_locked,
            bootloader_unlocked: !bl_locked,
            is_rooted_or_jailbroken: is_rooted,
        }
    }

    async fn query_imei(&self, serial: &str) -> (Option<String>, Option<String>) {
        let imei_out = self
            .exec_adb(
                serial,
                &[
                    "shell",
                    "service call iphonesubinfo 1 | toybox cut -d \"'\" -f2 | tr -d '. ' 2>/dev/null",
                ],
            )
            .await
            .unwrap_or_default();

        let cleaned = imei_out.trim().replace(|c: char| !c.is_ascii_digit(), "");
        if cleaned.len() >= 14 {
            (Some(cleaned[..15.min(cleaned.len())].to_string()), None)
        } else {
            (None, None)
        }
    }

    async fn exec_adb(&self, serial: &str, args: &[&str]) -> Result<String, String> {
        let mut cmd = Command::new(&self.adb_path);
        if !serial.is_empty() {
            cmd.arg("-s").arg(serial);
        }
        for a in args {
            cmd.arg(a);
        }

        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        let output = cmd
            .output()
            .await
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    "Android tools (adb) are not installed on this computer, so the phone cannot be read. Install Android platform-tools, then reconnect the phone with USB debugging on.".to_string()
                } else {
                    format!("Failed to run adb command: {}", e)
                }
            })?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(stderr.to_string())
        }
    }
}

struct AndroidBattery {
    health_percentage: u8,
    cycle_count: u32,
    design_mah: u32,
    actual_mah: u32,
    temperature_celsius: Option<f32>,
    charge_percentage: Option<u8>,
    is_charging: Option<bool>,
    estimated: bool,
}

/// Android reports these in µAh on most devices, mAh on a few.
fn microamp_to_mah(v: u32) -> u32 {
    if v > 100_000 { v / 1000 } else { v }
}

/// `(level %, temperature °C, charging)` from `dumpsys battery`; each is `None`
/// when the output doesn't contain it.
fn parse_dumpsys_battery(text: &str) -> (Option<u8>, Option<f32>, Option<bool>) {
    let (mut level, mut temp, mut charging) = (None, None, None);
    let mut saw_any = false;
    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("level:") {
            level = rest.trim().parse::<u8>().ok();
            saw_any = true;
        } else if let Some(rest) = line.strip_prefix("temperature:") {
            temp = rest.trim().parse::<f32>().ok().map(|t| t / 10.0);
        } else if line.contains("USB powered: true") || line.contains("AC powered: true") || line.contains("status: 2") {
            charging = Some(true);
        }
    }
    if saw_any && charging.is_none() {
        charging = Some(false);
    }
    (level, temp, charging)
}

fn resolve_adb_tool() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("ADB_PATH") {
        let p = PathBuf::from(path);
        if is_file_executable(&p) {
            return Some(p);
        }
    }

    if let Ok(home) = std::env::var("HOME") {
        let mac_sdk_path = PathBuf::from(home).join("Library/Android/sdk/platform-tools/adb");
        if is_file_executable(&mac_sdk_path) {
            return Some(mac_sdk_path);
        }
    }

    let default_names = ["adb", "/opt/homebrew/bin/adb", "/usr/local/bin/adb"];
    for name in &default_names {
        let p = PathBuf::from(name);
        if is_file_executable(&p) {
            return Some(p);
        }
    }

    None
}

fn is_file_executable(path: &PathBuf) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = std::fs::metadata(path) {
            return metadata.is_file() && (metadata.permissions().mode() & 0o111 != 0);
        }
    }
    #[cfg(windows)]
    {
        if path.exists() {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    /// With no adb on the machine the probe must say so in plain words,
    /// not return an "os error 2" or an empty report.
    #[tokio::test]
    async fn missing_adb_gives_a_plain_message() {
        let probe = AndroidProbe {
            adb_path: PathBuf::from("/nonexistent/path/to/adb"),
        };
        let err = probe.probe_device("ABC123").await.unwrap_err();
        assert!(err.contains("not installed"), "{err}");
        assert!(!err.contains("os error"), "{err}");
    }

    #[test]
    fn dumpsys_readings_are_parsed() {
        let text = "Current Battery Service state:\n  AC powered: false\n  USB powered: true\n  status: 2\n  level: 76\n  temperature: 312\n";
        assert_eq!(parse_dumpsys_battery(text), (Some(76), Some(31.2), Some(true)));
    }

    #[test]
    fn empty_dumpsys_means_unknown_not_88_percent() {
        assert_eq!(parse_dumpsys_battery(""), (None, None, None));
    }

    #[test]
    fn capacity_units_are_normalised() {
        assert_eq!(microamp_to_mah(5_000_000), 5000);
        assert_eq!(microamp_to_mah(4850), 4850);
    }
}

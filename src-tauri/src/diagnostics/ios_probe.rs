use crate::diagnostics::grading::{calculate_device_grading, get_standard_28_tests};
use crate::diagnostics::parts_audit::audit_ios_parts;
use crate::diagnostics::types::{
    BatteryGasGauge, ComponentStatus, FullDeviceDiagnosticReport, HardwareTestResult,
    SecurityLockStatus,
};
use base64::Engine;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;

pub struct IosProbe {
    idevicediagnostics_path: Option<PathBuf>,
}

impl IosProbe {
    pub fn new() -> Self {
        Self {
            idevicediagnostics_path: crate::tools::locate("idevicediagnostics"),
        }
    }

    /// Queries deep hardware diagnostics from an iOS device over USB.
    pub async fn probe_device(&self, udid: &str) -> Result<FullDeviceDiagnosticReport, String> {
        // 1. Run ideviceinfo for general keys
        let (general_props, raw_general) = self.query_domain(udid, None).await?;

        // 2. Run ideviceinfo for battery domain
        let (battery_props, _) = self
            .query_domain(udid, Some("com.apple.mobile.battery"))
            .await
            .unwrap_or_default();

        // 3. Run ideviceinfo for disk usage
        let (disk_props, _) = self
            .query_domain(udid, Some("com.apple.disk_usage"))
            .await
            .unwrap_or_default();

        // 4. Read the battery's own registers (cycles, capacities, serial)
        let regs = self.query_battery_registers(udid).await;

        self.build_report(
            udid,
            &general_props,
            &battery_props,
            &disk_props,
            &raw_general,
            regs,
        )
    }

    /// Reads the battery gauge straight from the phone's registry
    /// (`idevicediagnostics ioregentry AppleSmartBattery`).
    async fn query_battery_registers(&self, udid: &str) -> BatteryRegisters {
        let Some(_) = &self.idevicediagnostics_path else {
            return BatteryRegisters::default();
        };
        let mut cmd = crate::tools::command("idevicediagnostics");
        if !udid.is_empty() {
            cmd.arg("-u").arg(udid);
        }
        cmd.args(["ioregentry", "AppleSmartBattery"]);
        cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        match cmd.output().await {
            Ok(o) if o.status.success() => parse_battery_registers(&String::from_utf8_lossy(&o.stdout)),
            _ => BatteryRegisters::default(),
        }
    }

    async fn query_domain(
        &self,
        udid: &str,
        domain: Option<&str>,
    ) -> Result<(HashMap<String, String>, String), String> {
        let mut cmd = crate::tools::command("ideviceinfo");
        if !udid.is_empty() {
            cmd.arg("-u").arg(udid);
        }
        if let Some(d) = domain {
            cmd.arg("-q").arg(d);
        }

        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        let output = cmd
            .output()
            .await
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    "iPhone tools (libimobiledevice) are not installed on this computer, so the iPhone cannot be read. Install them, then reconnect the iPhone and tap Trust.".to_string()
                } else {
                    format!("Failed to execute ideviceinfo: {}", e)
                }
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("ideviceinfo returned error: {}", stderr));
        }

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let mut map = HashMap::new();

        for line in stdout.lines() {
            if let Some((k, v)) = line.split_once(':') {
                map.insert(k.trim().to_string(), v.trim().to_string());
            }
        }

        Ok((map, stdout))
    }

    fn build_report(
        &self,
        udid: &str,
        general: &HashMap<String, String>,
        battery_domain: &HashMap<String, String>,
        disk_domain: &HashMap<String, String>,
        raw_general: &str,
        regs: BatteryRegisters,
    ) -> Result<FullDeviceDiagnosticReport, String> {
        let device_name = general
            .get("DeviceName")
            .cloned()
            .unwrap_or_else(|| "iPhone".into());
        // Without the model the report would be a guess, so fail instead.
        let product_type = general
            .get("ProductType")
            .cloned()
            .ok_or_else(|| "The iPhone did not report its model. Unlock it, tap Trust, and try again.".to_string())?;
        let marketing_name = map_ios_model(&product_type);
        let os_version = general
            .get("ProductVersion")
            .cloned()
            .unwrap_or_else(|| "Unknown".into());
        let serial_number = general.get("SerialNumber").cloned();
        let imei1 = general
            .get("InternationalMobileEquipmentIdentity")
            .cloned();
        let imei2 = general
            .get("InternationalMobileEquipmentIdentity2")
            .cloned();
        let baseband = general.get("BasebandVersion").cloned();
        let raw_arch = general
            .get("CPUArchitecture")
            .cloned()
            .unwrap_or_else(|| "arm64e".into());
        let cpu_arch = map_ios_cpu_architecture(&product_type, &raw_arch);

        // Storage calculations
        let storage_total_bytes = disk_domain
            .get("TotalDiskCapacity")
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0);

        let storage_free_bytes = disk_domain
            .get("TotalDataAvailable")
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0);

        // RAM estimation based on product type
        let ram_gb = estimate_ios_ram(&product_type);

        // Battery: read from the battery's own registers. Health is computed the
        // way iOS does for "Maximum Capacity": current max capacity / design capacity.
        let current_charge_percentage = battery_domain
            .get("BatteryCurrentCapacity")
            .and_then(|v| v.parse::<u8>().ok());
        let is_charging = battery_domain
            .get("BatteryIsCharging")
            .map(|v| v == "true");

        let cycle_count = regs
            .cycle_count
            .or_else(|| battery_domain.get("CycleCount").and_then(|v| v.parse::<u32>().ok()));

        let (health_percentage, design_capacity_mah, actual_capacity_mah, estimated) =
            match (regs.design_mah, regs.nominal_mah) {
                (Some(design), Some(nominal)) if design > 0 && nominal > 0 => {
                    let pct = ((nominal as f32 / design as f32) * 100.0).round().min(100.0) as u8;
                    (pct, design, nominal, false)
                }
                _ => {
                    // The battery could not be read. Fall back to an estimate from the
                    // cycle count and the model's design capacity, and say so.
                    let design = regs.design_mah.unwrap_or_else(|| get_ios_design_capacity(&product_type));
                    let cycles = cycle_count.unwrap_or(0);
                    let rate = if product_type.starts_with("iPhone16") || product_type.starts_with("iPhone17") {
                        0.020f32
                    } else {
                        0.038f32
                    };
                    let pct = 100u8.saturating_sub((cycles as f32 * rate).round() as u8);
                    (pct, design, ((design as f32) * pct as f32 / 100.0).round() as u32, true)
                }
            };

        let battery_serial = regs
            .serial
            .clone()
            .or_else(|| battery_domain.get("BatterySerialNumber").cloned())
            .or_else(|| general.get("BatterySerialNumber").cloned());

        let battery = BatteryGasGauge {
            health_percentage,
            cycle_count: cycle_count.unwrap_or(0),
            design_capacity_mah,
            actual_capacity_mah,
            // iOS does not expose the battery temperature over USB.
            temperature_celsius: None,
            serial_number: battery_serial.clone(),
            // The phone does not report who made the cell, and nothing here checks
            // that the battery is genuine, so neither is claimed.
            manufacturer: None,
            status: ComponentStatus::Unknown,
            current_charge_percentage,
            is_charging,
            estimated,
        };

        // Security & Carrier Locks
        let activation_state = general
            .get("ActivationState")
            .map(|s| s.as_str())
            .unwrap_or("Activated");

        let (carrier_name, carrier_locked) = extract_carrier_info(raw_general);
        let fmi_account_masked = extract_masked_apple_id(raw_general);
        let fmi_on = raw_general.contains("fm-activation-locked: WUVT")
            || raw_general.contains("fm-spstatus: WUVT");

        // FMI is only fatal lock if device is unactivated
        let icloud_fmi_locked = fmi_on && activation_state == "Unactivated";

        let security_locks = SecurityLockStatus {
            icloud_fmi_locked,
            fmi_account_masked,
            fmi_on,
            mdm_enrolled: general
                .get("MobileDeviceManagementEnrolled")
                .map(|s| s == "true")
                .unwrap_or(false),
            carrier_locked,
            carrier_name,
            knox_tripped: false, // iOS devices do not have Knox
            frp_locked: false,   // iOS devices do not use FRP
            bootloader_unlocked: false,
            is_rooted_or_jailbroken: false,
        };

        // Parts Audit
        let mut combined_props = general.clone();
        for (k, v) in battery_domain {
            combined_props.insert(k.clone(), v.clone());
        }
        if let Some(serial) = &battery_serial {
            combined_props.insert("BatterySerialNumber".into(), serial.clone());
        }
        let parts_audit = audit_ios_parts(&combined_props);

        // Standard 28-point tests
        let mut hardware_tests: HashMap<String, HardwareTestResult> = HashMap::new();
        for test in get_standard_28_tests() {
            hardware_tests.insert(test.key.clone(), test);
        }

        // Grading calculation
        let grading =
            calculate_device_grading(&battery, &parts_audit, &security_locks, &hardware_tests);

        Ok(FullDeviceDiagnosticReport {
            device_id: udid.to_string(),
            device_name,
            brand: "Apple".into(),
            model: marketing_name,
            platform: "iOS".into(),
            os_version,
            imei1,
            imei2,
            serial_number,
            baseband_version: baseband,
            cpu_architecture: cpu_arch,
            ram_gb,
            storage_total_bytes,
            storage_free_bytes,
            battery,
            parts_audit,
            security_locks,
            hardware_tests,
            grading,
            limited_reason: None,
        })
    }
}

/// What the battery's own registers report. Every field is optional: whatever
/// could not be read stays `None` rather than being guessed.
#[derive(Debug, Default, PartialEq)]
pub(crate) struct BatteryRegisters {
    pub cycle_count: Option<u32>,
    /// Factory design capacity, mAh.
    pub design_mah: Option<u32>,
    /// Current maximum capacity, mAh (what iOS shows as "Maximum Capacity").
    pub nominal_mah: Option<u32>,
    pub serial: Option<String>,
}

/// Finds the value following `<key>NAME</key>` in the phone's XML plist output.
fn plist_value<'a>(xml: &'a str, key: &str) -> Option<&'a str> {
    let marker = format!("<key>{}</key>", key);
    let rest = &xml[xml.find(&marker)? + marker.len()..];
    let start = rest.find('<')?;
    let tag_end = rest[start..].find('>')? + start;
    let tag = &rest[start + 1..tag_end];
    let close = format!("</{}>", tag);
    let body_end = rest[tag_end + 1..].find(&close)? + tag_end + 1;
    Some(rest[tag_end + 1..body_end].trim())
}

pub(crate) fn parse_battery_registers(xml: &str) -> BatteryRegisters {
    let int = |k: &str| plist_value(xml, k).and_then(|v| v.parse::<u32>().ok());
    BatteryRegisters {
        cycle_count: int("CycleCount"),
        design_mah: int("DesignCapacity"),
        nominal_mah: int("NominalChargeCapacity"),
        serial: plist_value(xml, "Serial")
            .filter(|v| !v.is_empty())
            .map(|v| v.to_string()),
    }
}

fn extract_carrier_info(raw_text: &str) -> (Option<String>, bool) {
    let sim_ready = raw_text.contains("SIMStatus: kCTSIMSupportSIMStatusReady");
    let is_network_locked = raw_text.contains("NetworkLocked")
        || raw_text.contains("kCTSIMSupportSIMStatusNetworkLocked")
        || raw_text.contains("kCTSIMSupportSIMStatusSIMLocked");

    let carrier_locked = is_network_locked;

    let mut carrier_name = None;

    if raw_text.contains("com.apple.Qtel_dz")
        || (raw_text.contains("MCC: 603") && raw_text.contains("MNC: 03"))
    {
        carrier_name = Some("Ooredoo Algeria".to_string());
    } else if raw_text.contains("com.apple.Mobilis_dz")
        || (raw_text.contains("MCC: 603") && raw_text.contains("MNC: 01"))
    {
        carrier_name = Some("Mobilis".to_string());
    } else if raw_text.contains("com.apple.Djezzy_dz")
        || (raw_text.contains("MCC: 603") && raw_text.contains("MNC: 02"))
    {
        carrier_name = Some("Djezzy".to_string());
    } else if let Some(pos) = raw_text.find("CFBundleIdentifier: com.apple.") {
        let rest = &raw_text[pos + 30..];
        let end = rest.find('\n').unwrap_or(rest.len());
        let id = rest[..end].trim();
        carrier_name = Some(id.replace('_', " "));
    }

    if carrier_name.is_none() && sim_ready {
        carrier_name = Some("Active SIM (Factory Unlocked)".to_string());
    }

    (carrier_name, carrier_locked)
}

fn extract_masked_apple_id(raw_text: &str) -> Option<String> {
    if let Some(pos) = raw_text.find("fm-account-masked:") {
        let rest = &raw_text[pos + 18..];
        let end = rest.find('\n').unwrap_or(rest.len());
        let encoded = rest[..end].trim();
        if !encoded.is_empty() {
            if let Ok(decoded_bytes) =
                base64::engine::general_purpose::STANDARD.decode(encoded)
            {
                if let Ok(decoded_str) = String::from_utf8(decoded_bytes) {
                    let cleaned = decoded_str.trim().to_string();
                    if !cleaned.is_empty() {
                        return Some(cleaned);
                    }
                }
            }
        }
    }
    None
}

pub fn map_ios_model(product_type: &str) -> String {
    match product_type {
        "iPhone17,1" => "iPhone 16 Pro",
        "iPhone17,2" => "iPhone 16 Pro Max",
        "iPhone17,3" => "iPhone 16",
        "iPhone17,4" => "iPhone 16 Plus",
        "iPhone17,5" => "iPhone 16e",
        "iPhone16,1" => "iPhone 15 Pro",
        "iPhone16,2" => "iPhone 15 Pro Max",
        "iPhone15,4" => "iPhone 15",
        "iPhone15,5" => "iPhone 15 Plus",
        "iPhone15,2" => "iPhone 14 Pro",
        "iPhone15,3" => "iPhone 14 Pro Max",
        "iPhone14,7" => "iPhone 14",
        "iPhone14,8" => "iPhone 14 Plus",
        "iPhone14,2" => "iPhone 13 Pro",
        "iPhone14,3" => "iPhone 13 Pro Max",
        "iPhone14,5" => "iPhone 13",
        "iPhone14,4" => "iPhone 13 mini",
        "iPhone13,2" => "iPhone 12",
        "iPhone13,3" => "iPhone 12 Pro",
        "iPhone13,4" => "iPhone 12 Pro Max",
        "iPhone13,1" => "iPhone 12 mini",
        "iPhone12,1" => "iPhone 11",
        "iPhone12,3" => "iPhone 11 Pro",
        "iPhone12,5" => "iPhone 11 Pro Max",
        "iPhone11,8" => "iPhone XR",
        "iPhone11,2" => "iPhone XS",
        "iPhone11,4" | "iPhone11,6" => "iPhone XS Max",
        "iPhone10,3" | "iPhone10,6" => "iPhone X",
        "iPhone14,6" => "iPhone SE (3rd Gen)",
        "iPhone12,8" => "iPhone SE (2nd Gen)",
        "iPad13,18" | "iPad13,19" => "iPad (10th Gen)",
        "iPad14,3" | "iPad14,4" => "iPad Pro 11-inch (4th Gen)",
        "iPad14,5" | "iPad14,6" => "iPad Pro 12.9-inch (6th Gen)",
        other => other,
    }
    .to_string()
}

pub fn map_ios_cpu_architecture(product_type: &str, raw_arch: &str) -> String {
    match product_type {
        "iPhone17,1" | "iPhone17,2" => "Apple A18 Pro (6-core 64-bit ARM, 3nm)".to_string(),
        "iPhone17,3" | "iPhone17,4" | "iPhone17,5" => {
            "Apple A18 (6-core 64-bit ARM, 3nm)".to_string()
        }
        "iPhone16,1" | "iPhone16,2" => "Apple A17 Pro (6-core 64-bit ARM, 3nm)".to_string(),
        "iPhone15,2" | "iPhone15,3" | "iPhone15,4" | "iPhone15,5" => {
            "Apple A16 Bionic (6-core 64-bit ARM)".to_string()
        }
        "iPhone14,2" | "iPhone14,3" | "iPhone14,4" | "iPhone14,5" | "iPhone14,7"
        | "iPhone14,8" | "iPhone14,6" => "Apple A15 Bionic (6-core 64-bit ARM)".to_string(),
        "iPhone13,1" | "iPhone13,2" | "iPhone13,3" | "iPhone13,4" => {
            "Apple A14 Bionic (6-core 64-bit ARM)".to_string()
        }
        "iPhone12,1" | "iPhone12,3" | "iPhone12,5" | "iPhone12,8" => {
            "Apple A13 Bionic (6-core 64-bit ARM)".to_string()
        }
        _ if raw_arch.is_empty() => "Apple Silicon (64-bit ARM)".to_string(),
        _ => raw_arch.to_string(),
    }
}

pub fn get_ios_design_capacity(product_type: &str) -> u32 {
    match product_type {
        "iPhone17,2" => 4685, // iPhone 16 Pro Max
        "iPhone17,1" => 3582, // iPhone 16 Pro
        "iPhone17,4" => 4674, // iPhone 16 Plus
        "iPhone17,3" => 3561, // iPhone 16
        "iPhone17,5" => 3961, // iPhone 16e
        "iPhone16,2" => 4422, // iPhone 15 Pro Max
        "iPhone16,1" => 3274, // iPhone 15 Pro
        "iPhone15,5" => 4383, // iPhone 15 Plus
        "iPhone15,4" => 3349, // iPhone 15
        "iPhone15,3" => 4323, // iPhone 14 Pro Max
        "iPhone15,2" => 3200, // iPhone 14 Pro
        "iPhone14,8" => 4325, // iPhone 14 Plus
        "iPhone14,7" => 3279, // iPhone 14
        "iPhone14,3" => 4352, // iPhone 13 Pro Max
        "iPhone14,2" => 3095, // iPhone 13 Pro
        "iPhone14,5" => 3227, // iPhone 13
        "iPhone14,4" => 2406, // iPhone 13 mini
        "iPhone13,4" => 3687, // iPhone 12 Pro Max
        "iPhone13,3" | "iPhone13,2" => 2815, // iPhone 12 / 12 Pro
        "iPhone13,1" => 2227, // iPhone 12 mini
        "iPhone12,5" => 3969, // iPhone 11 Pro Max
        "iPhone12,3" => 3046, // iPhone 11 Pro
        "iPhone12,1" => 3110, // iPhone 11
        "iPhone11,2" => 2658, // iPhone XS
        "iPhone11,4" | "iPhone11,6" => 3174, // iPhone XS Max
        "iPhone11,8" => 2942, // iPhone XR
        "iPhone10,3" | "iPhone10,6" => 2716, // iPhone X
        "iPhone14,6" => 2018, // iPhone SE 3
        "iPhone12,8" => 1821, // iPhone SE 2
        _ => 3349,
    }
}

fn estimate_ios_ram(product_type: &str) -> f32 {
    if product_type.starts_with("iPhone17") || product_type.starts_with("iPhone16") {
        8.0
    } else if product_type.starts_with("iPhone15")
        || product_type.starts_with("iPhone14,2")
        || product_type.starts_with("iPhone14,3")
    {
        6.0
    } else if product_type.starts_with("iPhone14")
        || product_type.starts_with("iPhone13,2")
        || product_type.starts_with("iPhone13,3")
    {
        6.0
    } else {
        4.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_probe_real_iphone() {
        let probe = IosProbe::new();
        let res = probe.probe_device("00008140-0011311C26E2801C").await;
        match res {
            Ok(report) => {
                println!("=== PROBED REAL IPHONE SUCCESS ===");
                println!("Name: {}", report.device_name);
                println!("Model: {}", report.model);
                println!("IMEI1: {:?}", report.imei1);
                println!("Serial: {:?}", report.serial_number);
                println!(
                    "Battery: {}% ({} cycles, {}/{} mAh)",
                    report.battery.health_percentage,
                    report.battery.cycle_count,
                    report.battery.actual_capacity_mah,
                    report.battery.design_capacity_mah
                );
                println!("Carrier: {:?}", report.security_locks.carrier_name);
                println!("Carrier Locked: {}", report.security_locks.carrier_locked);
                println!("FMI Account: {:?}", report.security_locks.fmi_account_masked);
                println!("FMI Locked: {}", report.security_locks.icloud_fmi_locked);
                println!("Grade: {} (Score: {})", report.grading.grade, report.grading.score);
                assert_eq!(report.model, "iPhone 16 Pro Max");
                assert!(report.battery.cycle_count >= 470 && report.battery.cycle_count <= 490);
                assert!(report.battery.health_percentage >= 85 && report.battery.health_percentage <= 95);
                // Read from the battery's own registers, not estimated or looked up.
                assert!(!report.battery.estimated);
                assert_eq!(report.battery.design_capacity_mah, 4630);
                assert!(report.battery.actual_capacity_mah > 3900 && report.battery.actual_capacity_mah <= 4630);
                assert_eq!(
                    report.battery.health_percentage as f32,
                    (report.battery.actual_capacity_mah as f32 / 4630.0 * 100.0).round()
                );
                assert!(report.battery.temperature_celsius.is_none(), "iOS exposes no temperature");
                assert!(report.battery.manufacturer.is_none());
                let serial = report.battery.serial_number.clone().unwrap_or_default();
                assert!(!serial.contains("Verified"), "invented serial: {serial}");
                assert!(report.battery.current_charge_percentage.is_some());
                assert!(!report.security_locks.carrier_locked);
                assert_eq!(
                    report.security_locks.carrier_name.as_deref(),
                    Some("Ooredoo Algeria")
                );
                assert!(report.security_locks.fmi_account_masked.as_deref().unwrap_or("").starts_with("a"));
                assert!(report.security_locks.fmi_account_masked.as_deref().unwrap_or("").ends_with("@gmail.com"));
                assert!(!report.security_locks.icloud_fmi_locked);
                // Parts originality is not verified in this build and the phone's interactive tests
                // are not run here, so A+ must not be reachable from a probe alone.
                assert_ne!(report.grading.grade.to_string(), "A+");
            }
            Err(e) if e.contains("not found") || e.contains("No device found") || e.contains("Could not connect to lockdownd") => {
                println!("=== Physical iPhone not connected/screen locked: {} ===", e);
            }
            Err(e) => {
                println!("=== PROBE FAILED: {} ===", e);
                panic!("Probe failed: {}", e);
            }
        }
    }

    // The shape of the real `idevicediagnostics ioregentry AppleSmartBattery` output.
    const REGISTRY: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>IORegistry</key><dict>
 <key>BatteryData</key><dict>
  <key>AppleRawMaxCapacity</key><integer>4283</integer>
  <key>DesignCapacity</key><integer>4630</integer>
  <key>NominalChargeCapacity</key><integer>4180</integer>
 </dict>
 <key>FedDesignCapacity</key><integer>700</integer>
 <key>CycleCount</key><integer>475</integer>
 <key>Serial</key><string>F5DHC100TDG0000UMH</string>
</dict></dict></plist>"#;

    #[test]
    fn reads_battery_registers() {
        let r = parse_battery_registers(REGISTRY);
        assert_eq!(r.cycle_count, Some(475));
        assert_eq!(r.design_mah, Some(4630));
        assert_eq!(r.nominal_mah, Some(4180));
        assert_eq!(r.serial.as_deref(), Some("F5DHC100TDG0000UMH"));
    }

    #[test]
    fn missing_registers_stay_unknown() {
        assert_eq!(parse_battery_registers("<plist></plist>"), BatteryRegisters::default());
    }

    fn general() -> HashMap<String, String> {
        let mut m = HashMap::new();
        m.insert("ProductType".into(), "iPhone17,2".into());
        m.insert("DeviceName".into(), "Test".into());
        m
    }

    #[test]
    fn health_is_measured_like_ios_maximum_capacity() {
        let probe = IosProbe::new();
        let report = probe
            .build_report("U", &general(), &HashMap::new(), &HashMap::new(), "", parse_battery_registers(REGISTRY))
            .unwrap();
        let b = &report.battery;
        assert!(!b.estimated);
        assert_eq!((b.design_capacity_mah, b.actual_capacity_mah), (4630, 4180));
        assert_eq!(b.health_percentage, 90); // 4180 / 4630
        assert_eq!(b.cycle_count, 475);
        assert_eq!(b.serial_number.as_deref(), Some("F5DHC100TDG0000UMH"));
        assert!(b.temperature_celsius.is_none() && b.manufacturer.is_none());
        // The real serial is kept in the parts audit, but not called genuine.
        assert_eq!(report.parts_audit.battery.read_serial.as_deref(), Some("F5DHC100TDG0000UMH"));
        assert!(!report.parts_audit.battery.is_original);
    }

    #[test]
    fn unreadable_battery_is_labelled_an_estimate_not_a_reading() {
        let probe = IosProbe::new();
        let report = probe
            .build_report("U", &general(), &HashMap::new(), &HashMap::new(), "", BatteryRegisters::default())
            .unwrap();
        assert!(report.battery.estimated);
        assert!(report.battery.serial_number.is_none(), "no invented serial");
        assert!(report.battery.manufacturer.is_none());
        // Storage that couldn't be read is 0 (unknown), not an invented size.
        assert_eq!((report.storage_total_bytes, report.storage_free_bytes), (0, 0));
    }

    #[test]
    fn unknown_model_is_an_error_not_a_guess() {
        let probe = IosProbe::new();
        let err = probe
            .build_report("U", &HashMap::new(), &HashMap::new(), &HashMap::new(), "", BatteryRegisters::default())
            .unwrap_err();
        assert!(err.contains("model"), "{err}");
    }
}

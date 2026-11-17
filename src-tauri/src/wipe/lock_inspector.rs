use super::types::{ActiveAccountInfo, PreWipeAuditResult, WipeMethodInfo, WipeRiskLevel};
use std::collections::HashMap;

pub struct LockInspector;

impl LockInspector {
    pub fn new() -> Self {
        Self
    }

    /// Performs pre-wipe security audit on the target device
    pub async fn inspect_device(
        &self,
        device_id: &str,
        platform_hint: Option<&str>,
    ) -> Result<PreWipeAuditResult, String> {
        // 1. Virtual / Demo devices for simulation and testing
        if device_id.starts_with("demo-") || device_id.starts_with("virt-") || device_id.starts_with("mock-") {
            return Ok(Self::inspect_virtual_device(device_id));
        }

        // 2. Physical iOS device
        let is_ios = match platform_hint {
            Some(p) if p.eq_ignore_ascii_case("ios") => true,
            Some(p) if p.eq_ignore_ascii_case("android") => false,
            _ => device_id.len() >= 24 && !device_id.contains(':') && !device_id.contains('.'),
        };

        if is_ios {
            self.inspect_ios(device_id).await
        } else {
            self.inspect_android(device_id).await
        }
    }

    /// Assist technician by opening account management screen on the connected phone
    pub async fn launch_account_removal_screen(
        &self,
        device_id: &str,
        platform: &str,
    ) -> Result<String, String> {
        if device_id.starts_with("demo-") || device_id.starts_with("virt-") {
            return Ok("Demo mode: Account settings opened on simulated device screen.".into());
        }

        if platform.eq_ignore_ascii_case("android") {
            // Send Android Intent to open Accounts sync settings directly on the phone display
            let output = crate::transfer::adb::adb_command()
                .args(["-s", device_id, "shell", "am", "start", "-a", "android.settings.SYNC_SETTINGS"])
                .output()
                .await;

            match output {
                Ok(out) if out.status.success() => {
                    Ok("Successfully launched Account Settings on Android phone screen. Tap each account to remove it.".into())
                }
                _ => {
                    // Fallback to main Settings screen
                    let fallback = crate::transfer::adb::adb_command()
                        .args(["-s", device_id, "shell", "am", "start", "-a", "android.settings.SETTINGS"])
                        .output()
                        .await;
                    if fallback.map(|o| o.status.success()).unwrap_or(false) {
                        Ok("Opened Settings on Android phone. Navigate to Passwords & Accounts to remove accounts.".into())
                    } else {
                        Err("Failed to launch intent via ADB. Please open Settings > Accounts manually on the phone.".into())
                    }
                }
            }
        } else {
            // iOS: Explain iCloud deregistration
            Ok("On iPhone: Open Settings > Tap [Customer's Name at the Top] > Scroll down and tap 'Sign Out' > Enter Apple ID password to disable Find My iPhone.".into())
        }
    }

    /// Inspect iOS device via ideviceinfo and lockdownd
    async fn inspect_ios(&self, udid: &str) -> Result<PreWipeAuditResult, String> {
        let output = crate::tools::command("ideviceinfo")
            .args(["-u", udid])
            .output()
            .await
            .map_err(|e| format!("Failed to run ideviceinfo: {}", e))?;

        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(format!("ideviceinfo returned error: {}", err));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut map: HashMap<String, String> = HashMap::new();
        for line in stdout.lines() {
            if let Some((k, v)) = line.split_once(':') {
                map.insert(k.trim().to_string(), v.trim().to_string());
            }
        }

        let device_name = map.get("DeviceName").cloned().unwrap_or_else(|| "iPhone".into());
        let product_type = map.get("ProductType").cloned().unwrap_or_else(|| "iPhone".into());
        let model = map_product_type_to_marketing_name(&product_type);
        let os_version = map.get("ProductVersion").cloned().unwrap_or_else(|| "iOS".into());
        let imei = map.get("InternationalMobileEquipmentIdentity").cloned();
        let imei2 = map.get("InternationalMobileEquipmentIdentity2").cloned();
        let serial_number = map.get("SerialNumber").cloned();
        let storage_capacity = map.get("TotalDiskCapacity").map(|bytes| {
            let b: u64 = bytes.parse().unwrap_or(0);
            format!("{} GB", (b + 500_000_000) / 1_000_000_000)
        });

        // Battery percentage
        let battery_level = {
            let batt_out = crate::tools::command("ideviceinfo")
                .args(["-u", udid, "-q", "com.apple.mobile.battery"])
                .output()
                .await
                .ok();
            batt_out.and_then(|o| {
                let s = String::from_utf8_lossy(&o.stdout);
                for line in s.lines() {
                    if line.starts_with("CurrentCapacity:") {
                        return line.split(':').nth(1)?.trim().parse::<u8>().ok();
                    }
                }
                None
            })
        };

        // Check Find My iPhone / iCloud lock
        // Query com.apple.mobile.fmip or ActivationState / lockdown
        let mut fmi_on = false;
        let mut fmi_masked: Option<String> = None;
        let mut mdm_enrolled = false;

        // Check lockdownd keys
        let fmi_out = crate::tools::command("ideviceinfo")
            .args(["-u", udid, "-q", "com.apple.mobile.fmip"])
            .output()
            .await
            .ok();

        if let Some(o) = fmi_out {
            let s = String::from_utf8_lossy(&o.stdout);
            for line in s.lines() {
                if line.starts_with("FindMyiPhoneStatus:") || line.starts_with("FindMyDeviceStatus:") {
                    let val = line.split(':').nth(1).unwrap_or("").trim();
                    if val.eq_ignore_ascii_case("true") || val == "1" {
                        fmi_on = true;
                    }
                }
            }
        }

        // Check ActivationState
        let _activation_state = map.get("ActivationState").map(|s| s.as_str()).unwrap_or("Activated");
        let mut active_accounts = Vec::new();
        let mut blocking_reasons = Vec::new();
        let mut warning_reasons = Vec::new();

        if fmi_on {
            fmi_masked = Some("Linked to Customer Apple ID".into());
            active_accounts.push(ActiveAccountInfo {
                account_type: "icloud".into(),
                account_name: "iCloud / Apple Account".into(),
                identifier: "Find My iPhone Active".into(),
                action_required: "Customer must enter Apple ID password and turn off Find My in Settings > Apple Account".into(),
            });
            blocking_reasons.push("CRITICAL: iCloud Find My iPhone (FMI) is ACTIVE. Wiping this device now will permanently Activation-Lock / brick it. The customer must sign out of iCloud first.".into());
        }

        // Check MDM management
        let mdm_out = crate::tools::command("ideviceinfo")
            .args(["-u", udid, "-q", "com.apple.mobile.restriction"])
            .output()
            .await
            .ok();
        if let Some(o) = mdm_out {
            let s = String::from_utf8_lossy(&o.stdout);
            if s.contains("EnrolledViaDEP: true") || s.contains("IsSupervised: true") {
                mdm_enrolled = true;
                warning_reasons.push("Device is supervised or enrolled in Enterprise MDM (Mobile Device Management). Device may auto-re-enroll upon setup.".into());
            }
        }

        let is_safe = !fmi_on;
        let risk_level = if fmi_on {
            WipeRiskLevel::CriticalBlocked
        } else if mdm_enrolled {
            WipeRiskLevel::Warning
        } else {
            WipeRiskLevel::Safe
        };

        let supported_wipe_methods = vec![
            WipeMethodInfo {
                id: "ios_obliterate".into(),
                name: "Instant Crypto-Erase via Obliterate".into(),
                description: "Destroys effaceable hardware encryption keys in the Secure Enclave, resetting NVRAM and factory resetting in under 15 seconds. (NIST SP 800-88 Purge)".into(),
                nist_compliant: true,
                estimated_seconds: 18,
                requires_reboot: true,
            },
            WipeMethodInfo {
                id: "ios_recovery".into(),
                name: "Clean Recovery Mode Reset".into(),
                description: "Reboots into Apple Recovery Mode for full clean partition re-initialization.".into(),
                nist_compliant: true,
                estimated_seconds: 45,
                requires_reboot: true,
            },
        ];

        Ok(PreWipeAuditResult {
            device_id: udid.to_string(),
            device_name,
            brand: "Apple".into(),
            model,
            platform: "iOS".into(),
            os_version: format!("iOS {}", os_version),
            imei,
            imei2,
            serial_number,
            storage_capacity,
            battery_level,
            is_safe_to_wipe: is_safe,
            risk_level,
            blocking_reasons,
            warning_reasons,
            active_accounts,
            fmi_status: fmi_on,
            fmi_account_masked: fmi_masked,
            frp_status: false,
            mdm_enrolled,
            supported_wipe_methods,
        })
    }

    /// Inspect Android / HarmonyOS device via ADB
    async fn inspect_android(&self, serial: &str) -> Result<PreWipeAuditResult, String> {
        let brand_out = crate::transfer::adb::adb_command()
            .args(["-s", serial, "shell", "getprop", "ro.product.brand"])
            .output()
            .await;
        let model_out = crate::transfer::adb::adb_command()
            .args(["-s", serial, "shell", "getprop", "ro.product.model"])
            .output()
            .await;
        let os_out = crate::transfer::adb::adb_command()
            .args(["-s", serial, "shell", "getprop", "ro.build.version.release"])
            .output()
            .await;

        let brand = brand_out
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Android".into());

        let model = model_out
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Device".into());

        let os_version = os_out
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "14".into());

        // Battery
        let battery_level = {
            let batt_out = crate::transfer::adb::adb_command()
                .args(["-s", serial, "shell", "dumpsys", "battery"])
                .output()
                .await
                .ok();
            batt_out.and_then(|o| {
                let s = String::from_utf8_lossy(&o.stdout);
                for line in s.lines() {
                    if line.trim().starts_with("level:") {
                        return line.split(':').nth(1)?.trim().parse::<u8>().ok();
                    }
                }
                None
            })
        };

        // Inspect accounts via `dumpsys account`
        let accounts_out = crate::transfer::adb::adb_command()
            .args(["-s", serial, "shell", "dumpsys", "account"])
            .output()
            .await
            .ok();

        let mut active_accounts = Vec::new();
        let mut has_google_account = false;
        let mut has_samsung_account = false;
        let mut has_xiaomi_account = false;
        let mut has_huawei_account = false;

        if let Some(o) = accounts_out {
            let s = String::from_utf8_lossy(&o.stdout);
            for line in s.lines() {
                let trimmed = line.trim();
                if trimmed.contains("Account {name=") {
                    // Example: Account {name=user@gmail.com, type=com.google}
                    let name = extract_between(trimmed, "Account {name=", ",");
                    let acc_type = extract_between(trimmed, "type=", "}").unwrap_or_default();

                    if acc_type.contains("com.google") {
                        has_google_account = true;
                        active_accounts.push(ActiveAccountInfo {
                            account_type: "google".into(),
                            account_name: "Google Account (FRP Protected)".into(),
                            identifier: name.unwrap_or_else(|| "Google User".into()),
                            action_required: "Remove Google account in phone Settings > Accounts before wiping to prevent FRP Lock".into(),
                        });
                    } else if acc_type.contains("com.osp.app.signin") || acc_type.contains("samsung") {
                        has_samsung_account = true;
                        active_accounts.push(ActiveAccountInfo {
                            account_type: "samsung".into(),
                            account_name: "Samsung Account".into(),
                            identifier: name.unwrap_or_else(|| "Samsung User".into()),
                            action_required: "Remove Samsung account in Settings > Accounts to prevent Samsung Reactivation Lock".into(),
                        });
                    } else if acc_type.contains("xiaomi") {
                        has_xiaomi_account = true;
                        active_accounts.push(ActiveAccountInfo {
                            account_type: "xiaomi".into(),
                            account_name: "Xiaomi Mi Account".into(),
                            identifier: name.unwrap_or_else(|| "Mi Account".into()),
                            action_required: "Remove Mi Account to avoid Mi Cloud Lock".into(),
                        });
                    } else if acc_type.contains("huawei") {
                        has_huawei_account = true;
                        active_accounts.push(ActiveAccountInfo {
                            account_type: "huawei".into(),
                            account_name: "Huawei ID".into(),
                            identifier: name.unwrap_or_else(|| "Huawei User".into()),
                            action_required: "Log out of Huawei ID before wiping".into(),
                        });
                    }
                }
            }
        }

        // FRP Status
        let frp_status = has_google_account || has_samsung_account;
        let blocking_reasons = Vec::new();
        let mut warning_reasons = Vec::new();

        if has_google_account {
            warning_reasons.push("WARNING: Google Account active. Factory Reset Protection (FRP) will require the owner's Google login upon setup unless removed first.".into());
        }
        if has_samsung_account {
            warning_reasons.push("WARNING: Samsung Account active. Samsung Reactivation Lock will trigger unless removed.".into());
        }
        if has_xiaomi_account || has_huawei_account {
            warning_reasons.push("Active OEM cloud account detected. Please remove before wiping.".into());
        }

        let is_safe = active_accounts.is_empty();
        let risk_level = if has_google_account || has_samsung_account {
            WipeRiskLevel::Warning
        } else {
            WipeRiskLevel::Safe
        };

        let supported_wipe_methods = vec![
            WipeMethodInfo {
                id: "adb_master_clear".into(),
                name: "ADB Master Clear (FBE Key Shred)".into(),
                description: "Broadcasts recovery master clear intent to drop Linux kernel File-Based Encryption keys and format /data and /cache partitions. (NIST SP 800-88 Purge)".into(),
                nist_compliant: true,
                estimated_seconds: 30,
                requires_reboot: true,
            },
            WipeMethodInfo {
                id: "fastboot_erase".into(),
                name: "Fastboot Low-Level Erase".into(),
                description: "Reboots into bootloader mode and executes fastboot -w low-level cryptographic metadata and userdata wipe.".into(),
                nist_compliant: true,
                estimated_seconds: 40,
                requires_reboot: true,
            },
        ];

        Ok(PreWipeAuditResult {
            device_id: serial.to_string(),
            device_name: format!("{} {}", brand, model),
            brand,
            model,
            platform: "Android".into(),
            os_version: format!("Android {}", os_version),
            imei: None,
            imei2: None,
            serial_number: Some(serial.to_string()),
            storage_capacity: Some("128 GB".into()),
            battery_level,
            is_safe_to_wipe: is_safe,
            risk_level,
            blocking_reasons,
            warning_reasons,
            active_accounts,
            fmi_status: false,
            fmi_account_masked: None,
            frp_status,
            mdm_enrolled: false,
            supported_wipe_methods,
        })
    }

    /// Generates realistic virtual pre-wipe audit results for testing and demo modes
    fn inspect_virtual_device(device_id: &str) -> PreWipeAuditResult {
        match device_id {
            "demo-iphone15-locked" => PreWipeAuditResult {
                device_id: device_id.into(),
                device_name: "iPhone 15 Pro Max (Locked)".into(),
                brand: "Apple".into(),
                model: "iPhone 15 Pro Max".into(),
                platform: "iOS".into(),
                os_version: "iOS 17.5.1".into(),
                imei: Some("354892019482019".into()),
                imei2: Some("354892019482027".into()),
                serial_number: Some("F2LW9840Q1".into()),
                storage_capacity: Some("256 GB".into()),
                battery_level: Some(88),
                is_safe_to_wipe: false,
                risk_level: WipeRiskLevel::CriticalBlocked,
                blocking_reasons: vec![
                    "CRITICAL: iCloud Find My iPhone (FMI) is ACTIVE. Wiping this device now will permanently Activation-Lock / brick it. The customer must sign out of iCloud first.".into()
                ],
                warning_reasons: vec![],
                active_accounts: vec![
                    ActiveAccountInfo {
                        account_type: "icloud".into(),
                        account_name: "Apple iCloud".into(),
                        identifier: "a***d@gmail.com".into(),
                        action_required: "Customer must sign out in iOS Settings > [Apple ID] > Sign Out before wipe.".into(),
                    }
                ],
                fmi_status: true,
                fmi_account_masked: Some("a***d@gmail.com".into()),
                frp_status: false,
                mdm_enrolled: false,
                supported_wipe_methods: vec![
                    WipeMethodInfo {
                        id: "simulated_obliterate".into(),
                        name: "Instant Crypto-Erase via Obliterate".into(),
                        description: "Destroys effaceable hardware encryption keys in the Secure Enclave, resetting NVRAM and factory resetting in under 15 seconds. (NIST SP 800-88 Purge)".into(),
                        nist_compliant: true,
                        estimated_seconds: 15,
                        requires_reboot: true,
                    }
                ],
            },
            "demo-s24-frp" => PreWipeAuditResult {
                device_id: device_id.into(),
                device_name: "Samsung Galaxy S24 Ultra (Accounts Active)".into(),
                brand: "Samsung".into(),
                model: "Galaxy S24 Ultra (SM-S928B)".into(),
                platform: "Android".into(),
                os_version: "Android 14 (OneUI 6.1)".into(),
                imei: Some("359281048291048".into()),
                imei2: Some("359281048291055".into()),
                serial_number: Some("R5CX10928AB".into()),
                storage_capacity: Some("512 GB".into()),
                battery_level: Some(65),
                is_safe_to_wipe: false,
                risk_level: WipeRiskLevel::Warning,
                blocking_reasons: vec![],
                warning_reasons: vec![
                    "WARNING: Active Google Account detected. Google Factory Reset Protection (FRP) will require owner password on setup unless removed first.".into(),
                    "WARNING: Active Samsung Account detected. Samsung Reactivation Lock may trigger.".into(),
                ],
                active_accounts: vec![
                    ActiveAccountInfo {
                        account_type: "google".into(),
                        account_name: "Google Account (FRP)".into(),
                        identifier: "customer.tech@gmail.com".into(),
                        action_required: "Remove in phone Settings > Accounts & Backup > Manage Accounts.".into(),
                    },
                    ActiveAccountInfo {
                        account_type: "samsung".into(),
                        account_name: "Samsung Account".into(),
                        identifier: "customer.tech@samsung.com".into(),
                        action_required: "Log out of Samsung account in Settings before wipe.".into(),
                    }
                ],
                fmi_status: false,
                fmi_account_masked: None,
                frp_status: true,
                mdm_enrolled: false,
                supported_wipe_methods: vec![
                    WipeMethodInfo {
                        id: "simulated_master_clear".into(),
                        name: "ADB Master Clear (FBE Key Shred)".into(),
                        description: "Broadcasts recovery master clear intent to drop Linux kernel File-Based Encryption keys and format /data and /cache partitions. (NIST SP 800-88 Purge)".into(),
                        nist_compliant: true,
                        estimated_seconds: 25,
                        requires_reboot: true,
                    }
                ],
            },
            // Default: Clean, ready-to-wipe device
            _ => PreWipeAuditResult {
                device_id: device_id.into(),
                device_name: "Google Pixel 8 Pro (Clean)".into(),
                brand: "Google".into(),
                model: "Pixel 8 Pro (GC3VE)".into(),
                platform: "Android".into(),
                os_version: "Android 15".into(),
                imei: Some("358194028591042".into()),
                imei2: None,
                serial_number: Some("3A081FDH20019".into()),
                storage_capacity: Some("128 GB".into()),
                battery_level: Some(92),
                is_safe_to_wipe: true,
                risk_level: WipeRiskLevel::Safe,
                blocking_reasons: vec![],
                warning_reasons: vec![],
                active_accounts: vec![],
                fmi_status: false,
                fmi_account_masked: None,
                frp_status: false,
                mdm_enrolled: false,
                supported_wipe_methods: vec![
                    WipeMethodInfo {
                        id: "simulated_master_clear".into(),
                        name: "ADB Master Clear (FBE Key Shred)".into(),
                        description: "Drops Linux kernel File-Based Encryption master keys and securely purges data. (NIST SP 800-88 Purge)".into(),
                        nist_compliant: true,
                        estimated_seconds: 15,
                        requires_reboot: true,
                    },
                    WipeMethodInfo {
                        id: "simulated_fastboot".into(),
                        name: "Fastboot Low-Level Erase".into(),
                        description: "Low-level fastboot userdata & metadata partition format.".into(),
                        nist_compliant: true,
                        estimated_seconds: 20,
                        requires_reboot: true,
                    }
                ],
            },
        }
    }
}

fn extract_between(source: &str, start_token: &str, end_token: &str) -> Option<String> {
    let start = source.find(start_token)? + start_token.len();
    let rest = &source[start..];
    let end = rest.find(end_token)?;
    Some(rest[..end].trim().to_string())
}

fn map_product_type_to_marketing_name(product_type: &str) -> String {
    match product_type {
        "iPhone17,2" => "iPhone 16 Pro Max".into(),
        "iPhone17,1" => "iPhone 16 Pro".into(),
        "iPhone17,4" => "iPhone 16 Plus".into(),
        "iPhone17,3" => "iPhone 16".into(),
        "iPhone16,2" => "iPhone 15 Pro Max".into(),
        "iPhone16,1" => "iPhone 15 Pro".into(),
        "iPhone15,5" => "iPhone 15 Plus".into(),
        "iPhone15,4" => "iPhone 15".into(),
        "iPhone15,3" => "iPhone 14 Pro Max".into(),
        "iPhone15,2" => "iPhone 14 Pro".into(),
        "iPhone14,8" => "iPhone 14 Plus".into(),
        "iPhone14,7" => "iPhone 14".into(),
        "iPhone14,3" => "iPhone 13 Pro Max".into(),
        "iPhone14,2" => "iPhone 13 Pro".into(),
        "iPhone14,5" => "iPhone 13".into(),
        "iPhone14,4" => "iPhone 13 mini".into(),
        "iPhone13,4" => "iPhone 12 Pro Max".into(),
        "iPhone13,3" => "iPhone 12 Pro".into(),
        "iPhone13,2" => "iPhone 12".into(),
        "iPhone13,1" => "iPhone 12 mini".into(),
        "iPhone12,5" => "iPhone 11 Pro Max".into(),
        "iPhone12,3" => "iPhone 11 Pro".into(),
        "iPhone12,1" => "iPhone 11".into(),
        _ => product_type.to_string(),
    }
}

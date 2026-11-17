use super::certificate::CertificateManager;
use super::is_simulated_device;
use super::lock_inspector::LockInspector;
use super::oobe_verifier::OobeVerifier;
use super::types::{ExecuteWipeRequest, SanitizationRecord, WipeProgressEvent, WipeRiskLevel};
use sqlx::SqlitePool;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::process::Command;
use tokio::time::{sleep, Duration};
use uuid::Uuid;

/// How many times to re-check a device after the wipe command is sent.
const POST_WIPE_POLL_ATTEMPTS: u32 = 30;
/// Seconds between post-wipe checks (30 x 10s = 5 minutes for the device to reboot and wipe).
const POST_WIPE_POLL_INTERVAL_SECS: u64 = 10;

pub struct WipeEngine {
    inspector: LockInspector,
    verifier: OobeVerifier,
    certificate_mgr: CertificateManager,
}

impl WipeEngine {
    pub fn new(db_pool: SqlitePool) -> Self {
        Self {
            inspector: LockInspector::new(),
            verifier: OobeVerifier::new(),
            certificate_mgr: CertificateManager::new(db_pool),
        }
    }

    /// Wipes a device and issues a sanitization certificate ONLY after the device has been
    /// observed in a verified factory state. A command that was sent is not proof of a wipe.
    pub async fn execute_wipe(
        &self,
        app: Option<&AppHandle>,
        req: ExecuteWipeRequest,
    ) -> Result<SanitizationRecord, String> {
        let start_time = Instant::now();

        // 1. Mandatory Pre-Wipe Safety Audit
        let audit = self
            .inspector
            .inspect_device(&req.device_id, Some(&req.platform))
            .await?;

        // 2. Airbag Check 1: Blocked iCloud or critical accounts
        if audit.risk_level == WipeRiskLevel::CriticalBlocked && !req.technician_override {
            return Err(format!(
                "ABORTED BY SAFETY AIRBAG: Cannot wipe device with active iCloud Find My iPhone. {}",
                audit.blocking_reasons.join(" ")
            ));
        }

        // 3. Airbag Check 2: Customer backup confirmation
        if !req.customer_backup_confirmed {
            return Err("Safety confirmation required: Customer data backup confirmation checkbox is unchecked.".into());
        }

        // 4. Airbag Check 3: Last 4 digits of IMEI / Serial confirmation
        let expected_digits = get_last_4_digits(&audit.imei, &audit.serial_number).ok_or_else(|| {
            "No IMEI or serial number could be read from the device, so the confirmation check cannot be completed. Nothing was wiped."
                .to_string()
        })?;
        if req.imei_confirmation_digits.trim() != expected_digits {
            return Err(format!(
                "Safety 2FA Verification Failed: Entered '{}' does not match target device's last 4 digits ('{}').",
                req.imei_confirmation_digits.trim(),
                expected_digits
            ));
        }

        // 5. Refuse anything that cannot produce a real wipe. No certificate is ever issued for these.
        if is_simulated_device(&req.device_id) {
            return Err(
                "Simulated/virtual devices cannot be sanitized. No hardware was touched. No certificate was issued."
                    .into(),
            );
        }
        if req.platform.eq_ignore_ascii_case("ios") {
            return Err(
                "iPhone erase is not supported by this app: no command available here performs a real erase. \
                 Erase the iPhone on the device or with Apple Configurator, then record it manually. No certificate was issued."
                    .into(),
            );
        }

        let wipe_uuid = format!("WIPE-{}", Uuid::new_v4().to_string()[..8].to_uppercase());
        let cert_number = CertificateManager::generate_certificate_number();

        // --- STAGE 1: Target verified ---
        emit_progress(
            app,
            WipeProgressEvent {
                step: 1,
                total_steps: 4,
                stage_name: "[1/4] Pre-Wipe Audit".into(),
                progress_percent: 15,
                log_line: format!(
                    "Verified target: {} ({}, SN: {}). Safety checks passed.",
                    audit.device_name,
                    audit.imei.as_deref().unwrap_or("N/A"),
                    audit.serial_number.as_deref().unwrap_or("N/A")
                ),
                is_complete: false,
                is_error: false,
                error_message: None,
            },
        );

        // --- STAGE 2: Send the wipe command ---
        emit_progress(
            app,
            WipeProgressEvent {
                step: 2,
                total_steps: 4,
                stage_name: "[2/4] Sending Wipe Command".into(),
                progress_percent: 30,
                log_line: format!("Sending wipe method '{}' to the device...", req.wipe_method),
                is_complete: false,
                is_error: false,
                error_message: None,
            },
        );

        let command_accepted = self
            .execute_android_wipe(&req.device_id, &req.wipe_method)
            .await?;

        if !command_accepted {
            let msg = "Wipe command was rejected or exited with an error on the target device. No certificate was issued.";
            emit_progress(
                app,
                WipeProgressEvent {
                    step: 2,
                    total_steps: 4,
                    stage_name: "[2/4] Wipe Command Failed".into(),
                    progress_percent: 30,
                    log_line: format!("ERROR: {}", msg),
                    is_complete: true,
                    is_error: true,
                    error_message: Some(msg.into()),
                },
            );
            return Err(msg.into());
        }

        // --- STAGE 3: Wait for the device to reboot and finish the wipe ---
        let mut oobe_verified = false;
        for attempt in 1..=POST_WIPE_POLL_ATTEMPTS {
            emit_progress(
                app,
                WipeProgressEvent {
                    step: 3,
                    total_steps: 4,
                    stage_name: "[3/4] Waiting for Wipe to Complete".into(),
                    progress_percent: 50 + attempt * 30 / POST_WIPE_POLL_ATTEMPTS,
                    log_line: format!(
                        "Waiting for the device to reboot and finish wiping (check {}/{})...",
                        attempt, POST_WIPE_POLL_ATTEMPTS
                    ),
                    is_complete: false,
                    is_error: false,
                    error_message: None,
                },
            );
            sleep(Duration::from_secs(POST_WIPE_POLL_INTERVAL_SECS)).await;

            if self.verifier.verify_oobe(&req.device_id, &req.platform).await {
                oobe_verified = true;
                break;
            }
        }

        // --- STAGE 4: Verification ---
        if !oobe_verified {
            let msg = "The device did not reach a verified factory state (setup not completed, no accounts) within the time limit. No certificate was issued. Check the device and repeat the wipe.";
            emit_progress(
                app,
                WipeProgressEvent {
                    step: 4,
                    total_steps: 4,
                    stage_name: "[4/4] Verification Failed".into(),
                    progress_percent: 100,
                    log_line: format!("ERROR: {}", msg),
                    is_complete: true,
                    is_error: true,
                    error_message: Some(msg.into()),
                },
            );
            return Err(msg.into());
        }

        emit_progress(
            app,
            WipeProgressEvent {
                step: 4,
                total_steps: 4,
                stage_name: "[4/4] Sanitization Complete & Verified".into(),
                progress_percent: 100,
                log_line: format!(
                    "Verified factory state (setup not completed, no accounts). Generated Certificate: {}",
                    cert_number
                ),
                is_complete: true,
                is_error: false,
                error_message: None,
            },
        );

        let duration_secs = start_time.elapsed().as_secs() as i64;
        let pre_wipe_lock_audit = serde_json::to_value(&audit).unwrap_or(serde_json::json!({}));

        // 6. Construct and persist Sanitization Record
        let record = SanitizationRecord {
            id: 0,
            wipe_uuid,
            device_id: req.device_id.clone(),
            device_name: audit.device_name,
            brand: audit.brand,
            model: audit.model,
            platform: audit.platform,
            os_version: audit.os_version,
            imei: audit.imei,
            imei2: audit.imei2,
            serial_number: audit.serial_number,
            storage_capacity: audit.storage_capacity,
            wipe_method: req.wipe_method,
            nist_standard: "NIST SP 800-88 Rev. 1 Purge (Cryptographic Erase)".into(),
            pre_wipe_accounts_removed: audit.active_accounts.is_empty(),
            pre_wipe_lock_audit,
            post_wipe_oobe_verified: true,
            status: "completed".into(),
            technician_name: req.technician_name,
            notes: req.notes,
            duration_seconds: duration_secs.max(1),
            certificate_number: cert_number,
            created_at: chrono::Utc::now().to_rfc3339(),
        };

        self.certificate_mgr.save_record(record).await
    }

    /// Sends the Android wipe command.
    /// Ok(true)  -> the device accepted the command (it still has to pass verification).
    /// Ok(false) -> every attempted command exited with an error.
    /// Err       -> a required tool could not be run at all (for example adb is not installed).
    async fn execute_android_wipe(&self, serial: &str, wipe_method: &str) -> Result<bool, String> {
        match wipe_method {
            "fastboot_erase" => {
                // Reboot to bootloader, then erase userdata with fastboot.
                let _ = run_tool("adb", &["-s", serial, "reboot", "bootloader"]).await?;
                sleep(Duration::from_secs(3)).await;
                let erased = run_tool("fastboot", &["-s", serial, "-w"]).await?;
                let _ = run_tool("fastboot", &["-s", serial, "reboot"]).await;
                Ok(erased)
            }
            _ => {
                // Master clear through the framework. Accepting the broadcast is not proof that
                // a reset happened; the caller verifies the device state afterwards.
                let master_clear = run_tool(
                    "adb",
                    &[
                        "-s",
                        serial,
                        "shell",
                        "am",
                        "broadcast",
                        "-a",
                        "android.intent.action.MASTER_CLEAR",
                    ],
                )
                .await?;
                if master_clear {
                    return Ok(true);
                }

                // Fallback: recovery wipe_data (requires root on the device).
                run_tool("adb", &["-s", serial, "shell", "recovery", "--wipe_data"]).await
            }
        }
    }
}

/// Runs an external tool. Returns Ok(exit_succeeded) when it ran, and Err when it could not
/// be started, so a missing tool can never be mistaken for a successful command.
async fn run_tool(program: &str, args: &[&str]) -> Result<bool, String> {
    let mut cmd = if program == "adb" {
        crate::transfer::adb::adb_command()
    } else {
        Command::new(program)
    };
    match cmd.args(args).output().await {
        Ok(out) => Ok(out.status.success()),
        Err(e) => Err(format!(
            "Could not run '{}': {}. Make sure the Android platform tools are installed and available on PATH.",
            program, e
        )),
    }
}

fn emit_progress(app: Option<&AppHandle>, event: WipeProgressEvent) {
    if let Some(a) = app {
        let _ = a.emit("wipe-progress", &event);
    }
}

/// Last 4 digits of the IMEI (or the serial as a fallback). None when neither is usable,
/// so the confirmation can never be satisfied by a fixed default value.
fn get_last_4_digits(imei: &Option<String>, serial: &Option<String>) -> Option<String> {
    if let Some(s) = imei {
        let clean: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
        if clean.len() >= 4 {
            return Some(clean[clean.len() - 4..].to_string());
        }
    }
    if let Some(s) = serial {
        let clean: String = s.trim().to_string();
        if clean.len() >= 4 {
            return Some(clean[clean.len() - 4..].to_string());
        }
    }
    None
}

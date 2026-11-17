use tokio::process::Command;

pub struct OobeVerifier;

impl OobeVerifier {
    pub fn new() -> Self {
        Self
    }

    /// Returns true only when the device is positively observed in a clean, never-set-up
    /// state. Any command that fails to run or exits non-zero counts as NOT verified.
    pub async fn verify_oobe(&self, device_id: &str, platform: &str) -> bool {
        if super::is_simulated_device(device_id) {
            // Simulated devices have no hardware state to observe, so they can never verify.
            return false;
        }

        if platform.eq_ignore_ascii_case("ios") {
            self.verify_ios_oobe(device_id).await
        } else {
            self.verify_android_oobe(device_id).await
        }
    }

    async fn verify_ios_oobe(&self, udid: &str) -> bool {
        let output = Command::new("ideviceinfo")
            .args(["-u", udid, "-k", "ActivationState"])
            .output()
            .await;

        match output {
            // Only "Unactivated" is the clean first-run state. "Activated" means the
            // previous owner's account is still on the phone.
            Ok(out) if out.status.success() => {
                String::from_utf8_lossy(&out.stdout)
                    .trim()
                    .eq_ignore_ascii_case("Unactivated")
            }
            _ => false,
        }
    }

    async fn verify_android_oobe(&self, serial: &str) -> bool {
        // 1. The device must report that first-time setup has NOT been completed.
        //    `settings get` prints "null" when the key is unset, which is the post-wipe state.
        //    (ro.setupwizard.mode is a build property and does not change on wipe.)
        let setup_out = crate::transfer::adb::adb_command()
            .args(["-s", serial, "shell", "settings", "get", "secure", "user_setup_complete"])
            .output()
            .await;

        let setup_incomplete = match setup_out {
            Ok(out) if out.status.success() => {
                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                s == "0" || s.eq_ignore_ascii_case("null")
            }
            _ => false,
        };

        // 2. The account dump must succeed AND contain no accounts. A failed dumpsys is
        //    not evidence that the accounts are gone.
        let accounts_out = crate::transfer::adb::adb_command()
            .args(["-s", serial, "shell", "dumpsys", "account"])
            .output()
            .await;

        let accounts_empty = match accounts_out {
            Ok(out) if out.status.success() => {
                let s = String::from_utf8_lossy(&out.stdout);
                !s.contains("Account {name=")
            }
            _ => false,
        };

        setup_incomplete && accounts_empty
    }
}

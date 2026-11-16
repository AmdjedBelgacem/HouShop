pub mod certificate;
pub mod lock_inspector;
pub mod oobe_verifier;
pub mod types;
pub mod wipe_engine;

pub use certificate::CertificateManager;
pub use lock_inspector::LockInspector;
#[allow(unused_imports)]
pub use types::*;
pub use wipe_engine::WipeEngine;

/// Simulated devices (demo presets and virtual test devices) have no hardware behind them.
/// Nothing may be wiped or certified for them.
pub(crate) fn is_simulated_device(device_id: &str) -> bool {
    device_id.starts_with("demo-") || device_id.starts_with("virt-")
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn test_airbag_blocks_icloud_locked_device() {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();

        // Run migrations
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS sanitization_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                wipe_uuid TEXT NOT NULL UNIQUE,
                device_id TEXT NOT NULL,
                device_name TEXT NOT NULL,
                brand TEXT NOT NULL,
                model TEXT NOT NULL,
                platform TEXT NOT NULL,
                os_version TEXT NOT NULL,
                imei TEXT,
                imei2 TEXT,
                serial_number TEXT,
                storage_capacity TEXT,
                wipe_method TEXT NOT NULL,
                nist_standard TEXT NOT NULL DEFAULT 'NIST SP 800-88 Rev. 1 Purge',
                pre_wipe_accounts_removed BOOLEAN NOT NULL DEFAULT 1,
                pre_wipe_lock_audit JSON NOT NULL DEFAULT '{}',
                post_wipe_oobe_verified BOOLEAN NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'completed',
                technician_name TEXT NOT NULL,
                notes TEXT,
                duration_seconds INTEGER NOT NULL DEFAULT 0,
                certificate_number TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        let engine = WipeEngine::new(pool);

        // Attempting to wipe demo-iphone15-locked with FMI active should fail airbag
        let req = ExecuteWipeRequest {
            device_id: "demo-iphone15-locked".into(),
            platform: "iOS".into(),
            wipe_method: "simulated_obliterate".into(),
            technician_name: "Amdjed".into(),
            technician_override: false,
            imei_confirmation_digits: "2019".into(),
            customer_backup_confirmed: true,
            notes: None,
        };

        let res = engine.execute_wipe(None, req).await;
        assert!(res.is_err(), "Should be blocked by Safety Airbag!");
        let err_msg = res.unwrap_err();
        assert!(
            err_msg.contains("ABORTED BY SAFETY AIRBAG") || err_msg.contains("Find My iPhone"),
            "Error must specify FMI lock protection: {}",
            err_msg
        );
    }

    #[tokio::test]
    async fn test_safety_2fa_imei_digit_validation() {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();

        let engine = WipeEngine::new(pool);

        // Providing wrong digits (e.g. 9999 instead of 1042) must fail
        let req = ExecuteWipeRequest {
            device_id: "demo-pixel8-clean".into(),
            platform: "Android".into(),
            wipe_method: "simulated_master_clear".into(),
            technician_name: "Amdjed".into(),
            technician_override: false,
            imei_confirmation_digits: "9999".into(), // WRONG
            customer_backup_confirmed: true,
            notes: None,
        };

        let res = engine.execute_wipe(None, req).await;
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("Safety 2FA Verification Failed"));
    }

    #[tokio::test]
    async fn test_simulated_device_is_never_certified() {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS sanitization_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                wipe_uuid TEXT NOT NULL UNIQUE,
                device_id TEXT NOT NULL,
                device_name TEXT NOT NULL,
                brand TEXT NOT NULL,
                model TEXT NOT NULL,
                platform TEXT NOT NULL,
                os_version TEXT NOT NULL,
                imei TEXT,
                imei2 TEXT,
                serial_number TEXT,
                storage_capacity TEXT,
                wipe_method TEXT NOT NULL,
                nist_standard TEXT NOT NULL DEFAULT 'NIST SP 800-88 Rev. 1 Purge',
                pre_wipe_accounts_removed BOOLEAN NOT NULL DEFAULT 1,
                pre_wipe_lock_audit JSON NOT NULL DEFAULT '{}',
                post_wipe_oobe_verified BOOLEAN NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'completed',
                technician_name TEXT NOT NULL,
                notes TEXT,
                duration_seconds INTEGER NOT NULL DEFAULT 0,
                certificate_number TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        let engine = WipeEngine::new(pool.clone());

        // Target: Pixel 8 Pro (Clean) with IMEI 358194028591042 -> last 4 digits: 1042.
        // A simulated device has no hardware, so it must never produce a certificate.
        let req = ExecuteWipeRequest {
            device_id: "demo-pixel8-clean".into(),
            platform: "Android".into(),
            wipe_method: "simulated_master_clear".into(),
            technician_name: "Technician Amdjed".into(),
            technician_override: false,
            imei_confirmation_digits: "1042".into(),
            customer_backup_confirmed: true,
            notes: Some("Customer trade-in sanitization".into()),
        };

        let res = engine.execute_wipe(None, req).await;
        assert!(res.is_err(), "Simulated device must not be certified");
        assert!(res.unwrap_err().contains("No certificate was issued"));

        let saved: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM sanitization_records")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(saved.0, 0, "No sanitization record may be stored for a simulated device");
    }

    #[tokio::test]
    async fn test_tspl_label_contains_certificate() {
        let record = SanitizationRecord {
            id: 1,
            wipe_uuid: "WIPE-TEST0001".into(),
            device_id: "usb-serial-1".into(),
            device_name: "Pixel 8".into(),
            brand: "Google".into(),
            model: "Pixel 8".into(),
            platform: "Android".into(),
            os_version: "14".into(),
            imei: None,
            imei2: None,
            serial_number: Some("ABC123".into()),
            storage_capacity: None,
            wipe_method: "master_clear".into(),
            nist_standard: "NIST SP 800-88 Rev. 1 Purge (Cryptographic Erase)".into(),
            pre_wipe_accounts_removed: true,
            pre_wipe_lock_audit: serde_json::json!({}),
            post_wipe_oobe_verified: true,
            status: "completed".into(),
            technician_name: "Technician".into(),
            notes: None,
            duration_seconds: 60,
            certificate_number: "CERT-WIPE-2026-ABCDEF".into(),
            created_at: "2026-01-01T00:00:00Z".into(),
        };

        let pool = SqlitePoolOptions::new()
            .connect_lazy("sqlite::memory:")
            .unwrap();
        let cert_mgr = CertificateManager::new(pool);
        let tspl = cert_mgr.build_tspl_label(&record, WipeLabelOpts::default());
        assert!(tspl.contains("HOUSHOP SANITIZED"));
        assert!(tspl.contains("NIST SP 800-88 PURGED"));
        assert!(tspl.contains(&record.certificate_number));
    }
}

use super::types::{SanitizationRecord, WipeLabelOpts};
use chrono::Utc;
use sqlx::SqlitePool;
use uuid::Uuid;

pub struct CertificateManager {
    db_pool: SqlitePool,
}

impl CertificateManager {
    pub fn new(db_pool: SqlitePool) -> Self {
        Self { db_pool }
    }

    /// Generates a standardized NIST SP 800-88 compliant Certificate Number
    pub fn generate_certificate_number() -> String {
        let year = Utc::now().format("%Y");
        let rand_hex = &Uuid::new_v4().to_string()[..6].to_uppercase();
        format!("CERT-WIPE-{}-{}", year, rand_hex)
    }

    /// Persists a new sanitization record into SQLite
    pub async fn save_record(
        &self,
        record: SanitizationRecord,
    ) -> Result<SanitizationRecord, String> {
        let pre_locks_json = serde_json::to_string(&record.pre_wipe_lock_audit)
            .unwrap_or_else(|_| "{}".into());

        let res = sqlx::query(
            r#"
            INSERT INTO sanitization_records (
                wipe_uuid, device_id, device_name, brand, model,
                platform, os_version, imei, imei2, serial_number,
                storage_capacity, wipe_method, nist_standard,
                pre_wipe_accounts_removed, pre_wipe_lock_audit,
                post_wipe_oobe_verified, status, technician_name,
                notes, duration_seconds, certificate_number, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            "#,
        )
        .bind(&record.wipe_uuid)
        .bind(&record.device_id)
        .bind(&record.device_name)
        .bind(&record.brand)
        .bind(&record.model)
        .bind(&record.platform)
        .bind(&record.os_version)
        .bind(&record.imei)
        .bind(&record.imei2)
        .bind(&record.serial_number)
        .bind(&record.storage_capacity)
        .bind(&record.wipe_method)
        .bind(&record.nist_standard)
        .bind(record.pre_wipe_accounts_removed)
        .bind(&pre_locks_json)
        .bind(record.post_wipe_oobe_verified)
        .bind(&record.status)
        .bind(&record.technician_name)
        .bind(&record.notes)
        .bind(record.duration_seconds)
        .bind(&record.certificate_number)
        .execute(&self.db_pool)
        .await
        .map_err(|e| format!("Failed to save sanitization record to database: {}", e))?;

        let mut saved = record;
        saved.id = res.last_insert_rowid();
        Ok(saved)
    }

    /// Lists recent sanitization records from the database
    pub async fn list_records(&self, limit: i64) -> Result<Vec<SanitizationRecord>, String> {
        let rows = sqlx::query(
            r#"
            SELECT
                id, wipe_uuid, device_id, device_name, brand, model,
                platform, os_version, imei, imei2, serial_number,
                storage_capacity, wipe_method, nist_standard,
                pre_wipe_accounts_removed, pre_wipe_lock_audit,
                post_wipe_oobe_verified, status, technician_name,
                notes, duration_seconds, certificate_number, created_at
            FROM sanitization_records
            ORDER BY id DESC
            LIMIT ?
            "#,
        )
        .bind(limit)
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| format!("Failed to fetch sanitization records: {}", e))?;

        let mut records = Vec::new();
        for r in rows {
            use sqlx::Row;
            let pre_locks_str: String = r.get("pre_wipe_lock_audit");
            let pre_locks_val: serde_json::Value =
                serde_json::from_str(&pre_locks_str).unwrap_or(serde_json::json!({}));

            records.push(SanitizationRecord {
                id: r.get("id"),
                wipe_uuid: r.get("wipe_uuid"),
                device_id: r.get("device_id"),
                device_name: r.get("device_name"),
                brand: r.get("brand"),
                model: r.get("model"),
                platform: r.get("platform"),
                os_version: r.get("os_version"),
                imei: r.get("imei"),
                imei2: r.get("imei2"),
                serial_number: r.get("serial_number"),
                storage_capacity: r.get("storage_capacity"),
                wipe_method: r.get("wipe_method"),
                nist_standard: r.get("nist_standard"),
                pre_wipe_accounts_removed: r.get("pre_wipe_accounts_removed"),
                pre_wipe_lock_audit: pre_locks_val,
                post_wipe_oobe_verified: r.get("post_wipe_oobe_verified"),
                status: r.get("status"),
                technician_name: r.get("technician_name"),
                notes: r.get("notes"),
                duration_seconds: r.get("duration_seconds"),
                certificate_number: r.get("certificate_number"),
                created_at: r.get("created_at"),
            });
        }

        Ok(records)
    }

    /// Retrieves a single sanitization record by its ID
    pub async fn get_record_by_id(&self, id: i64) -> Result<SanitizationRecord, String> {
        let r = sqlx::query(
            r#"
            SELECT
                id, wipe_uuid, device_id, device_name, brand, model,
                platform, os_version, imei, imei2, serial_number,
                storage_capacity, wipe_method, nist_standard,
                pre_wipe_accounts_removed, pre_wipe_lock_audit,
                post_wipe_oobe_verified, status, technician_name,
                notes, duration_seconds, certificate_number, created_at
            FROM sanitization_records
            WHERE id = ?
            "#,
        )
        .bind(id)
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| format!("Sanitization record #{} not found: {}", id, e))?;

        use sqlx::Row;
        let pre_locks_str: String = r.get("pre_wipe_lock_audit");
        let pre_locks_val: serde_json::Value =
            serde_json::from_str(&pre_locks_str).unwrap_or(serde_json::json!({}));

        Ok(SanitizationRecord {
            id: r.get("id"),
            wipe_uuid: r.get("wipe_uuid"),
            device_id: r.get("device_id"),
            device_name: r.get("device_name"),
            brand: r.get("brand"),
            model: r.get("model"),
            platform: r.get("platform"),
            os_version: r.get("os_version"),
            imei: r.get("imei"),
            imei2: r.get("imei2"),
            serial_number: r.get("serial_number"),
            storage_capacity: r.get("storage_capacity"),
            wipe_method: r.get("wipe_method"),
            nist_standard: r.get("nist_standard"),
            pre_wipe_accounts_removed: r.get("pre_wipe_accounts_removed"),
            pre_wipe_lock_audit: pre_locks_val,
            post_wipe_oobe_verified: r.get("post_wipe_oobe_verified"),
            status: r.get("status"),
            technician_name: r.get("technician_name"),
            notes: r.get("notes"),
            duration_seconds: r.get("duration_seconds"),
            certificate_number: r.get("certificate_number"),
            created_at: r.get("created_at"),
        })
    }

    /// Formats a TSPL command stream for thermal sticker printing (40x30mm or 50x30mm label)
    pub fn build_tspl_label(&self, record: &SanitizationRecord, opts: WipeLabelOpts) -> String {
        let mut tspl = String::new();
        tspl.push_str(&format!(
            "SIZE {} mm, {} mm\n",
            opts.label_width_mm, opts.label_height_mm
        ));
        tspl.push_str("GAP 2 mm, 0 mm\n");
        tspl.push_str("DENSITY 10\n");
        tspl.push_str("DIRECTION 1\n");
        tspl.push_str("CLS\n");

        // Header
        tspl.push_str("TEXT 15,15,\"3\",0,1,1,\"HOUSHOP SANITIZED\"\n");
        tspl.push_str("TEXT 15,45,\"1\",0,1,1,\"NIST SP 800-88 PURGED\"\n");

        // Device Model & Spec
        let display_name = format!("{} {}", record.brand, record.model);
        let truncated_name: String = display_name.chars().take(24).collect();
        tspl.push_str(&format!(
            "TEXT 15,70,\"2\",0,1,1,\"{}\"\n",
            truncated_name
        ));

        // IMEI / Serial Number
        let imei_val = record
            .imei
            .as_deref()
            .or(record.serial_number.as_deref())
            .unwrap_or("N/A");
        tspl.push_str(&format!("TEXT 15,100,\"1\",0,1,1,\"ID: {}\"\n", imei_val));

        // Method & Tech
        tspl.push_str(&format!(
            "TEXT 15,125,\"1\",0,1,1,\"By: {} | {}\"\n",
            record.technician_name,
            &record.created_at[..10.min(record.created_at.len())]
        ));

        // Barcode for Certificate Number
        tspl.push_str(&format!(
            "BARCODE 15,150,\"128\",35,1,0,2,2,\"{}\"\n",
            record.certificate_number
        ));
        tspl.push_str(&format!(
            "TEXT 15,195,\"1\",0,1,1,\"{}\"\n",
            record.certificate_number
        ));

        tspl.push_str(&format!("PRINT {},1\n", opts.copies.max(1)));
        tspl
    }
}

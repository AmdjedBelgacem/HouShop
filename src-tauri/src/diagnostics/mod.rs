pub mod android_probe;
pub mod diagnostic_server;
pub mod grading;
pub mod ios_probe;
pub mod mtp_probe;
pub mod parts_audit;
pub mod types;
pub mod virtual_probe;

use android_probe::AndroidProbe;
use diagnostic_server::DiagnosticServerManager;
use grading::calculate_device_grading;
use ios_probe::IosProbe;
use sqlx::SqlitePool;
use std::sync::Arc;
use tokio::sync::Mutex;
pub use types::*;
use uuid::Uuid;

pub struct DiagnosticEngine {
    db_pool: SqlitePool,
    ios_probe: IosProbe,
    android_probe: AndroidProbe,
    pub server_manager: Arc<Mutex<DiagnosticServerManager>>,
}

impl DiagnosticEngine {
    pub fn new(db_pool: SqlitePool) -> Self {
        Self {
            db_pool,
            ios_probe: IosProbe::new(),
            android_probe: AndroidProbe::new(),
            server_manager: Arc::new(Mutex::new(DiagnosticServerManager::new())),
        }
    }

    /// Probes a connected device by its ID/serial, or virtual device identifier.
    pub async fn probe_device(
        &self,
        device_id: &str,
        platform: Option<&str>,
    ) -> Result<FullDeviceDiagnosticReport, String> {
        // 1. Check if it is a demo/virtual device
        if device_id.starts_with("demo-") || device_id.starts_with("mock-") {
            return Ok(virtual_probe::generate_virtual_report(device_id));
        }

        // 1b. An Android phone seen only as a file-transfer (MTP) device.
        if device_id.starts_with(crate::transfer::mtp::ID_PREFIX) {
            return mtp_probe::probe_device(device_id).await;
        }

        // 2. Check if platform is specified or deduce from device_id
        let is_ios = match platform {
            Some("iOS") | Some("ios") => true,
            Some("Android") | Some("android") => false,
            _ => device_id.len() >= 24 && !device_id.contains(':'),
        };

        if is_ios {
            self.ios_probe.probe_device(device_id).await
        } else {
            self.android_probe.probe_device(device_id).await
        }
    }

    /// Re-evaluates a report when an interactive hardware test state changes.
    pub fn update_hardware_test(
        &self,
        report: &mut FullDeviceDiagnosticReport,
        test_key: &str,
        passed: bool,
        details: Option<String>,
    ) {
        if let Some(test) = report.hardware_tests.get_mut(test_key) {
            test.passed = passed;
            test.tested = true;
            if let Some(d) = details {
                test.details = Some(d);
            }
        }

        // Recalculate grading
        report.grading = calculate_device_grading(
            &report.battery,
            &report.parts_audit,
            &report.security_locks,
            &report.hardware_tests,
        );
    }

    /// Batch updates multiple hardware tests in a single pass and re-evaluates grading once.
    pub fn batch_update_hardware_tests(
        &self,
        report: &mut FullDeviceDiagnosticReport,
        updates: Vec<(String, bool, Option<String>)>,
    ) {
        for (test_key, passed, details) in updates {
            if let Some(test) = report.hardware_tests.get_mut(&test_key) {
                test.passed = passed;
                test.tested = true;
                if let Some(d) = details {
                    test.details = Some(d);
                }
            }
        }

        // Recalculate grading once after all updates
        report.grading = calculate_device_grading(
            &report.battery,
            &report.parts_audit,
            &report.security_locks,
            &report.hardware_tests,
        );
    }

    /// Saves an inspection report into the local SQLite database.
    pub async fn save_inspection(
        &self,
        req: SaveInspectionRequest,
    ) -> Result<DeviceInspectionRecord, String> {
        let inspection_uuid = format!("INS-{}", Uuid::new_v4().to_string()[..8].to_uppercase());
        let report = &req.report;

        let parts_json = serde_json::to_string(&report.parts_audit)
            .map_err(|e| format!("Failed to serialize parts_audit: {}", e))?;
        let tests_json = serde_json::to_string(&report.hardware_tests)
            .map_err(|e| format!("Failed to serialize hardware_tests: {}", e))?;
        let locks_json = serde_json::to_string(&report.security_locks)
            .map_err(|e| format!("Failed to serialize security_locks: {}", e))?;

        let res = sqlx::query(
            r#"
            INSERT INTO device_inspections (
                inspection_uuid, device_id, device_name, brand, model,
                platform, os_version, imei1, imei2, serial_number,
                battery_health, battery_cycles, battery_design_mah, battery_actual_mah,
                parts_audit, hardware_tests, score, calculated_grade,
                passed_tests_count, total_tests_count, lock_status, technician_notes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&inspection_uuid)
        .bind(&report.device_id)
        .bind(&report.device_name)
        .bind(&report.brand)
        .bind(&report.model)
        .bind(&report.platform)
        .bind(&report.os_version)
        .bind(&report.imei1)
        .bind(&report.imei2)
        .bind(&report.serial_number)
        .bind(report.battery.health_percentage as i64)
        .bind(report.battery.cycle_count as i64)
        .bind(report.battery.design_capacity_mah as i64)
        .bind(report.battery.actual_capacity_mah as i64)
        .bind(&parts_json)
        .bind(&tests_json)
        .bind(report.grading.score as i64)
        .bind(report.grading.grade.to_string())
        .bind(report.grading.passed_count as i64)
        .bind(report.grading.total_count as i64)
        .bind(&locks_json)
        .bind(&req.technician_notes)
        .execute(&self.db_pool)
        .await
        .map_err(|e| format!("Database error saving inspection: {}", e))?;

        let record = self.get_inspection_by_id(res.last_insert_rowid()).await?;
        Ok(record)
    }

    pub async fn get_inspection_by_id(&self, id: i64) -> Result<DeviceInspectionRecord, String> {
        let record = sqlx::query_as::<_, DeviceInspectionRecord>(
            r#"
            SELECT
                id, inspection_uuid, device_id, device_name, brand, model,
                platform, os_version, imei1, imei2, serial_number,
                battery_health, battery_cycles, battery_design_mah, battery_actual_mah,
                parts_audit, hardware_tests, score, calculated_grade,
                passed_tests_count, total_tests_count, lock_status, technician_notes,
                created_at
            FROM device_inspections
            WHERE id = ?
            "#,
        )
        .bind(id)
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| format!("Inspection record not found: {}", e))?;

        Ok(record)
    }

    pub async fn list_inspections(&self, limit: i64) -> Result<Vec<DeviceInspectionRecord>, String> {
        let records = sqlx::query_as::<_, DeviceInspectionRecord>(
            r#"
            SELECT
                id, inspection_uuid, device_id, device_name, brand, model,
                platform, os_version, imei1, imei2, serial_number,
                battery_health, battery_cycles, battery_design_mah, battery_actual_mah,
                parts_audit, hardware_tests, score, calculated_grade,
                passed_tests_count, total_tests_count, lock_status, technician_notes,
                created_at
            FROM device_inspections
            ORDER BY id DESC
            LIMIT ?
            "#,
        )
        .bind(limit)
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| format!("Failed to list inspections: {}", e))?;

        Ok(records)
    }
}

//! Limited report for an Android phone seen only as a file-transfer (MTP)
//! device. Only what the phone itself reports over MTP is filled in; every
//! other reading stays unknown and every hardware test stays "not tested".

use crate::diagnostics::grading::{calculate_device_grading, get_standard_28_tests};
use crate::diagnostics::parts_audit::audit_android_parts;
use crate::diagnostics::types::{
    BatteryGasGauge, ComponentStatus, FullDeviceDiagnosticReport, HardwareTestResult,
    SecurityLockStatus,
};
use crate::transfer::mtp::{self, MtpDevice};
use std::collections::HashMap;

pub async fn probe_device(device_id: &str) -> Result<FullDeviceDiagnosticReport, String> {
    let device = mtp::find_device(device_id).await.ok_or_else(|| {
        "The phone is no longer connected over USB. Unlock it, set the USB mode to File transfer and reconnect it."
            .to_string()
    })?;
    Ok(build_report(&device))
}

pub fn build_report(d: &MtpDevice) -> FullDeviceDiagnosticReport {
    let brand = if d.manufacturer.is_empty() { "Android".to_string() } else { d.manufacturer.clone() };
    let battery = BatteryGasGauge {
        // Not measured: neutral health and flagged, as for any unreadable battery.
        health_percentage: 100,
        cycle_count: 0,
        design_capacity_mah: 0,
        actual_capacity_mah: 0,
        temperature_celsius: None,
        serial_number: None,
        manufacturer: None,
        status: ComponentStatus::Unknown,
        current_charge_percentage: d.battery_percent,
        is_charging: None,
        estimated: true,
    };
    let parts_audit = audit_android_parts(&HashMap::new());
    let security_locks = SecurityLockStatus::default();
    let mut hardware_tests: HashMap<String, HardwareTestResult> = HashMap::new();
    for test in get_standard_28_tests() {
        hardware_tests.insert(test.key.clone(), test);
    }
    let grading = calculate_device_grading(&battery, &parts_audit, &security_locks, &hardware_tests);

    FullDeviceDiagnosticReport {
        device_id: d.id.clone(),
        device_name: format!("{} {}", brand, d.model).trim().to_string(),
        brand,
        model: d.model.clone(),
        platform: "Android".into(),
        os_version: "Android".into(),
        imei1: None,
        imei2: None,
        serial_number: d.serial.clone(),
        baseband_version: None,
        cpu_architecture: String::new(),
        ram_gb: 0.0,
        storage_total_bytes: d.storage_total_bytes,
        storage_free_bytes: d.storage_free_bytes,
        battery,
        parts_audit,
        security_locks,
        hardware_tests,
        grading,
        limited_reason: Some("mtp".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_keeps_unread_values_unknown() {
        let r = build_report(&MtpDevice {
            id: "mtp:1".into(),
            manufacturer: "Unisoc".into(),
            model: "Unisoc Phone".into(),
            serial: Some("1".into()),
            storage_total_bytes: 100,
            storage_free_bytes: 40,
            battery_percent: Some(55),
        });
        assert_eq!(r.limited_reason.as_deref(), Some("mtp"));
        assert_eq!(r.imei1, None);
        assert_eq!(r.battery.current_charge_percentage, Some(55));
        assert!(r.battery.estimated);
        assert!(r.hardware_tests.values().all(|t| !t.tested));
    }
}

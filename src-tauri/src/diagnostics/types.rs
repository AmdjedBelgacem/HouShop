use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use std::collections::HashMap;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComponentStatus {
    Original,
    ReplacedOem,
    ReplacedThirdParty,
    Defective,
    Unknown,
}

impl ComponentStatus {
    #[allow(dead_code)]
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Original => "original",
            Self::ReplacedOem => "replaced_oem",
            Self::ReplacedThirdParty => "replaced_third_party",
            Self::Defective => "defective",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartAuditItem {
    pub name: String,
    pub status: ComponentStatus,
    pub read_serial: Option<String>,
    pub factory_serial: Option<String>,
    pub is_original: bool,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartsAuditReport {
    pub screen: PartAuditItem,
    pub battery: PartAuditItem,
    pub rear_camera: PartAuditItem,
    pub front_camera: PartAuditItem,
    pub biometrics: PartAuditItem,
    pub logic_board: PartAuditItem,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatteryGasGauge {
    pub health_percentage: u8,
    pub cycle_count: u32,
    pub design_capacity_mah: u32,
    pub actual_capacity_mah: u32,
    /// None when the device does not expose a battery temperature.
    pub temperature_celsius: Option<f32>,
    pub serial_number: Option<String>,
    pub manufacturer: Option<String>,
    pub status: ComponentStatus,
    #[serde(default)]
    pub current_charge_percentage: Option<u8>,
    #[serde(default)]
    pub is_charging: Option<bool>,
    /// True when health/capacity could not be read from the battery itself and
    /// were estimated from the cycle count instead.
    #[serde(default)]
    pub estimated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SecurityLockStatus {
    #[serde(default)]
    pub icloud_fmi_locked: bool,
    #[serde(default)]
    pub fmi_account_masked: Option<String>,
    #[serde(default)]
    pub fmi_on: bool,
    #[serde(default)]
    pub mdm_enrolled: bool,
    #[serde(default)]
    pub carrier_locked: bool,
    #[serde(default)]
    pub carrier_name: Option<String>,
    #[serde(default)]
    pub knox_tripped: bool,
    #[serde(default)]
    pub frp_locked: bool,
    #[serde(default)]
    pub bootloader_unlocked: bool,
    #[serde(default)]
    pub is_rooted_or_jailbroken: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareTestResult {
    pub key: String,
    pub name: String,
    pub category: String, // 'touch' | 'display' | 'audio' | 'camera' | 'biometrics' | 'sensors' | 'buttons' | 'connectivity' | 'haptics'
    pub passed: bool,
    pub tested: bool,
    pub details: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DeviceGrade {
    #[serde(rename = "A+")]
    APlus,
    #[serde(rename = "A")]
    A,
    #[serde(rename = "B")]
    B,
    #[serde(rename = "C")]
    C,
    #[serde(rename = "Defective")]
    Defective,
}

impl fmt::Display for DeviceGrade {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::APlus => write!(f, "A+"),
            Self::A => write!(f, "A"),
            Self::B => write!(f, "B"),
            Self::C => write!(f, "C"),
            Self::Defective => write!(f, "Defective"),
        }
    }
}

impl DeviceGrade {
    #[allow(dead_code)]
    pub fn from_str(s: &str) -> Self {
        match s {
            "A+" => Self::APlus,
            "A" => Self::A,
            "B" => Self::B,
            "C" => Self::C,
            _ => Self::Defective,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GradingResult {
    pub score: u8, // 0..100
    pub grade: DeviceGrade,
    pub passed_count: usize,
    pub total_count: usize,
    pub valuation_multiplier: f32, // Recommended trade-in adjustment (e.g. 1.0 for A+, 0.9 for A, 0.75 for B, 0.55 for C, 0.25 for Defective)
    pub summary: String,
    pub defects: Vec<String>,
    /// Hardware tests that have not been run yet. They do not lower the score,
    /// but the grade stays provisional until they are done.
    #[serde(default)]
    pub pending_tests: usize,
    /// True while any hardware test is still pending: the grade is an estimate
    /// from what the probe could read, and is capped below A.
    #[serde(default)]
    pub provisional: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FullDeviceDiagnosticReport {
    pub device_id: String,
    pub device_name: String,
    pub brand: String,
    pub model: String,
    pub platform: String,
    pub os_version: String,
    pub imei1: Option<String>,
    pub imei2: Option<String>,
    pub serial_number: Option<String>,
    pub baseband_version: Option<String>,
    pub cpu_architecture: String,
    pub ram_gb: f32,
    pub storage_total_bytes: u64,
    pub storage_free_bytes: u64,
    pub battery: BatteryGasGauge,
    pub parts_audit: PartsAuditReport,
    pub security_locks: SecurityLockStatus,
    pub hardware_tests: HashMap<String, HardwareTestResult>,
    pub grading: GradingResult,
    /// Set when only basic details could be read (e.g. "mtp": an Android phone
    /// with USB debugging off). Everything not read is left unknown.
    #[serde(default)]
    pub limited_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DeviceInspectionRecord {
    pub id: i64,
    pub inspection_uuid: String,
    pub device_id: String,
    pub device_name: String,
    pub brand: String,
    pub model: String,
    pub platform: String,
    pub os_version: String,
    pub imei1: Option<String>,
    pub imei2: Option<String>,
    pub serial_number: Option<String>,
    pub battery_health: i64,
    pub battery_cycles: i64,
    pub battery_design_mah: i64,
    pub battery_actual_mah: i64,
    pub parts_audit: String,   // JSON
    pub hardware_tests: String, // JSON
    pub score: i64,
    pub calculated_grade: String,
    pub passed_tests_count: i64,
    pub total_tests_count: i64,
    pub lock_status: String,   // JSON
    pub technician_notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveInspectionRequest {
    pub device_id: String,
    pub technician_notes: Option<String>,
    pub report: FullDeviceDiagnosticReport,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MobileDiagnosticSyncEvent {
    pub test_key: String,
    pub passed: bool,
    pub details: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticServerInfo {
    pub ip_address: String,
    pub port: u16,
    pub pin: String,
    pub connect_url: String,
    pub qr_code_svg: String,
    pub qr_code_data_url: String,
    pub connected: bool,
}

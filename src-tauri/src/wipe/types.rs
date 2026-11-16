use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WipeRiskLevel {
    Safe,
    Warning,
    CriticalBlocked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveAccountInfo {
    pub account_type: String, // 'icloud' | 'google' | 'samsung' | 'xiaomi' | 'huawei' | 'other'
    pub account_name: String,
    pub identifier: String,
    pub action_required: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WipeMethodInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub nist_compliant: bool,
    pub estimated_seconds: u32,
    pub requires_reboot: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreWipeAuditResult {
    pub device_id: String,
    pub device_name: String,
    pub brand: String,
    pub model: String,
    pub platform: String,
    pub os_version: String,
    pub imei: Option<String>,
    pub imei2: Option<String>,
    pub serial_number: Option<String>,
    pub storage_capacity: Option<String>,
    pub battery_level: Option<u8>,
    pub is_safe_to_wipe: bool,
    pub risk_level: WipeRiskLevel,
    pub blocking_reasons: Vec<String>,
    pub warning_reasons: Vec<String>,
    pub active_accounts: Vec<ActiveAccountInfo>,
    pub fmi_status: bool,
    pub fmi_account_masked: Option<String>,
    pub frp_status: bool,
    pub mdm_enrolled: bool,
    pub supported_wipe_methods: Vec<WipeMethodInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WipeProgressEvent {
    pub step: u32,
    pub total_steps: u32,
    pub stage_name: String,
    pub progress_percent: u32,
    pub log_line: String,
    pub is_complete: bool,
    pub is_error: bool,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecuteWipeRequest {
    pub device_id: String,
    pub platform: String,
    pub wipe_method: String,
    pub technician_name: String,
    pub technician_override: bool,
    pub imei_confirmation_digits: String,
    pub customer_backup_confirmed: bool,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SanitizationRecord {
    pub id: i64,
    pub wipe_uuid: String,
    pub device_id: String,
    pub device_name: String,
    pub brand: String,
    pub model: String,
    pub platform: String,
    pub os_version: String,
    pub imei: Option<String>,
    pub imei2: Option<String>,
    pub serial_number: Option<String>,
    pub storage_capacity: Option<String>,
    pub wipe_method: String,
    pub nist_standard: String,
    pub pre_wipe_accounts_removed: bool,
    pub pre_wipe_lock_audit: serde_json::Value,
    pub post_wipe_oobe_verified: bool,
    pub status: String,
    pub technician_name: String,
    pub notes: Option<String>,
    pub duration_seconds: i64,
    pub certificate_number: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WipeLabelOpts {
    pub label_width_mm: f32,
    pub label_height_mm: f32,
    pub copies: u32,
}

impl Default for WipeLabelOpts {
    fn default() -> Self {
        Self {
            label_width_mm: 50.0,
            label_height_mm: 30.0,
            copies: 1,
        }
    }
}

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DevicePlatform {
    Android,
    Ios,
    HarmonyOs,
}

impl fmt::Display for DevicePlatform {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Android => write!(f, "Android"),
            Self::Ios => write!(f, "iOS"),
            Self::HarmonyOs => write!(f, "HarmonyOS"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionType {
    Usb,
    Wifi,
    Virtual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceConnectionState {
    Connected,
    Unauthorized,
    Offline,
    Locked,
    NeedTrust,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferCategory {
    Contacts,
    Messages,
    Calls,
    Calendars,
    Photos,
    Videos,
    Audio,
    Documents,
}

impl TransferCategory {
    pub fn all() -> &'static [TransferCategory] {
        &[
            TransferCategory::Contacts,
            TransferCategory::Messages,
            TransferCategory::Calls,
            TransferCategory::Calendars,
            TransferCategory::Photos,
            TransferCategory::Videos,
            TransferCategory::Audio,
            TransferCategory::Documents,
        ]
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Contacts => "contacts",
            Self::Messages => "messages",
            Self::Calls => "calls",
            Self::Calendars => "calendars",
            Self::Photos => "photos",
            Self::Videos => "videos",
            Self::Audio => "audio",
            Self::Documents => "documents",
        }
    }

    pub fn from_str_opt(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "contacts" => Some(Self::Contacts),
            "messages" | "sms" => Some(Self::Messages),
            "calls" | "call_logs" => Some(Self::Calls),
            "calendars" => Some(Self::Calendars),
            "photos" => Some(Self::Photos),
            "videos" => Some(Self::Videos),
            "audio" | "music" => Some(Self::Audio),
            "documents" | "docs" => Some(Self::Documents),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCapabilities {
    pub can_read_contacts: bool,
    pub can_write_contacts: bool,
    pub can_read_messages: bool,
    pub can_write_messages: bool,
    pub can_read_calls: bool,
    pub can_write_calls: bool,
    pub can_read_calendars: bool,
    pub can_write_calendars: bool,
    pub can_read_media: bool,
    pub can_write_media: bool,
}

impl Default for DeviceCapabilities {
    fn default() -> Self {
        Self {
            can_read_contacts: true,
            can_write_contacts: true,
            can_read_messages: true,
            can_write_messages: true,
            can_read_calls: true,
            can_write_calls: true,
            can_read_calendars: true,
            can_write_calendars: true,
            can_read_media: true,
            can_write_media: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub brand: String,
    pub model: String,
    pub platform: DevicePlatform,
    pub os_version: String,
    pub connection_type: ConnectionType,
    pub connection_state: DeviceConnectionState,
    pub battery_level: Option<u8>,
    pub is_charging: Option<bool>,
    pub storage_total_bytes: u64,
    pub storage_free_bytes: u64,
    pub capabilities: DeviceCapabilities,
    pub is_virtual: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryScanResult {
    pub category: TransferCategory,
    pub item_count: u64,
    pub total_bytes: u64,
    pub available: bool,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceDataSummary {
    pub device_id: String,
    pub categories: Vec<CategoryScanResult>,
    pub total_items: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferStatus {
    Pending,
    InProgress,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

impl fmt::Display for TransferStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Pending => write!(f, "pending"),
            Self::InProgress => write!(f, "in_progress"),
            Self::Paused => write!(f, "paused"),
            Self::Completed => write!(f, "completed"),
            Self::Failed => write!(f, "failed"),
            Self::Cancelled => write!(f, "cancelled"),
        }
    }
}

impl TransferStatus {
    pub fn from_str(s: &str) -> Self {
        match s {
            "in_progress" => Self::InProgress,
            "paused" => Self::Paused,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            "cancelled" => Self::Cancelled,
            _ => Self::Pending,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct TransferSessionRecord {
    pub id: i64,
    pub session_uuid: String,
    pub source_device_id: String,
    pub source_device_name: String,
    pub source_platform: String,
    pub target_device_id: String,
    pub target_device_name: String,
    pub target_platform: String,
    pub status: String,
    pub total_items: i64,
    pub transferred_items: i64,
    pub total_bytes: i64,
    pub transferred_bytes: i64,
    pub selected_categories: String,
    pub error_message: Option<String>,
    pub started_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct TransferLogRecord {
    pub id: i64,
    pub session_id: i64,
    pub category: String,
    pub item_name: String,
    pub item_size: i64,
    pub status: String,
    pub error_message: Option<String>,
    pub checksum: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartTransferRequest {
    pub source_device_id: String,
    pub target_device_id: String,
    pub categories: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferProgressEvent {
    pub session_uuid: String,
    pub status: TransferStatus,
    pub current_category: Option<TransferCategory>,
    pub current_item_name: Option<String>,
    pub current_item_index: u64,
    pub total_items: u64,
    pub transferred_bytes: u64,
    pub total_bytes: u64,
    pub progress_percentage: f32,
    pub speed_bytes_per_sec: u64,
    pub speed_mbps: f32,
    pub eta_seconds: u64,
    pub elapsed_seconds: u64,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferSummaryReport {
    pub session_id: i64,
    pub session_uuid: String,
    pub source_device_name: String,
    pub source_platform: String,
    pub target_device_name: String,
    pub target_platform: String,
    pub status: TransferStatus,
    pub total_items: u64,
    pub transferred_items: u64,
    pub skipped_items: u64,
    pub failed_items: u64,
    pub total_bytes: u64,
    pub transferred_bytes: u64,
    pub duration_seconds: u64,
    pub average_speed_mbps: f32,
    pub categories_breakdown: Vec<CategoryTransferSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryTransferSummary {
    pub category: TransferCategory,
    pub transferred_count: u64,
    pub failed_count: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WifiServerInfo {
    pub ip_address: String,
    pub port: u16,
    pub pin: String,
    pub qr_code_svg: String,
    pub qr_code_data_url: String,
    pub connect_url: String,
    pub active_connections: usize,
}

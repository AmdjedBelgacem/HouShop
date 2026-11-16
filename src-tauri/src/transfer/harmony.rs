use super::types::{DeviceInfo, DevicePlatform};

pub struct HarmonyManager;

impl HarmonyManager {
    pub fn new() -> Self {
        Self
    }

    /// Evaluates if an Android/ADB device is actually a Huawei HarmonyOS device.
    pub fn is_harmony_device(brand: &str, model: &str, os_str: &str) -> bool {
        let b = brand.to_uppercase();
        let m = model.to_uppercase();
        let o = os_str.to_uppercase();

        b.contains("HUAWEI")
            || b.contains("HONOR")
            || m.starts_with("HMA-")
            || m.starts_with("NOH-")
            || m.starts_with("ALN-")
            || o.contains("HARMONY")
            || o.contains("EMUI")
    }

    /// Decorates an existing DeviceInfo with HarmonyOS characteristics.
    pub fn enrich_harmony_device(device: &mut DeviceInfo) {
        device.platform = DevicePlatform::HarmonyOs;
        if !device.os_version.contains("HarmonyOS") && !device.os_version.contains("EMUI") {
            device.os_version = "HarmonyOS 4.2".to_string();
        }
    }
}

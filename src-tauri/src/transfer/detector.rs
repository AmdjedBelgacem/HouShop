use super::adb::AdbManager;
use super::harmony::HarmonyManager;
use super::ios::IosManager;
use super::types::DeviceInfo;
use super::virtual_device::VirtualDeviceProvider;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;

pub struct DeviceDetector {
    adb: AdbManager,
    ios: IosManager,
    harmony: HarmonyManager,
    virtual_devices_enabled: AtomicBool,
    known_devices: Arc<RwLock<HashMap<String, DeviceInfo>>>,
    seen_physical_ids: Arc<RwLock<HashSet<String>>>,
}

impl DeviceDetector {
    pub fn new() -> Self {
        Self {
            adb: AdbManager::new(),
            ios: IosManager::new(),
            harmony: HarmonyManager::new(),
            virtual_devices_enabled: AtomicBool::new(true),
            known_devices: Arc::new(RwLock::new(HashMap::new())),
            seen_physical_ids: Arc::new(RwLock::new(HashSet::new())),
        }
    }

    pub fn set_virtual_devices_enabled(&self, enabled: bool) {
        self.virtual_devices_enabled.store(enabled, Ordering::SeqCst);
    }

    pub fn is_virtual_devices_enabled(&self) -> bool {
        self.virtual_devices_enabled.load(Ordering::SeqCst)
    }

    /// Discovers all currently connected devices across USB ADB, iOS, HarmonyOS, and Virtual.
    pub async fn scan_all_devices(&self) -> Vec<DeviceInfo> {
        let mut all_devices = Vec::new();

        // 1. Android & HarmonyOS devices via ADB
        if let Ok(mut adb_devices) = self.adb.list_devices().await {
            for dev in &mut adb_devices {
                if HarmonyManager::is_harmony_device(&dev.brand, &dev.model, &dev.os_version) {
                    HarmonyManager::enrich_harmony_device(dev);
                }
            }
            all_devices.extend(adb_devices);
        }

        // 2. iOS devices
        if let Ok(ios_devices) = self.ios.list_devices().await {
            all_devices.extend(ios_devices);
        }

        // 3. Virtual devices if enabled
        if self.virtual_devices_enabled.load(Ordering::SeqCst) {
            let virtuals = VirtualDeviceProvider::get_virtual_devices();
            all_devices.extend(virtuals);
        }

        // Real USB devices ALWAYS come before virtual/demo devices
        all_devices.sort_by_key(|d| d.is_virtual);

        // Update known devices map
        let mut map = self.known_devices.write().await;
        map.clear();
        for dev in &all_devices {
            map.insert(dev.id.clone(), dev.clone());
        }

        all_devices
    }

    /// Runs a single polling pass and emits Tauri events for any changes.
    pub async fn poll_and_emit_events(&self, app: &AppHandle) {
        let current_devices = self.scan_all_devices().await;

        let current_physical: Vec<&DeviceInfo> = current_devices
            .iter()
            .filter(|d| !d.id.starts_with("virt-") && !d.id.starts_with("demo-"))
            .collect();

        let current_ids: HashSet<String> = current_physical.iter().map(|d| d.id.clone()).collect();
        let mut seen = self.seen_physical_ids.write().await;

        for dev in &current_physical {
            if !seen.contains(&dev.id) {
                // Newly detected physical phone!
                println!("[USB Auto-Detect] Physical device connected: {} ({})", dev.name, dev.model);
                let _ = app.emit("physical-device-connected", *dev);
            }
        }

        for old_id in seen.iter() {
            if !current_ids.contains(old_id) {
                println!("[USB Auto-Detect] Physical device disconnected: {}", old_id);
                let _ = app.emit("physical-device-disconnected", old_id);
            }
        }

        *seen = current_ids;

        let _ = app.emit("transfer-device-list-updated", &current_devices);
    }

    pub async fn get_device(&self, device_id: &str) -> Option<DeviceInfo> {
        let map = self.known_devices.read().await;
        if let Some(d) = map.get(device_id) {
            return Some(d.clone());
        }
        // Fallback check in virtual devices
        VirtualDeviceProvider::get_virtual_devices()
            .into_iter()
            .find(|d| d.id == device_id)
    }

    pub fn adb(&self) -> &AdbManager {
        &self.adb
    }

    pub fn ios(&self) -> &IosManager {
        &self.ios
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_scan_real_devices() {
        let detector = DeviceDetector::new();
        let devices = detector.scan_all_devices().await;
        println!("=== SCANNED {} DEVICES ===", devices.len());
        for d in &devices {
            println!("DEVICE: id={}, name={}, model={}, brand={}, platform={:?}, state={:?}", d.id, d.name, d.model, d.brand, d.platform, d.connection_state);
        }
    }
}

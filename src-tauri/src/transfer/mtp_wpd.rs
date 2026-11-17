//! Reads phones that only offer file transfer (MTP) through the Windows
//! Portable Devices (WPD) API, which Windows ships with. Nothing is written to
//! the phone and no driver is installed.

use super::mtp::{MtpDevice, ID_PREFIX};
use windows::core::{w, PCWSTR, PWSTR};
use windows::Win32::Devices::PortableDevices::*;
use windows::Win32::System::Com::*;

fn pwstr_to_string(p: PWSTR) -> String {
    if p.is_null() {
        return String::new();
    }
    let s = unsafe { p.to_string() }.unwrap_or_default();
    unsafe { CoTaskMemFree(Some(p.0 as *const _)) };
    s
}

fn device_ids(manager: &IPortableDeviceManager) -> Vec<PWSTR> {
    let mut count = 0u32;
    if unsafe { manager.GetDevices(std::ptr::null_mut(), &mut count) }.is_err() || count == 0 {
        return Vec::new();
    }
    let mut ids = vec![PWSTR::null(); count as usize];
    if unsafe { manager.GetDevices(ids.as_mut_ptr(), &mut count) }.is_err() {
        return Vec::new();
    }
    ids.truncate(count as usize);
    ids
}

fn read_device(manager: &IPortableDeviceManager, id: PCWSTR) -> Option<MtpDevice> {
    unsafe {
        let mut manufacturer = String::new();
        let mut len = 0u32;
        if manager.GetDeviceManufacturer(id, PWSTR::null(), &mut len).is_ok() && len > 0 {
            let mut buf = vec![0u16; len as usize];
            if manager.GetDeviceManufacturer(id, PWSTR(buf.as_mut_ptr()), &mut len).is_ok() {
                manufacturer = String::from_utf16_lossy(&buf).trim_end_matches('\0').to_string();
            }
        }
        // iPhones also show up as portable devices; they are handled elsewhere.
        if manufacturer.to_lowercase().contains("apple") {
            return None;
        }

        let device: IPortableDevice = CoCreateInstance(&PortableDevice, None, CLSCTX_INPROC_SERVER).ok()?;
        let client: IPortableDeviceValues = CoCreateInstance(&PortableDeviceValues, None, CLSCTX_INPROC_SERVER).ok()?;
        let _ = client.SetStringValue(&WPD_CLIENT_NAME, w!("Shop Management"));
        let _ = client.SetUnsignedIntegerValue(&WPD_CLIENT_MAJOR_VERSION, 1);
        let _ = client.SetUnsignedIntegerValue(&WPD_CLIENT_MINOR_VERSION, 0);
        let _ = client.SetUnsignedIntegerValue(&WPD_CLIENT_REVISION, 0);
        // Read-only access: this app never changes anything on the phone.
        let _ = client.SetUnsignedIntegerValue(&WPD_CLIENT_DESIRED_ACCESS, 0x8000_0000); // GENERIC_READ
        device.Open(id, &client).ok()?;

        let content = device.Content().ok()?;
        let props = content.Properties().ok()?;
        let root = w!("DEVICE");

        let keys: IPortableDeviceKeyCollection =
            CoCreateInstance(&PortableDeviceKeyCollection, None, CLSCTX_INPROC_SERVER).ok()?;
        let _ = keys.Add(&WPD_DEVICE_MODEL);
        let _ = keys.Add(&WPD_DEVICE_MANUFACTURER);
        let _ = keys.Add(&WPD_DEVICE_SERIAL_NUMBER);
        let _ = keys.Add(&WPD_DEVICE_POWER_LEVEL);
        let values = props.GetValues(root, &keys).ok()?;

        let model = values.GetStringValue(&WPD_DEVICE_MODEL).map(pwstr_to_string).unwrap_or_default();
        if let Ok(m) = values.GetStringValue(&WPD_DEVICE_MANUFACTURER).map(pwstr_to_string) {
            if !m.is_empty() {
                manufacturer = m;
            }
        }
        let serial = values
            .GetStringValue(&WPD_DEVICE_SERIAL_NUMBER)
            .map(pwstr_to_string)
            .ok()
            .filter(|s| !s.is_empty());
        let battery_percent = values
            .GetUnsignedIntegerValue(&WPD_DEVICE_POWER_LEVEL)
            .ok()
            .map(|p| p.min(100) as u8);

        // Storage areas are the children of the device object.
        let (mut total, mut free) = (0u64, 0u64);
        let skeys: IPortableDeviceKeyCollection =
            CoCreateInstance(&PortableDeviceKeyCollection, None, CLSCTX_INPROC_SERVER).ok()?;
        let _ = skeys.Add(&WPD_STORAGE_CAPACITY);
        let _ = skeys.Add(&WPD_STORAGE_FREE_SPACE_IN_BYTES);
        if let Ok(en) = content.EnumObjects(0, root, None) {
            loop {
                let mut object = [PWSTR::null()];
                let mut fetched = 0u32;
                let hr = en.Next(&mut object, &mut fetched);
                if hr.is_err() || fetched == 0 {
                    break;
                }
                let object_id = pwstr_to_string(object[0]);
                let wide: Vec<u16> = object_id.encode_utf16().chain(std::iter::once(0)).collect();
                if let Ok(v) = props.GetValues(PCWSTR(wide.as_ptr()), &skeys) {
                    total += v.GetUnsignedLargeIntegerValue(&WPD_STORAGE_CAPACITY).unwrap_or(0);
                    free += v.GetUnsignedLargeIntegerValue(&WPD_STORAGE_FREE_SPACE_IN_BYTES).unwrap_or(0);
                }
            }
        }
        let _ = device.Close();

        if model.is_empty() && manufacturer.is_empty() {
            return None;
        }
        Some(MtpDevice {
            id: String::new(),
            manufacturer,
            model,
            serial,
            storage_total_bytes: total,
            storage_free_bytes: free,
            battery_percent,
        })
    }
}

/// Every phone Windows currently sees as a portable (file-transfer) device.
pub fn list_devices() -> Vec<MtpDevice> {
    let mut out = Vec::new();
    unsafe {
        let initialised = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
        if let Ok(manager) = CoCreateInstance::<_, IPortableDeviceManager>(&PortableDeviceManager, None, CLSCTX_INPROC_SERVER) {
            let _ = manager.RefreshDeviceList();
            for (index, id) in device_ids(&manager).into_iter().enumerate() {
                let id_str = pwstr_to_string_keep(id);
                let wide: Vec<u16> = id_str.encode_utf16().chain(std::iter::once(0)).collect();
                if let Some(mut d) = read_device(&manager, PCWSTR(wide.as_ptr())) {
                    d.id = match &d.serial {
                        Some(s) => format!("{ID_PREFIX}{s}"),
                        None => format!("{ID_PREFIX}device-{index}"),
                    };
                    out.push(d);
                }
                CoTaskMemFree(Some(id.0 as *const _));
            }
        }
        if initialised {
            CoUninitialize();
        }
    }
    out
}

fn pwstr_to_string_keep(p: PWSTR) -> String {
    if p.is_null() {
        String::new()
    } else {
        unsafe { p.to_string() }.unwrap_or_default()
    }
}

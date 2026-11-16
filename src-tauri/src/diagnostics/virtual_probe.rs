use crate::diagnostics::grading::{calculate_device_grading, simulated_standard_tests};
use crate::diagnostics::types::{
    BatteryGasGauge, ComponentStatus, FullDeviceDiagnosticReport, PartAuditItem, PartsAuditReport,
    SecurityLockStatus,
};
use std::collections::HashMap;

pub fn generate_virtual_report(preset_id: &str) -> FullDeviceDiagnosticReport {
    match preset_id {
        "demo-s24-ultra" => generate_galaxy_s24_ultra(),
        "demo-huawei-p60" => generate_huawei_p60_pro(),
        "demo-defective-lock" => generate_defective_iphone(),
        _ => generate_iphone_15_pro(),
    }
}

pub fn list_virtual_devices() -> Vec<(&'static str, &'static str, &'static str, &'static str)> {
    vec![
        ("demo-iphone15-pro", "iPhone 15 Pro (Grade A+)", "Apple", "iOS 17.5.1"),
        ("demo-s24-ultra", "Galaxy S24 Ultra (Grade A)", "Samsung", "Android 14 (One UI 6.1)"),
        ("demo-huawei-p60", "HUAWEI P60 Pro (Grade B - Third-Party Screen)", "Huawei", "HarmonyOS 4.2"),
        ("demo-defective-lock", "iPhone 13 Pro (Defective - iCloud Locked)", "Apple", "iOS 16.4"),
    ]
}

fn generate_iphone_15_pro() -> FullDeviceDiagnosticReport {
    let battery = BatteryGasGauge {
        health_percentage: 97,
        cycle_count: 94,
        design_capacity_mah: 3274,
        actual_capacity_mah: 3180,
        temperature_celsius: 27.2,
        serial_number: Some("F8Y34107A800P019".into()),
        manufacturer: Some("Desay High-Density OEM".into()),
        status: ComponentStatus::Original,
        current_charge_percentage: Some(88),
        is_charging: Some(false),
    };

    let original_item = |name: &str, sn: &str, note: &str| PartAuditItem {
        name: name.into(),
        status: ComponentStatus::Original,
        read_serial: Some(sn.into()),
        factory_serial: Some(sn.into()),
        is_original: true,
        note: Some(note.into()),
    };

    let parts_audit = PartsAuditReport {
        screen: original_item(
            "Super Retina XDR OLED",
            "G9N338600PPM12K4",
            "Factory TrueTone & 120Hz ProMotion pairing verified",
        ),
        battery: original_item(
            "Lithium-ion Pack",
            "F8Y34107A800P019",
            "OEM BQ27Z561 Gas Gauge calibration authenticated",
        ),
        rear_camera: original_item(
            "Triple Lens 48MP Photonic Engine",
            "C11342629PM118A",
            "Sony IMX803 Quad-Bayer OIS module verified",
        ),
        front_camera: original_item(
            "TrueDepth 12MP Camera",
            "DN6331900K8PM23",
            "Autofocus & SL 3D flood illuminator paired",
        ),
        biometrics: original_item(
            "Face ID Dot Projector & Secure Enclave",
            "CHIP-A17PRO-092",
            "Apple A17 Pro Secure Enclave hardware biometric bound",
        ),
        logic_board: original_item(
            "Titanium Logic Board (A2848)",
            "DN6D00P8X091",
            "Baseband Qualcomm X70 5G Modem verified",
        ),
    };

    let security_locks = SecurityLockStatus {
        icloud_fmi_locked: false,
        fmi_account_masked: None,
        fmi_on: false,
        mdm_enrolled: false,
        carrier_locked: false,
        carrier_name: Some("Unlocked".into()),
        knox_tripped: false,
        frp_locked: false,
        bootloader_unlocked: false,
        is_rooted_or_jailbroken: false,
    };

    let mut hardware_tests = HashMap::new();
    for t in simulated_standard_tests() {
        hardware_tests.insert(t.key.clone(), t);
    }

    let grading = calculate_device_grading(&battery, &parts_audit, &security_locks, &hardware_tests);

    FullDeviceDiagnosticReport {
        device_id: "demo-iphone15-pro".into(),
        device_name: "iPhone 15 Pro".into(),
        brand: "Apple".into(),
        model: "iPhone 15 Pro (A2848)".into(),
        platform: "iOS".into(),
        os_version: "iOS 17.5.1 (Build 21F90)".into(),
        imei1: Some("359482109842103".into()),
        imei2: Some("359482109842104".into()),
        serial_number: Some("DN6DQ90J019K".into()),
        baseband_version: Some("2.50.02".into()),
        cpu_architecture: "Apple A17 Pro (6-core 64-bit ARM)".into(),
        ram_gb: 8.0,
        storage_total_bytes: 256 * 1024 * 1024 * 1024,
        storage_free_bytes: 182 * 1024 * 1024 * 1024,
        battery,
        parts_audit,
        security_locks,
        hardware_tests,
        grading,
    }
}

fn generate_galaxy_s24_ultra() -> FullDeviceDiagnosticReport {
    let battery = BatteryGasGauge {
        health_percentage: 92,
        cycle_count: 210,
        design_capacity_mah: 5000,
        actual_capacity_mah: 4620,
        temperature_celsius: 29.1,
        serial_number: Some("AA1R109AS/7-B".into()),
        manufacturer: Some("Samsung SDI Co., Ltd.".into()),
        status: ComponentStatus::Original,
        current_charge_percentage: Some(65),
        is_charging: Some(true),
    };

    let original_item = |name: &str, sn: &str, note: &str| PartAuditItem {
        name: name.into(),
        status: ComponentStatus::Original,
        read_serial: Some(sn.into()),
        factory_serial: Some(sn.into()),
        is_original: true,
        note: Some(note.into()),
    };

    let parts_audit = PartsAuditReport {
        screen: original_item(
            "Dynamic AMOLED 2X 120Hz",
            "SEC_AMB681AU01",
            "Corning Gorilla Armor anti-reflective panel verified",
        ),
        battery: original_item(
            "Dual-Cell 5000mAh",
            "AA1R109AS/7-B",
            "Samsung fuel gauge authentic",
        ),
        rear_camera: original_item(
            "200MP ISOCELL HP2 Quad-Cam",
            "CAM_SEC_HP2_2024",
            "Periscope 5x and 3x telephoto aligned",
        ),
        front_camera: original_item(
            "12MP Dual Pixel AF",
            "CAM_SEC_3LU_FRONT",
            "OEM front camera verified",
        ),
        biometrics: original_item(
            "Qualcomm 3D Sonic Gen 2 Ultrasonic",
            "QC_SONIC_MAX_01",
            "Knox TrustZone ultrasonic driver active",
        ),
        logic_board: original_item(
            "Main PCB SM-S928B",
            "RF8X10992AB",
            "Snapdragon 8 Gen 3 for Galaxy verified",
        ),
    };

    let security_locks = SecurityLockStatus {
        icloud_fmi_locked: false,
        fmi_account_masked: None,
        fmi_on: false,
        mdm_enrolled: false,
        carrier_locked: false,
        carrier_name: Some("Unlocked".into()),
        knox_tripped: false, // 0x0 Knox Warranty intact
        frp_locked: false,
        bootloader_unlocked: false,
        is_rooted_or_jailbroken: false,
    };

    let mut hardware_tests = HashMap::new();
    for t in simulated_standard_tests() {
        hardware_tests.insert(t.key.clone(), t);
    }

    let grading = calculate_device_grading(&battery, &parts_audit, &security_locks, &hardware_tests);

    FullDeviceDiagnosticReport {
        device_id: "demo-s24-ultra".into(),
        device_name: "Galaxy S24 Ultra".into(),
        brand: "Samsung".into(),
        model: "SM-S928B/DS".into(),
        platform: "Android".into(),
        os_version: "Android 14 (One UI 6.1)".into(),
        imei1: Some("352109840192841".into()),
        imei2: Some("352109840192842".into()),
        serial_number: Some("R5CW109VXYM".into()),
        baseband_version: Some("S928BXXU1AXB5".into()),
        cpu_architecture: "Snapdragon 8 Gen 3 for Galaxy (Octa-core 3.39GHz)".into(),
        ram_gb: 12.0,
        storage_total_bytes: 512 * 1024 * 1024 * 1024,
        storage_free_bytes: 388 * 1024 * 1024 * 1024,
        battery,
        parts_audit,
        security_locks,
        hardware_tests,
        grading,
    }
}

fn generate_huawei_p60_pro() -> FullDeviceDiagnosticReport {
    let battery = BatteryGasGauge {
        health_percentage: 84,
        cycle_count: 480,
        design_capacity_mah: 4815,
        actual_capacity_mah: 4050,
        temperature_celsius: 31.0,
        serial_number: Some("HB486586ECW".into()),
        manufacturer: Some("Huawei Technologies Co., Ltd.".into()),
        status: ComponentStatus::Original,
        current_charge_percentage: Some(42),
        is_charging: Some(false),
    };

    let parts_audit = PartsAuditReport {
        screen: PartAuditItem {
            name: "Quad-Curve Kunlun OLED".into(),
            status: ComponentStatus::ReplacedThirdParty, // Third party aftermarket screen!
            read_serial: Some("AFTERMARKET_OLED_BOE_99".into()),
            factory_serial: Some("HW_KUNLUN_019482".into()),
            is_original: false,
            note: Some("Aftermarket display replacement detected; lacks high-frequency PWM calibration".into()),
        },
        battery: PartAuditItem {
            name: "SuperCharge 88W Battery".into(),
            status: ComponentStatus::Original,
            read_serial: Some("HB486586ECW".into()),
            factory_serial: Some("HB486586ECW".into()),
            is_original: true,
            note: Some("Factory battery unit intact".into()),
        },
        rear_camera: PartAuditItem {
            name: "Ultra Lighting XMAGE 48MP".into(),
            status: ComponentStatus::Original,
            read_serial: Some("XMAGE_RYYB_F14".into()),
            factory_serial: Some("XMAGE_RYYB_F14".into()),
            is_original: true,
            note: Some("Variable mechanical aperture F1.4-F4.0 calibrated".into()),
        },
        front_camera: PartAuditItem {
            name: "13MP Ultra-Wide Selfie".into(),
            status: ComponentStatus::Original,
            read_serial: Some("HW_FRONT_13M".into()),
            factory_serial: Some("HW_FRONT_13M".into()),
            is_original: true,
            note: Some("Front optics verified".into()),
        },
        biometrics: PartAuditItem {
            name: "In-Screen Optical Fingerprint".into(),
            status: ComponentStatus::Original,
            read_serial: Some("HW_FP_OPTICAL".into()),
            factory_serial: Some("HW_FP_OPTICAL".into()),
            is_original: true,
            note: Some("TEE biometric enclave authenticated".into()),
        },
        logic_board: PartAuditItem {
            name: "Motherboard (MNA-AL00)".into(),
            status: ComponentStatus::Original,
            read_serial: Some("HW2023P60MNA".into()),
            factory_serial: Some("HW2023P60MNA".into()),
            is_original: true,
            note: Some("Qualcomm Snapdragon 8+ Gen 1 4G".into()),
        },
    };

    let security_locks = SecurityLockStatus {
        icloud_fmi_locked: false,
        fmi_account_masked: None,
        fmi_on: false,
        mdm_enrolled: false,
        carrier_locked: false,
        carrier_name: Some("Unlocked".into()),
        knox_tripped: false,
        frp_locked: false,
        bootloader_unlocked: false,
        is_rooted_or_jailbroken: false,
    };

    let mut hardware_tests = HashMap::new();
    for t in simulated_standard_tests() {
        hardware_tests.insert(t.key.clone(), t);
    }

    let grading = calculate_device_grading(&battery, &parts_audit, &security_locks, &hardware_tests);

    FullDeviceDiagnosticReport {
        device_id: "demo-huawei-p60".into(),
        device_name: "HUAWEI P60 Pro".into(),
        brand: "Huawei".into(),
        model: "MNA-AL00 (Rococo Pearl)".into(),
        platform: "HarmonyOS".into(),
        os_version: "HarmonyOS 4.2.0.120".into(),
        imei1: Some("864910293849102".into()),
        imei2: Some("864910293849103".into()),
        serial_number: Some("HWP60P9019X8".into()),
        baseband_version: Some("21C20B780S000C000".into()),
        cpu_architecture: "Snapdragon 8+ Gen 1 (ARMv8.4)".into(),
        ram_gb: 12.0,
        storage_total_bytes: 512 * 1024 * 1024 * 1024,
        storage_free_bytes: 410 * 1024 * 1024 * 1024,
        battery,
        parts_audit,
        security_locks,
        hardware_tests,
        grading,
    }
}

fn generate_defective_iphone() -> FullDeviceDiagnosticReport {
    let battery = BatteryGasGauge {
        health_percentage: 73,
        cycle_count: 1140,
        design_capacity_mah: 3095,
        actual_capacity_mah: 2260,
        temperature_celsius: 36.8,
        serial_number: Some("F8Y11029481A".into()),
        manufacturer: Some("Desay (Degraded)".into()),
        status: ComponentStatus::Defective,
        current_charge_percentage: Some(19),
        is_charging: Some(false),
    };

    let parts_audit = PartsAuditReport {
        screen: PartAuditItem {
            name: "Super Retina OLED".into(),
            status: ComponentStatus::Defective,
            read_serial: Some("BAD_SERIAL_000".into()),
            factory_serial: Some("G9N12093841A".into()),
            is_original: false,
            note: Some("Digitizer dead lines and digitizer IC desoldered".into()),
        },
        battery: PartAuditItem {
            name: "Battery Pack".into(),
            status: ComponentStatus::Defective,
            read_serial: Some("F8Y11029481A".into()),
            factory_serial: Some("F8Y11029481A".into()),
            is_original: true,
            note: Some("Cycle count exceeded 1000; internal resistance high".into()),
        },
        rear_camera: PartAuditItem {
            name: "Triple Camera Module".into(),
            status: ComponentStatus::Original,
            read_serial: Some("C111293841A".into()),
            factory_serial: Some("C111293841A".into()),
            is_original: true,
            note: None,
        },
        front_camera: PartAuditItem {
            name: "Front Camera".into(),
            status: ComponentStatus::Original,
            read_serial: Some("DN611293841A".into()),
            factory_serial: Some("DN611293841A".into()),
            is_original: true,
            note: None,
        },
        biometrics: PartAuditItem {
            name: "Face ID TrueDepth".into(),
            status: ComponentStatus::Defective,
            read_serial: None,
            factory_serial: Some("FACEID_CHIP_01".into()),
            is_original: false,
            note: Some("Dot Projector cracked; Face ID disabled by iOS".into()),
        },
        logic_board: PartAuditItem {
            name: "Logic Board (A2638)".into(),
            status: ComponentStatus::Original,
            read_serial: Some("DN6G102941".into()),
            factory_serial: Some("DN6G102941".into()),
            is_original: true,
            note: None,
        },
    };

    let security_locks = SecurityLockStatus {
        icloud_fmi_locked: true, // iCloud Locked!
        fmi_account_masked: Some("u•••••@icloud.com".into()),
        fmi_on: true,
        mdm_enrolled: false,
        carrier_locked: true,
        carrier_name: Some("Verizon US (Locked)".into()),
        knox_tripped: false,
        frp_locked: false,
        bootloader_unlocked: false,
        is_rooted_or_jailbroken: false,
    };

    let mut hardware_tests = HashMap::new();
    for mut t in simulated_standard_tests() {
        if t.key == "touch_matrix" || t.key == "display_rgbw" || t.key == "face_id_or_touch_id" {
            t.passed = false;
            t.details = Some("Hardware sensor unreadable or damaged".into());
        }
        hardware_tests.insert(t.key.clone(), t);
    }

    let grading = calculate_device_grading(&battery, &parts_audit, &security_locks, &hardware_tests);

    FullDeviceDiagnosticReport {
        device_id: "demo-defective-lock".into(),
        device_name: "iPhone 13 Pro (Defective)".into(),
        brand: "Apple".into(),
        model: "iPhone 13 Pro (A2638)".into(),
        platform: "iOS".into(),
        os_version: "iOS 16.4".into(),
        imei1: Some("358102938410293".into()),
        imei2: None,
        serial_number: Some("DN6G9102X901".into()),
        baseband_version: Some("1.70.01".into()),
        cpu_architecture: "Apple A15 Bionic".into(),
        ram_gb: 6.0,
        storage_total_bytes: 128 * 1024 * 1024 * 1024,
        storage_free_bytes: 20 * 1024 * 1024 * 1024,
        battery,
        parts_audit,
        security_locks,
        hardware_tests,
        grading,
    }
}

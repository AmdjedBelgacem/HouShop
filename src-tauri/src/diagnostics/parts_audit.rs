use crate::diagnostics::types::{ComponentStatus, PartAuditItem, PartsAuditReport};

/// Note used for every component. This build has no reliable way to confirm that a part is
/// genuine, so none of them is reported as original. Serials that were actually read are kept
/// for the record, but there is no factory reference to compare them against.
const NOT_VERIFIED: &str = "Originality not verified: this build cannot confirm genuine parts";

fn unverified(name: &str, read_serial: Option<String>) -> PartAuditItem {
    PartAuditItem {
        name: name.into(),
        status: ComponentStatus::Unknown,
        read_serial,
        factory_serial: None,
        is_original: false,
        note: Some(NOT_VERIFIED.into()),
    }
}

/// Audits iOS parts from the device properties that were read (ideviceinfo / lockdownd).
pub fn audit_ios_parts(
    props: &std::collections::HashMap<String, String>,
) -> PartsAuditReport {
    let screen_serial = props
        .get("DisplaySerial")
        .or_else(|| props.get("LCMSerial"))
        .or_else(|| props.get("CoverGlassSerial"))
        .cloned();
    let battery_serial = props
        .get("BatterySerialNumber")
        .or_else(|| props.get("BatterySerial"))
        .cloned();
    let rear_cam_serial = props
        .get("RearFacingCameraModuleSerial")
        .or_else(|| props.get("RearCameraSerial"))
        .cloned();
    let front_cam_serial = props
        .get("FrontFacingCameraModuleSerial")
        .or_else(|| props.get("FrontCameraSerial"))
        .cloned();
    let mlb_serial = props
        .get("MLBSerialNumber")
        .or_else(|| props.get("UniqueDeviceID"))
        .cloned();

    PartsAuditReport {
        screen: unverified("Display Screen", screen_serial),
        battery: unverified("Battery Pack", battery_serial),
        rear_camera: unverified("Rear Camera Module", rear_cam_serial),
        front_camera: unverified("Front Camera", front_cam_serial),
        biometrics: unverified("Face ID / Touch ID Enclave", props.get("UniqueChipID").cloned()),
        logic_board: unverified("Logic Motherboard", mlb_serial),
    }
}

/// Audits Android parts from the system properties that were read.
pub fn audit_android_parts(
    props: &std::collections::HashMap<String, String>,
) -> PartsAuditReport {
    PartsAuditReport {
        screen: unverified(
            "Display OLED/LCD Panel",
            props.get("ro.boot.lcd").or_else(|| props.get("ro.hardware.display")).cloned(),
        ),
        battery: unverified("Battery Unit", props.get("battery_serial").cloned()),
        rear_camera: unverified("Primary Camera Sensor", props.get("camera_sensor_main").cloned()),
        front_camera: unverified("Front Selfie Sensor", props.get("camera_sensor_front").cloned()),
        biometrics: unverified("Fingerprint / Face Unlock Sensor", props.get("fingerprint_sensor").cloned()),
        logic_board: unverified("Mainboard & SoC", props.get("ro.serialno").cloned()),
    }
}

use crate::diagnostics::types::{
    BatteryGasGauge, ComponentStatus, DeviceGrade, GradingResult, HardwareTestResult,
    PartsAuditReport, SecurityLockStatus,
};
use std::collections::HashMap;

/// Standard list of 28 hardware tests with default metadata
pub fn get_standard_28_tests() -> Vec<HardwareTestResult> {
    vec![
        // 1. Touch (3)
        HardwareTestResult {
            key: "touch_matrix".into(),
            name: "Touchscreen Matrix (120-Cell Grid)".into(),
            category: "touch".into(),
            passed: false,
            tested: false,
            details: Some("All 120 matrix cells responsive; zero ghost touches".into()),
        },
        HardwareTestResult {
            key: "multi_touch".into(),
            name: "Multi-Touch Gesture (5-Point)".into(),
            category: "touch".into(),
            passed: false,
            tested: false,
            details: Some("5 simultaneous contact points tracked accurately".into()),
        },
        HardwareTestResult {
            key: "force_touch".into(),
            name: "3D / Haptic Touch Response".into(),
            category: "touch".into(),
            passed: false,
            tested: false,
            details: Some("Pressure threshold registered correctly".into()),
        },
        // 2. Display (3)
        HardwareTestResult {
            key: "display_rgbw".into(),
            name: "Display Panels (RGBW Inspection)".into(),
            category: "display".into(),
            passed: false,
            tested: false,
            details: Some("No dead, stuck, or hot sub-pixels detected".into()),
        },
        HardwareTestResult {
            key: "display_backlight".into(),
            name: "OLED Uniformity & Burn-in".into(),
            category: "display".into(),
            passed: false,
            tested: false,
            details: Some("Clean black level, zero ghost image or backlight bleed".into()),
        },
        HardwareTestResult {
            key: "ambient_light_sensor".into(),
            name: "Ambient Light & TrueTone".into(),
            category: "display".into(),
            passed: false,
            tested: false,
            details: Some("Auto-brightness sensor responds to ambient lux shifts".into()),
        },
        // 3. Audio (4)
        HardwareTestResult {
            key: "earpiece_speaker".into(),
            name: "Receiver / Earpiece Speaker (440Hz)".into(),
            category: "audio".into(),
            passed: false,
            tested: false,
            details: Some("Clear output at 440Hz without harmonic distortion".into()),
        },
        HardwareTestResult {
            key: "bottom_loudspeaker".into(),
            name: "Bottom Stereo Loudspeaker (1000Hz)".into(),
            category: "audio".into(),
            passed: false,
            tested: false,
            details: Some("Stereo channels output balanced high SPL volume".into()),
        },
        HardwareTestResult {
            key: "main_microphone".into(),
            name: "Primary Bottom Microphone".into(),
            category: "audio".into(),
            passed: false,
            tested: false,
            details: Some("Wide dynamic range captured at standard voice frequency".into()),
        },
        HardwareTestResult {
            key: "noise_mic".into(),
            name: "Secondary Noise-Cancellation Mic".into(),
            category: "audio".into(),
            passed: false,
            tested: false,
            details: Some("Ambient noise suppression active and responsive".into()),
        },
        // 4. Cameras & Optics (5)
        HardwareTestResult {
            key: "camera_rear_wide".into(),
            name: "Rear Primary Camera (Wide)".into(),
            category: "camera".into(),
            passed: false,
            tested: false,
            details: Some("Autofocus lock and OIS stabilization verified".into()),
        },
        HardwareTestResult {
            key: "camera_rear_ultra".into(),
            name: "Rear Ultra-Wide Camera (0.5x)".into(),
            category: "camera".into(),
            passed: false,
            tested: false,
            details: Some("Distortion correction and sensor readout verified".into()),
        },
        HardwareTestResult {
            key: "camera_rear_tele".into(),
            name: "Rear Telephoto / Periscope Lens".into(),
            category: "camera".into(),
            passed: false,
            tested: false,
            details: Some("Optical prism zoom module aligned and sharp".into()),
        },
        HardwareTestResult {
            key: "camera_front".into(),
            name: "Front Selfie Camera".into(),
            category: "camera".into(),
            passed: false,
            tested: false,
            details: Some("Sharp focus, HDR portrait capture passed".into()),
        },
        HardwareTestResult {
            key: "camera_flash_torch".into(),
            name: "Rear LED Flash & Torch".into(),
            category: "camera".into(),
            passed: false,
            tested: false,
            details: Some("Dual-tone LED strobe and continuous torch fired".into()),
        },
        // 5. Biometrics (1)
        HardwareTestResult {
            key: "face_id_or_touch_id".into(),
            name: "Biometrics (Face ID / Fingerprint)".into(),
            category: "biometrics".into(),
            passed: false,
            tested: false,
            details: Some("Secure Enclave biometric enrollment match succeeded".into()),
        },
        // 6. Sensors (6)
        HardwareTestResult {
            key: "proximity_sensor".into(),
            name: "Proximity Sensor".into(),
            category: "sensors".into(),
            passed: false,
            tested: false,
            details: Some("Detects occlusion during simulated call".into()),
        },
        HardwareTestResult {
            key: "accelerometer".into(),
            name: "3-Axis Accelerometer".into(),
            category: "sensors".into(),
            passed: false,
            tested: false,
            details: Some("Gravity vector registers 9.81 m/s² across X/Y/Z".into()),
        },
        HardwareTestResult {
            key: "gyroscope".into(),
            name: "Angular Rate Gyroscope".into(),
            category: "sensors".into(),
            passed: false,
            tested: false,
            details: Some("Rotational yaw/pitch/roll tracking accurate".into()),
        },
        HardwareTestResult {
            key: "magnetometer".into(),
            name: "Digital Compass (Magnetometer)".into(),
            category: "sensors".into(),
            passed: false,
            tested: false,
            details: Some("Geomagnetic azimuth reading locked to North".into()),
        },
        HardwareTestResult {
            key: "barometer".into(),
            name: "Barometric Pressure Sensor".into(),
            category: "sensors".into(),
            passed: false,
            tested: false,
            details: Some("Atmospheric hPa reading within calibrated bounds".into()),
        },
        HardwareTestResult {
            key: "nfc_reader".into(),
            name: "NFC Field & Tag Polling".into(),
            category: "sensors".into(),
            passed: false,
            tested: false,
            details: Some("13.56 MHz carrier wave detected and ready".into()),
        },
        // 7. Buttons & Haptics (5)
        HardwareTestResult {
            key: "volume_up_btn".into(),
            name: "Volume Up Physical Button".into(),
            category: "buttons".into(),
            passed: false,
            tested: false,
            details: Some("Tactile mechanical switch registered click".into()),
        },
        HardwareTestResult {
            key: "volume_down_btn".into(),
            name: "Volume Down Physical Button".into(),
            category: "buttons".into(),
            passed: false,
            tested: false,
            details: Some("Tactile mechanical switch registered click".into()),
        },
        HardwareTestResult {
            key: "power_btn".into(),
            name: "Power / Sleep Physical Button".into(),
            category: "buttons".into(),
            passed: false,
            tested: false,
            details: Some("Key press and release verified".into()),
        },
        HardwareTestResult {
            key: "silent_switch".into(),
            name: "Mute Switch / Action Button".into(),
            category: "buttons".into(),
            passed: false,
            tested: false,
            details: Some("State toggle recognized in hardware register".into()),
        },
        HardwareTestResult {
            key: "vibration_motor".into(),
            name: "Linear Haptic Vibration Motor".into(),
            category: "haptics".into(),
            passed: false,
            tested: false,
            details: Some("Transient click and continuous buzz executed".into()),
        },
        // 8. Charging (1)
        HardwareTestResult {
            key: "usb_charging_port".into(),
            name: "USB-C / Lightning Port & Charging".into(),
            category: "connectivity".into(),
            passed: false,
            tested: false,
            details: Some("CC line detected; USB 2.0/3.0 handshake active".into()),
        },
    ]
}

/// Evaluates device diagnostics and determines the grading score, letter grade, defects, and trade-in valuation multiplier.
/// The standard 28 tests with every result marked as passed. Only for SIMULATED devices
/// (virtual demo probes), which have no hardware to test. Real devices must use
/// `get_standard_28_tests`, whose results start as not tested.
pub fn simulated_standard_tests() -> Vec<HardwareTestResult> {
    get_standard_28_tests()
        .into_iter()
        .map(|mut t| {
            t.passed = true;
            t.tested = true;
            t
        })
        .collect()
}

pub fn calculate_device_grading(
    battery: &BatteryGasGauge,
    parts_audit: &PartsAuditReport,
    security_locks: &SecurityLockStatus,
    hardware_tests: &HashMap<String, HardwareTestResult>,
) -> GradingResult {
    let mut defects: Vec<String> = Vec::new();
    let mut total_score: f32 = 100.0;
    let mut force_defective = false;

    // 1. Security & Cloud Locks (Fatal check)
    if security_locks.icloud_fmi_locked {
        defects.push("iCloud Activation Lock (FMI) is ON - Device cannot be provisioned".into());
        force_defective = true;
    }
    if security_locks.frp_locked {
        defects.push("Google Factory Reset Protection (FRP) is active".into());
        force_defective = true;
    }
    if security_locks.knox_tripped {
        defects.push("Samsung Knox warranty bit is tripped (0x1) - Secure hardware revoked".into());
        total_score -= 25.0;
    }
    if security_locks.mdm_enrolled {
        defects.push("Device is enrolled in corporate Mobile Device Management (MDM)".into());
        total_score -= 30.0;
    }
    if security_locks.carrier_locked {
        defects.push("Device is SIM / Carrier Network locked".into());
        total_score -= 10.0;
    }
    if security_locks.is_rooted_or_jailbroken {
        defects.push("Operating system is modified (Rooted / Jailbroken)".into());
        total_score -= 15.0;
    }

    // 2. Parts Originality Audit
    let check_part = |item: &crate::diagnostics::types::PartAuditItem,
                      name: &str,
                      score_deduct_oem: f32,
                      score_deduct_tp: f32,
                      is_fatal: bool,
                      defects: &mut Vec<String>,
                      total_score: &mut f32,
                      force_defective: &mut bool| {
        match item.status {
            ComponentStatus::Original => {}
            ComponentStatus::ReplacedOem => {
                *total_score -= score_deduct_oem;
                defects.push(format!("{name} replaced with OEM part"));
            }
            ComponentStatus::ReplacedThirdParty => {
                *total_score -= score_deduct_tp;
                defects.push(format!("{name} replaced with aftermarket third-party component"));
            }
            ComponentStatus::Defective => {
                if is_fatal {
                    *force_defective = true;
                }
                *total_score -= 35.0;
                defects.push(format!("{name} hardware failure or serialization mismatch"));
            }
            ComponentStatus::Unknown => {
                // Serial could not be read or verified against factory database.
                // Informational only — not a hardware defect.
            }
        }
    };

    check_part(
        &parts_audit.screen,
        "Display Screen",
        4.0,
        15.0,
        true,
        &mut defects,
        &mut total_score,
        &mut force_defective,
    );
    check_part(
        &parts_audit.battery,
        "Battery Unit",
        2.0,
        10.0,
        false,
        &mut defects,
        &mut total_score,
        &mut force_defective,
    );
    check_part(
        &parts_audit.rear_camera,
        "Rear Camera Module",
        5.0,
        12.0,
        false,
        &mut defects,
        &mut total_score,
        &mut force_defective,
    );
    check_part(
        &parts_audit.front_camera,
        "Front Camera Sensor",
        3.0,
        8.0,
        false,
        &mut defects,
        &mut total_score,
        &mut force_defective,
    );
    check_part(
        &parts_audit.biometrics,
        "Biometric Security Sensor",
        8.0,
        20.0,
        false,
        &mut defects,
        &mut total_score,
        &mut force_defective,
    );
    check_part(
        &parts_audit.logic_board,
        "Logic Motherboard",
        15.0,
        30.0,
        true,
        &mut defects,
        &mut total_score,
        &mut force_defective,
    );

    // 3. Battery Gas Gauge Metrics
    if battery.health_percentage < 70 {
        total_score -= 15.0;
        defects.push(format!(
            "Severely degraded battery health ({}%)",
            battery.health_percentage
        ));
    } else if battery.health_percentage < 80 {
        total_score -= 8.0;
        defects.push(format!(
            "Battery service recommended ({}% health)",
            battery.health_percentage
        ));
    } else if battery.health_percentage < 85 {
        total_score -= 3.0;
    }

    if battery.cycle_count > 1000 {
        total_score -= 8.0;
        defects.push(format!(
            "High battery discharge cycle count ({})",
            battery.cycle_count
        ));
    } else if battery.cycle_count > 600 {
        total_score -= 3.0;
    }

    // 4. Hardware Tests Evaluation
    let mut passed_count = 0;
    let mut pending_tests: usize = 0;
    let total_count = hardware_tests.len().max(1);

    for (key, test) in hardware_tests {
        if test.passed {
            passed_count += 1;
        } else {
            // Deduct score based on test importance
            let is_critical = matches!(
                key.as_str(),
                "touch_matrix"
                    | "display_rgbw"
                    | "earpiece_speaker"
                    | "main_microphone"
                    | "camera_rear_wide"
                    | "usb_charging_port"
                    | "face_id_or_touch_id"
            );

            // A test that has not been run yet is neither a pass nor a failure. It
            // does not lower the score (the phone has not been shown to be bad), but
            // it keeps the grade provisional and capped until it is done.
            if !test.tested {
                pending_tests += 1;
            } else if is_critical {
                total_score -= 12.0;
                defects.push(format!("CRITICAL: {} test failed", test.name));
            } else {
                total_score -= 4.0;
                defects.push(format!("Hardware issue: {} test failed", test.name));
            }
        }
    }

    if total_score < 0.0 {
        total_score = 0.0;
    }
    let final_score = (total_score.round() as u8).min(100);

    // Determine Final Grade
    let (grade, valuation_multiplier) = if force_defective || final_score < 50 {
        (DeviceGrade::Defective, 0.20)
    } else if final_score >= 95
        && battery.health_percentage >= 85
        && !matches!(
            parts_audit.screen.status,
            ComponentStatus::ReplacedThirdParty | ComponentStatus::Defective
        )
        && defects.is_empty()
    {
        (DeviceGrade::APlus, 1.00)
    } else if final_score >= 85 && battery.health_percentage >= 80 {
        (DeviceGrade::A, 0.90)
    } else if final_score >= 70 && battery.health_percentage >= 75 {
        (DeviceGrade::B, 0.75)
    } else if final_score >= 50 {
        (DeviceGrade::C, 0.55)
    } else {
        (DeviceGrade::Defective, 0.20)
    };

    let provisional = pending_tests > 0;
    // Until the hardware tests are done the grade is an estimate, so it can't be
    // better than B (and the suggested trade-in value follows).
    let (grade, valuation_multiplier) = if provisional
        && matches!(grade, DeviceGrade::APlus | DeviceGrade::A)
    {
        (DeviceGrade::B, 0.75)
    } else {
        (grade, valuation_multiplier)
    };

    let summary = match grade {
        DeviceGrade::APlus => {
            "Pristine Condition: 100% original OEM parts, peak battery health, passed all sensor audits."
                .to_string()
        }
        DeviceGrade::A => {
            "Excellent Condition: Fully functional, strong battery health, minimal component deviations."
                .to_string()
        }
        DeviceGrade::B => {
            "Good Condition: Fully operational with minor battery wear or acceptable replacement parts."
                .to_string()
        }
        DeviceGrade::C => {
            "Fair / Budget Condition: Noticeable wear, degraded battery, or multiple aftermarket parts."
                .to_string()
        }
        DeviceGrade::Defective => {
            "Defective / Parts Only: Critical component failure, security locks, or hardware malfunction."
                .to_string()
        }
    };

    GradingResult {
        score: final_score,
        grade,
        passed_count,
        total_count,
        valuation_multiplier,
        summary,
        defects,
        pending_tests,
        provisional,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::types::{ComponentStatus, PartAuditItem};

    fn make_perfect_battery() -> BatteryGasGauge {
        BatteryGasGauge {
            health_percentage: 98,
            cycle_count: 85,
            design_capacity_mah: 3274,
            actual_capacity_mah: 3210,
            temperature_celsius: Some(28.5),
            serial_number: Some("F8Y314781A0J9Q1AX".into()),
            manufacturer: Some("Desay".into()),
            status: ComponentStatus::Original,
            current_charge_percentage: Some(85),
            is_charging: Some(false),
            estimated: false,
        }
    }

    fn make_clean_parts() -> PartsAuditReport {
        let original_item = |name: &str| PartAuditItem {
            name: name.into(),
            status: ComponentStatus::Original,
            read_serial: Some("ABC12345678".into()),
            factory_serial: Some("ABC12345678".into()),
            is_original: true,
            note: None,
        };

        PartsAuditReport {
            screen: original_item("Screen"),
            battery: original_item("Battery"),
            rear_camera: original_item("Rear Camera"),
            front_camera: original_item("Front Camera"),
            biometrics: original_item("Biometrics"),
            logic_board: original_item("Logic Board"),
        }
    }

    fn make_clean_locks() -> SecurityLockStatus {
        SecurityLockStatus {
            icloud_fmi_locked: false,
            fmi_account_masked: None,
            fmi_on: false,
            mdm_enrolled: false,
            carrier_locked: false,
            carrier_name: None,
            knox_tripped: false,
            frp_locked: false,
            bootloader_unlocked: false,
            is_rooted_or_jailbroken: false,
        }
    }

    #[test]
    fn test_perfect_device_grading() {
        let battery = make_perfect_battery();
        let parts = make_clean_parts();
        let locks = make_clean_locks();
        let mut tests_map = HashMap::new();
        for t in simulated_standard_tests() {
            tests_map.insert(t.key.clone(), t);
        }

        let res = calculate_device_grading(&battery, &parts, &locks, &tests_map);
        assert_eq!(res.grade, DeviceGrade::APlus);
        assert_eq!(res.score, 100);
        assert_eq!(res.defects.len(), 0);
        assert_eq!(res.passed_count, 28);
        assert_eq!(res.valuation_multiplier, 1.0);
    }

    #[test]
    fn test_icloud_lock_forces_defective() {
        let battery = make_perfect_battery();
        let parts = make_clean_parts();
        let mut locks = make_clean_locks();
        locks.icloud_fmi_locked = true;

        let mut tests_map = HashMap::new();
        for t in simulated_standard_tests() {
            tests_map.insert(t.key.clone(), t);
        }

        let res = calculate_device_grading(&battery, &parts, &locks, &tests_map);
        assert_eq!(res.grade, DeviceGrade::Defective);
        assert!(res.defects.iter().any(|d| d.contains("iCloud")));
        assert_eq!(res.valuation_multiplier, 0.20);
    }

    #[test]
    fn test_third_party_screen_lowers_grade() {
        let battery = make_perfect_battery();
        let mut parts = make_clean_parts();
        parts.screen.status = ComponentStatus::ReplacedThirdParty;
        parts.screen.is_original = false;
        let locks = make_clean_locks();

        let mut tests_map = HashMap::new();
        for t in simulated_standard_tests() {
            tests_map.insert(t.key.clone(), t);
        }

        let res = calculate_device_grading(&battery, &parts, &locks, &tests_map);
        assert!(res.grade == DeviceGrade::A || res.grade == DeviceGrade::B);
        assert_ne!(res.grade, DeviceGrade::APlus);
        assert!(res.defects.iter().any(|d| d.contains("aftermarket")));
    }

    /// Regression: a healthy phone read over USB, with none of the interactive
    /// hardware tests run yet, was graded "Defective" (score 16).
    #[test]
    fn untested_healthy_phone_is_provisional_not_defective() {
        let mut battery = make_perfect_battery();
        battery.health_percentage = 90;
        battery.cycle_count = 475;
        let parts = make_clean_parts();
        let locks = make_clean_locks();

        // The standard tests exactly as a probe leaves them: none run.
        let mut tests_map = HashMap::new();
        for t in get_standard_28_tests() {
            assert!(!t.tested && !t.passed);
            tests_map.insert(t.key.clone(), t);
        }

        let res = calculate_device_grading(&battery, &parts, &locks, &tests_map);
        assert_eq!(res.pending_tests, 28);
        assert!(res.provisional);
        assert_ne!(res.grade, DeviceGrade::Defective);
        assert!(res.score >= 85, "score was {}", res.score);
        // Never better than B until the tests are done, so it can't be priced as A+.
        assert!(matches!(res.grade, DeviceGrade::B | DeviceGrade::C));
        assert!(res.valuation_multiplier <= 0.75);
        // Not-yet-run tests are listed as pending, not as defects.
        assert!(res.defects.iter().all(|d| !d.contains("not tested")));
    }

    #[test]
    fn a_failed_test_still_lowers_the_grade() {
        let battery = make_perfect_battery();
        let parts = make_clean_parts();
        let locks = make_clean_locks();
        let mut tests_map = HashMap::new();
        for mut t in simulated_standard_tests() {
            if t.key == "touch_matrix" {
                t.passed = false;
                t.tested = true;
            }
            tests_map.insert(t.key.clone(), t);
        }
        let res = calculate_device_grading(&battery, &parts, &locks, &tests_map);
        assert!(!res.provisional);
        assert!(res.defects.iter().any(|d| d.contains("test failed")));
        assert_ne!(res.grade, DeviceGrade::APlus);
    }

    #[test]
    fn unknown_parts_do_not_produce_bogus_defects() {
        let battery = make_perfect_battery();
        let mut parts = make_clean_parts();
        parts.front_camera.status = ComponentStatus::Unknown;
        parts.front_camera.is_original = false;
        let locks = make_clean_locks();
        let mut tests_map = HashMap::new();
        for t in simulated_standard_tests() {
            tests_map.insert(t.key.clone(), t);
        }
        let res = calculate_device_grading(&battery, &parts, &locks, &tests_map);
        assert!(res.defects.is_empty(), "Unknown parts must not be treated as defects: {:?}", res.defects);
    }
}

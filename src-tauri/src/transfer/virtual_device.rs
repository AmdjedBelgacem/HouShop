use super::normalizer::{
    CanonicalCallLog, CanonicalContact, CanonicalMessage, ContactAddress, ContactEmail,
    ContactPhone,
};
use super::types::{
    ConnectionType, DeviceCapabilities, DeviceConnectionState, DeviceInfo, DevicePlatform,
    TransferCategory,
};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

pub struct VirtualDeviceProvider;

impl VirtualDeviceProvider {
    /// Returns a set of realistic simulated test phones for shop demonstration and automated testing.
    pub fn get_virtual_devices() -> Vec<DeviceInfo> {
        vec![
            DeviceInfo {
                id: "virt-samsung-s24".to_string(),
                name: "Samsung Galaxy S24 Ultra (Demo)".to_string(),
                brand: "Samsung".to_string(),
                model: "SM-S928B".to_string(),
                platform: DevicePlatform::Android,
                os_version: "Android 14 (One UI 6.1)".to_string(),
                connection_type: ConnectionType::Virtual,
                connection_state: DeviceConnectionState::Connected,
                battery_level: Some(88),
                is_charging: Some(true),
                storage_total_bytes: 256 * 1024 * 1024 * 1024,
                storage_free_bytes: 142 * 1024 * 1024 * 1024,
                capabilities: DeviceCapabilities::default(),
                is_virtual: true,
            },
            DeviceInfo {
                id: "virt-apple-iphone15".to_string(),
                name: "iPhone 15 Pro Max (Demo)".to_string(),
                brand: "Apple".to_string(),
                model: "A3106".to_string(),
                platform: DevicePlatform::Ios,
                os_version: "iOS 17.5.1".to_string(),
                connection_type: ConnectionType::Virtual,
                connection_state: DeviceConnectionState::Connected,
                battery_level: Some(94),
                is_charging: Some(false),
                storage_total_bytes: 512 * 1024 * 1024 * 1024,
                storage_free_bytes: 388 * 1024 * 1024 * 1024,
                capabilities: DeviceCapabilities {
                    can_read_contacts: true,
                    can_write_contacts: true,
                    can_read_messages: true,
                    can_write_messages: false, // iOS security sandbox
                    can_read_calls: true,
                    can_write_calls: false,
                    can_read_calendars: true,
                    can_write_calendars: true,
                    can_read_media: true,
                    can_write_media: true,
                },
                is_virtual: true,
            },
            DeviceInfo {
                id: "virt-huawei-p60".to_string(),
                name: "Huawei P60 Pro (Demo)".to_string(),
                brand: "Huawei".to_string(),
                model: "MNA-AL00".to_string(),
                platform: DevicePlatform::HarmonyOs,
                os_version: "HarmonyOS 4.2".to_string(),
                connection_type: ConnectionType::Virtual,
                connection_state: DeviceConnectionState::Connected,
                battery_level: Some(76),
                is_charging: Some(false),
                storage_total_bytes: 256 * 1024 * 1024 * 1024,
                storage_free_bytes: 98 * 1024 * 1024 * 1024,
                capabilities: DeviceCapabilities::default(),
                is_virtual: true,
            },
        ]
    }

    /// Scans simulated categories for a virtual device.
    pub fn scan_categories(device_id: &str) -> Vec<(TransferCategory, u64, u64)> {
        match device_id {
            "virt-apple-iphone15" => vec![
                (TransferCategory::Contacts, 342, 342 * 620),
                (TransferCategory::Photos, 58, 185 * 1024 * 1024),
                (TransferCategory::Videos, 8, 420 * 1024 * 1024),
                (TransferCategory::Audio, 14, 85 * 1024 * 1024),
                (TransferCategory::Documents, 24, 38 * 1024 * 1024),
                (TransferCategory::Calendars, 31, 45 * 1024),
                (TransferCategory::Messages, 0, 0),
                (TransferCategory::Calls, 0, 0),
            ],
            _ => vec![
                (TransferCategory::Contacts, 284, 284 * 512),
                (TransferCategory::Messages, 126, 126 * 340),
                (TransferCategory::Calls, 95, 95 * 210),
                (TransferCategory::Calendars, 18, 25 * 1024),
                (TransferCategory::Photos, 42, 120 * 1024 * 1024),
                (TransferCategory::Videos, 5, 290 * 1024 * 1024),
                (TransferCategory::Audio, 19, 95 * 1024 * 1024),
                (TransferCategory::Documents, 16, 22 * 1024 * 1024),
            ],
        }
    }

    /// Populates staging files for a virtual device extraction so the transfer pipeline can stream real files.
    pub fn stage_virtual_data(staging_dir: &Path, category: TransferCategory) -> Result<Vec<PathBuf>, String> {
        let cat_dir = staging_dir.join(category.as_str());
        fs::create_dir_all(&cat_dir).map_err(|e| e.to_string())?;
        let mut created_files = Vec::new();

        match category {
            TransferCategory::Contacts => {
                let vcf_path = cat_dir.join("contacts.vcf");
                let contacts = sample_contacts();
                let mut vcf_content = String::new();
                for c in &contacts {
                    vcf_content.push_str(&c.to_vcard());
                }
                fs::write(&vcf_path, vcf_content).map_err(|e| e.to_string())?;
                created_files.push(vcf_path);
            }
            TransferCategory::Messages => {
                let xml_path = cat_dir.join("sms_backup.xml");
                let msgs = sample_messages();
                let xml_content = CanonicalMessage::to_android_xml(&msgs);
                fs::write(&xml_path, xml_content).map_err(|e| e.to_string())?;
                created_files.push(xml_path);
            }
            TransferCategory::Calls => {
                let xml_path = cat_dir.join("calls_backup.xml");
                let calls = sample_calls();
                let xml_content = CanonicalCallLog::to_android_xml(&calls);
                fs::write(&xml_path, xml_content).map_err(|e| e.to_string())?;
                created_files.push(xml_path);
            }
            TransferCategory::Calendars => {
                let ics_path = cat_dir.join("calendar.ics");
                let ics_content = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//HouShop//Virtual//EN\r\nBEGIN:VEVENT\r\nUID:evt-001@houshop\r\nDTSTART:20261116T100000Z\r\nDTEND:20261116T110000Z\r\nSUMMARY:Customer Appointment\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
                fs::write(&ics_path, ics_content).map_err(|e| e.to_string())?;
                created_files.push(ics_path);
            }
            TransferCategory::Photos => {
                // Generate realistic sample JPEG image binaries (valid SOI, APP0 JFIF, DQT, and EOI tags)
                for i in 1..=4 {
                    let file_path = cat_dir.join(format!("IMG_20261116_{:04}.jpg", i));
                    let mut file = File::create(&file_path).map_err(|e| e.to_string())?;
                    // Minimal valid JPEG header
                    file.write_all(&[0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, b'J', b'F', b'I', b'F', 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00])
                        .map_err(|e| e.to_string())?;
                    // Pad with sample image data
                    let dummy_data = vec![0x7A; 100 * 1024]; // 100KB per sample image
                    file.write_all(&dummy_data).map_err(|e| e.to_string())?;
                    // EOI marker
                    file.write_all(&[0xFF, 0xD9]).map_err(|e| e.to_string())?;
                    created_files.push(file_path);
                }
            }
            TransferCategory::Videos => {
                let file_path = cat_dir.join("VID_20261116_0001.mp4");
                let mut file = File::create(&file_path).map_err(|e| e.to_string())?;
                // Minimal MP4 ftyp box header
                file.write_all(&[0x00, 0x00, 0x00, 0x18, b'f', b't', b'y', b'p', b'm', b'p', b'4', b'2', 0x00, 0x00, 0x00, 0x00, b'i', b's', b'o', b'm'])
                    .map_err(|e| e.to_string())?;
                let dummy_data = vec![0x33; 250 * 1024]; // 250KB sample video
                file.write_all(&dummy_data).map_err(|e| e.to_string())?;
                created_files.push(file_path);
            }
            TransferCategory::Audio => {
                let file_path = cat_dir.join("Voice_Recording_001.m4a");
                let mut file = File::create(&file_path).map_err(|e| e.to_string())?;
                file.write_all(&[0x00, 0x00, 0x00, 0x20, b'f', b't', b'y', b'p', b'M', b'4', b'A', b' '])
                    .map_err(|e| e.to_string())?;
                let dummy_data = vec![0x55; 80 * 1024];
                file.write_all(&dummy_data).map_err(|e| e.to_string())?;
                created_files.push(file_path);
            }
            TransferCategory::Documents => {
                let file_path = cat_dir.join("Customer_Receipt_Scan.pdf");
                let mut file = File::create(&file_path).map_err(|e| e.to_string())?;
                // Minimal valid PDF header
                file.write_all(b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\nxref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n115\n%%EOF")
                    .map_err(|e| e.to_string())?;
                created_files.push(file_path);
            }
        }

        Ok(created_files)
    }
}

fn sample_contacts() -> Vec<CanonicalContact> {
    vec![
        CanonicalContact {
            id: Some("1".to_string()),
            display_name: "Yassine Belgacem".to_string(),
            first_name: Some("Yassine".to_string()),
            last_name: Some("Belgacem".to_string()),
            middle_name: None,
            prefix: None,
            suffix: None,
            organization: Some("HouPhone Tech".to_string()),
            job_title: Some("Store Manager".to_string()),
            phones: vec![
                ContactPhone {
                    label: "MOBILE".to_string(),
                    number: "+213 550 11 22 33".to_string(),
                },
                ContactPhone {
                    label: "WORK".to_string(),
                    number: "+213 21 00 11 22".to_string(),
                },
            ],
            emails: vec![ContactEmail {
                label: "WORK".to_string(),
                address: "yassine@houphone.dz".to_string(),
            }],
            addresses: vec![ContactAddress {
                label: "WORK".to_string(),
                street: Some("12 Rue Didouche Mourad".to_string()),
                city: Some("Algiers".to_string()),
                state: Some("Algiers".to_string()),
                postal_code: Some("16000".to_string()),
                country: Some("Algeria".to_string()),
            }],
            note: Some("VIP Customer - Always purchases premium accessories".to_string()),
            birthday: Some("1995-04-12".to_string()),
            photo_base64: None,
        },
        CanonicalContact {
            id: Some("2".to_string()),
            display_name: "Karim Brahimi".to_string(),
            first_name: Some("Karim".to_string()),
            last_name: Some("Brahimi".to_string()),
            middle_name: None,
            prefix: None,
            suffix: None,
            organization: Some("Electro Algerie".to_string()),
            job_title: Some("Wholesale Supplier".to_string()),
            phones: vec![ContactPhone {
                label: "MOBILE".to_string(),
                number: "+213 661 44 55 66".to_string(),
            }],
            emails: vec![ContactEmail {
                label: "HOME".to_string(),
                address: "k.brahimi@gmail.com".to_string(),
            }],
            addresses: Vec::new(),
            note: None,
            birthday: None,
            photo_base64: None,
        },
        CanonicalContact {
            id: Some("3".to_string()),
            display_name: "Amira Mansouri".to_string(),
            first_name: Some("Amira".to_string()),
            last_name: Some("Mansouri".to_string()),
            middle_name: None,
            prefix: None,
            suffix: None,
            organization: None,
            job_title: None,
            phones: vec![ContactPhone {
                label: "MOBILE".to_string(),
                number: "+213 770 88 99 00".to_string(),
            }],
            emails: Vec::new(),
            addresses: Vec::new(),
            note: None,
            birthday: None,
            photo_base64: None,
        },
    ]
}

fn sample_messages() -> Vec<CanonicalMessage> {
    vec![
        CanonicalMessage {
            id: Some("m1".to_string()),
            address: "+213 550 11 22 33".to_string(),
            date_epoch_ms: 1731750000000,
            body: "Salam Yassine, the new screen protectors arrived at the shop!".to_string(),
            message_type: 1, // Inbox
            read: true,
            status: -1,
            contact_name: Some("Yassine Belgacem".to_string()),
        },
        CanonicalMessage {
            id: Some("m2".to_string()),
            address: "+213 550 11 22 33".to_string(),
            date_epoch_ms: 1731750050000,
            body: "Great, I will pass by after work to pick up two units.".to_string(),
            message_type: 2, // Sent
            read: true,
            status: 0,
            contact_name: Some("Yassine Belgacem".to_string()),
        },
        CanonicalMessage {
            id: Some("m3".to_string()),
            address: "+213 661 44 55 66".to_string(),
            date_epoch_ms: 1731745000000,
            body: "Invoice for latest shipment has been processed. Thank you.".to_string(),
            message_type: 1,
            read: true,
            status: -1,
            contact_name: Some("Karim Brahimi".to_string()),
        },
    ]
}

fn sample_calls() -> Vec<CanonicalCallLog> {
    vec![
        CanonicalCallLog {
            number: "+213 550 11 22 33".to_string(),
            date_epoch_ms: 1731752000000,
            duration_seconds: 145,
            call_type: 1, // Incoming
            contact_name: Some("Yassine Belgacem".to_string()),
        },
        CanonicalCallLog {
            number: "+213 661 44 55 66".to_string(),
            date_epoch_ms: 1731748000000,
            duration_seconds: 62,
            call_type: 2, // Outgoing
            contact_name: Some("Karim Brahimi".to_string()),
        },
        CanonicalCallLog {
            number: "+213 770 88 99 00".to_string(),
            date_epoch_ms: 1731740000000,
            duration_seconds: 0,
            call_type: 3, // Missed
            contact_name: Some("Amira Mansouri".to_string()),
        },
    ]
}

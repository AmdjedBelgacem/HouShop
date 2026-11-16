use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

// ============================================================================
// 1. CANONICAL CONTACT & VCARD 3.0 / 4.0
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContactPhone {
    pub label: String, // "MOBILE", "HOME", "WORK", "OTHER"
    pub number: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContactEmail {
    pub label: String, // "HOME", "WORK", "OTHER"
    pub address: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContactAddress {
    pub label: String,
    pub street: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub postal_code: Option<String>,
    pub country: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CanonicalContact {
    pub id: Option<String>,
    pub display_name: String,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub middle_name: Option<String>,
    pub prefix: Option<String>,
    pub suffix: Option<String>,
    pub organization: Option<String>,
    pub job_title: Option<String>,
    pub phones: Vec<ContactPhone>,
    pub emails: Vec<ContactEmail>,
    pub addresses: Vec<ContactAddress>,
    pub note: Option<String>,
    pub birthday: Option<String>, // "YYYY-MM-DD"
    pub photo_base64: Option<String>,
}

impl CanonicalContact {
    pub fn new(display_name: impl Into<String>) -> Self {
        Self {
            id: None,
            display_name: display_name.into(),
            first_name: None,
            last_name: None,
            middle_name: None,
            prefix: None,
            suffix: None,
            organization: None,
            job_title: None,
            phones: Vec::new(),
            emails: Vec::new(),
            addresses: Vec::new(),
            note: None,
            birthday: None,
            photo_base64: None,
        }
    }

    /// Serializes contact to standard vCard 3.0 format widely accepted by Android, iOS, and macOS.
    pub fn to_vcard(&self) -> String {
        let mut out = String::new();
        out.push_str("BEGIN:VCARD\r\nVERSION:3.0\r\n");

        // Formatted name
        out.push_str(&format!("FN:{}\r\n", escape_vcard(&self.display_name)));

        // Structured name: Family, Given, Additional, Prefix, Suffix
        let last = self.last_name.as_deref().unwrap_or("");
        let first = self.first_name.as_deref().unwrap_or(self.display_name.as_str());
        let middle = self.middle_name.as_deref().unwrap_or("");
        let prefix = self.prefix.as_deref().unwrap_or("");
        let suffix = self.suffix.as_deref().unwrap_or("");
        out.push_str(&format!(
            "N:{};{};{};{};{}\r\n",
            escape_vcard(last),
            escape_vcard(first),
            escape_vcard(middle),
            escape_vcard(prefix),
            escape_vcard(suffix)
        ));

        if let Some(org) = &self.organization {
            out.push_str(&format!("ORG:{}\r\n", escape_vcard(org)));
        }

        if let Some(title) = &self.job_title {
            out.push_str(&format!("TITLE:{}\r\n", escape_vcard(title)));
        }

        for phone in &self.phones {
            let ptype = phone.label.to_uppercase();
            out.push_str(&format!("TEL;TYPE={}:{}\r\n", ptype, phone.number.trim()));
        }

        for email in &self.emails {
            let etype = email.label.to_uppercase();
            out.push_str(&format!("EMAIL;TYPE={}:{}\r\n", etype, email.address.trim()));
        }

        for addr in &self.addresses {
            let atype = addr.label.to_uppercase();
            let street = addr.street.as_deref().unwrap_or("");
            let city = addr.city.as_deref().unwrap_or("");
            let state = addr.state.as_deref().unwrap_or("");
            let zip = addr.postal_code.as_deref().unwrap_or("");
            let country = addr.country.as_deref().unwrap_or("");
            out.push_str(&format!(
                "ADR;TYPE={}:;;{};{};{};{};{}\r\n",
                atype,
                escape_vcard(street),
                escape_vcard(city),
                escape_vcard(state),
                escape_vcard(zip),
                escape_vcard(country)
            ));
        }

        if let Some(bday) = &self.birthday {
            out.push_str(&format!("BDAY:{}\r\n", bday.trim()));
        }

        if let Some(note) = &self.note {
            out.push_str(&format!("NOTE:{}\r\n", escape_vcard(note)));
        }

        if let Some(photo) = &self.photo_base64 {
            out.push_str(&format!("PHOTO;ENCODING=b;TYPE=JPEG:{}\r\n", photo.trim()));
        }

        out.push_str("END:VCARD\r\n");
        out
    }

    /// Parses a single or multi-entry vCard stream into a list of CanonicalContacts.
    pub fn parse_vcards(content: &str) -> Vec<CanonicalContact> {
        let mut contacts = Vec::new();
        let lines: Vec<&str> = content.lines().map(|l| l.trim_end()).collect();
        let mut in_vcard = false;
        let mut current = CanonicalContact::new("");

        // Handle unfolded lines (lines beginning with space or tab continue previous line)
        let mut unfolded = Vec::new();
        for line in lines {
            if (line.starts_with(' ') || line.starts_with('\t')) && !unfolded.is_empty() {
                let last = unfolded.pop().unwrap_or_default();
                unfolded.push(format!("{}{}", last, line.trim_start()));
            } else if !line.trim().is_empty() {
                unfolded.push(line.to_string());
            }
        }

        for line in unfolded {
            let trimmed = line.trim();
            if trimmed.eq_ignore_ascii_case("BEGIN:VCARD") {
                in_vcard = true;
                current = CanonicalContact::new("");
                continue;
            }
            if trimmed.eq_ignore_ascii_case("END:VCARD") {
                if in_vcard && !current.display_name.is_empty() {
                    contacts.push(current.clone());
                }
                in_vcard = false;
                continue;
            }
            if !in_vcard {
                continue;
            }

            if let Some((raw_key, val)) = line.split_once(':') {
                let key_parts: Vec<&str> = raw_key.split(';').collect();
                let prop = key_parts[0].to_uppercase();

                match prop.as_str() {
                    "FN" => {
                        current.display_name = unescape_vcard(val);
                    }
                    "N" => {
                        let parts: Vec<&str> = val.split(';').collect();
                        if parts.len() > 0 && !parts[0].is_empty() {
                            current.last_name = Some(unescape_vcard(parts[0]));
                        }
                        if parts.len() > 1 && !parts[1].is_empty() {
                            current.first_name = Some(unescape_vcard(parts[1]));
                        }
                        if parts.len() > 2 && !parts[2].is_empty() {
                            current.middle_name = Some(unescape_vcard(parts[2]));
                        }
                        if parts.len() > 3 && !parts[3].is_empty() {
                            current.prefix = Some(unescape_vcard(parts[3]));
                        }
                        if parts.len() > 4 && !parts[4].is_empty() {
                            current.suffix = Some(unescape_vcard(parts[4]));
                        }
                        if current.display_name.is_empty() {
                            let mut full = String::new();
                            if let Some(f) = &current.first_name {
                                full.push_str(f);
                            }
                            if let Some(l) = &current.last_name {
                                if !full.is_empty() {
                                    full.push(' ');
                                }
                                full.push_str(l);
                            }
                            current.display_name = full;
                        }
                    }
                    "ORG" => {
                        current.organization = Some(unescape_vcard(val));
                    }
                    "TITLE" => {
                        current.job_title = Some(unescape_vcard(val));
                    }
                    "TEL" => {
                        let label = key_parts
                            .iter()
                            .find(|p| p.to_uppercase().starts_with("TYPE="))
                            .map(|p| p[5..].to_string())
                            .unwrap_or_else(|| "CELL".to_string());
                        current.phones.push(ContactPhone {
                            label,
                            number: val.trim().to_string(),
                        });
                    }
                    "EMAIL" => {
                        let label = key_parts
                            .iter()
                            .find(|p| p.to_uppercase().starts_with("TYPE="))
                            .map(|p| p[5..].to_string())
                            .unwrap_or_else(|| "HOME".to_string());
                        current.emails.push(ContactEmail {
                            label,
                            address: val.trim().to_string(),
                        });
                    }
                    "ADR" => {
                        let parts: Vec<&str> = val.split(';').collect();
                        let label = key_parts
                            .iter()
                            .find(|p| p.to_uppercase().starts_with("TYPE="))
                            .map(|p| p[5..].to_string())
                            .unwrap_or_else(|| "HOME".to_string());
                        let street = parts.get(2).filter(|s| !s.is_empty()).map(|s| unescape_vcard(s));
                        let city = parts.get(3).filter(|s| !s.is_empty()).map(|s| unescape_vcard(s));
                        let state = parts.get(4).filter(|s| !s.is_empty()).map(|s| unescape_vcard(s));
                        let zip = parts.get(5).filter(|s| !s.is_empty()).map(|s| unescape_vcard(s));
                        let country = parts.get(6).filter(|s| !s.is_empty()).map(|s| unescape_vcard(s));

                        current.addresses.push(ContactAddress {
                            label,
                            street,
                            city,
                            state,
                            postal_code: zip,
                            country,
                        });
                    }
                    "BDAY" => {
                        current.birthday = Some(val.trim().to_string());
                    }
                    "NOTE" => {
                        current.note = Some(unescape_vcard(val));
                    }
                    "PHOTO" => {
                        current.photo_base64 = Some(val.trim().to_string());
                    }
                    _ => {}
                }
            }
        }

        contacts
    }
}

fn escape_vcard(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace(',', "\\,")
        .replace(';', "\\;")
        .replace('\n', "\\n")
        .replace('\r', "")
}

fn unescape_vcard(s: &str) -> String {
    s.replace("\\n", "\n")
        .replace("\\N", "\n")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
}

// ============================================================================
// 2. CANONICAL SMS / MESSAGES & ANDROID SMS XML
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CanonicalMessage {
    pub id: Option<String>,
    pub address: String, // Phone number or contact address
    pub date_epoch_ms: i64,
    pub body: String,
    pub message_type: u8, // 1 = Received (Inbox), 2 = Sent
    pub read: bool,
    pub status: i32, // -1 = None, 0 = Complete, 32 = Pending, 64 = Failed
    pub contact_name: Option<String>,
}

impl CanonicalMessage {
    /// Formats a collection of messages into the standard Android SMS Backup & Restore XML specification.
    /// This XML file is natively recognized and restorable by Android devices and third-party tools.
    pub fn to_android_xml(messages: &[CanonicalMessage]) -> String {
        let mut out = String::new();
        out.push_str("<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n");
        out.push_str(&format!(
            "<!-- Backup created by HouSwitch on {} -->\n",
            chrono::Utc::now().to_rfc3339()
        ));
        out.push_str(&format!("<smses count=\"{}\">\n", messages.len()));

        for m in messages {
            let readable_date = chrono::DateTime::from_timestamp_millis(m.date_epoch_ms)
                .map(|dt| dt.format("%b %d, %Y %I:%M:%S %p").to_string())
                .unwrap_or_else(|| "".to_string());

            out.push_str(&format!(
                "  <sms protocol=\"0\" address=\"{}\" date=\"{}\" type=\"{}\" subject=\"null\" body=\"{}\" toa=\"null\" sc_toa=\"null\" service_center=\"null\" read=\"{}\" status=\"{}\" locked=\"0\" date_sent=\"0\" sub_id=\"-1\" readable_date=\"{}\" contact_name=\"{}\" />\n",
                escape_xml(&m.address),
                m.date_epoch_ms,
                m.message_type,
                escape_xml(&m.body),
                if m.read { "1" } else { "0" },
                m.status,
                escape_xml(&readable_date),
                escape_xml(m.contact_name.as_deref().unwrap_or("Unknown"))
            ));
        }

        out.push_str("</smses>\n");
        out
    }

    /// Parses an Android SMS Backup XML back into CanonicalMessages.
    pub fn parse_android_xml(xml: &str) -> Vec<CanonicalMessage> {
        let mut messages = Vec::new();
        for line in xml.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("<sms ") {
                let address = extract_xml_attr(trimmed, "address").unwrap_or_default();
                let date_str = extract_xml_attr(trimmed, "date").unwrap_or("0".to_string());
                let date_epoch_ms = date_str.parse::<i64>().unwrap_or(0);
                let body = extract_xml_attr(trimmed, "body").map(|b| unescape_xml(&b)).unwrap_or_default();
                let msg_type = extract_xml_attr(trimmed, "type")
                    .and_then(|t| t.parse::<u8>().ok())
                    .unwrap_or(1);
                let read = extract_xml_attr(trimmed, "read")
                    .map(|r| r == "1")
                    .unwrap_or(true);
                let status = extract_xml_attr(trimmed, "status")
                    .and_then(|s| s.parse::<i32>().ok())
                    .unwrap_or(-1);
                let contact_name = extract_xml_attr(trimmed, "contact_name");

                messages.push(CanonicalMessage {
                    id: None,
                    address,
                    date_epoch_ms,
                    body,
                    message_type: msg_type,
                    read,
                    status,
                    contact_name,
                });
            }
        }
        messages
    }
}

// ============================================================================
// 3. CANONICAL CALL LOGS & ANDROID CALL LOG XML
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CanonicalCallLog {
    pub number: String,
    pub date_epoch_ms: i64,
    pub duration_seconds: i64,
    pub call_type: u8, // 1 = Incoming, 2 = Outgoing, 3 = Missed, 4 = Voicemail, 5 = Rejected
    pub contact_name: Option<String>,
}

impl CanonicalCallLog {
    /// Formats call logs into Android Call Log Backup XML standard.
    pub fn to_android_xml(calls: &[CanonicalCallLog]) -> String {
        let mut out = String::new();
        out.push_str("<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n");
        out.push_str(&format!(
            "<!-- Call logs backup created by HouSwitch on {} -->\n",
            chrono::Utc::now().to_rfc3339()
        ));
        out.push_str(&format!("<calls count=\"{}\">\n", calls.len()));

        for c in calls {
            let readable_date = chrono::DateTime::from_timestamp_millis(c.date_epoch_ms)
                .map(|dt| dt.format("%b %d, %Y %I:%M:%S %p").to_string())
                .unwrap_or_else(|| "".to_string());

            out.push_str(&format!(
                "  <call number=\"{}\" duration=\"{}\" date=\"{}\" type=\"{}\" presentation=\"1\" readable_date=\"{}\" name=\"{}\" />\n",
                escape_xml(&c.number),
                c.duration_seconds,
                c.date_epoch_ms,
                c.call_type,
                escape_xml(&readable_date),
                escape_xml(c.contact_name.as_deref().unwrap_or("Unknown"))
            ));
        }

        out.push_str("</calls>\n");
        out
    }

    pub fn parse_android_xml(xml: &str) -> Vec<CanonicalCallLog> {
        let mut calls = Vec::new();
        for line in xml.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("<call ") {
                let number = extract_xml_attr(trimmed, "number").unwrap_or_default();
                let duration = extract_xml_attr(trimmed, "duration")
                    .and_then(|d| d.parse::<i64>().ok())
                    .unwrap_or(0);
                let date = extract_xml_attr(trimmed, "date")
                    .and_then(|d| d.parse::<i64>().ok())
                    .unwrap_or(0);
                let call_type = extract_xml_attr(trimmed, "type")
                    .and_then(|t| t.parse::<u8>().ok())
                    .unwrap_or(1);
                let name = extract_xml_attr(trimmed, "name");

                calls.push(CanonicalCallLog {
                    number,
                    date_epoch_ms: date,
                    duration_seconds: duration,
                    call_type,
                    contact_name: name,
                });
            }
        }
        calls
    }
}

// ============================================================================
// 4. CANONICAL CALENDAR (.ICS / ICALENDAR)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CanonicalCalendarEvent {
    pub uid: String,
    pub summary: String,
    pub description: Option<String>,
    pub start_iso: String, // "YYYYMMDDTHHMMSSZ"
    pub end_iso: String,
    pub location: Option<String>,
}

impl CanonicalCalendarEvent {
    pub fn to_ics(events: &[CanonicalCalendarEvent]) -> String {
        let mut out = String::new();
        out.push_str("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//HouShop//HouSwitch//EN\r\n");

        for e in events {
            out.push_str("BEGIN:VEVENT\r\n");
            out.push_str(&format!("UID:{}\r\n", e.uid));
            out.push_str(&format!("DTSTART:{}\r\n", e.start_iso));
            out.push_str(&format!("DTEND:{}\r\n", e.end_iso));
            out.push_str(&format!("SUMMARY:{}\r\n", escape_vcard(&e.summary)));
            if let Some(desc) = &e.description {
                out.push_str(&format!("DESCRIPTION:{}\r\n", escape_vcard(desc)));
            }
            if let Some(loc) = &e.location {
                out.push_str(&format!("LOCATION:{}\r\n", escape_vcard(loc)));
            }
            out.push_str("END:VEVENT\r\n");
        }

        out.push_str("END:VCALENDAR\r\n");
        out
    }
}

// ============================================================================
// 5. MEDIA & FILE STREAMING, CHUNKING & DEDUPLICATION
// ============================================================================

pub const DEFAULT_CHUNK_SIZE: usize = 4 * 1024 * 1024; // 4MB stream chunks

/// Computes SHA-256 hash of a file using chunked streaming so huge files don't fill RAM.
pub fn calculate_file_sha256(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; DEFAULT_CHUNK_SIZE];

    loop {
        let bytes_read = file.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

/// Copies a file with atomic `.partial` write and SHA-256 validation.
/// If deduplication applies (dest exists with same size & hash), skips copy.
pub fn stream_copy_atomic<F>(
    src: &Path,
    dst: &Path,
    mut on_chunk: F,
) -> Result<(u64, String, bool), String>
where
    F: FnMut(u64, u64),
{
    let metadata = fs::metadata(src).map_err(|e| format!("Failed to read src metadata: {}", e))?;
    let total_size = metadata.len();

    // Deduplication check: if destination already exists and size matches, compare hash
    if dst.is_file() {
        if let Ok(dst_meta) = fs::metadata(dst) {
            if dst_meta.len() == total_size {
                let src_hash = calculate_file_sha256(src).map_err(|e| e.to_string())?;
                let dst_hash = calculate_file_sha256(dst).map_err(|e| e.to_string())?;
                if src_hash == dst_hash {
                    return Ok((total_size, src_hash, true)); // Deduplicated!
                }
            }
        }
    }

    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent dir: {}", e))?;
    }

    // Atomic write to .partial first
    let partial_path = PathBuf::from(format!("{}.partial", dst.to_string_lossy()));
    let mut src_file = File::open(src).map_err(|e| format!("Cannot open source file: {}", e))?;
    let mut dst_file = File::create(&partial_path).map_err(|e| format!("Cannot create partial file: {}", e))?;

    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; DEFAULT_CHUNK_SIZE];
    let mut transferred: u64 = 0;

    loop {
        let bytes_read = src_file.read(&mut buffer).map_err(|e| format!("Read error: {}", e))?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
        dst_file.write_all(&buffer[..bytes_read]).map_err(|e| format!("Write error: {}", e))?;
        transferred += bytes_read as u64;
        on_chunk(transferred, total_size);
    }

    dst_file.flush().map_err(|e| format!("Flush error: {}", e))?;
    drop(dst_file);

    let calculated_hash = format!("{:x}", hasher.finalize());

    // Rename .partial to final destination atomically
    fs::rename(&partial_path, dst).map_err(|e| format!("Failed to finalize transfer to destination: {}", e))?;

    Ok((transferred, calculated_hash, false))
}

// ============================================================================
// XML HELPERS
// ============================================================================

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn unescape_xml(s: &str) -> String {
    s.replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&gt;", ">")
        .replace("&lt;", "<")
        .replace("&amp;", "&")
}

fn extract_xml_attr(xml_tag: &str, attr: &str) -> Option<String> {
    let pattern = format!("{}=\"", attr);
    if let Some(pos) = xml_tag.find(&pattern) {
        let start = pos + pattern.len();
        if let Some(end) = xml_tag[start..].find('"') {
            return Some(xml_tag[start..start + end].to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vcard_roundtrip() {
        let mut contact = CanonicalContact::new("Houria Belgacem");
        contact.first_name = Some("Houria".to_string());
        contact.last_name = Some("Belgacem".to_string());
        contact.organization = Some("HouShop".to_string());
        contact.phones.push(ContactPhone {
            label: "CELL".to_string(),
            number: "+213550112233".to_string(),
        });
        contact.emails.push(ContactEmail {
            label: "WORK".to_string(),
            address: "houria@houshop.dz".to_string(),
        });

        let vcard_str = contact.to_vcard();
        assert!(vcard_str.contains("BEGIN:VCARD"));
        assert!(vcard_str.contains("FN:Houria Belgacem"));
        assert!(vcard_str.contains("TEL;TYPE=CELL:+213550112233"));

        let parsed = CanonicalContact::parse_vcards(&vcard_str);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].display_name, "Houria Belgacem");
        assert_eq!(parsed[0].phones.len(), 1);
        assert_eq!(parsed[0].phones[0].number, "+213550112233");
    }

    #[test]
    fn test_sms_xml_roundtrip() {
        let msgs = vec![
            CanonicalMessage {
                id: None,
                address: "+213550112233".to_string(),
                date_epoch_ms: 1731750000000,
                body: "Salam, your screen protector is ready!".to_string(),
                message_type: 1,
                read: true,
                status: -1,
                contact_name: Some("Houria".to_string()),
            },
        ];

        let xml = CanonicalMessage::to_android_xml(&msgs);
        assert!(xml.contains("<smses count=\"1\">"));
        assert!(xml.contains("address=\"+213550112233\""));

        let parsed = CanonicalMessage::parse_android_xml(&xml);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].address, "+213550112233");
        assert_eq!(parsed[0].body, "Salam, your screen protector is ready!");
    }

    #[test]
    fn test_call_log_xml_roundtrip() {
        let calls = vec![
            CanonicalCallLog {
                number: "+213661445566".to_string(),
                date_epoch_ms: 1731752000000,
                duration_seconds: 120,
                call_type: 1,
                contact_name: Some("Karim".to_string()),
            },
        ];

        let xml = CanonicalCallLog::to_android_xml(&calls);
        assert!(xml.contains("<calls count=\"1\">"));
        assert!(xml.contains("number=\"+213661445566\""));

        let parsed = CanonicalCallLog::parse_android_xml(&xml);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].number, "+213661445566");
        assert_eq!(parsed[0].duration_seconds, 120);
    }

    #[test]
    fn test_stream_copy_atomic_and_deduplication() {
        let temp_dir = std::env::temp_dir().join(format!("houshop_test_{}", uuid::Uuid::new_v4()));
        let _ = fs::create_dir_all(&temp_dir);

        let src_file = temp_dir.join("sample.txt");
        let dst_file = temp_dir.join("destination.txt");

        fs::write(&src_file, "HouSwitch test data streaming chunk").unwrap();

        let mut chunks_reported = 0;
        let (bytes, hash, deduplicated) = stream_copy_atomic(&src_file, &dst_file, |_curr, _tot| {
            chunks_reported += 1;
        }).unwrap();

        assert_eq!(bytes, 35);
        assert!(!hash.is_empty());
        assert!(!deduplicated);
        assert!(dst_file.is_file());
        assert_eq!(fs::read_to_string(&dst_file).unwrap(), "HouSwitch test data streaming chunk");

        // Second run with same file: should report deduplicated!
        let (bytes2, hash2, deduplicated2) = stream_copy_atomic(&src_file, &dst_file, |_curr, _tot| {}).unwrap();
        assert_eq!(bytes2, 35);
        assert_eq!(hash2, hash);
        assert!(deduplicated2);

        let _ = fs::remove_dir_all(&temp_dir);
    }
}

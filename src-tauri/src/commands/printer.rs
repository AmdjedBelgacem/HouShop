//! RAW thermal-label printing for TSPL/TSPL2 label printers (Xprinter, etc.).
//!
//! Implements a Hybrid Direct RAW Graphics pipeline:
//!   1. The frontend renders the label to a 1-bit packed bitmap (canvas → threshold → bytes).
//!   2. This module wraps that bitmap in native TSPL commands and injects the whole payload
//!      straight to the Windows Spooler with data type "RAW", bypassing the GDI/driver
//!      scaling + anti-aliasing pipeline for pixel-perfect, zero-margin thermal output.
//!
//! Mirrors the rest of the crate's conventions: `#[tauri::command] pub async fn`,
//! `Result<T, String>` returns, `format!("Failed to ...: {}", e)` errors.

use base64::Engine;
use serde::{Deserialize, Serialize};

/// TSPL tunables exposed to the UI for final positioning/contrast adjustment.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PrintOpts {
    /// Print density 0–15 (higher = darker bars). Default 8.
    pub density: u8,
    /// Print direction 0 or 1 (flips the image vertically). Default 0.
    pub direction: u8,
    /// Vertical offset in dots to compensate for die-cut registration drift. Default 0.
    pub shift: i32,
    /// Physical label height in millimetres (drives SIZE/GAP). Default 45.0.
    pub label_height_mm: f32,
    /// Physical label width in millimetres (drives SIZE). Default 35.0.
    pub label_width_mm: f32,
    /// Gap between labels in millimetres (die-cut liner gap). Default 2.0.
    pub gap_mm: f32,
}

impl Default for PrintOpts {
    fn default() -> Self {
        Self {
            density: 8,
            direction: 0,
            shift: 0,
            label_height_mm: 45.0,
            label_width_mm: 35.0,
            gap_mm: 2.0,
        }
    }
}

/// Enumerate locally-installed printer names.
///
/// On Windows uses `EnumPrintersW`. Non-Windows targets return an error so the
/// project still type-checks on the dev machine; real printing runs on Windows.
#[tauri::command]
pub async fn list_printers() -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Graphics::Printing::{
            EnumPrintersW, PRINTER_ENUM_LOCAL, PRINTER_ENUM_CONNECTIONS, PRINTER_INFO_4W,
        };

        fn run() -> Result<Vec<String>, String> {
            // Two-pass enum: first query the required byte count, then the actual data.
            let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
            let mut needed: u32 = 0;
            let mut returned: u32 = 0;

            unsafe {
                let _ = EnumPrintersW(
                    flags,
                    None,
                    4,
                    None,
                    0,
                    &mut needed,
                    &mut returned,
                );
            }
            if needed == 0 {
                return Ok(Vec::new());
            }

            let mut buf = vec![0u8; needed as usize];
            let mut returned: u32 = 0;
            let rc = unsafe {
                EnumPrintersW(
                    flags,
                    None,
                    4,
                    Some(buf.as_mut_ptr()),
                    needed,
                    &mut needed,
                    &mut returned,
                )
            };
            if rc.is_err() {
                return Err("EnumPrintersW failed".to_string());
            }

            // Reinterpret the byte buffer as an array of PRINTER_INFO_4W.
            let info_size = std::mem::size_of::<PRINTER_INFO_4W>();
            let count = returned as usize;
            let mut names = Vec::with_capacity(count);
            for i in 0..count {
                let offset = i * info_size;
                if offset + info_size > buf.len() {
                    break;
                }
                let info: &PRINTER_INFO_4W =
                    unsafe { &*(buf.as_ptr().add(offset) as *const PRINTER_INFO_4W) };
                if let Some(name_pcwstr) = info.pPrinterName {
                    names.push(name_pcwstr.to_string().map_err(|e| e.to_string())?);
                }
            }
            names.sort_by_key(|n| n.to_lowercase());
            Ok(names)
        }

        run()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("RAW printing is only supported on Windows".to_string())
    }
}

/// Build the complete TSPL/TSPL2 command stream for one label.
///
/// `packed_bytes` is a row-major 1-bit bitmap whose width is exactly
/// `width_px` (must be a multiple of 8) and whose row count is `height_px`.
fn build_tspl_payload(
    width_px: u32,
    height_px: u32,
    packed_bytes: &[u8],
    opts: &PrintOpts,
) -> Result<Vec<u8>, String> {
    if width_px == 0 || height_px == 0 {
        return Err("Invalid bitmap dimensions".to_string());
    }
    if width_px % 8 != 0 {
        return Err(format!(
            "Width must be a multiple of 8 (got {width_px}); pad the canvas before packing"
        ));
    }
    let width_bytes = (width_px / 8) as usize;
    let expected = width_bytes * height_px as usize;
    if packed_bytes.len() != expected {
        return Err(format!(
            "Packed bitmap is {} bytes, expected {} ({} bytes/row × {} rows)",
            packed_bytes.len(),
            expected,
            width_bytes,
            height_px
        ));
    }

    let mut out = Vec::with_capacity(256 + packed_bytes.len());
    // TSPL text commands are LF-terminated ASCII.
    let cmd = |out: &mut Vec<u8>, s: &str| {
        out.extend_from_slice(s.as_bytes());
        out.push(b'\n');
    };

    cmd(
        &mut out,
        &format!(
            "SIZE {w:.2} mm,{h:.2} mm",
            w = opts.label_width_mm,
            h = opts.label_height_mm
        ),
    );
    cmd(&mut out, &format!("GAP {:.2} mm,0 mm", opts.gap_mm));
    cmd(&mut out, &format!("DIRECTION {}", opts.direction));
    cmd(&mut out, "REFERENCE 0,0");
    cmd(&mut out, &format!("SHIFT {}", opts.shift));
    cmd(&mut out, &format!("DENSITY {}", opts.density));
    cmd(&mut out, "CLS");

    // BITMAP x,y,widthBytes,height,mode,<data>
    // mode 0 = overwrite, no scaling. x,y are in dots from REFERENCE 0,0.
    let header = format!(
        "BITMAP 0,0,{},{},0,",
        width_bytes, height_px
    );
    out.extend_from_slice(header.as_bytes());
    out.extend_from_slice(packed_bytes);
    out.push(b'\n');

    cmd(&mut out, "PRINT 1,1");
    Ok(out)
}

/// Print one label by sending a raw TSPL command stream to `printer_name`
/// via the Windows Spooler API with data type "RAW".
#[tauri::command]
pub async fn print_label(
    printer_name: String,
    width_px: u32,
    height_px: u32,
    packed_base64: String,
    opts: Option<PrintOpts>,
) -> Result<(), String> {
    let opts = opts.unwrap_or_default();

    let packed_bytes = base64::engine::general_purpose::STANDARD
        .decode(packed_base64.trim())
        .map_err(|e| format!("Failed to decode bitmap base64: {}", e))?;

    let payload = build_tspl_payload(width_px, height_px, &packed_bytes, &opts)?;

    #[cfg(target_os = "windows")]
    {
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::{CloseHandle, HANDLE};
        use windows::Win32::Graphics::Printing::{
            ClosePrinter, EndDocPrinter, EndPagePrinter, OpenPrinterW, StartDocPrinterW,
            StartPagePrinter, WritePrinter, DOC_INFO_1W, PRINTER_DEFAULTSW,
        };

        fn run(
            printer_name: &str,
            payload: &[u8],
        ) -> Result<(), String> {
            // Open the printer with a wide name and request RAW access.
            let mut name_utf16: Vec<u16> = printer_name.encode_utf16().collect();
            name_utf16.push(0);

            let mut defaults = PRINTER_DEFAULTSW {
                DesiredAccess: windows::Win32::Graphics::Printing::PRINTER_ACCESS_USE,
                ..Default::default()
            };

            let mut handle: HANDLE = HANDLE::default();
            let rc = unsafe {
                OpenPrinterW(
                    PCWSTR(name_utf16.as_ptr()),
                    &mut handle,
                    Some(&mut defaults),
                )
            };
            if rc.is_err() || handle.is_invalid() {
                return Err(format!(
                    "OpenPrinterW failed for \"{}\". Make sure the printer is installed and shared.",
                    printer_name
                ));
            }

            // RAII guard: guarantee ClosePrinter even on early-return paths.
            struct PrinterGuard(HANDLE);
            impl Drop for PrinterGuard {
                fn drop(&mut self) {
                    unsafe { let _ = ClosePrinter(self.0); }
                }
            }
            let _guard = PrinterGuard(handle);

            // Submit a single RAW document — the bytes go to the device verbatim.
            let mut raw_pcwstr: Vec<u16> = "RAW".encode_utf16().collect();
            raw_pcwstr.push(0);
            let doc_info = DOC_INFO_1W {
                pDocName: PCWSTR(b"Label\0".as_ptr() as *const u16),
                pOutputFile: PCWSTR::null(),
                pDatatype: PCWSTR(raw_pcwstr.as_ptr()),
            };

            let job = unsafe { StartDocPrinterW(handle, 1, &doc_info as *const _ as _) };
            if job == 0 {
                return Err("StartDocPrinterW failed".to_string());
            }

            let page_rc = unsafe { StartPagePrinter(handle) };
            if page_rc.is_err() {
                unsafe { let _ = EndDocPrinter(handle); }
                return Err("StartPagePrinter failed".to_string());
            }

            // Send the entire TSPL payload in one WritePrinter call.
            let mut written: u32 = 0;
            let write_rc = unsafe {
                WritePrinter(
                    handle,
                    payload.as_ptr() as *const _,
                    payload.len() as u32,
                    &mut written,
                )
            };
            let _ = unsafe { EndPagePrinter(handle) };
            let _ = unsafe { EndDocPrinter(handle) };

            if write_rc.is_err() {
                return Err("WritePrinter failed".to_string());
            }
            if written as usize != payload.len() {
                return Err(format!(
                    "Short write: {} of {} bytes sent",
                    written,
                    payload.len()
                ));
            }
            Ok(())
        }

        run(&printer_name, &payload)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (printer_name, payload); // silence unused warnings on non-Windows
        Err("RAW printing is only supported on Windows".to_string())
    }
}

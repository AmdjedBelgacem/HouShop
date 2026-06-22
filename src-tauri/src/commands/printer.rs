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

// ---------------------------------------------------------------------------
// Windows FFI. Uses `windows-sys` (raw bindings) whose signatures are 1:1 with
// the Win32 C headers — no feature gating across modules, no Param/Result
// wrappers, stable across releases.
//
// Verified signatures for windows-sys 0.59 (from the crate source):
//   type HANDLE = *mut c_void
//   type BOOL   = i32            // 0 == FALSE, nonzero == TRUE
//   type PCWSTR = *const u16
//   type PWSTR  = *mut u16
//   OpenPrinterW(PCWSTR, *mut HANDLE, *const PRINTER_DEFAULTSW) -> BOOL
//   EnumPrintersW(u32, PCWSTR, u32, *mut u8, u32, *mut u32, *mut u32) -> BOOL
//   StartDocPrinterW(HANDLE, u32, *const DOC_INFO_1W) -> u32
//   WritePrinter(HANDLE, *const c_void, u32, *mut u32) -> BOOL
//   StartPagePrinter / EndPagePrinter / EndDocPrinter / ClosePrinter -> BOOL
//   PRINTER_DEFAULTSW { pDatatype: PWSTR, pDevMode: *mut DEVMODEW, DesiredAccess: u32 }
//   DOC_INFO_1W      { pDocName: PWSTR, pOutputFile: PWSTR, pDatatype: PWSTR }
//   PRINTER_INFO_4W  { pPrinterName: PWSTR, pServerName: PWSTR, Attributes: u32 }
// ---------------------------------------------------------------------------
#[cfg(target_os = "windows")]
mod win {
    use windows_sys::Win32::Foundation::{BOOL, HANDLE};
    use windows_sys::Win32::Graphics::Printing::{
        ClosePrinter, EndDocPrinter, EndPagePrinter, EnumPrintersW, OpenPrinterW,
        PRINTER_ACCESS_USE, PRINTER_DEFAULTSW, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL,
        PRINTER_INFO_4W, StartDocPrinterW, StartPagePrinter, WritePrinter, DOC_INFO_1W,
    };

    /// Convert a Rust string to a NUL-terminated UTF-16 buffer.
    pub fn to_wide(s: &str) -> Vec<u16> {
        let mut v: Vec<u16> = s.encode_utf16().collect();
        v.push(0);
        v
    }

    /// Enumerate installed printer names (local + connections) via EnumPrintersW level 4.
    pub fn list_printer_names() -> Result<Vec<String>, String> {
        let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        let mut needed: u32 = 0;
        let mut returned: u32 = 0;

        // First pass: discover the required buffer size. This returns 0 (FALSE)
        // with GetLastError() == ERROR_INSUFFICIENT_BUFFER, which is expected.
        unsafe {
            let _ = EnumPrintersW(
                flags,
                std::ptr::null(),
                4,
                std::ptr::null_mut(),
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
        let ok: BOOL = unsafe {
            EnumPrintersW(
                flags,
                std::ptr::null(),
                4,
                buf.as_mut_ptr(),
                needed,
                &mut needed,
                &mut returned,
            )
        };
        if ok == 0 {
            return Err("EnumPrintersW failed".to_string());
        }

        // Reinterpret the byte buffer as an array of PRINTER_INFO_4W records.
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
            // PRINTER_INFO_4W fields are PWSTR (raw pointers), not Options.
            if !info.pPrinterName.is_null() {
                // The string lives inside `buf`; copy it out before we borrow it.
                names.push(unsafe { widestr_to_string(info.pPrinterName) });
            }
        }
        names.sort_by_key(|n| n.to_lowercase());
        Ok(names)
    }

    /// Build a Rust String from a NUL-terminated PCWSTR/PWSTR.
    unsafe fn widestr_to_string(ptr: *const u16) -> String {
        let mut len = 0usize;
        while *{ ptr.add(len) } != 0 {
            len += 1;
        }
        let slice = std::slice::from_raw_parts(ptr, len);
        String::from_utf16_lossy(slice)
    }

    /// RAII guard that guarantees ClosePrinter on drop, even on early returns.
    struct PrinterHandle(HANDLE);
    impl Drop for PrinterHandle {
        fn drop(&mut self) {
            unsafe { let _ = ClosePrinter(self.0); }
        }
    }

    /// Inject `payload` to the printer as a single RAW job.
    pub fn send_raw_job(printer_name: &str, payload: &[u8]) -> Result<(), String> {
        let name_w = to_wide(printer_name);

        // PRINTER_DEFAULTSW: only DesiredAccess matters here; null datatype/devmode.
        // Passed by const reference to OpenPrinterW, so no `mut` needed.
        let defaults = PRINTER_DEFAULTSW {
            pDatatype: std::ptr::null_mut(),
            pDevMode: std::ptr::null_mut(),
            DesiredAccess: PRINTER_ACCESS_USE,
        };

        let mut handle: HANDLE = std::ptr::null_mut();
        let ok: BOOL = unsafe {
            OpenPrinterW(
                name_w.as_ptr(),
                &mut handle,
                &defaults,
            )
        };
        if ok == 0 || handle.is_null() {
            return Err(format!(
                "OpenPrinterW failed for \"{}\". Make sure the printer is installed.",
                printer_name
            ));
        }
        let h = PrinterHandle(handle);

        // Submit a single RAW document — the bytes go to the device verbatim.
        let doc_name_w = to_wide("Label");
        let raw_w = to_wide("RAW");
        let doc_info = DOC_INFO_1W {
            pDocName: doc_name_w.as_ptr() as *mut u16,
            pOutputFile: std::ptr::null_mut(),
            pDatatype: raw_w.as_ptr() as *mut u16,
        };

        let job = unsafe { StartDocPrinterW(h.0, 1, &doc_info) };
        if job == 0 {
            return Err("StartDocPrinterW failed".to_string());
        }

        let started: BOOL = unsafe { StartPagePrinter(h.0) };
        if started == 0 {
            unsafe { let _ = EndDocPrinter(h.0); }
            return Err("StartPagePrinter failed".to_string());
        }

        // Send the entire TSPL payload in one WritePrinter call.
        let mut written: u32 = 0;
        let wrote: BOOL = unsafe {
            WritePrinter(
                h.0,
                payload.as_ptr() as *const _,
                payload.len() as u32,
                &mut written,
            )
        };
        unsafe { let _ = EndPagePrinter(h.0); }
        unsafe { let _ = EndDocPrinter(h.0); }

        if wrote == 0 {
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
}

/// Enumerate locally-installed printer names.
///
/// On Windows uses `EnumPrintersW`. Non-Windows targets return an error so the
/// project still type-checks on the dev machine; real printing runs on Windows.
#[tauri::command]
pub async fn list_printers() -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    {
        win::list_printer_names()
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
    let header = format!("BITMAP 0,0,{},{},0,", width_bytes, height_px);
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
        win::send_raw_job(&printer_name, &payload)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (printer_name, payload); // silence unused warnings on non-Windows
        Err("RAW printing is only supported on Windows".to_string())
    }
}

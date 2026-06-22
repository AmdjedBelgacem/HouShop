import { useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { BarcodeLookup } from '../lib/types';

const MIN_CHARS = 3;
const SCAN_TIMEOUT_MS = 300;

/**
 * Map a physical key code (`KeyboardEvent.code`) to the character it represents
 * on a standard US keyboard layout — regardless of the OS's active layout.
 *
 * Why: barcode scanners are "keyboard wedge" devices that emit keystrokes
 * assuming a US layout. On French AZERTY (where digits require Shift), the
 * scanner's `1` arrives as `e.key === '&'` even though `e.code === 'Digit1'`.
 * Reading `e.code` (physical position) instead of `e.key` (translated char)
 * makes the scanner immune to the user's keyboard layout.
 *
 * Returns null for keys that aren't part of a typical barcode (digits + a few
 * letters for non-EAN symbologies).
 */
function codeToChar(code: string): string | null {
  // Top-row digits: Digit0..Digit9 ("Digit5" is 6 chars). Use regex to avoid
  // fragile length assumptions — a prior version checked length === 7 which is
  // wrong (Digit5 is 6 chars) and silently dropped every digit.
  const digitMatch = code.match(/^Digit([0-9])$/);
  if (digitMatch) return digitMatch[1];

  // Numpad digits: Numpad0..Numpad9 ("Numpad5" is 7 chars).
  const numpadMatch = code.match(/^Numpad([0-9])$/);
  if (numpadMatch) return numpadMatch[1];

  // Alphanumerics from the main layout (for CODE128 / similar).
  const letterMatch = code.match(/^Key([A-Z])$/);
  if (letterMatch) return letterMatch[1];

  return null;
}

/**
 * Hardware barcode scanner hook (keyboard-wedge).
 *
 * Scanners emit a rapid burst of keypresses terminated by Enter, faster than a
 * human can type. We buffer characters within a short window and, on Enter,
 * look the barcode up via `get_product_by_barcode`. The result carries both the
 * product and (if the scanned barcode belongs to a variant) the matched
 * variant, so checkout can auto-select it instead of re-opening the picker.
 *
 * Uses `e.code` (physical key) rather than `e.key` (layout-translated char) so
 * the scanner works regardless of the OS keyboard layout (French AZERTY, etc.).
 */
export function useBarcodeScanner(onScan: (lookup: BarcodeLookup) => void) {
  const buffer = useRef<{ chars: string; firstTime: number }>({ chars: '', firstTime: 0 });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processingRef = useRef(false);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ignore typing in form fields — the scanner shouldn't hijack input focus.
    const target = e.target as HTMLElement;
    const tag = target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) {
      return;
    }

    // Enter terminates a scan. (NumpadEnter maps to "Enter" too.)
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      const { chars, firstTime } = buffer.current;
      const elapsed = Date.now() - firstTime;

      // Diagnostic: log what the scanner accumulated so failures are visible.
      if (chars.length > 0) {
        console.log('[scanner] Enter received, buffer:', JSON.stringify(chars),
          `len=${chars.length} elapsed=${elapsed}ms threshold=${SCAN_TIMEOUT_MS}ms`);
      }

      if (chars.length >= MIN_CHARS && elapsed < SCAN_TIMEOUT_MS && !processingRef.current) {
        processingRef.current = true;
        invoke<BarcodeLookup>('get_product_by_barcode', { barcode: chars })
          .then(lookup => {
            if (lookup) {
              onScan(lookup);
            }
          })
          .catch(err => {
            // Log the lookup failure so scanner issues are diagnosable instead
            // of failing silently. Common causes: barcode not in DB, variant
            // barcode with no matching product, or IPC deserialization error.
            console.error('[scanner] lookup failed for', JSON.stringify(chars), err);
          })
          .finally(() => {
            processingRef.current = false;
          });
      }

      buffer.current = { chars: '', firstTime: 0 };
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      return;
    }

    // Translate the physical key to a layout-independent character.
    const ch = codeToChar(e.code);
    if (ch !== null) {
      const now = Date.now();
      if (buffer.current.chars.length === 0) {
        buffer.current = { chars: ch, firstTime: now };
      } else {
        const lastGap = now - buffer.current.firstTime;
        if (lastGap > SCAN_TIMEOUT_MS) {
          buffer.current = { chars: ch, firstTime: now };
        } else {
          buffer.current.chars += ch;
        }
      }

      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        buffer.current = { chars: '', firstTime: 0 };
      }, SCAN_TIMEOUT_MS);
    }
  }, [onScan]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [handleKeyDown]);
}

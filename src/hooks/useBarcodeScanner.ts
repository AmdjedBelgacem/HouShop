import { useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { BarcodeLookup } from '../lib/types';

const MIN_CHARS = 3;
const SCAN_TIMEOUT_MS = 300;

/**
 * Hardware barcode scanner hook (keyboard-wedge).
 *
 * Scanners emit a rapid burst of keypresses terminated by Enter, faster than a
 * human can type. We buffer characters within a short window and, on Enter,
 * look the barcode up via `get_product_by_barcode`. The result carries both the
 * product and (if the scanned barcode belongs to a variant) the matched
 * variant, so checkout can auto-select it instead of re-opening the picker.
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

    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta' ||
        e.key === 'Tab' || e.key === 'Escape' || e.key === 'CapsLock') {
      return;
    }

    if (e.key === 'Enter') {
      const { chars, firstTime } = buffer.current;
      const elapsed = Date.now() - firstTime;

      if (chars.length >= MIN_CHARS && elapsed < SCAN_TIMEOUT_MS && !processingRef.current) {
        processingRef.current = true;
        invoke<BarcodeLookup>('get_product_by_barcode', { barcode: chars })
          .then(lookup => {
            if (lookup) {
              onScan(lookup);
            }
          })
          .catch(() => { })
          .finally(() => {
            processingRef.current = false;
          });
      }

      buffer.current = { chars: '', firstTime: 0 };
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      return;
    }

    if (e.key.length === 1) {
      const now = Date.now();
      if (buffer.current.chars.length === 0) {
        buffer.current = { chars: e.key, firstTime: now };
      } else {
        const lastGap = now - buffer.current.firstTime;
        if (lastGap > SCAN_TIMEOUT_MS) {
          buffer.current = { chars: e.key, firstTime: now };
        } else {
          buffer.current.chars += e.key;
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

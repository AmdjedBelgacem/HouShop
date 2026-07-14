/**
 * TSPL printer bridge: thin TypeScript wrapper over the Rust `print_label` /
 * `list_printers` Tauri commands. Handles the chosen-printer persistence and
 * exposes the tunables (density / direction / shift) the label dialog edits.
 */

import { invoke } from '@tauri-apps/api/core';
import { renderLabelToBitmap, type RenderLabelInput, type LabelVisibility, type LabelStyling, type BarcodeSize } from './labelRenderer';

const SAVED_PRINTER_KEY = 'tspl_printer_name';
const SAVED_LABEL_SETTINGS_KEY = 'tspl_label_settings';

/**
 * Persisted label settings. Everything except `copies` is remembered between
 * print sessions so the merchant doesn't re-enter paper/visibility/styling on
 * every label. `copies` is intentionally excluded (it's per-run).
 */
export interface SavedLabelSettings {
  paperKey: PaperPreset['key'];
  density: number;
  direction: number;
  shift: number;
  shiftX: number;
  visibility: LabelVisibility;
  styling: LabelStyling;
  barcodeSize: BarcodeSize;
  combineNameVariant: boolean;
}

/** Load the saved label settings, or null if none stored yet. */
export function getSavedLabelSettings(): SavedLabelSettings | null {
  try {
    const raw = localStorage.getItem(SAVED_LABEL_SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as SavedLabelSettings;
    return null;
  } catch {
    return null;
  }
}

/** Persist label settings for the next print session (copies excluded). */
export function setSavedLabelSettings(settings: SavedLabelSettings): void {
  try {
    localStorage.setItem(SAVED_LABEL_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable / quota — non-fatal; the print still went through.
  }
}

/** Mirror of `PrintOpts` in `src-tauri/src/commands/printer.rs`. */
export interface TsplPrintOpts {
  density: number;
  direction: number;
  shift: number;
  shiftX: number;
  labelHeightMm: number;
  labelWidthMm: number;
  gapMm: number;
  /** Number of copies of the same label (TSPL `PRINT copies,1`). */
  copies: number;
}

/** Standard Xprinter label resolutions (dots per inch). */
export const RESOLUTION_DPI = 203;

/**
 * Convert a physical label size to printer dots at the configured DPI.
 * Width is rounded up to the nearest multiple of 8 so rows pack into whole bytes.
 */
export function mmToDots(mm: number, dpi = RESOLUTION_DPI): number {
  return Math.round((mm / 25.4) * dpi);
}

/** Round a pixel width up to a multiple of 8 (BITMAP requires whole bytes/row). */
export function ceilToByte(widthPx: number): number {
  return Math.ceil(widthPx / 8) * 8;
}

export function getSavedPrinter(): string | null {
  return localStorage.getItem(SAVED_PRINTER_KEY);
}

export function setSavedPrinter(name: string): void {
  localStorage.setItem(SAVED_PRINTER_KEY, name);
}

export function clearSavedPrinter(): void {
  localStorage.removeItem(SAVED_PRINTER_KEY);
}

/** Ask Rust for the locally-installed printer names. */
export async function listPrinters(): Promise<string[]> {
  return invoke<string[]>('list_printers');
}

/** Paper presets: physical dimensions of the loaded media. */
export interface PaperPreset {
  key: string;
  label: string;
  widthMm: number;
  heightMm: number;
  gapMm: number;
}

/** Product barcode tags (small die-cut labels). */
export const PAPER_PRESETS: PaperPreset[] = [
  { key: 'medium', label: '35×34mm', widthMm: 35, heightMm: 34, gapMm: 2 },
  { key: 'small', label: '25.4×17mm', widthMm: 25.4, heightMm: 17, gapMm: 2 },
];

/**
 * Larger delivery / shipping papers for Xprinter TSPL printers.
 * 100×150mm (4×6") is the common courier shipping label size.
 */
export const DELIVERY_PAPER_PRESETS: PaperPreset[] = [
  { key: 'delivery_4x6', label: '100×150mm (4×6")', widthMm: 100, heightMm: 150, gapMm: 3 },
  { key: 'delivery_4x4', label: '100×100mm (4×4")', widthMm: 100, heightMm: 100, gapMm: 3 },
  { key: 'delivery_80x150', label: '80×150mm', widthMm: 80, heightMm: 150, gapMm: 3 },
  { key: 'delivery_80x120', label: '80×120mm', widthMm: 80, heightMm: 120, gapMm: 3 },
];

/** Invoice / receipt-style papers (thermal, larger than barcode tags). */
export const INVOICE_PAPER_PRESETS: PaperPreset[] = [
  { key: 'invoice_80x200', label: '80×200mm', widthMm: 80, heightMm: 200, gapMm: 3 },
  { key: 'invoice_80x150', label: '80×150mm', widthMm: 80, heightMm: 150, gapMm: 3 },
  { key: 'invoice_100x150', label: '100×150mm', widthMm: 100, heightMm: 150, gapMm: 3 },
  { key: 'invoice_100x100', label: '100×100mm', widthMm: 100, heightMm: 100, gapMm: 3 },
];

const SAVED_DELIVERY_SETTINGS_KEY = 'tspl_delivery_settings';
const SAVED_INVOICE_SETTINGS_KEY = 'tspl_invoice_settings';

export interface SavedDocumentSettings {
  paperKey: string;
  density: number;
  direction: number;
  shift: number;
  shiftX: number;
}

export function getSavedDocumentSettings(kind: 'delivery' | 'invoice'): SavedDocumentSettings | null {
  try {
    const key = kind === 'delivery' ? SAVED_DELIVERY_SETTINGS_KEY : SAVED_INVOICE_SETTINGS_KEY;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as SavedDocumentSettings;
    return null;
  } catch {
    return null;
  }
}

export function setSavedDocumentSettings(kind: 'delivery' | 'invoice', settings: SavedDocumentSettings): void {
  try {
    const key = kind === 'delivery' ? SAVED_DELIVERY_SETTINGS_KEY : SAVED_INVOICE_SETTINGS_KEY;
    localStorage.setItem(key, JSON.stringify(settings));
  } catch {
    // non-fatal
  }
}

/** Send an already-packed 1-bit bitmap via the same RAW TSPL path as barcode labels. */
export async function printPackedBitmap(
  printerName: string,
  bitmap: { widthPx: number; heightPx: number; packedBase64: string },
  paper: PaperPreset,
  opts: TsplPrintOpts,
): Promise<void> {
  if (!printerName) {
    throw new Error('No printer selected. Pick a printer from the dropdown.');
  }
  await invoke('print_label', {
    printerName,
    widthPx: bitmap.widthPx,
    heightPx: bitmap.heightPx,
    packedBase64: bitmap.packedBase64,
    opts: {
      density: opts.density,
      direction: opts.direction,
      shift: opts.shift,
      shift_x: opts.shiftX,
      label_height_mm: opts.labelHeightMm,
      label_width_mm: opts.labelWidthMm,
      gap_mm: opts.gapMm,
      copies: opts.copies,
    },
  });
}

/**
 * Render the label to a 1-bit bitmap and send it to the printer via RAW spooler injection.
 * Returns when the printer driver has accepted the job (or throws with a user-facing message).
 */
export async function printLabel(
  printerName: string,
  label: Omit<RenderLabelInput, 'widthPx' | 'heightPx'>,
  paper: PaperPreset,
  opts: TsplPrintOpts,
): Promise<void> {
  if (!printerName) {
    throw new Error('No printer selected. Pick a printer from the dropdown.');
  }

  // Step 1: derive exact dot canvas from physical size + DPI, byte-aligned width.
  const widthPx = ceilToByte(mmToDots(paper.widthMm, RESOLUTION_DPI));
  const heightPx = mmToDots(paper.heightMm, RESOLUTION_DPI);

  // Steps 2–3 (frontend): render + threshold + pack to 1-bit bytes.
  const bitmap = renderLabelToBitmap({
    ...label,
    shiftX: opts.shiftX,
    widthPx,
    heightPx,
  });

  // Step 4 (Rust): wrap in TSPL + inject via RAW Windows Spooler.
  await printPackedBitmap(printerName, bitmap, paper, opts);
}

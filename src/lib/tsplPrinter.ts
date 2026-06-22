/**
 * TSPL printer bridge: thin TypeScript wrapper over the Rust `print_label` /
 * `list_printers` Tauri commands. Handles the chosen-printer persistence and
 * exposes the tunables (density / direction / shift) the label dialog edits.
 */

import { invoke } from '@tauri-apps/api/core';
import { renderLabelToBitmap, type RenderLabelInput } from './labelRenderer';

const SAVED_PRINTER_KEY = 'tspl_printer_name';

/** Mirror of `PrintOpts` in `src-tauri/src/commands/printer.rs`. */
export interface TsplPrintOpts {
  density: number;
  direction: number;
  shift: number;
  labelHeightMm: number;
  labelWidthMm: number;
  gapMm: number;
}

export const DEFAULT_TSPL_OPTS: TsplPrintOpts = {
  density: 8,
  direction: 0,
  shift: 0,
  labelHeightMm: 45,
  labelWidthMm: 35,
  gapMm: 2,
};

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

/** Paper presets: physical dimensions and the resulting dot canvas. */
export interface PaperPreset {
  key: 'medium' | 'small';
  label: string;
  widthMm: number;
  heightMm: number;
  gapMm: number;
}

export const PAPER_PRESETS: PaperPreset[] = [
  { key: 'medium', label: '35×45mm', widthMm: 35, heightMm: 45, gapMm: 2 },
  { key: 'small', label: '2×4"', widthMm: 50, heightMm: 100, gapMm: 2 },
];

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
  const bitmap = renderLabelToBitmap({ ...label, widthPx, heightPx });

  // Step 4 (Rust): wrap in TSPL + inject via RAW Windows Spooler.
  await invoke('print_label', {
    printerName,
    widthPx: bitmap.widthPx,
    heightPx: bitmap.heightPx,
    packedBase64: bitmap.packedBase64,
    opts: {
      density: opts.density,
      direction: opts.direction,
      shift: opts.shift,
      label_height_mm: opts.labelHeightMm,
      label_width_mm: opts.labelWidthMm,
      gap_mm: opts.gapMm,
    },
  });
}

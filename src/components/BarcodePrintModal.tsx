import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useI18n } from '../i18n';
import {
  X,
  Printer,
  AlertTriangle,
  RefreshCw,
  Loader2,
  ChevronDown,
  Tag,
  MoveHorizontal,
} from 'lucide-react';
import {
  PAPER_PRESETS,
  getSavedPrinter,
  setSavedPrinter,
  getSavedLabelSettings,
  setSavedLabelSettings,
  listPrinters,
  printLabel,
  mmToDots,
  ceilToByte,
  RESOLUTION_DPI,
  type PaperPreset,
} from '../lib/tsplPrinter';
import { renderLabelToDataURL, type LabelVisibility, type LabelStyling, type BarcodeSize } from '../lib/labelRenderer';
import type { ProductVariant } from '../lib/types';

interface BarcodePrintModalProps {
  barcode: string;
  productName: string;
  /** Product ID — when set, the modal fetches variants and shows a picker. */
  productId?: number;
  /** Pre-selected variant name (e.g. opened from a variant-specific context). */
  variantName?: string | null;
  sku: string | null;
  price?: number | null;
  onClose: () => void;
}

function isValidEan13Input(value: string): boolean {
  return /^\d{12,13}$/.test(value);
}

// The price element's font is rendered 1.4× its base size by default (the scale
// that looks right on these tags), but the UI shows it as 1.0× so the baseline
// reads cleanly — the merchant only sees numbers above/below that reference.
const PRICE_DEFAULT_FONT_SCALE = 1.4;
const XP350B_CENTER_SHIFT_X = 0;
const SHIFT_X_RANGE = 160;

/** Map an internal price fontScale to the value shown in the stepper. */
function priceFontScaleToDisplay(v: number): number {
  // 1.4 → 1.0; everything else is shown relative to that same offset.
  return Number((v / PRICE_DEFAULT_FONT_SCALE).toFixed(2));
}
/** Inverse of priceFontScaleToDisplay: turn a displayed value back to internal. */
function priceFontScaleFromDisplay(v: number): number {
  return Number((v * PRICE_DEFAULT_FONT_SCALE).toFixed(2));
}

/**
 * Older builds stored H-Shift with a hidden +20 "display zero" and also applied
 * a secret base shift in the renderer. That made the preview lie and pushed
 * content right on left-rail printers (XP-350B). Map the old default of 20 → 0
 * so first open after upgrade is centered; anything else is kept as-is.
 */
function migrateShiftX(raw: number | undefined | null): number {
  if (raw == null || !Number.isFinite(raw)) return XP350B_CENTER_SHIFT_X;
  if (raw === 0 || raw === 20 || raw === -32) return XP350B_CENTER_SHIFT_X;
  return Math.round(raw);
}

export default function BarcodePrintModal({ barcode, productName, productId, variantName, price, onClose }: BarcodePrintModalProps) {
  const { t } = useI18n();
  // Restore the last-used settings so the merchant doesn't re-enter paper/
  // visibility/styling on every label. `copies` is NOT restored (per-run).
  const saved = getSavedLabelSettings();
  const [paperKey, setPaperKey] = useState<PaperPreset['key']>(saved?.paperKey ?? 'small');
  const [printers, setPrinters] = useState<string[]>([]);
  const [printerName, setPrinterName] = useState<string>('');
  const [tunables, setTunables] = useState({
    // Density 10 prints solid black bars on XP-350B better than the old 8
    // (grey/weak modules were a common scan failure mode).
    density: saved?.density ?? 10,
    direction: saved?.direction ?? 0,
    shift: saved?.shift ?? 0,
    // Horizontal position in dots. Negative = left (common fix when the
    // XP-350B leaves empty space on the left of the physical tag).
    shiftX: migrateShiftX(saved?.shiftX),
  });
  const [copies, setCopies] = useState(1);
  const [visibility, setVisibility] = useState<LabelVisibility>(saved?.visibility ?? {
    name: true,
    variant: true,
    price: true,
    barcode: true,
  });
  // Per-element styling: fontScale (1 = default) and offsetY (dots, +down/-up).
  // Resides under "Text & position" — independent of the visibility toggles.
  // The price font defaults to 1.4× (the size that looks right on these tags)
  // but the stepper displays it as 1.0× so the baseline reads cleanly.
  const [styling, setStyling] = useState<LabelStyling>(saved?.styling ?? {
    name: { fontScale: 1, offsetY: 0 },
    variant: { fontScale: 1, offsetY: 0 },
    price: { fontScale: PRICE_DEFAULT_FONT_SCALE, offsetY: 0 },
  });
  // Barcode sizing: independent width/height multipliers + a uniform scale.
  // Defaults to 1/1/1 (full width, default bar height). Height/scale < 1 shrink
  // the bars — handy on 25×17mm tags where the default height can feel large.
  const [barcodeSize, setBarcodeSize] = useState<BarcodeSize>(saved?.barcodeSize ?? {
    widthScale: 1.12,
    heightScale: 1.18,
    scale: 1,
  });
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showStyling, setShowStyling] = useState(false);
  const [showBarcodeSize, setShowBarcodeSize] = useState(false);
  // When true, the variant title is merged into the product name as a single
  // inline title line ("Product — Variant") instead of a separate subtitle.
  // Defaults on (selected) per the requested default.
  const [combineNameVariant, setCombineNameVariant] = useState<boolean>(saved?.combineNameVariant ?? true);
  const displayShiftX = tunables.shiftX - XP350B_CENTER_SHIFT_X;
  const minShiftX = XP350B_CENTER_SHIFT_X - SHIFT_X_RANGE;
  const maxShiftX = XP350B_CENTER_SHIFT_X + SHIFT_X_RANGE;

  // Variants for this product (fetched on mount when productId is provided).
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  // Selected variant id: '' = product-level (no variant), otherwise the variant id.
  const [selectedVariantId, setSelectedVariantId] = useState<string>('');

  // Fetch variants once when the modal opens, so the user can pick which
  // variant label to print. Falls back to the product-level barcode/price
  // when "None" is selected or the product has no variants.
  useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    async function load() {
      try {
        const list = await invoke<ProductVariant[]>('get_product_variants', { productId });
        if (cancelled) return;
        setVariants(list);
        // If a variant was pre-selected via props, default to it.
        if (variantName) {
          const match = list.find(v => v.variant_name === variantName);
          if (match) setSelectedVariantId(String(match.id));
        }
      } catch {
        // No variants available — product-level label only.
      }
    }
    load();
    return () => { cancelled = true; };
  }, [productId, variantName]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !printing) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, printing]);

  // The currently selected variant object (or null for product-level).
  const selectedVariant = useMemo(
    () => variants.find(v => String(v.id) === selectedVariantId) ?? null,
    [variants, selectedVariantId],
  );

  // Effective label data: variant overrides product-level when selected.
  const effectiveBarcode = selectedVariant?.barcode || barcode;
  const effectiveVariantName = selectedVariant?.variant_name ?? variantName ?? null;
  const effectivePrice = selectedVariant?.selling_price ?? price ?? null;

  const paper = PAPER_PRESETS.find(p => p.key === paperKey)!;

  // Derived: barcode validity (no setState-in-effect needed).
  const barcodeError =
    !effectiveBarcode || !isValidEan13Input(effectiveBarcode)
      ? `Invalid barcode: "${effectiveBarcode}". Must be 12-13 digits.`
      : null;

  // Derived: full TSPL options = user tunables + paper geometry.
  const opts = {
    density: tunables.density,
    direction: tunables.direction,
    shift: tunables.shift,
    shiftX: tunables.shiftX,
    labelWidthMm: paper.widthMm,
    labelHeightMm: paper.heightMm,
    gapMm: paper.gapMm,
    copies,
  };

  // True WYSIWYG preview: same shiftX / layout as the printed bitmap. Empty
  // left/right space in this image is what you will get on the physical tag.
  const previewSrc = useMemo(() => {
    if (barcodeError) return null;
    try {
      const widthPx = ceilToByte(mmToDots(paper.widthMm, RESOLUTION_DPI));
      const heightPx = mmToDots(paper.heightMm, RESOLUTION_DPI);
      return renderLabelToDataURL({
        barcode: effectiveBarcode,
        productName,
        variantName: effectiveVariantName,
        price: effectivePrice,
        shiftX: tunables.shiftX,
        visibility,
        styling,
        barcodeSize,
        combineNameVariant,
        widthPx,
        heightPx,
      });
    } catch {
      return null;
    }
  }, [effectiveBarcode, productName, effectiveVariantName, effectivePrice, barcodeError, paper, tunables.shiftX, visibility, styling, barcodeSize, combineNameVariant]);

  // Load the printer list once on mount.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingPrinters(true);
      setError(null);
      try {
        const list = await listPrinters();
        if (cancelled) return;
        setPrinters(list);
        const savedPrinter = getSavedPrinter();
        if (savedPrinter && list.includes(savedPrinter)) {
          setPrinterName(savedPrinter);
        } else if (list.length > 0) {
          setPrinterName(list[0]);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingPrinters(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  async function refreshPrinters() {
    setLoadingPrinters(true);
    setError(null);
    try {
      const list = await listPrinters();
      setPrinters(list);
      const savedPrinter = getSavedPrinter();
      if (savedPrinter && list.includes(savedPrinter)) {
        setPrinterName(savedPrinter);
      } else if (list.length > 0) {
        setPrinterName(list[0]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingPrinters(false);
    }
  }

  function onPickPrinter(name: string) {
    setPrinterName(name);
    setSavedPrinter(name);
  }

  async function onPrint() {
    setError(null);
    if (barcodeError) {
      setError(barcodeError);
      return;
    }
    setPrinting(true);
    try {
      await printLabel(
        printerName,
        {
          barcode: effectiveBarcode,
          productName,
          variantName: effectiveVariantName,
          price: effectivePrice,
          visibility,
          styling,
          barcodeSize,
          combineNameVariant,
        },
        paper,
        opts,
      );
      // Remember everything for next time — except copies (that's per-run).
      setSavedLabelSettings({
        paperKey,
        density: tunables.density,
        direction: tunables.direction,
        shift: tunables.shift,
        shiftX: tunables.shiftX,
        visibility,
        styling,
        barcodeSize,
        combineNameVariant,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPrinting(false);
    }
  }

  // Preview box sized to the label's aspect ratio so it's proportionally accurate.
  const previewAspect = paper.heightMm / paper.widthMm;
  const displayPrice =
    effectivePrice != null && effectivePrice > 0
      ? `${effectivePrice.toFixed(2)} DA`
      : null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6"
      onClick={() => { if (!printing) onClose(); }}
    >
      {/* Frosted backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-md" />

      <div
        className="relative w-[70vw] max-w-[960px] min-w-[320px] max-h-[min(92vh,880px)] flex flex-col rounded-[20px] bg-card shadow-[0_24px_80px_-12px_rgba(0,0,0,0.28),0_0_0_1px_rgba(0,0,0,0.04)] overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="barcode-print-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-6 sm:px-7 py-4 border-b border-border/80 shrink-0">
          <div className="min-w-0">
            <h3
              id="barcode-print-title"
              className="text-[17px] font-semibold tracking-tight text-text-primary"
            >
              {t('barcode.title')}
            </h3>
            <p className="text-[12.5px] text-text-secondary mt-0.5 truncate">
              {productName}
              {effectiveVariantName ? ` · ${effectiveVariantName}` : ''}
              {displayPrice ? ` · ${displayPrice}` : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={printing}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-text-secondary hover:bg-border/60 hover:text-text-primary transition-colors disabled:opacity-40"
            aria-label={t('common.close')}
          >
            <X size={15} strokeWidth={2.25} />
          </button>
        </div>

        {/* Body — two-column on wide, stacked on narrow */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-0 lg:min-h-full">
            {/* ── Left: preview stage ── */}
            <div className="flex flex-col border-b lg:border-b-0 lg:border-r border-border/80 bg-surface/60">
              <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 sm:px-8 py-8 sm:py-10">
                <div className="w-full max-w-[460px]">
                  <div className="flex items-center justify-between mb-2.5 px-0.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                      Print preview
                    </span>
                    <span className="text-[11px] text-text-muted">
                      Matches printer 1:1
                    </span>
                  </div>
                  {/* The white rectangle is the actual rendered paper preview.
                      No decorative frame is part of the printed label. */}
                  <div className="relative flex w-full items-center justify-center p-2 sm:p-3">
                    <div
                      className="relative w-full max-w-[380px] bg-white overflow-hidden"
                      style={{ aspectRatio: `1 / ${previewAspect}` }}
                    >
                      {previewSrc ? (
                        <img
                          src={previewSrc}
                          alt="Label preview"
                          className="absolute inset-0 h-full w-full object-fill"
                        />
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-text-muted">
                          <Tag size={28} strokeWidth={1.5} className="opacity-40" />
                          <p className="text-[13px]">No preview available</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Meta chips under preview */}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <MetaChip>
                    {paper.widthMm}×{paper.heightMm} mm
                  </MetaChip>
                  {effectiveBarcode && (
                    <MetaChip mono>{effectiveBarcode}</MetaChip>
                  )}
                  {tunables.shiftX !== 0 && (
                    <MetaChip>
                      H {tunables.shiftX > 0 ? '+' : ''}{tunables.shiftX} dots
                    </MetaChip>
                  )}
                </div>
              </div>
            </div>

            {/* ── Right: controls ── */}
            <div className="flex flex-col px-5 sm:px-6 py-5 sm:py-6 space-y-5">
              {/* Errors */}
              {(error || barcodeError) && (
                <div className="space-y-2">
                  {error && (
                    <ErrorBanner message={error} />
                  )}
                  {barcodeError && (
                    <ErrorBanner message={barcodeError} />
                  )}
                </div>
              )}

              {/* Variant picker */}
              {variants.length > 0 && (
                <Section title="Variant">
                  <div className="relative">
                    <select
                      value={selectedVariantId}
                      onChange={e => setSelectedVariantId(e.target.value)}
                      className="field-select"
                    >
                      <option value="">None (product label)</option>
                      {variants.map(v => (
                        <option key={v.id} value={v.id}>
                          {v.variant_name}{v.selling_price ? ` — ${v.selling_price.toFixed(2)} DA` : ''}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={14}
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted"
                    />
                  </div>
                </Section>
              )}

              {/* Horizontal position — primary control for left-rail printers */}
              <Section title="Horizontal position">
                <div className="rounded-2xl border border-border/80 bg-surface/40 px-3.5 py-3.5 space-y-3">
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-navy/10 text-navy">
                      <MoveHorizontal size={14} strokeWidth={2.25} />
                    </div>
                    <p className="text-[12.5px] text-text-secondary leading-snug">
                      XP-350B loads labels on the <span className="font-medium text-text-primary">left</span>.
                      Center is calibrated for that left rail. If the print still leaves empty space on the left, move it left until it sits in the middle of the sticker.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setTunables(o => ({ ...o, shiftX: Math.max(minShiftX, o.shiftX - 5) }))}
                      className="h-9 min-w-[4.5rem] px-2 rounded-xl border border-border bg-card text-[12px] font-semibold text-text-primary hover:bg-surface transition-colors"
                    >
                      ← Left
                    </button>
                    <input
                      type="range"
                      min={minShiftX}
                      max={maxShiftX}
                      step={1}
                      value={tunables.shiftX}
                      onChange={e => setTunables(o => ({ ...o, shiftX: Number(e.target.value) }))}
                      className="flex-1 min-w-0 accent-navy h-1.5 cursor-pointer"
                      aria-label="Horizontal position in dots"
                    />
                    <button
                      type="button"
                      onClick={() => setTunables(o => ({ ...o, shiftX: Math.min(maxShiftX, o.shiftX + 5) }))}
                      className="h-9 min-w-[4.5rem] px-2 rounded-xl border border-border bg-card text-[12px] font-semibold text-text-primary hover:bg-surface transition-colors"
                    >
                      Right →
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setTunables(o => ({ ...o, shiftX: Math.max(minShiftX, o.shiftX - 1) }))}
                        className="w-8 h-8 rounded-lg border border-border bg-card text-text-secondary hover:bg-surface text-[14px]"
                      >
                        −
                      </button>
                      <span className="w-16 text-center text-[13px] font-semibold tabular-nums text-text-primary">
                        {displayShiftX > 0 ? '+' : ''}{displayShiftX}
                      </span>
                      <button
                        type="button"
                        onClick={() => setTunables(o => ({ ...o, shiftX: Math.min(maxShiftX, o.shiftX + 1) }))}
                        className="w-8 h-8 rounded-lg border border-border bg-card text-text-secondary hover:bg-surface text-[14px]"
                      >
                        +
                      </button>
                      <span className="text-[11px] text-text-muted ml-0.5">dots</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTunables(o => ({ ...o, shiftX: XP350B_CENTER_SHIFT_X }))}
                      className="text-[12px] font-medium text-navy hover:opacity-70 transition-opacity"
                    >
                      Center
                    </button>
                  </div>
                </div>
              </Section>

              {/* Content visibility */}
              <Section title="Show on label">
                <div className="grid grid-cols-2 gap-2">
                  <Toggle
                    label="Name"
                    checked={visibility.name ?? true}
                    onChange={v => setVisibility(s => ({ ...s, name: v }))}
                  />
                  <Toggle
                    label="Variant"
                    checked={visibility.variant ?? true}
                    disabled={!effectiveVariantName}
                    onChange={v => setVisibility(s => ({ ...s, variant: v }))}
                  />
                  <Toggle
                    label="Price"
                    checked={visibility.price ?? true}
                    disabled={effectivePrice == null || effectivePrice <= 0}
                    onChange={v => setVisibility(s => ({ ...s, price: v }))}
                  />
                  <Toggle
                    label="Barcode"
                    checked={visibility.barcode ?? true}
                    onChange={v => setVisibility(s => ({ ...s, barcode: v }))}
                  />
                </div>
                {effectiveVariantName && (visibility.name ?? true) && (visibility.variant ?? true) && (
                  <label className="mt-3 flex items-center gap-2.5 cursor-pointer select-none group">
                    <span
                      className={`relative inline-flex h-[18px] w-[32px] flex-shrink-0 rounded-full transition-colors ${
                        combineNameVariant ? 'bg-navy' : 'bg-text-muted/25'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={combineNameVariant}
                        onChange={e => setCombineNameVariant(e.target.checked)}
                        className="peer sr-only"
                      />
                      <span
                        className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform ${
                          combineNameVariant ? 'translate-x-[16px]' : 'translate-x-[2px]'
                        }`}
                      />
                    </span>
                    <span className="text-[12.5px] text-text-secondary group-hover:text-text-primary transition-colors leading-snug">
                      Merge variant into title
                    </span>
                  </label>
                )}
              </Section>

              {/* Text size & position */}
              <Collapsible
                title="Text & position"
                open={showStyling}
                onToggle={() => setShowStyling(v => !v)}
              >
                <div className="space-y-2">
                  <StyleRow
                    label="Name"
                    fontScale={styling.name?.fontScale ?? 1}
                    offsetY={styling.name?.offsetY ?? 0}
                    disabled={!visibility.name}
                    onChange={(fs, oy) => setStyling(s => ({ ...s, name: { fontScale: fs, offsetY: oy } }))}
                  />
                  <StyleRow
                    label="Variant"
                    fontScale={styling.variant?.fontScale ?? 1}
                    offsetY={styling.variant?.offsetY ?? 0}
                    disabled={!visibility.variant || !variantName}
                    onChange={(fs, oy) => setStyling(s => ({ ...s, variant: { fontScale: fs, offsetY: oy } }))}
                  />
                  <StyleRow
                    label="Price"
                    fontScale={priceFontScaleToDisplay(styling.price?.fontScale ?? PRICE_DEFAULT_FONT_SCALE)}
                    offsetY={styling.price?.offsetY ?? 0}
                    disabled={!visibility.price || price == null || price <= 0}
                    onChange={(fs, oy) => setStyling(s => ({ ...s, price: { fontScale: priceFontScaleFromDisplay(fs), offsetY: oy } }))}
                  />
                </div>
              </Collapsible>

              {/* Barcode size */}
              <Collapsible
                title="Barcode size"
                open={showBarcodeSize}
                onToggle={() => setShowBarcodeSize(v => !v)}
                trailing={
                  showBarcodeSize ? (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        setBarcodeSize({ widthScale: 1.12, heightScale: 1.18, scale: 1 });
                      }}
                      className="text-[12px] font-medium text-navy hover:opacity-70 transition-opacity"
                    >
                      Reset
                    </button>
                  ) : undefined
                }
              >
                <div className="space-y-2">
                  <SizeRow
                    label="Width"
                    value={barcodeSize.widthScale ?? 1}
                    min={0.8}
                    max={1.4}
                    step={0.05}
                    onChange={v => setBarcodeSize(s => ({ ...s, widthScale: v }))}
                  />
                  <SizeRow
                    label="Height"
                    value={barcodeSize.heightScale ?? 1}
                    min={0.7}
                    max={2}
                    step={0.05}
                    onChange={v => setBarcodeSize(s => ({ ...s, heightScale: v }))}
                  />
                  <SizeRow
                    label="Scale"
                    value={barcodeSize.scale ?? 1}
                    min={0.8}
                    max={2}
                    step={0.05}
                    onChange={v => setBarcodeSize(s => ({ ...s, scale: v }))}
                  />
                  <p className="text-[11.5px] text-text-muted leading-relaxed pt-0.5">
                    Lower height or scale to free vertical space on small tags. Too small may hurt scanner readability.
                  </p>
                </div>
              </Collapsible>

              {/* Printer */}
              <Section title="Printer">
                <div className="flex gap-2">
                  <div className="relative flex-1 min-w-0">
                    <select
                      value={printerName}
                      onChange={e => onPickPrinter(e.target.value)}
                      disabled={loadingPrinters || printing}
                      className="field-select pr-9"
                    >
                      {printers.length === 0 && !loadingPrinters && (
                        <option value="">No printers found</option>
                      )}
                      {printers.map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                    <ChevronDown
                      size={14}
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={refreshPrinters}
                    disabled={loadingPrinters || printing}
                    title="Refresh printer list"
                    className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl border border-border bg-card text-text-secondary hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-50"
                  >
                    <RefreshCw size={15} className={loadingPrinters ? 'animate-spin' : ''} />
                  </button>
                </div>
              </Section>

              {/* Paper size — segmented control */}
              <Section title="Paper size">
                <div className="flex items-center gap-0.5 rounded-xl bg-surface p-1 border border-border/60">
                  {PAPER_PRESETS.map(p => {
                    const active = paperKey === p.key;
                    return (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => setPaperKey(p.key)}
                        className={`flex-1 px-3 py-2 rounded-[10px] text-[12.5px] font-medium transition-all ${
                          active
                            ? 'bg-card text-text-primary shadow-[0_1px_3px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.04)]'
                            : 'text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </Section>

              {/* Advanced */}
              <Collapsible
                title="Advanced settings"
                open={showAdvanced}
                onToggle={() => setShowAdvanced(v => !v)}
              >
                <div className="grid grid-cols-2 gap-3">
                  <NumberField
                    label="Density"
                    value={tunables.density}
                    min={0}
                    max={15}
                    onChange={v => setTunables(o => ({ ...o, density: v }))}
                    hint="0–15"
                  />
                  <NumberField
                    label="Direction"
                    value={tunables.direction}
                    min={0}
                    max={1}
                    onChange={v => setTunables(o => ({ ...o, direction: v }))}
                    hint="0 or 1"
                  />
                  <NumberField
                    label="V-Shift"
                    value={tunables.shift}
                    min={-50}
                    max={50}
                    onChange={v => setTunables(o => ({ ...o, shift: v }))}
                    hint="vertical dots"
                  />
                  <NumberField
                    label="H-Shift"
                    value={displayShiftX}
                    min={-SHIFT_X_RANGE}
                    max={SHIFT_X_RANGE}
                    onChange={v => setTunables(o => ({ ...o, shiftX: XP350B_CENTER_SHIFT_X + v }))}
                    hint="− left · + right (same as above)"
                  />
                </div>
              </Collapsible>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 px-5 sm:px-7 py-3.5 border-t border-border/80 bg-card/95 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-[12.5px] font-medium text-text-secondary">Copies</span>
            <div className="flex items-center rounded-xl border border-border overflow-hidden bg-surface">
              <button
                type="button"
                onClick={() => setCopies(c => Math.max(1, c - 1))}
                disabled={copies <= 1 || printing}
                className="w-9 h-9 flex items-center justify-center text-text-secondary hover:bg-card hover:text-text-primary disabled:opacity-35 transition-colors text-[15px]"
              >
                −
              </button>
              <input
                type="number"
                min={1}
                max={999}
                value={copies}
                onChange={e => {
                  const n = parseInt(e.target.value, 10);
                  setCopies(Number.isFinite(n) && n > 0 ? Math.min(999, n) : 1);
                }}
                disabled={printing}
                className="w-11 h-9 text-center text-[13px] font-semibold tabular-nums text-text-primary border-x border-border bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                type="button"
                onClick={() => setCopies(c => Math.min(999, c + 1))}
                disabled={copies >= 999 || printing}
                className="w-9 h-9 flex items-center justify-center text-text-secondary hover:bg-card hover:text-text-primary disabled:opacity-35 transition-colors text-[15px]"
              >
                +
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={printing}
              className="px-4 py-2 rounded-xl text-[13px] font-medium text-text-secondary hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={onPrint}
              disabled={printing || !!barcodeError || !printerName}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-navy text-white text-[13px] font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.12)] hover:bg-navy-light active:scale-[0.98] transition-all disabled:opacity-45 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              {printing ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} strokeWidth={2.25} />}
              {printing ? 'Printing…' : t('barcode.print')}
            </button>
          </div>
        </div>
      </div>

      {/* Shared field styles scoped to this modal tree via arbitrary utility classes above */}
      <style>{`
        .field-select {
          width: 100%;
          appearance: none;
          -webkit-appearance: none;
          background-color: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 12px;
          padding: 0.55rem 2.25rem 0.55rem 0.85rem;
          font-size: 13px;
          line-height: 1.35;
          color: var(--color-text-primary);
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .field-select:focus {
          outline: none;
          border-color: color-mix(in srgb, var(--color-navy) 35%, var(--color-border));
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-navy) 12%, transparent);
        }
        .field-select:disabled {
          opacity: 0.55;
        }
      `}</style>
    </div>
  );
}

/* ─── Small presentational helpers ─── */

function MetaChip({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-card border border-border/80 px-2.5 py-1 text-[11.5px] text-text-secondary shadow-sm ${
        mono ? 'font-mono tracking-wide' : 'font-medium'
      }`}
    >
      {children}
    </span>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200/80 dark:border-red-500/20 px-3.5 py-2.5">
      <AlertTriangle size={15} className="text-accent-red flex-shrink-0 mt-0.5" />
      <p className="text-[12.5px] text-accent-red font-medium leading-snug">{message}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted mb-2">
        {title}
      </h4>
      {children}
    </div>
  );
}

function Collapsible({
  title,
  open,
  onToggle,
  trailing,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/80 bg-surface/40 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-surface/80 transition-colors"
      >
        <span className="text-[13px] font-medium text-text-primary">{title}</span>
        <span className="flex items-center gap-2">
          {trailing}
          <ChevronDown
            size={15}
            className={`text-text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>
      {open && (
        <div className="px-3.5 pb-3.5 pt-0.5 border-t border-border/60">
          {children}
        </div>
      )}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border text-[12.5px] font-medium transition-all ${
        disabled
          ? 'border-border/60 bg-surface/50 text-text-muted opacity-50 cursor-not-allowed'
          : checked
            ? 'border-navy/25 bg-navy/[0.07] text-text-primary shadow-sm'
            : 'border-border bg-card text-text-secondary hover:border-border hover:bg-surface'
      }`}
    >
      <span>{label}</span>
      <span
        className={`relative inline-flex h-[18px] w-[32px] flex-shrink-0 rounded-full transition-colors ${
          checked && !disabled ? 'bg-navy' : 'bg-text-muted/25'
        }`}
      >
        <span
          className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-[16px]' : 'translate-x-[2px]'
          }`}
        />
      </span>
    </button>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-text-muted mb-1">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={e => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
        }}
        className="w-full rounded-xl border border-border bg-card px-3 py-2 text-[13px] text-text-primary tabular-nums focus:outline-none focus:ring-[3px] focus:ring-navy/12 focus:border-navy/30 transition-shadow"
      />
      {hint && <p className="text-[10.5px] text-text-muted mt-1">{hint}</p>}
    </div>
  );
}

/** A −/+ stepper for a numeric value, with the value shown in the middle. */
function Stepper({
  value,
  min,
  max,
  step,
  disabled,
  onChange,
  format,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const dec = () => onChange(Math.max(min, Math.round((value - step) * 100) / 100));
  const inc = () => onChange(Math.min(max, Math.round((value + step) * 100) / 100));
  return (
    <div className={`flex items-center gap-1 ${disabled ? 'opacity-40' : ''}`}>
      <button
        type="button"
        onClick={dec}
        disabled={disabled || value <= min}
        className="w-7 h-7 flex items-center justify-center rounded-lg border border-border bg-card text-text-secondary hover:bg-surface hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 transition-colors text-[13px]"
      >
        −
      </button>
      <span className="w-12 text-center text-[12px] font-semibold text-text-primary tabular-nums">
        {format ? format(value) : value}
      </span>
      <button
        type="button"
        onClick={inc}
        disabled={disabled || value >= max}
        className="w-7 h-7 flex items-center justify-center rounded-lg border border-border bg-card text-text-secondary hover:bg-surface hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 transition-colors text-[13px]"
      >
        +
      </button>
    </div>
  );
}

/** One row of per-element styling: label, font-size stepper, position stepper. */
function StyleRow({
  label,
  fontScale,
  offsetY,
  disabled,
  onChange,
}: {
  label: string;
  fontScale: number;
  offsetY: number;
  disabled?: boolean;
  onChange: (fontScale: number, offsetY: number) => void;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-card border border-border/70 ${
        disabled ? 'opacity-50' : ''
      }`}
    >
      <span className="text-[12.5px] font-medium text-text-primary w-14 flex-shrink-0">{label}</span>
      <div className="flex items-center gap-4">
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[10px] font-medium text-text-muted">Size</span>
          <Stepper
            value={fontScale}
            min={0.5}
            max={3}
            step={0.1}
            disabled={disabled}
            onChange={v => onChange(v, offsetY)}
            format={v => `${v.toFixed(1)}×`}
          />
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[10px] font-medium text-text-muted">Pos</span>
          <Stepper
            value={offsetY}
            min={-40}
            max={40}
            step={1}
            disabled={disabled}
            onChange={v => onChange(fontScale, v)}
            format={v => (v > 0 ? `+${v}` : `${v}`)}
          />
        </div>
      </div>
    </div>
  );
}

/** One row of barcode sizing: label + a single multiplier stepper (in ×). */
function SizeRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-card border border-border/70">
      <span className="text-[12.5px] font-medium text-text-primary w-14 flex-shrink-0">{label}</span>
      <Stepper
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={onChange}
        format={v => `${v.toFixed(2)}×`}
      />
    </div>
  );
}

import { useState, useEffect, useMemo, useId, Fragment, type CSSProperties, type ReactNode } from 'react';
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
// shiftX = 0 is geometric center of the label bitmap. Negative moves left,
// positive right. Range must cover a full half-label so far-left can pin any
// element (short title or barcode) flush to x = 0 on both 25mm and 35mm tags.
const XP350B_CENTER_SHIFT_X = 0;
const SHIFT_X_RANGE = 240;

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
  // inline title line instead of a separate subtitle. Defaults on.
  const [combineNameVariant, setCombineNameVariant] = useState<boolean>(saved?.combineNameVariant ?? true);
  // Joiner between name and variant when merged. Default is a space — no dash
  // unless the merchant types one (e.g. " - ", " — ", " / ").
  const [nameVariantSeparator, setNameVariantSeparator] = useState<string>(
    saved?.nameVariantSeparator ?? ' ',
  );
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
      ? t('print.barcode.invalid', { barcode: effectiveBarcode })
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
        nameVariantSeparator,
        widthPx,
        heightPx,
      });
    } catch {
      return null;
    }
  }, [effectiveBarcode, productName, effectiveVariantName, effectivePrice, barcodeError, paper, tunables.shiftX, visibility, styling, barcodeSize, combineNameVariant, nameVariantSeparator]);

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
          nameVariantSeparator,
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
        nameVariantSeparator,
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
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />

      <div
        className="relative w-[70vw] max-w-[960px] min-w-[320px] max-h-[min(92vh,880px)] flex flex-col rounded-2xl bg-card border border-border-light shadow-raised overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="barcode-print-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-border-light shrink-0">
          <div className="min-w-0">
            <h3
              id="barcode-print-title"
              className="text-[17px] font-semibold tracking-tight text-text-primary"
            >
              {t('barcode.title')}
            </h3>
            <p className="text-[13px] text-text-secondary mt-0.5 truncate">
              {productName}
              {effectiveVariantName ? ` · ${effectiveVariantName}` : ''}
              {displayPrice ? ` · ${displayPrice}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={printing}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-text-secondary hover:bg-border-light hover:text-text-primary transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30"
            aria-label={t('common.close')}
          >
            <X size={15} strokeWidth={2.25} aria-hidden="true" />
          </button>
        </div>

        {/* Body — two-column on wide, stacked on narrow */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-0 lg:min-h-full">
            {/* ── Left: preview stage ── */}
            <div className="flex flex-col bg-surface border-b lg:border-b-0 lg:border-r border-border-light">
              <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 sm:px-8 py-8 sm:py-10">
                <div className="w-full max-w-[460px]">
                  <div className="flex items-center justify-between mb-2.5 px-0.5">
                    <span className="eyebrow">{t('print.preview.title')}</span>
                    <span className="text-[13px] text-text-secondary">
                      {t('print.preview.matches')}
                    </span>
                  </div>
                  {/* The white rectangle is the actual rendered paper preview.
                      Its colours are fixed (white paper, dark text) because that is what prints. */}
                  <div className="relative flex w-full items-center justify-center p-2 sm:p-3">
                    <div
                      className="relative w-full max-w-[380px] bg-white overflow-hidden shadow-raised ring-1 ring-black/5"
                      style={{ aspectRatio: `1 / ${previewAspect}` }}
                    >
                      {previewSrc ? (
                        <img
                          src={previewSrc}
                          alt={t('print.preview.labelAlt')}
                          className="absolute inset-0 h-full w-full object-fill"
                        />
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-text-muted">
                          <Tag size={28} strokeWidth={1.5} className="opacity-40" aria-hidden="true" />
                          <p className="text-[13px]">{t('print.preview.none')}</p>
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
                      {t('print.shift.chip', {
                        value: `${tunables.shiftX > 0 ? '+' : ''}${tunables.shiftX}`,
                        unit: t('print.unit.dots'),
                      })}
                    </MetaChip>
                  )}
                </div>
              </div>
            </div>

            {/* ── Right: controls ── */}
            <div className="flex flex-col gap-5 px-5 sm:px-6 py-5 sm:py-6">
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
                <Section title={t('invoice.variant')}>
                  <div className="relative">
                    <select
                      value={selectedVariantId}
                      onChange={e => setSelectedVariantId(e.target.value)}
                      aria-label={t('invoice.variant')}
                      className="field-select"
                    >
                      <option value="">{t('print.variant.none')}</option>
                      {variants.map(v => (
                        <option key={v.id} value={v.id}>
                          {v.variant_name}{v.selling_price ? ` — ${v.selling_price.toFixed(2)} DA` : ''}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={14}
                      aria-hidden="true"
                      className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-text-secondary"
                    />
                  </div>
                </Section>
              )}

              {/* Horizontal position — primary control for left-rail printers */}
              <Section title={t('print.shift.title')}>
                <div className="rounded-2xl border border-border bg-surface px-4 py-4 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-navy/10 text-navy">
                      <MoveHorizontal size={14} strokeWidth={2.25} aria-hidden="true" />
                    </div>
                    <p className="text-[14px] text-text-secondary leading-relaxed">
                      {renderRich(t('print.shift.help'), {
                        center: <span className="font-medium text-text-primary">{t('print.shift.center')}</span>,
                        left: <span className="font-medium text-text-primary">{t('print.shift.left')}</span>,
                      })}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setTunables(o => ({ ...o, shiftX: Math.max(minShiftX, o.shiftX - 5) }))}
                      className="h-9 min-w-[4.5rem] px-3 rounded-xl border border-border bg-card text-[13px] font-medium text-text-primary hover:bg-surface transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30"
                    >
                      ← {t('print.shift.moveLeft')}
                    </button>
                    <input
                      type="range"
                      min={minShiftX}
                      max={maxShiftX}
                      step={1}
                      value={tunables.shiftX}
                      onChange={e => setTunables(o => ({ ...o, shiftX: Number(e.target.value) }))}
                      className="barcode-range flex-1 min-w-0 cursor-pointer"
                      style={{
                        '--range-fill': `${((tunables.shiftX - minShiftX) / (maxShiftX - minShiftX)) * 100}%`,
                      } as CSSProperties}
                      aria-label={t('print.shift.rangeLabel')}
                    />
                    <button
                      type="button"
                      onClick={() => setTunables(o => ({ ...o, shiftX: Math.min(maxShiftX, o.shiftX + 5) }))}
                      className="h-9 min-w-[4.5rem] px-3 rounded-xl border border-border bg-card text-[13px] font-medium text-text-primary hover:bg-surface transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30"
                    >
                      {t('print.shift.moveRight')} →
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setTunables(o => ({ ...o, shiftX: Math.max(minShiftX, o.shiftX - 1) }))}
                        aria-label={t('print.shift.nudgeLeft')}
                        className="w-8 h-8 flex items-center justify-center rounded-lg border border-border bg-card text-text-secondary hover:bg-surface hover:text-text-primary text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30"
                      >
                        −
                      </button>
                      <span className="w-16 text-center text-[14px] font-semibold tabular-nums text-text-primary" aria-live="polite">
                        {displayShiftX > 0 ? '+' : ''}{displayShiftX}
                      </span>
                      <button
                        type="button"
                        onClick={() => setTunables(o => ({ ...o, shiftX: Math.min(maxShiftX, o.shiftX + 1) }))}
                        aria-label={t('print.shift.nudgeRight')}
                        className="w-8 h-8 flex items-center justify-center rounded-lg border border-border bg-card text-text-secondary hover:bg-surface hover:text-text-primary text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30"
                      >
                        +
                      </button>
                      <span className="text-[13px] text-text-secondary ml-0.5">{t('print.unit.dots')}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTunables(o => ({ ...o, shiftX: XP350B_CENTER_SHIFT_X }))}
                      className="rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-navy hover:bg-navy/10 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30"
                    >
                      {t('print.shift.center')}
                    </button>
                  </div>
                </div>
              </Section>

              {/* Content visibility */}
              <Section title={t('print.visibility.title')}>
                <div className="grid grid-cols-2 gap-2">
                  <Toggle
                    label={t('common.name')}
                    checked={visibility.name ?? true}
                    onChange={v => setVisibility(s => ({ ...s, name: v }))}
                  />
                  <Toggle
                    label={t('invoice.variant')}
                    checked={visibility.variant ?? true}
                    disabled={!effectiveVariantName}
                    onChange={v => setVisibility(s => ({ ...s, variant: v }))}
                  />
                  <Toggle
                    label={t('common.price')}
                    checked={visibility.price ?? true}
                    disabled={effectivePrice == null || effectivePrice <= 0}
                    onChange={v => setVisibility(s => ({ ...s, price: v }))}
                  />
                  <Toggle
                    label={t('barcode.label')}
                    checked={visibility.barcode ?? true}
                    onChange={v => setVisibility(s => ({ ...s, barcode: v }))}
                  />
                </div>
                {effectiveVariantName && (visibility.name ?? true) && (visibility.variant ?? true) && (
                  <div className="mt-3 space-y-3">
                    <label className="flex items-center gap-3 cursor-pointer select-none group">
                      <span
                        className={`relative inline-flex h-[22px] w-[38px] flex-shrink-0 rounded-full transition-colors has-focus-visible:ring-[3px] has-focus-visible:ring-navy/30 ${
                          combineNameVariant ? 'bg-navy' : 'bg-text-muted/40'
                        }`}
                      >
                        <input
                          type="checkbox"
                          role="switch"
                          checked={combineNameVariant}
                          onChange={e => setCombineNameVariant(e.target.checked)}
                          className="peer sr-only"
                        />
                        <span
                          aria-hidden="true"
                          className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-card shadow-sm transition-transform ${
                            combineNameVariant ? 'translate-x-[18px]' : 'translate-x-[2px]'
                          }`}
                        />
                      </span>
                      <span className="text-[14px] text-text-secondary group-hover:text-text-primary transition-colors leading-snug">
                        {t('print.combine.label')}
                      </span>
                    </label>
                    {combineNameVariant && (
                      <div className="flex flex-wrap items-center gap-2 pl-[50px]">
                        <label
                          htmlFor="name-variant-sep"
                          className="text-[13px] font-medium text-text-secondary shrink-0"
                        >
                          {t('print.separator.label')}
                        </label>
                        <input
                          id="name-variant-sep"
                          type="text"
                          value={nameVariantSeparator}
                          onChange={e => setNameVariantSeparator(e.target.value)}
                          placeholder={t('print.separator.placeholder')}
                          maxLength={8}
                          className="w-24 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[13px] text-text-primary font-mono placeholder:text-text-muted focus-visible:outline-none focus-visible:border-navy focus-visible:ring-[3px] focus-visible:ring-navy/20 transition-[border-color,box-shadow] duration-150"
                          title={t('print.separator.title')}
                        />
                        <span className="text-[13px] text-text-secondary min-w-0">
                          {t('print.separator.hint')}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </Section>

              {/* Text size & position */}
              <Collapsible
                title={t('print.styling.title')}
                open={showStyling}
                onToggle={() => setShowStyling(v => !v)}
              >
                <div className="space-y-2">
                  <StyleRow
                    label={t('common.name')}
                    fontScale={styling.name?.fontScale ?? 1}
                    offsetY={styling.name?.offsetY ?? 0}
                    disabled={!visibility.name}
                    onChange={(fs, oy) => setStyling(s => ({ ...s, name: { fontScale: fs, offsetY: oy } }))}
                  />
                  <StyleRow
                    label={t('invoice.variant')}
                    fontScale={styling.variant?.fontScale ?? 1}
                    offsetY={styling.variant?.offsetY ?? 0}
                    // Same size/pos knobs as Name; uses the same typeface.
                    // Disabled when no variant, hidden, or merged into the title
                    // (combined line is styled by Name).
                    disabled={
                      !visibility.variant
                      || !effectiveVariantName
                      || (!!combineNameVariant && (visibility.name ?? true))
                    }
                    onChange={(fs, oy) => setStyling(s => ({ ...s, variant: { fontScale: fs, offsetY: oy } }))}
                  />
                  <StyleRow
                    label={t('common.price')}
                    fontScale={priceFontScaleToDisplay(styling.price?.fontScale ?? PRICE_DEFAULT_FONT_SCALE)}
                    offsetY={styling.price?.offsetY ?? 0}
                    disabled={!visibility.price || price == null || price <= 0}
                    onChange={(fs, oy) => setStyling(s => ({ ...s, price: { fontScale: priceFontScaleFromDisplay(fs), offsetY: oy } }))}
                  />
                  <p className="text-[13px] text-text-secondary leading-relaxed pt-0.5">
                    {t('print.styling.note')}
                  </p>
                </div>
              </Collapsible>

              {/* Barcode size */}
              <Collapsible
                title={t('print.barcodeSize.title')}
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
                      className="mr-1 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-navy hover:bg-navy/10 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30"
                    >
                      {t('print.reset')}
                    </button>
                  ) : undefined
                }
              >
                <div className="space-y-2">
                  <SizeRow
                    label={t('print.size.width')}
                    value={barcodeSize.widthScale ?? 1}
                    min={0.8}
                    max={1.4}
                    step={0.05}
                    onChange={v => setBarcodeSize(s => ({ ...s, widthScale: v }))}
                  />
                  <SizeRow
                    label={t('print.size.height')}
                    value={barcodeSize.heightScale ?? 1}
                    min={0.7}
                    max={2}
                    step={0.05}
                    onChange={v => setBarcodeSize(s => ({ ...s, heightScale: v }))}
                  />
                  <SizeRow
                    label={t('print.size.scale')}
                    value={barcodeSize.scale ?? 1}
                    min={0.8}
                    max={2}
                    step={0.05}
                    onChange={v => setBarcodeSize(s => ({ ...s, scale: v }))}
                  />
                  <p className="text-[13px] text-text-secondary leading-relaxed pt-0.5">
                    {t('print.barcodeSize.note')}
                  </p>
                </div>
              </Collapsible>

              {/* Printer */}
              <Section title={t('print.printer.title')}>
                <div className="flex gap-2">
                  <div className="relative flex-1 min-w-0">
                    <select
                      value={printerName}
                      onChange={e => onPickPrinter(e.target.value)}
                      disabled={loadingPrinters || printing}
                      aria-label={t('print.printer.title')}
                      className="field-select pr-9"
                    >
                      {printers.length === 0 && !loadingPrinters && (
                        <option value="">{t('print.printer.none')}</option>
                      )}
                      {printers.map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                    <ChevronDown
                      size={14}
                      aria-hidden="true"
                      className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-text-secondary"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={refreshPrinters}
                    disabled={loadingPrinters || printing}
                    title={t('print.printer.refresh')}
                    aria-label={t('print.printer.refresh')}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-text-secondary hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30"
                  >
                    <RefreshCw size={15} className={loadingPrinters ? 'animate-spin' : ''} aria-hidden="true" />
                  </button>
                </div>
              </Section>

              {/* Paper size — segmented control */}
              <Section title={t('print.paper.title')}>
                <div role="group" aria-label={t('print.paper.title')}className="flex items-center gap-1 rounded-xl bg-surface p-1 border border-border">
                  {PAPER_PRESETS.map(p => {
                    const active = paperKey === p.key;
                    return (
                      <button
                        key={p.key}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setPaperKey(p.key)}
                        className={`flex-1 px-3 py-2 rounded-[10px] text-[14px] transition-all focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30 ${
                          active
                            ? 'bg-card text-text-primary font-semibold shadow-sm'
                            : 'text-text-secondary font-medium hover:text-text-primary'
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
                title={t('print.advanced.title')}
                open={showAdvanced}
                onToggle={() => setShowAdvanced(v => !v)}
              >
                <div className="grid grid-cols-2 gap-3">
                  <NumberField
                    label={t('print.field.density')}
                    value={tunables.density}
                    min={0}
                    max={15}
                    onChange={v => setTunables(o => ({ ...o, density: v }))}
                    hint="0–15"
                  />
                  <NumberField
                    label={t('print.field.direction')}
                    value={tunables.direction}
                    min={0}
                    max={1}
                    onChange={v => setTunables(o => ({ ...o, direction: v }))}
                    hint={t('print.hint.zeroOrOne')}
                  />
                  <NumberField
                    label={t('print.field.vShift')}
                    value={tunables.shift}
                    min={-50}
                    max={50}
                    onChange={v => setTunables(o => ({ ...o, shift: v }))}
                    hint={t('print.hint.verticalDots')}
                  />
                  <NumberField
                    label={t('print.field.hShift')}
                    value={displayShiftX}
                    min={-SHIFT_X_RANGE}
                    max={SHIFT_X_RANGE}
                    onChange={v => setTunables(o => ({ ...o, shiftX: XP350B_CENTER_SHIFT_X + v }))}
                    hint={t('print.hint.hShift')}
                  />
                </div>
              </Collapsible>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 sm:px-7 py-4 border-t border-border-light bg-card shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-[13px] font-medium text-text-secondary">{t('print.copies')}</span>
            <div className="flex items-center rounded-xl border border-border overflow-hidden bg-surface">
              <button
                type="button"
                onClick={() => setCopies(c => Math.max(1, c - 1))}
                disabled={copies <= 1 || printing}
                aria-label={t('print.a11y.decrease', { label: t('print.copies') })}
                className="w-9 h-9 flex items-center justify-center text-text-secondary hover:bg-card hover:text-text-primary disabled:opacity-35 transition-colors text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy/40"
              >
                −
              </button>
              <input
                type="number"
                min={1}
                max={999}
                value={copies}
                aria-label={t('print.copies')}
                onChange={e => {
                  const n = parseInt(e.target.value, 10);
                  setCopies(Number.isFinite(n) && n > 0 ? Math.min(999, n) : 1);
                }}
                disabled={printing}
                className="w-12 h-9 text-center text-[14px] font-semibold tabular-nums text-text-primary border-x border-border bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                type="button"
                onClick={() => setCopies(c => Math.min(999, c + 1))}
                disabled={copies >= 999 || printing}
                aria-label={t('print.a11y.increase', { label: t('print.copies') })}
                className="w-9 h-9 flex items-center justify-center text-text-secondary hover:bg-card hover:text-text-primary disabled:opacity-35 transition-colors text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy/40"
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
              className="btn-secondary"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={onPrint}
              disabled={printing || !!barcodeError || !printerName}
              className="btn-primary px-5 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              {printing ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Printer size={15} strokeWidth={2.25} aria-hidden="true" />}
              {printing ? t('print.printing') : t('barcode.print')}
            </button>
          </div>
        </div>
      </div>

      {/* Shared field styles and range slider, scoped to this modal tree */}
      <style>{`
        .field-select {
          width: 100%;
          appearance: none;
          -webkit-appearance: none;
          background-color: var(--color-card);
          border: 1px solid var(--color-border);
          border-radius: 12px;
          height: 2.5rem;
          padding: 0 2.25rem 0 0.85rem;
          font-size: 14px;
          line-height: 1.35;
          color: var(--color-text-primary);
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .field-select:focus-visible {
          outline: none;
          border-color: var(--color-navy);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-navy) 25%, transparent);
        }
        .field-select:disabled {
          opacity: 0.55;
        }

        .barcode-range {
          -webkit-appearance: none;
          appearance: none;
          height: 6px;
          border-radius: 999px;
          background: linear-gradient(
            to right,
            var(--color-navy) 0%,
            var(--color-navy) var(--range-fill, 50%),
            var(--color-border) var(--range-fill, 50%),
            var(--color-border) 100%
          );
          outline: none;
        }
        .barcode-range::-webkit-slider-runnable-track {
          height: 6px;
          border-radius: 999px;
          background: transparent;
        }
        [dir="rtl"] .barcode-range {
          background: linear-gradient(
            to left,
            var(--color-navy) 0%,
            var(--color-navy) var(--range-fill, 50%),
            var(--color-border) var(--range-fill, 50%),
            var(--color-border) 100%
          );
        }
        .barcode-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          box-sizing: border-box;
          width: 18px;
          height: 18px;
          margin-top: -6px;
          border: 1px solid var(--color-border);
          border-radius: 50%;
          background: var(--color-card);
          box-shadow: var(--shadow-raised);
          transition: box-shadow 0.15s;
        }
        .barcode-range::-moz-range-track {
          height: 6px;
          border-radius: 999px;
          background: transparent;
        }
        .barcode-range::-moz-range-progress {
          height: 6px;
          border-radius: 999px;
          background: var(--color-navy);
        }
        .barcode-range::-moz-range-thumb {
          box-sizing: border-box;
          width: 18px;
          height: 18px;
          border: 1px solid var(--color-border);
          border-radius: 50%;
          background: var(--color-card);
          box-shadow: var(--shadow-raised);
        }
        .barcode-range:focus-visible::-webkit-slider-thumb {
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-navy) 30%, transparent);
        }
        .barcode-range:focus-visible::-moz-range-thumb {
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-navy) 30%, transparent);
        }
      `}</style>
    </div>
  );
}

/* ─── Small presentational helpers ─── */

/**
 * Splits a translated template on its `{name}` placeholders and swaps each one
 * for a React node, so emphasised words can stay inside their own elements.
 */
function renderRich(template: string, parts: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{[a-z]+\})/).map((segment, i) => {
    const match = /^\{([a-z]+)\}$/.exec(segment);
    return match && match[1] in parts ? <Fragment key={i}>{parts[match[1]]}</Fragment> : segment;
  });
}

function MetaChip({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-card border border-border px-2.5 py-1 text-[13px] text-text-secondary ${
        mono ? 'font-mono tracking-wide' : 'font-medium'
      }`}
    >
      {children}
    </span>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-xl bg-accent-red/10 border border-accent-red/25 px-3.5 py-2.5">
      <AlertTriangle size={15} className="text-accent-red flex-shrink-0 mt-0.5" aria-hidden="true" />
      <p className="text-[13px] text-accent-red font-medium leading-snug">{message}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="eyebrow mb-2.5">{title}</h4>
      {children}
    </div>
  );
}

/**
 * Disclosure group. The header toggle and the optional trailing action are
 * sibling controls (never nested buttons), and the toggle exposes aria-expanded.
 */
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
  const panelId = useId();
  return (
    <div className="rounded-2xl border border-border bg-surface overflow-hidden">
      <div className="flex w-full items-center justify-between gap-3 pr-4 hover:bg-card transition-colors">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex flex-1 min-w-0 items-center justify-between gap-3 px-4 py-3 text-left rounded-2xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-navy/30"
        >
          <span className="text-[14px] font-medium text-text-primary">{title}</span>
          <ChevronDown
            size={15}
            aria-hidden="true"
            className={`text-text-secondary transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </button>
        {trailing}
      </div>
      {open && (
        <div id={panelId} className="px-4 pb-4 pt-1 border-t border-border-light">
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
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border text-[14px] font-medium transition-all focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30 ${
        disabled
          ? 'border-border-light bg-surface text-text-muted opacity-60 cursor-not-allowed'
          : checked
            ? 'border-navy/40 bg-navy/10 text-text-primary'
            : 'border-border bg-card text-text-secondary hover:bg-surface hover:text-text-primary'
      }`}
    >
      <span>{label}</span>
      <span
        aria-hidden="true"
        className={`relative inline-flex h-[22px] w-[38px] flex-shrink-0 rounded-full transition-colors ${
          checked && !disabled ? 'bg-navy' : 'bg-text-muted/40'
        }`}
      >
        <span
          className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-card shadow-sm transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-[2px]'
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
  const inputId = useId();
  return (
    <div>
      <label htmlFor={inputId} className="block text-[13px] font-medium text-text-secondary mb-1.5">
        {label}
      </label>
      <input
        id={inputId}
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={e => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
        }}
        className="w-full rounded-xl border border-border bg-card px-3 py-2 text-[14px] text-text-primary tabular-nums focus-visible:outline-none focus-visible:border-navy focus-visible:ring-[3px] focus-visible:ring-navy/20 transition-[border-color,box-shadow] duration-150"
      />
      {hint && <p className="text-[13px] text-text-secondary mt-1.5">{hint}</p>}
    </div>
  );
}

/** A −/+ stepper for a numeric value, with the value shown in the middle. */
function Stepper({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
  format,
}: {
  /** Accessible name for the control, e.g. "Name size". */
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const { t } = useI18n();
  const dec = () => onChange(Math.max(min, Math.round((value - step) * 100) / 100));
  const inc = () => onChange(Math.min(max, Math.round((value + step) * 100) / 100));
  const stepBtn =
    'w-8 h-8 flex items-center justify-center rounded-lg border border-border bg-card text-text-secondary hover:bg-surface hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 transition-colors text-[14px] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30';
  return (
    <div className={`flex items-center gap-1.5 ${disabled ? 'opacity-40' : ''}`}>
      <button
        type="button"
        onClick={dec}
        disabled={disabled || value <= min}
        aria-label={t('print.a11y.decrease', { label })}
        className={stepBtn}
      >
        −
      </button>
      <span className="w-14 text-center text-[13px] font-semibold text-text-primary tabular-nums">
        {format ? format(value) : value}
      </span>
      <button
        type="button"
        onClick={inc}
        disabled={disabled || value >= max}
        aria-label={t('print.a11y.increase', { label })}
        className={stepBtn}
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
  const { t } = useI18n();
  return (
    <div
      className={`flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-card border border-border ${
        disabled ? 'opacity-50' : ''
      }`}
    >
      <span className="text-[14px] font-medium text-text-primary w-14 flex-shrink-0">{label}</span>
      <div className="flex items-center gap-4">
        <div className="flex flex-col items-center gap-1">
          <span className="text-[13px] font-medium text-text-secondary">{t('print.styling.size')}</span>
          <Stepper
            label={t('print.a11y.size', { label })}
            value={fontScale}
            min={0.5}
            max={3}
            step={0.1}
            disabled={disabled}
            onChange={v => onChange(v, offsetY)}
            format={v => `${v.toFixed(1)}×`}
          />
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="text-[13px] font-medium text-text-secondary">{t('print.styling.pos')}</span>
          <Stepper
            label={t('print.a11y.position', { label })}
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
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-card border border-border">
      <span className="text-[14px] font-medium text-text-primary w-14 flex-shrink-0">{label}</span>
      <Stepper
        label={t('print.a11y.barcodeSize', { label })}
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

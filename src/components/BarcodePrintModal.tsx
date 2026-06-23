import { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useI18n } from '../i18n';
import { X, Printer, AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';
import {
  PAPER_PRESETS,
  getSavedPrinter,
  setSavedPrinter,
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

export default function BarcodePrintModal({ barcode, productName, productId, variantName, price, onClose }: BarcodePrintModalProps) {
  const { t } = useI18n();
  const [paperKey, setPaperKey] = useState<PaperPreset['key']>('medium');
  const [printers, setPrinters] = useState<string[]>([]);
  const [printerName, setPrinterName] = useState<string>('');
  const [tunables, setTunables] = useState({ density: 8, direction: 0, shift: 0, shiftX: 0 });
  const [visibility, setVisibility] = useState<LabelVisibility>({
    name: true,
    variant: true,
    price: true,
    barcode: true,
  });
  // Per-element styling: fontScale (1 = default) and offsetY (dots, +down/-up).
  // Resides under "Text & position" — independent of the visibility toggles.
  const [styling, setStyling] = useState<LabelStyling>({
    name: { fontScale: 1, offsetY: 0 },
    variant: { fontScale: 1, offsetY: 0 },
    price: { fontScale: 1, offsetY: 0 },
  });
  // Barcode sizing: independent width/height multipliers + a uniform scale.
  // Defaults to 1/1/1 (full width, default bar height). Height/scale < 1 shrink
  // the bars — handy on 25×17mm tags where the default height can feel large.
  const [barcodeSize, setBarcodeSize] = useState<BarcodeSize>({
    widthScale: 1,
    heightScale: 1,
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
  const [combineNameVariant, setCombineNameVariant] = useState(false);

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
  };

  // True preview: render the exact same bitmap the printer will output, shown
  // as a scaled-up image. Recomputes whenever any input changes, so what you
  // see is what you print — name, variant, price, barcode, polarity, shifts.
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
        const saved = getSavedPrinter();
        if (saved && list.includes(saved)) {
          setPrinterName(saved);
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
      const saved = getSavedPrinter();
      if (saved && list.includes(saved)) {
        setPrinterName(saved);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPrinting(false);
    }
  }

  // Preview box sized to the label's aspect ratio so it's proportionally accurate.
  const previewAspect = paper.heightMm / paper.widthMm;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200]" onClick={onClose}>
      <div
        className="bg-card rounded-2xl w-full max-w-[440px] shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="text-[14px] font-bold text-text-primary">{t('barcode.title')}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface text-text-muted transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          {/* Errors */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
              <AlertTriangle size={14} className="text-accent-red flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-accent-red font-medium">{error}</p>
            </div>
          )}
          {barcodeError && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
              <AlertTriangle size={14} className="text-accent-red flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-accent-red font-medium">{barcodeError}</p>
            </div>
          )}

          {/* True preview — what you see is what you print */}
          <div className="flex justify-center bg-surface rounded-xl py-4 border border-border">
            {previewSrc ? (
              <img
                src={previewSrc}
                alt="Label preview"
                style={{ height: 'auto', width: 'auto', maxWidth: 220, aspectRatio: `${1} / ${previewAspect}` }}
                className="rounded border border-border bg-white object-contain"
              />
            ) : (
              <p className="text-[11px] text-text-muted py-8">No preview available</p>
            )}
          </div>

          {/* Variant picker — lets the user choose which variant label to print.
              Only shown when the product has variants. Selecting one overrides
              the product-level barcode/price/variant title. */}
          {variants.length > 0 && (
            <div>
              <label className="block text-[11px] font-semibold text-text-secondary mb-1">
                Variant
              </label>
              <select
                value={selectedVariantId}
                onChange={e => setSelectedVariantId(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-2.5 py-1.5 text-[12px] text-text-primary focus:outline-none focus:ring-1 focus:ring-navy"
              >
                <option value="">None (product label)</option>
                {variants.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.variant_name}{v.selling_price ? ` — ${v.selling_price.toFixed(2)} DA` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Content visibility toggles */}
          <div>
            <label className="block text-[11px] font-semibold text-text-secondary mb-1.5">
              Show on label
            </label>
            <div className="grid grid-cols-2 gap-1.5">
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
            {/* Inline variant merge: "Product — Variant" on one title block. */}
            {effectiveVariantName && (visibility.name ?? true) && (visibility.variant ?? true) && (
              <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={combineNameVariant}
                  onChange={e => setCombineNameVariant(e.target.checked)}
                  className="w-3.5 h-3.5 accent-navy"
                />
                <span className="text-[11px] text-text-secondary">
                  Merge variant into title (e.g. "{productName} — {effectiveVariantName}")
                </span>
              </label>
            )}
          </div>

          {/* Text size & position controls (per-element, independent of toggles) */}
          <div>
            <button
              onClick={() => setShowStyling(v => !v)}
              className="text-[11px] font-semibold text-navy hover:underline"
            >
              {showStyling ? '− Hide' : '+ Show'} text & position
            </button>
            {showStyling && (
              <div className="space-y-2 mt-2">
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
                  fontScale={styling.price?.fontScale ?? 1}
                  offsetY={styling.price?.offsetY ?? 0}
                  disabled={!visibility.price || price == null || price <= 0}
                  onChange={(fs, oy) => setStyling(s => ({ ...s, price: { fontScale: fs, offsetY: oy } }))}
                />
              </div>
            )}
          </div>

          {/* Barcode size: independent width/height multipliers + uniform scale.
              Height/scale < 1 shrink the bars (useful on small labels). */}
          <div>
            <div className="flex items-center justify-between">
              <button
                onClick={() => setShowBarcodeSize(v => !v)}
                className="text-[11px] font-semibold text-navy hover:underline"
              >
                {showBarcodeSize ? '− Hide' : '+ Show'} barcode size
              </button>
              {showBarcodeSize && (
                <button
                  onClick={() => setBarcodeSize({ widthScale: 1, heightScale: 1, scale: 1 })}
                  className="text-[10px] text-text-muted hover:text-text-primary"
                >
                  Reset
                </button>
              )}
            </div>
            {showBarcodeSize && (
              <div className="space-y-2 mt-2">
                <SizeRow
                  label="Width"
                  value={barcodeSize.widthScale ?? 1}
                  min={0.3}
                  max={1.5}
                  step={0.05}
                  onChange={v => setBarcodeSize(s => ({ ...s, widthScale: v }))}
                />
                <SizeRow
                  label="Height"
                  value={barcodeSize.heightScale ?? 1}
                  min={0.2}
                  max={2}
                  step={0.05}
                  onChange={v => setBarcodeSize(s => ({ ...s, heightScale: v }))}
                />
                <SizeRow
                  label="Scale"
                  value={barcodeSize.scale ?? 1}
                  min={0.3}
                  max={2}
                  step={0.05}
                  onChange={v => setBarcodeSize(s => ({ ...s, scale: v }))}
                />
                <p className="text-[9.5px] text-text-muted leading-snug">
                  Lower the height or height-scale to shorten the bars and free vertical space. Narrowing width or scale leaves side margins. Shrinking too much can hurt scanner readability.
                </p>
              </div>
            )}
          </div>

          {/* Printer selector */}
          <div>
            <label className="block text-[11px] font-semibold text-text-secondary mb-1">
              Printer (RAW)
            </label>
            <div className="flex gap-1.5">
              <select
                value={printerName}
                onChange={e => onPickPrinter(e.target.value)}
                disabled={loadingPrinters || printing}
                className="flex-1 min-w-0 bg-surface border border-border rounded-lg px-2.5 py-1.5 text-[12px] text-text-primary focus:outline-none focus:ring-1 focus:ring-navy"
              >
                {printers.length === 0 && !loadingPrinters && (
                  <option value="">No printers found</option>
                )}
                {printers.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <button
                onClick={refreshPrinters}
                disabled={loadingPrinters || printing}
                title="Refresh printer list"
                className="p-1.5 rounded-lg border border-border bg-surface text-text-secondary hover:bg-card transition-colors disabled:opacity-50"
              >
                <RefreshCw size={14} className={loadingPrinters ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          {/* Paper size */}
          <div>
            <label className="block text-[11px] font-semibold text-text-secondary mb-1">
              Paper size
            </label>
            <div className="flex items-center gap-1 bg-surface rounded-lg border border-border p-0.5">
              {PAPER_PRESETS.map(p => (
                <button
                  key={p.key}
                  onClick={() => setPaperKey(p.key)}
                  className={`flex-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    paperKey === p.key ? 'bg-navy text-white' : 'text-text-secondary hover:bg-card'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Advanced tunables */}
          <div>
            <button
              onClick={() => setShowAdvanced(v => !v)}
              className="text-[11px] font-semibold text-navy hover:underline"
            >
              {showAdvanced ? '− Hide' : '+ Show'} advanced settings
            </button>
            {showAdvanced && (
              <div className="grid grid-cols-2 gap-2 mt-2">
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
                  value={tunables.shiftX}
                  min={-50}
                  max={50}
                  onChange={v => setTunables(o => ({ ...o, shiftX: v }))}
                  hint="− = left, + = right"
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-card">
          <button
            onClick={onPrint}
            disabled={printing || !!barcodeError || !printerName}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-navy text-white text-[12px] font-medium hover:bg-navy-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {printing ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
            {printing ? 'Printing…' : t('barcode.print')}
          </button>
        </div>
      </div>
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
      className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors ${
        disabled
          ? 'border-border bg-surface text-text-muted opacity-50 cursor-not-allowed'
          : checked
            ? 'border-navy bg-navy/10 text-navy'
            : 'border-border bg-surface text-text-secondary hover:bg-card'
      }`}
    >
      <span>{label}</span>
      <span
        className={`relative inline-flex h-3.5 w-6 flex-shrink-0 rounded-full transition-colors ${
          checked ? 'bg-navy' : 'bg-text-muted/30'
        }`}
      >
        <span
          className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-3' : 'translate-x-0.5'
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
      <label className="block text-[10px] font-medium text-text-muted mb-0.5">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={e => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
        }}
        className="w-full bg-surface border border-border rounded-md px-2 py-1 text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-navy"
      />
      {hint && <p className="text-[9px] text-text-muted mt-0.5">{hint}</p>}
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
        className="w-5 h-5 flex items-center justify-center rounded-md border border-border bg-surface text-text-secondary hover:bg-card disabled:cursor-not-allowed disabled:opacity-50"
      >
        −
      </button>
      <span className="w-10 text-center text-[10px] font-medium text-text-primary tabular-nums">
        {format ? format(value) : value}
      </span>
      <button
        type="button"
        onClick={inc}
        disabled={disabled || value >= max}
        className="w-5 h-5 flex items-center justify-center rounded-md border border-border bg-surface text-text-secondary hover:bg-card disabled:cursor-not-allowed disabled:opacity-50"
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
      className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-border bg-surface ${
        disabled ? 'opacity-50' : ''
      }`}
    >
      <span className="text-[11px] font-medium text-text-primary w-14 flex-shrink-0">{label}</span>
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-center">
          <span className="text-[8px] text-text-muted mb-0.5">Size</span>
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
        <div className="flex flex-col items-center">
          <span className="text-[8px] text-text-muted mb-0.5">Pos</span>
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
    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-border bg-surface">
      <span className="text-[11px] font-medium text-text-primary w-14 flex-shrink-0">{label}</span>
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

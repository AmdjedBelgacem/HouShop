import { useState, useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { useI18n } from '../i18n';
import { X, Printer, AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';
import {
  PAPER_PRESETS,
  getSavedPrinter,
  setSavedPrinter,
  listPrinters,
  printLabel,
  type PaperPreset,
} from '../lib/tsplPrinter';

interface BarcodePrintModalProps {
  barcode: string;
  productName: string;
  sku: string | null;
  price?: number | null;
  onClose: () => void;
}

function isValidEan13Input(value: string): boolean {
  return /^\d{12,13}$/.test(value);
}

export default function BarcodePrintModal({ barcode, productName, sku, price, onClose }: BarcodePrintModalProps) {
  const { t } = useI18n();
  const [paperKey, setPaperKey] = useState<PaperPreset['key']>('medium');
  const [printers, setPrinters] = useState<string[]>([]);
  const [printerName, setPrinterName] = useState<string>('');
  const [tunables, setTunables] = useState({ density: 8, direction: 0, shift: 0 });
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const paper = PAPER_PRESETS.find(p => p.key === paperKey)!;

  // Derived: barcode validity (no setState-in-effect needed).
  const barcodeError =
    !barcode || !isValidEan13Input(barcode)
      ? `Invalid barcode: "${barcode}". Must be 12-13 digits.`
      : null;

  // Derived: full TSPL options = user tunables + paper geometry.
  const opts = {
    density: tunables.density,
    direction: tunables.direction,
    shift: tunables.shift,
    labelWidthMm: paper.widthMm,
    labelHeightMm: paper.heightMm,
    gapMm: paper.gapMm,
  };

  // Live preview only: draw EAN-13 into the SVG. The printed bitmap is rendered
  // separately in labelRenderer.ts, so this is purely for the on-screen preview.
  useEffect(() => {
    if (!svgRef.current || barcodeError) {
      if (svgRef.current) svgRef.current.innerHTML = '';
      return;
    }
    try {
      JsBarcode(svgRef.current, barcode, {
        format: 'EAN13',
        width: 1.15,
        height: 50,
        displayValue: true,
        fontSize: 9,
        margin: 4,
        background: '#ffffff',
        lineColor: '#000000',
      });
      svgRef.current.setAttribute('shape-rendering', 'crispEdges');
    } catch {
      if (svgRef.current) svgRef.current.innerHTML = '';
    }
  }, [barcode, barcodeError]);

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
        { barcode, productName, sku, price },
        paper,
        opts,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200]" onClick={onClose}>
      <div
        className="bg-card rounded-2xl w-full max-w-[420px] shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="text-[14px] font-bold text-text-primary">{t('barcode.title')}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface text-text-muted transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
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

          {/* Preview */}
          <div className="flex justify-center bg-surface rounded-xl py-4 border border-border">
            <svg ref={svgRef} style={{ display: 'block', shapeRendering: 'crispEdges', maxHeight: 90 }} />
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
              <div className="grid grid-cols-3 gap-2 mt-2">
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
                  label="Shift"
                  value={tunables.shift}
                  min={-50}
                  max={50}
                  onChange={v => setTunables(o => ({ ...o, shift: v }))}
                  hint="dots"
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
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

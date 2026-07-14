/**
 * TSPL print dialog for delivery slips and invoices — same Xprinter RAW path
 * as BarcodePrintModal, with larger paper presets suitable for shipping labels.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  X,
  Printer,
  AlertTriangle,
  RefreshCw,
  Loader2,
  ChevronDown,
  Package,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { useBranding } from '../hooks/useBranding';
import type { Sale, SaleItemWithProduct, Customer } from '../lib/types';
import {
  DELIVERY_PAPER_PRESETS,
  INVOICE_PAPER_PRESETS,
  getSavedPrinter,
  setSavedPrinter,
  getSavedDocumentSettings,
  setSavedDocumentSettings,
  listPrinters,
  printPackedBitmap,
  mmToDots,
  ceilToByte,
  RESOLUTION_DPI,
  type PaperPreset,
  type TsplPrintOpts,
} from '../lib/tsplPrinter';
import {
  renderDocumentToBitmap,
  renderDocumentToDataURL,
  type DocumentKind,
  type DocumentLineItem,
} from '../lib/documentRenderer';

interface DocumentPrintModalProps {
  kind: DocumentKind;
  sale: Sale;
  items: SaleItemWithProduct[];
  customer?: Customer | null;
  onClose: () => void;
}

function formatDate(iso: string, withTime: boolean): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  if (!withTime) return date;
  return (
    date +
    ' — ' +
    d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
  );
}

function parseWarranty(notes: string | null): Map<string, number> {
  const map = new Map<string, number>();
  if (!notes) return map;
  try {
    const parsed = JSON.parse(notes);
    if (parsed.warranty && Array.isArray(parsed.warranty)) {
      parsed.warranty.forEach(
        (w: { product_id: number; variant_name?: string | null; warranty_months: number }) => {
          const key = `${w.product_id}-${w.variant_name ?? 'base'}`;
          map.set(key, w.warranty_months);
        },
      );
    }
  } catch {
    // ignore malformed notes
  }
  return map;
}

export default function DocumentPrintModal({
  kind,
  sale,
  items,
  customer,
  onClose,
}: DocumentPrintModalProps) {
  const { t } = useI18n();
  const { logoUrl, shopName } = useBranding();
  const presets = kind === 'shipping' ? DELIVERY_PAPER_PRESETS : INVOICE_PAPER_PRESETS;
  const settingsKind = kind === 'shipping' ? 'delivery' : 'invoice';
  const saved = getSavedDocumentSettings(settingsKind);

  const defaultPaperKey =
    saved?.paperKey && presets.some(p => p.key === saved.paperKey)
      ? saved.paperKey
      : presets[0].key;

  const [paperKey, setPaperKey] = useState(defaultPaperKey);
  const [printers, setPrinters] = useState<string[]>([]);
  const [printerName, setPrinterName] = useState('');
  const [tunables, setTunables] = useState({
    density: saved?.density ?? 10,
    direction: saved?.direction ?? 0,
    shift: saved?.shift ?? 0,
    shiftX: saved?.shiftX ?? 0,
  });
  const [copies, setCopies] = useState(1);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);

  const paper = presets.find(p => p.key === paperKey) ?? presets[0];

  const docId =
    kind === 'shipping' ? `#TXN-${90000 + sale.id}` : `INV-${90000 + sale.id}`;
  const dateLabel = formatDate(sale.created_at, kind === 'invoice');
  const warrantyMap = useMemo(() => parseWarranty(sale.notes), [sale.notes]);

  const lineItems: DocumentLineItem[] = useMemo(
    () =>
      items.map(item => {
        const wKey = `${item.product_id}-${item.variant_name ?? 'base'}`;
        const months = warrantyMap.get(wKey);
        return {
          name: item.product_name,
          variant: item.variant_name,
          qty: item.quantity,
          unitPrice: item.unit_price,
          subtotal: item.subtotal,
          warranty: months
            ? t('invoice.warrantyMonths', { count: months })
            : null,
        };
      }),
    [items, warrantyMap, t],
  );

  const renderInput = useMemo(() => {
    const widthPx = ceilToByte(mmToDots(paper.widthMm, RESOLUTION_DPI));
    const heightPx = mmToDots(paper.heightMm, RESOLUTION_DPI);
    return {
      kind,
      docId,
      dateLabel,
      shopName: shopName,
      logoSrc: logoUrl,
      customerName: customer?.name ?? null,
      customerPhone: customer?.phone ?? null,
      customerEmail: customer?.email ?? null,
      customerAddress: customer?.address ?? null,
      items: lineItems,
      total: sale.total_amount,
      paymentMethod: sale.payment_method,
      thankYou: kind === 'invoice' ? t('invoice.thankYou') : null,
      labels: {
        title: kind === 'shipping' ? t('shipping.title') : t('invoice.title'),
        shipTo: t('shipping.shipTo'),
        billTo: t('invoice.billTo'),
        items: kind === 'shipping' ? t('shipping.items') : t('invoice.product'),
        qty: t('invoice.qty'),
        price: t('invoice.unitPrice'),
        subtotal: t('invoice.subtotal'),
        total: t('invoice.total'),
        payment: t('invoice.paymentMethod'),
        noCustomer: t('shipping.noCustomer'),
        warranty: t('invoice.warranty'),
      },
      widthPx,
      heightPx,
    };
  }, [
    kind,
    docId,
    dateLabel,
    shopName,
    logoUrl,
    customer,
    lineItems,
    sale.total_amount,
    sale.payment_method,
    paper,
    t,
  ]);

  // WYSIWYG preview
  useEffect(() => {
    let cancelled = false;
    setPreviewLoading(true);
    (async () => {
      try {
        const url = await renderDocumentToDataURL(renderInput);
        if (!cancelled) setPreviewSrc(url);
      } catch {
        if (!cancelled) setPreviewSrc(null);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [renderInput]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !printing) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, printing]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingPrinters(true);
      try {
        const list = await listPrinters();
        if (cancelled) return;
        setPrinters(list);
        const savedPrinter = getSavedPrinter();
        if (savedPrinter && list.includes(savedPrinter)) setPrinterName(savedPrinter);
        else if (list.length > 0) setPrinterName(list[0]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingPrinters(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshPrinters() {
    setLoadingPrinters(true);
    setError(null);
    try {
      const list = await listPrinters();
      setPrinters(list);
      const savedPrinter = getSavedPrinter();
      if (savedPrinter && list.includes(savedPrinter)) setPrinterName(savedPrinter);
      else if (list.length > 0) setPrinterName(list[0]);
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
    setPrinting(true);
    try {
      const bitmap = await renderDocumentToBitmap(renderInput);
      const opts: TsplPrintOpts = {
        density: tunables.density,
        direction: tunables.direction,
        shift: tunables.shift,
        shiftX: tunables.shiftX,
        labelWidthMm: paper.widthMm,
        labelHeightMm: paper.heightMm,
        gapMm: paper.gapMm,
        copies,
      };
      await printPackedBitmap(printerName, bitmap, paper, opts);
      setSavedDocumentSettings(settingsKind, {
        paperKey,
        density: tunables.density,
        direction: tunables.direction,
        shift: tunables.shift,
        shiftX: tunables.shiftX,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPrinting(false);
    }
  }

  const previewAspect = paper.heightMm / paper.widthMm;
  const title =
    kind === 'shipping' ? t('shipping.title') : t('invoice.title');
  const printLabel =
    kind === 'shipping' ? t('shipping.printLabel') : t('checkout.printInvoice');

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6"
      onClick={() => {
        if (!printing) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-md" />

      <div
        className="relative w-[70vw] max-w-[960px] min-w-[320px] max-h-[min(92vh,880px)] flex flex-col rounded-[20px] bg-card shadow-[0_24px_80px_-12px_rgba(0,0,0,0.28),0_0_0_1px_rgba(0,0,0,0.04)] overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between gap-4 px-6 sm:px-7 py-4 border-b border-border/80 shrink-0">
          <div className="min-w-0">
            <h3 className="text-[17px] font-semibold tracking-tight text-text-primary">
              {title}
            </h3>
            <p className="text-[12.5px] text-text-secondary mt-0.5 truncate">
              {docId} · Xprinter TSPL
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

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-0 lg:min-h-full">
            {/* Preview */}
            <div className="flex flex-col border-b lg:border-b-0 lg:border-r border-border/80 bg-surface/60">
              <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 sm:px-8 py-8 sm:py-10">
                <div className="w-full max-w-[420px]">
                  <div className="flex items-center justify-between mb-2.5 px-0.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                      Print preview
                    </span>
                    <span className="text-[11px] text-text-muted">Matches printer 1:1</span>
                  </div>
                  <div className="relative flex w-full items-center justify-center p-2 sm:p-3">
                    <div
                      className="relative w-full max-w-[360px] bg-white overflow-hidden shadow-sm border border-border/40"
                      style={{ aspectRatio: `1 / ${previewAspect}` }}
                    >
                      {previewSrc ? (
                        <img
                          src={previewSrc}
                          alt="Document preview"
                          className="absolute inset-0 h-full w-full object-fill"
                        />
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-text-muted">
                          {previewLoading ? (
                            <Loader2 size={28} className="animate-spin opacity-50" />
                          ) : (
                            <>
                              <Package size={28} strokeWidth={1.5} className="opacity-40" />
                              <p className="text-[13px]">No preview available</p>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-card border border-border/80 px-2.5 py-1 text-[11.5px] font-medium text-text-secondary shadow-sm">
                    {paper.widthMm}×{paper.heightMm} mm
                  </span>
                  <span className="inline-flex items-center rounded-full bg-card border border-border/80 px-2.5 py-1 text-[11.5px] font-mono text-text-secondary shadow-sm">
                    {docId}
                  </span>
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="flex flex-col px-5 sm:px-6 py-5 sm:py-6 space-y-5">
              {error && (
                <div className="flex items-start gap-2.5 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200/80 dark:border-red-500/20 px-3.5 py-2.5">
                  <AlertTriangle size={15} className="text-accent-red flex-shrink-0 mt-0.5" />
                  <p className="text-[12.5px] text-accent-red font-medium leading-snug">{error}</p>
                </div>
              )}

              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted mb-2">
                  Printer
                </h4>
                <div className="flex gap-2">
                  <div className="relative flex-1 min-w-0">
                    <select
                      value={printerName}
                      onChange={e => onPickPrinter(e.target.value)}
                      disabled={loadingPrinters || printing}
                      className="doc-field-select"
                    >
                      {printers.length === 0 && !loadingPrinters && (
                        <option value="">No printers found</option>
                      )}
                      {printers.map(name => (
                        <option key={name} value={name}>
                          {name}
                        </option>
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
              </div>

              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted mb-2">
                  Paper size
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  {presets.map((p: PaperPreset) => {
                    const active = paperKey === p.key;
                    return (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => setPaperKey(p.key)}
                        className={`px-3 py-2.5 rounded-xl text-[12.5px] font-medium border transition-all text-left ${
                          active
                            ? 'bg-navy/10 border-navy/25 text-text-primary shadow-sm'
                            : 'bg-card border-border text-text-secondary hover:bg-surface'
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11.5px] text-text-muted mt-2 leading-relaxed">
                  {kind === 'shipping'
                    ? 'Use 100×150mm (4×6") for standard courier delivery labels on Xprinter.'
                    : 'Larger thermal papers for invoices — same RAW TSPL path as barcode labels.'}
                </p>
              </div>

              <div className="rounded-2xl border border-border/80 bg-surface/40 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(v => !v)}
                  className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-surface/80 transition-colors"
                >
                  <span className="text-[13px] font-medium text-text-primary">
                    Advanced settings
                  </span>
                  <ChevronDown
                    size={15}
                    className={`text-text-muted transition-transform duration-200 ${
                      showAdvanced ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                {showAdvanced && (
                  <div className="px-3.5 pb-3.5 pt-0.5 border-t border-border/60 grid grid-cols-2 gap-3">
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
                      min={-160}
                      max={160}
                      onChange={v => setTunables(o => ({ ...o, shiftX: v }))}
                      hint="horizontal dots"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

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
              disabled={printing || !printerName}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-navy text-white text-[13px] font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.12)] hover:bg-navy-light active:scale-[0.98] transition-all disabled:opacity-45 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              {printing ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Printer size={15} strokeWidth={2.25} />
              )}
              {printing ? 'Printing…' : printLabel}
            </button>
          </div>
        </div>

        <style>{`
          .doc-field-select {
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
          .doc-field-select:focus {
            outline: none;
            border-color: color-mix(in srgb, var(--color-navy) 35%, var(--color-border));
            box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-navy) 12%, transparent);
          }
          .doc-field-select:disabled { opacity: 0.55; }
        `}</style>
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

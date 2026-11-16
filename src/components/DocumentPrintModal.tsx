/**
 * TSPL print dialog for delivery slips and invoices — same Xprinter RAW path
 * as BarcodePrintModal, with larger paper presets suitable for shipping labels.
 */

import { useEffect, useId, useMemo, useState } from 'react';
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
import { useBranding } from '../hooks/brandingContext';
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

  // WYSIWYG preview: remembers which render input its result belongs to.
  // While a newer input is still rendering, the previous image stays visible
  // and the spinner shows, exactly as before.
  const [preview, setPreview] = useState<{
    input: typeof renderInput;
    src: string | null;
  } | null>(null);
  const previewSrc = preview?.src ?? null;
  const previewLoading = preview?.input !== renderInput;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = await renderDocumentToDataURL(renderInput);
        if (!cancelled) setPreview({ input: renderInput, src: url });
      } catch {
        if (!cancelled) setPreview({ input: renderInput, src: null });
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
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />

      <div
        className="relative w-[70vw] max-w-[960px] min-w-[320px] max-h-[min(92vh,880px)] flex flex-col rounded-2xl bg-card border border-border-light shadow-raised overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="document-print-title"
      >
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-border-light shrink-0">
          <div className="min-w-0">
            <h3
              id="document-print-title"
              className="text-[17px] font-semibold tracking-tight text-text-primary"
            >
              {title}
            </h3>
            <p className="text-[13px] text-text-secondary mt-0.5 truncate">
              {docId} · Xprinter TSPL
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

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-0 lg:min-h-full">
            {/* Preview */}
            <div className="flex flex-col bg-surface border-b lg:border-b-0 lg:border-r border-border-light">
              <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 sm:px-8 py-8 sm:py-10">
                <div className="w-full max-w-[420px]">
                  <div className="flex items-center justify-between mb-2.5 px-0.5">
                    <span className="eyebrow">{t('print.preview.title')}</span>
                    <span className="text-[13px] text-text-secondary">{t('print.preview.matches')}</span>
                  </div>
                  {/* The white rectangle is the printable paper. Its colours are
                      intentionally fixed (white paper, dark text) and must not follow the theme. */}
                  <div className="relative flex w-full items-center justify-center p-2 sm:p-3">
                    <div
                      className="relative w-full max-w-[360px] bg-white overflow-hidden shadow-raised ring-1 ring-black/5"
                      style={{ aspectRatio: `1 / ${previewAspect}` }}
                    >
                      {previewSrc ? (
                        <img
                          src={previewSrc}
                          alt={t('print.preview.documentAlt')}
                          className="absolute inset-0 h-full w-full object-fill"
                        />
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-text-muted">
                          {previewLoading ? (
                            <Loader2 size={28} className="animate-spin opacity-50" aria-hidden="true" />
                          ) : (
                            <>
                              <Package size={28} strokeWidth={1.5} className="opacity-40" aria-hidden="true" />
                              <p className="text-[13px]">{t('print.preview.none')}</p>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-card border border-border px-2.5 py-1 text-[13px] font-medium text-text-secondary">
                    {paper.widthMm}×{paper.heightMm} mm
                  </span>
                  <span className="inline-flex items-center rounded-full bg-card border border-border px-2.5 py-1 text-[13px] font-mono text-text-secondary">
                    {docId}
                  </span>
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="flex flex-col gap-5 px-5 sm:px-6 py-5 sm:py-6">
              {error && (
                <div role="alert" className="flex items-start gap-2.5 rounded-xl bg-accent-red/10 border border-accent-red/25 px-3.5 py-2.5">
                  <AlertTriangle size={15} className="text-accent-red flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <p className="text-[13px] text-accent-red font-medium leading-snug">{error}</p>
                </div>
              )}

              <div>
                <h4 className="eyebrow mb-2.5">{t('print.printer.title')}</h4>
                <div className="flex gap-2">
                  <div className="relative flex-1 min-w-0">
                    <select
                      value={printerName}
                      onChange={e => onPickPrinter(e.target.value)}
                      disabled={loadingPrinters || printing}
                      aria-label={t('print.printer.title')}
                      className="doc-field-select"
                    >
                      {printers.length === 0 && !loadingPrinters && (
                        <option value="">{t('print.printer.none')}</option>
                      )}
                      {printers.map(name => (
                        <option key={name} value={name}>
                          {name}
                        </option>
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
              </div>

              <div>
                <h4 className="eyebrow mb-2.5">{t('print.paper.title')}</h4>
                <div role="group" aria-label={t('print.paper.title')} className="grid grid-cols-2 gap-2">
                  {presets.map((p: PaperPreset) => {
                    const active = paperKey === p.key;
                    return (
                      <button
                        key={p.key}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setPaperKey(p.key)}
                        className={`px-3.5 py-2.5 rounded-xl text-[14px] text-left border transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30 ${
                          active
                            ? 'bg-navy/10 border-navy/40 text-text-primary font-semibold'
                            : 'bg-card border-border text-text-secondary font-medium hover:bg-surface hover:text-text-primary'
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[13px] text-text-secondary mt-2.5 leading-relaxed">
                  {kind === 'shipping'
                    ? t('print.paper.shippingHint')
                    : t('print.paper.invoiceHint')}
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-surface overflow-hidden">
                <button
                  type="button"
                  aria-expanded={showAdvanced}
                  aria-controls="document-advanced-settings"
                  onClick={() => setShowAdvanced(v => !v)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-card transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-navy/30"
                >
                  <span className="text-[13px] font-medium text-text-primary">
                    {t('print.advanced.title')}
                  </span>
                  <ChevronDown
                    size={15}
                    aria-hidden="true"
                    className={`text-text-secondary transition-transform duration-200 ${
                      showAdvanced ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                {showAdvanced && (
                  <div id="document-advanced-settings" className="px-4 pb-4 pt-1 border-t border-border-light grid grid-cols-2 gap-3">
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
                      value={tunables.shiftX}
                      min={-160}
                      max={160}
                      onChange={v => setTunables(o => ({ ...o, shiftX: v }))}
                      hint={t('print.hint.horizontalDots')}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

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
              disabled={printing || !printerName}
              className="btn-primary px-5 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              {printing ? (
                <Loader2 size={15} className="animate-spin" aria-hidden="true" />
              ) : (
                <Printer size={15} strokeWidth={2.25} aria-hidden="true" />
              )}
              {printing ? t('print.printing') : printLabel}
            </button>
          </div>
        </div>

        <style>{`
          .doc-field-select {
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
          .doc-field-select:focus-visible {
            outline: none;
            border-color: var(--color-navy);
            box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-navy) 25%, transparent);
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
        className="w-full rounded-xl border border-border bg-card px-3 py-2 text-[14px] text-text-primary tabular-nums placeholder:text-text-muted focus-visible:outline-none focus-visible:border-navy focus-visible:ring-[3px] focus-visible:ring-navy/20 transition-[border-color,box-shadow] duration-150"
      />
      {hint && <p className="text-[13px] text-text-secondary mt-1.5">{hint}</p>}
    </div>
  );
}

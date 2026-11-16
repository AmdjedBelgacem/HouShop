import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import type { SaleWithItems, ReturnWithDetails, ReturnsSummary, CreateReturn, Customer } from '../lib/types';
import ConfirmDialog from '../components/ConfirmDialog';
import { useI18n } from '../i18n';
import {
  Search, RotateCcw, ArrowLeft, Package, Layers, Receipt, Minus, Plus,
} from 'lucide-react';
import { uiLocale } from '../i18n/locale';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30';

const fmt = (n: number) => `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\u200E DA`;

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(uiLocale(), { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + d.toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit', hour12: true });
}

const REASON_PRESETS = ['Defective', 'Wrong item', 'Customer changed mind', 'Not as described', 'Other'];

// Presets are stored in English; translate them only for display.
function reasonLabel(reason: string, t: (key: string) => string): string {
  switch (reason) {
    case 'Defective': return t('returns.reasonDefective');
    case 'Wrong item': return t('returns.reasonWrongItem');
    case 'Customer changed mind': return t('returns.reasonChangedMind');
    case 'Not as described': return t('returns.reasonNotAsDescribed');
    case 'Other': return t('returns.reasonOther');
    default: return reason;
  }
}

export default function Returns() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [builderSale, setBuilderSale] = useState<SaleWithItems | null>(null);

  const { data: sales } = useQuery({
    queryKey: ['sales'],
    queryFn: () => invoke<SaleWithItems[]>('get_sales'),
  });
  const { data: customers } = useQuery({
    queryKey: ['customers'],
    queryFn: () => invoke<Customer[]>('get_customers'),
  });
  const { data: returns } = useQuery({
    queryKey: ['returns'],
    queryFn: () => invoke<ReturnWithDetails[]>('get_returns'),
  });
  const { data: summary } = useQuery({
    queryKey: ['returns-summary'],
    queryFn: () => invoke<ReturnsSummary>('get_returns_summary'),
  });
  const customerMap = new Map((customers ?? []).map(c => [c.id, c]));

  // Map sale_item_id → already-returned quantity, so the builder caps the qty
  // a user can return per line at (sold − already returned).
  const returnedByItem = new Map<number, number>();
  (returns ?? []).forEach(r => {
    returnedByItem.set(r.sale_item_id, (returnedByItem.get(r.sale_item_id) ?? 0) + r.quantity);
  });

  const filteredSales = (sales ?? []).filter(s => {
    if (!search) return true;
    const q = search.toLowerCase();
    const txId = `txn-${90000 + s.sale.id}`;
    const cust = s.sale.customer_id ? customerMap.get(s.sale.customer_id)?.name?.toLowerCase() : '';
    return txId.includes(q) || (cust && cust.includes(q));
  });

  return (
    <div className="p-8">
      {builderSale ? (
        <ReturnBuilder
          sale={builderSale}
          returnedByItem={returnedByItem}
          customerName={builderSale.sale.customer_id ? customerMap.get(builderSale.sale.customer_id)?.name ?? null : null}
          onClose={() => setBuilderSale(null)}
          onDone={() => {
            queryClient.invalidateQueries({ queryKey: ['returns'] });
            queryClient.invalidateQueries({ queryKey: ['returns-summary'] });
            queryClient.invalidateQueries({ queryKey: ['sales'] });
            queryClient.invalidateQueries({ queryKey: ['products'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
            setBuilderSale(null);
          }}
        />
      ) : (
        <div className="animate-fade-up">
          <div className="mb-7">
            <span className="eyebrow-accent mb-3 flex w-fit">{t('sidebar.groupSell')}</span>
            <h2 className="page-title">{t('returns.title')}</h2>
            <p className="page-subtitle">{t('returns.subtitle')}</p>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="card p-5">
              <p className="text-[13px] font-medium text-text-secondary">{t('returns.totalReturns')}</p>
              <p className="text-[24px] font-semibold tracking-[-0.02em] text-text-primary tabular-nums mt-1">{summary?.total_returns ?? 0}</p>
            </div>
            <div className="card p-5">
              <p className="text-[13px] font-medium text-text-secondary">{t('returns.totalRefunded')}</p>
              <p className="text-[24px] font-semibold tracking-[-0.02em] text-accent-red tabular-nums mt-1">{fmt(summary?.total_refunded ?? 0)}</p>
            </div>
            <div className="card p-5">
              <p className="text-[13px] font-medium text-text-secondary">{t('returns.unitsReturned')}</p>
              <p className="text-[24px] font-semibold tracking-[-0.02em] text-text-primary tabular-nums mt-1">{summary?.units_returned ?? 0}</p>
            </div>
          </div>

          {/* Recent returns history */}
          <section className="card overflow-hidden mb-8">
            <div className="px-5 py-4 border-b border-border-light flex items-center gap-2.5">
              <RotateCcw size={15} className="text-text-muted" />
              <h3 className="text-[15px] font-semibold text-text-primary">{t('returns.recentReturns')}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border-light bg-surface/60">
                    <th className="text-left py-2.5 px-5 text-[13px] font-medium text-text-muted">{t('returns.product')}</th>
                    <th className="text-left py-2.5 px-4 text-[13px] font-medium text-text-muted">{t('returns.customer')}</th>
                    <th className="text-center py-2.5 px-4 text-[13px] font-medium text-text-muted">{t('returns.qty')}</th>
                    <th className="text-right py-2.5 px-4 text-[13px] font-medium text-text-muted">{t('returns.refund')}</th>
                    <th className="text-left py-2.5 px-4 text-[13px] font-medium text-text-muted">{t('returns.reason')}</th>
                    <th className="text-left py-2.5 px-5 text-[13px] font-medium text-text-muted">{t('returns.date')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(returns ?? []).length === 0 ? (
                    <tr><td colSpan={6} className="py-10">
                      <EmptyState icon={<RotateCcw size={20} />} message={t('returns.noReturns')} />
                    </td></tr>
                  ) : (returns ?? []).slice(0, 8).map(r => (
                    <tr key={r.id} className="border-b border-border-light last:border-0 hover:bg-surface transition-colors">
                      <td className="py-3 px-5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-text-primary">{r.product_name}</span>
                          {r.variant_name && (
                            <span className="badge bg-accent-blue/10 text-accent-blue text-[13px] px-2 py-0.5">{r.variant_name}</span>
                          )}
                        </div>
                        <p className="text-[13px] text-text-muted mt-0.5 tabular-nums">#{`TXN-${90000 + r.sale_id}`}</p>
                      </td>
                      <td className="py-3 px-4 text-text-secondary">{r.customer_name ?? t('sales.walkIn')}</td>
                      <td className="py-3 px-4 text-center text-text-secondary tabular-nums">{r.quantity}</td>
                      <td className="py-3 px-4 text-right font-semibold text-accent-red tabular-nums">{fmt(r.refund_amount)}</td>
                      <td className="py-3 px-4 text-text-secondary">{r.reason ? reasonLabel(r.reason, t) : '—'}</td>
                      <td className="py-3 px-5 text-text-muted text-[13px] whitespace-nowrap">{formatDate(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Find a sale to return from */}
          <div className="relative mb-4">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <input
              type="text"
              aria-label={t('returns.searchSales')}
              placeholder={t('returns.searchSales')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="form-input pl-10 py-2.5"
            />
          </div>
          <section className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border-light bg-surface/60">
                    <th className="text-left py-2.5 px-5 text-[13px] font-medium text-text-muted">{t('returns.transaction')}</th>
                    <th className="text-left py-2.5 px-4 text-[13px] font-medium text-text-muted">{t('returns.customer')}</th>
                    <th className="text-left py-2.5 px-4 text-[13px] font-medium text-text-muted">{t('returns.date')}</th>
                    <th className="text-center py-2.5 px-4 text-[13px] font-medium text-text-muted">{t('returns.items')}</th>
                    <th className="text-right py-2.5 px-4 text-[13px] font-medium text-text-muted">{t('returns.amount')}</th>
                    <th className="text-center py-2.5 px-5 text-[13px] font-medium text-text-muted">{t('returns.action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSales.length === 0 ? (
                    <tr><td colSpan={6} className="py-10">
                      <EmptyState icon={<Receipt size={20} />} message={t('returns.noSales')} />
                    </td></tr>
                  ) : filteredSales.slice(0, 15).map(s => {
                    const cust = s.sale.customer_id ? customerMap.get(s.sale.customer_id) : null;
                    return (
                      <tr key={s.sale.id} className="border-b border-border-light last:border-0 hover:bg-surface transition-colors">
                        <td className="py-3 px-5 font-semibold text-navy tabular-nums whitespace-nowrap">#{`TXN-${90000 + s.sale.id}`}</td>
                        <td className="py-3 px-4 text-text-secondary">{cust?.name ?? t('sales.walkIn')}</td>
                        <td className="py-3 px-4 text-text-muted text-[13px] whitespace-nowrap">{formatDate(s.sale.created_at)}</td>
                        <td className="py-3 px-4 text-center text-text-secondary tabular-nums">{s.items.reduce((a, i) => a + i.quantity, 0)}</td>
                        <td className="py-3 px-4 text-right font-semibold text-text-primary tabular-nums">{fmt(s.sale.total_amount)}</td>
                        <td className="py-3 px-5 text-center">
                          <button type="button" onClick={() => setBuilderSale(s)}
                            className={`btn-secondary px-3 py-1.5 text-[13px] rounded-lg ${FOCUS}`}>
                            <RotateCcw size={13} /> {t('returns.process')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function EmptyState({ icon, message }: { icon: ReactNode; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 text-center">
      <span className="w-11 h-11 rounded-full bg-surface text-text-muted flex items-center justify-center">{icon}</span>
      <p className="text-[13px] text-text-secondary">{message}</p>
    </div>
  );
}

interface ReturnBuilderProps {
  sale: SaleWithItems;
  returnedByItem: Map<number, number>;
  customerName: string | null;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Per-line return entry: which item, how many units (≤ sold − already returned),
 * and an optional reason + refund override. The default refund is the line's
 * unit price × returned qty (full refund), editable per line.
 */
interface LineReturn {
  saleItemId: number;
  qty: number;
  refund: number;
  reason: string;
}

function ReturnBuilder({ sale, returnedByItem, customerName, onClose, onDone }: ReturnBuilderProps) {
  const { t } = useI18n();
  const [lines, setLines] = useState<Record<number, LineReturn>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  const createReturn = useMutation({
    mutationFn: (data: CreateReturn) => invoke('create_return', { data }),
  });

  const lineState = (item: typeof sale.items[number]): LineReturn => {
    const existing = lines[item.id];
    if (existing) return existing;
    return { saleItemId: item.id, qty: 0, refund: 0, reason: '' };
  };

  const updateLine = (itemId: number, patch: Partial<LineReturn>) => {
    const blank: LineReturn = { saleItemId: itemId, qty: 0, refund: 0, reason: '' };
    setLines(prev => ({ ...prev, [itemId]: { ...blank, ...prev[itemId], ...patch } }));
  };

  // Selected lines = those with qty > 0.
  const selected = sale.items
    .map(item => ({ item, st: lineState(item) }))
    .filter(({ st }) => st.qty > 0);
  const totalRefund = selected.reduce((sum, { item, st }) => {
    // Default refund = full unit price × qty if the user didn't set one.
    return sum + (st.refund > 0 ? st.refund : item.unit_price * st.qty);
  }, 0);
  const totalUnits = selected.reduce((s, { st }) => s + st.qty, 0);

  const handleConfirm = async () => {
    setConfirmOpen(false);
    try {
      for (const { item, st } of selected) {
        const refund = st.refund > 0 ? st.refund : item.unit_price * st.qty;
        const payload: CreateReturn = {
          sale_id: sale.sale.id,
          sale_item_id: item.id,
          product_id: item.product_id,
          variant_id: item.variant_id,
          quantity: st.qty,
          refund_amount: refund,
          reason: st.reason || null,
        };
        await createReturn.mutateAsync(payload);
      }
      toast.success(t('toast.returnProcessed'));
      onDone();
    } catch (err) {
      console.error('Return failed:', err);
      toast.error(typeof err === 'string' ? err : t('toast.error'));
    }
  };

  return (
    <>
      <div className="animate-fade-up">
        {/* Header */}
        <div className="flex items-center gap-4 mb-7">
          <button type="button" onClick={onClose} aria-label={t('common.back')}
            className={`p-2 rounded-lg text-text-secondary hover:bg-surface hover:text-text-primary transition-colors ${FOCUS}`}>
            <ArrowLeft size={18} />
          </button>
          <div>
            <h2 className="page-title">{t('returns.processTitle')}</h2>
            <p className="page-subtitle">
              #{`TXN-${90000 + sale.sale.id}`} · {customerName ?? t('sales.walkIn')} · {formatDate(sale.sale.created_at)}
            </p>
          </div>
        </div>

        {/* Items — pick what to return */}
        <section className="card overflow-hidden mb-5">
          <div className="px-5 py-4 border-b border-border-light flex items-center gap-2.5">
            <Package size={15} className="text-text-muted" />
            <h3 className="text-[15px] font-semibold text-text-primary">{t('returns.selectItems')}</h3>
          </div>
          <div className="divide-y divide-border-light">
            {sale.items.map(item => {
              const sold = item.quantity;
              const already = returnedByItem.get(item.id) ?? 0;
              const returnable = sold - already;
              const st = lineState(item);
              return (
                <div key={item.id} className="px-5 py-4 flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[14px] font-semibold text-text-primary">{item.product_name}</p>
                      {item.variant_name && (
                        <span className="badge bg-accent-blue/10 text-accent-blue text-[13px] px-2 py-0.5">
                          <Layers size={10} />{item.variant_name}
                        </span>
                      )}
                    </div>
                    <p className="text-[13px] text-text-muted mt-0.5 tabular-nums">
                      {t('returns.soldCount', { count: sold })} · {t('returns.returnableCount', { count: returnable })} · {fmt(item.unit_price)} {t('returns.each')}
                    </p>
                    {st.qty > 0 && (
                      <div className="grid grid-cols-2 gap-3 mt-3 max-w-lg">
                        <div>
                          <label htmlFor={`return-reason-${item.id}`} className="block text-[13px] font-medium text-text-secondary mb-1.5">{t('returns.reason')}</label>
                          <select
                            id={`return-reason-${item.id}`}
                            value={st.reason}
                            onChange={e => updateLine(item.id, { reason: e.target.value })}
                            className="form-input py-2 text-[13px]"
                          >
                            <option value="">{t('returns.selectReason')}</option>
                            {REASON_PRESETS.map(r => <option key={r} value={r}>{reasonLabel(r, t)}</option>)}
                          </select>
                        </div>
                        <div>
                          <label htmlFor={`return-refund-${item.id}`} className="block text-[13px] font-medium text-text-secondary mb-1.5">{t('returns.refundAmount')}</label>
                          <input
                            id={`return-refund-${item.id}`}
                            type="number" step="0.01" min="0"
                            value={st.refund > 0 ? st.refund : ''}
                            onChange={e => updateLine(item.id, { refund: parseFloat(e.target.value) || 0 })}
                            placeholder={`${fmt(item.unit_price * st.qty)} ${t('returns.default')}`}
                            className="form-input py-2 text-[13px] tabular-nums"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  {/* Qty stepper — capped at returnable units. 0 = not returning. */}
                  <div className="flex items-center gap-1 flex-shrink-0 p-1 rounded-xl bg-surface border border-border-light">
                    <button
                      type="button"
                      aria-label={t('returns.decreaseQty')}
                      onClick={() => updateLine(item.id, { qty: Math.max(0, st.qty - 1) })}
                      disabled={returnable <= 0}
                      className={`w-8 h-8 inline-flex items-center justify-center rounded-lg bg-card border border-border text-text-primary hover:bg-surface disabled:opacity-40 disabled:pointer-events-none transition-colors ${FOCUS}`}
                    ><Minus size={14} /></button>
                    <span className="w-9 text-center text-[14px] font-semibold text-text-primary tabular-nums" aria-live="polite">{st.qty}</span>
                    <button
                      type="button"
                      aria-label={t('returns.increaseQty')}
                      onClick={() => updateLine(item.id, { qty: Math.min(returnable, st.qty + 1) })}
                      disabled={st.qty >= returnable}
                      className={`w-8 h-8 inline-flex items-center justify-center rounded-lg bg-card border border-border text-text-primary hover:bg-surface disabled:opacity-40 disabled:pointer-events-none transition-colors ${FOCUS}`}
                    ><Plus size={14} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Summary + confirm */}
        <div className="card p-5 flex flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-8">
            <div>
              <p className="text-[13px] font-medium text-text-secondary">{t('returns.unitsToReturn')}</p>
              <p className="text-[24px] font-semibold tracking-[-0.02em] text-text-primary tabular-nums mt-0.5">{totalUnits}</p>
            </div>
            <div>
              <p className="text-[13px] font-medium text-text-secondary">{t('returns.totalRefund')}</p>
              <p className="text-[24px] font-semibold tracking-[-0.02em] text-accent-red tabular-nums mt-0.5">{fmt(totalRefund)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <button type="button" onClick={onClose} className="btn-secondary">
              {t('common.cancel')}
            </button>
            <button type="button" onClick={() => setConfirmOpen(true)} disabled={totalUnits === 0 || createReturn.isPending}
              className="btn-danger">
              <RotateCcw size={14} /> {createReturn.isPending ? t('returns.processing') : t('returns.confirmReturn')}
            </button>
          </div>
        </div>
      </div>

      {/* Rendered outside the animated wrapper so the fixed overlay covers the viewport. */}
      <ConfirmDialog
        open={confirmOpen}
        variant="danger"
        title={t('returns.confirmTitle')}
        description={t('returns.confirmDesc', { units: totalUnits, refund: fmt(totalRefund) })}
        confirmLabel={t('returns.confirmReturn')}
        loading={createReturn.isPending}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

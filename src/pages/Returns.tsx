import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import type { SaleWithItems, ReturnWithDetails, ReturnsSummary, CreateReturn, Customer } from '../lib/types';
import ConfirmDialog from '../components/ConfirmDialog';
import { useI18n } from '../i18n';
import {
  Search, RotateCcw, ArrowLeft, Package, Layers, Receipt,
} from 'lucide-react';

const fmt = (n: number) => `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DA`;

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

const REASON_PRESETS = ['Defective', 'Wrong item', 'Customer changed mind', 'Not as described', 'Other'];

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
        <>
          <div className="flex items-start justify-between mb-7">
            <div>
              <h2 className="text-[26px] font-bold text-text-primary leading-tight">{t('returns.title')}</h2>
              <p className="text-[14px] text-text-secondary mt-1.5">{t('returns.subtitle')}</p>
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-3 gap-5 mb-6">
            <div className="card px-5 py-3.5">
              <p className="text-[10.5px] font-semibold text-text-muted tracking-[0.08em] uppercase">{t('returns.totalReturns')}</p>
              <p className="text-[20px] font-bold text-text-primary mt-0.5">{summary?.total_returns ?? 0}</p>
            </div>
            <div className="card px-5 py-3.5">
              <p className="text-[10.5px] font-semibold text-text-muted tracking-[0.08em] uppercase">{t('returns.totalRefunded')}</p>
              <p className="text-[20px] font-bold text-accent-red mt-0.5">{fmt(summary?.total_refunded ?? 0)}</p>
            </div>
            <div className="card px-5 py-3.5">
              <p className="text-[10.5px] font-semibold text-text-muted tracking-[0.08em] uppercase">{t('returns.unitsReturned')}</p>
              <p className="text-[20px] font-bold text-text-primary mt-0.5">{summary?.units_returned ?? 0}</p>
            </div>
          </div>

          {/* Recent returns history */}
          <div className="card overflow-hidden mb-6">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <RotateCcw size={15} className="text-text-muted" />
              <h3 className="text-[14px] font-bold text-text-primary">{t('returns.recentReturns')}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-surface/50">
                    <th className="text-left py-2.5 px-5 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('returns.product')}</th>
                    <th className="text-left py-2.5 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('returns.customer')}</th>
                    <th className="text-center py-2.5 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('returns.qty')}</th>
                    <th className="text-right py-2.5 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('returns.refund')}</th>
                    <th className="text-left py-2.5 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('returns.reason')}</th>
                    <th className="text-left py-2.5 px-5 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('returns.date')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(returns ?? []).length === 0 ? (
                    <tr><td colSpan={6} className="py-12 text-center text-text-muted">
                      <RotateCcw size={28} className="mx-auto mb-2 opacity-30" />
                      {t('returns.noReturns')}
                    </td></tr>
                  ) : (returns ?? []).slice(0, 8).map(r => (
                    <tr key={r.id} className="border-b border-border-light hover:bg-surface/30 transition-colors">
                      <td className="py-3 px-5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-text-primary">{r.product_name}</span>
                          {r.variant_name && (
                            <span className="text-[10px] font-medium text-accent-blue bg-blue-50 px-1.5 py-0.5 rounded">{r.variant_name}</span>
                          )}
                        </div>
                        <p className="text-[10.5px] text-text-muted">#{`TXN-${90000 + r.sale_id}`}</p>
                      </td>
                      <td className="py-3 px-4 text-text-secondary">{r.customer_name ?? 'Walk-in'}</td>
                      <td className="py-3 px-4 text-center text-text-secondary">{r.quantity}</td>
                      <td className="py-3 px-4 text-right font-semibold text-accent-red">{fmt(r.refund_amount)}</td>
                      <td className="py-3 px-4 text-text-secondary text-[12px]">{r.reason ?? '—'}</td>
                      <td className="py-3 px-5 text-text-muted text-[12px]">{formatDate(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Find a sale to return from */}
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                placeholder={t('returns.searchSales')}
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-lg border border-border text-[13px] focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy/30 placeholder:text-text-muted bg-surface"
              />
            </div>
          </div>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-sidebar/50">
                    <th className="text-left py-3 px-5 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('returns.transaction')}</th>
                    <th className="text-left py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('returns.customer')}</th>
                    <th className="text-left py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('returns.date')}</th>
                    <th className="text-center py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('returns.items')}</th>
                    <th className="text-right py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('returns.amount')}</th>
                    <th className="text-center py-3 px-5 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('returns.action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSales.length === 0 ? (
                    <tr><td colSpan={6} className="py-12 text-center text-text-muted">
                      <Receipt size={28} className="mx-auto mb-2 opacity-30" />
                      {t('returns.noSales')}
                    </td></tr>
                  ) : filteredSales.slice(0, 15).map(s => {
                    const cust = s.sale.customer_id ? customerMap.get(s.sale.customer_id) : null;
                    return (
                      <tr key={s.sale.id} className="border-b border-border-light hover:bg-surface/30 transition-colors">
                        <td className="py-3 px-5 font-semibold text-navy">#{`TXN-${90000 + s.sale.id}`}</td>
                        <td className="py-3 px-4 text-text-secondary">{cust?.name ?? 'Walk-in'}</td>
                        <td className="py-3 px-4 text-text-muted text-[12px]">{formatDate(s.sale.created_at)}</td>
                        <td className="py-3 px-4 text-center text-text-secondary">{s.items.reduce((a, i) => a + i.quantity, 0)}</td>
                        <td className="py-3 px-4 text-right font-semibold text-text-primary">{fmt(s.sale.total_amount)}</td>
                        <td className="py-3 px-5 text-center">
                          <button onClick={() => setBuilderSale(s)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-navy text-white text-[12px] font-medium hover:bg-navy-light transition-colors">
                            <RotateCcw size={13} /> {t('returns.process')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
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
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-card border border-transparent hover:border-border transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h2 className="text-[22px] font-bold text-text-primary">{t('returns.processTitle')}</h2>
          <p className="text-[13px] text-text-secondary">
            #{`TXN-${90000 + sale.sale.id}`} · {customerName ?? 'Walk-in'} · {formatDate(sale.sale.created_at)}
          </p>
        </div>
      </div>

      {/* Items — pick what to return */}
      <div className="card overflow-hidden mb-6">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <Package size={15} className="text-text-muted" />
          <h3 className="text-[14px] font-bold text-text-primary">{t('returns.selectItems')}</h3>
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
                  <div className="flex items-center gap-1.5">
                    <p className="text-[13.5px] font-semibold text-text-primary">{item.product_name}</p>
                    {item.variant_name && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-accent-blue bg-blue-50 px-1.5 py-0.5 rounded">
                        <Layers size={9} />{item.variant_name}
                      </span>
                    )}
                  </div>
                  <p className="text-[11.5px] text-text-muted mt-0.5">
                    {t('returns.soldCount', { count: sold })} · {t('returns.returnableCount', { count: returnable })} · {fmt(item.unit_price)} {t('returns.each')}
                  </p>
                  {st.qty > 0 && (
                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <div>
                        <label className="block text-[10px] font-semibold text-text-muted tracking-[0.06em] uppercase mb-1">{t('returns.reason')}</label>
                        <select
                          value={st.reason}
                          onChange={e => updateLine(item.id, { reason: e.target.value })}
                          className="form-input !py-1.5 !text-[12px]"
                        >
                          <option value="">{t('returns.selectReason')}</option>
                          {REASON_PRESETS.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-text-muted tracking-[0.06em] uppercase mb-1">{t('returns.refundAmount')}</label>
                        <input
                          type="number" step="0.01" min="0"
                          value={st.refund > 0 ? st.refund : ''}
                          onChange={e => updateLine(item.id, { refund: parseFloat(e.target.value) || 0 })}
                          placeholder={`${fmt(item.unit_price * st.qty)} ${t('returns.default')}`}
                          className="form-input !py-1.5 !text-[12px]"
                        />
                      </div>
                    </div>
                  )}
                </div>
                {/* Qty stepper — capped at returnable units. 0 = not returning. */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => updateLine(item.id, { qty: Math.max(0, st.qty - 1) })}
                    disabled={returnable <= 0}
                    className="w-7 h-7 rounded-md border border-border bg-surface text-text-secondary hover:bg-card disabled:opacity-40"
                  >−</button>
                  <span className="w-8 text-center text-[13px] font-semibold text-text-primary tabular-nums">{st.qty}</span>
                  <button
                    onClick={() => updateLine(item.id, { qty: Math.min(returnable, st.qty + 1) })}
                    disabled={st.qty >= returnable}
                    className="w-7 h-7 rounded-md border border-border bg-surface text-text-secondary hover:bg-card disabled:opacity-40"
                  >+</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Summary + confirm */}
      <div className="card p-5 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div>
            <p className="text-[10.5px] font-semibold text-text-muted tracking-[0.08em] uppercase">{t('returns.unitsToReturn')}</p>
            <p className="text-[20px] font-bold text-text-primary mt-0.5">{totalUnits}</p>
          </div>
          <div>
            <p className="text-[10.5px] font-semibold text-text-muted tracking-[0.08em] uppercase">{t('returns.totalRefund')}</p>
            <p className="text-[20px] font-bold text-accent-red mt-0.5">{fmt(totalRefund)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <button onClick={onClose}
            className="px-5 py-2.5 rounded-lg border border-border text-[13px] font-medium text-text-secondary hover:bg-surface transition-colors">
            {t('common.cancel')}
          </button>
          <button onClick={() => setConfirmOpen(true)} disabled={totalUnits === 0 || createReturn.isPending}
            className="px-6 py-2.5 rounded-lg bg-accent-red text-white text-[13px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center gap-2">
            <RotateCcw size={14} /> {createReturn.isPending ? t('returns.processing') : t('returns.confirmReturn')}
          </button>
        </div>
      </div>

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
    </div>
  );
}

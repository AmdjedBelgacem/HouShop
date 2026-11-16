import { useState, useRef, useEffect, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import type { SaleWithItems, SalesSummary, Customer } from '../lib/types';
import Invoice from '../components/Invoice';
import ShippingLabel from '../components/ShippingLabel';
import CustomSelect from '../components/CustomSelect';
import ConfirmDialog from '../components/ConfirmDialog';
import { useI18n } from '../i18n';
import {
  Search, Download, Printer, Calendar, Filter,
  RefreshCw, MoreHorizontal, ChevronLeft, ChevronRight,
  TrendingUp, TrendingDown, Receipt, ChevronDown, ChevronUp, Package, Layers, Trash2,
} from 'lucide-react';
import { uiLocale } from '../i18n/locale';

const ITEMS_PER_PAGE = 10;
const fmt = (n: number) => `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\u200E DA`;

function getCoverImage(imagePath: string | null): string | null {
  if (!imagePath) return null;
  try {
    const parsed = JSON.parse(imagePath);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed[0];
  } catch { /* value is not a JSON list: fall back to the raw string */ }
  return imagePath;
}

function methodInfo(method: string): { label: string; color: string } {
  const m = method.toLowerCase();
  if (m === 'cash') return { label: 'Cash', color: 'bg-surface text-text-secondary' };
  if (m === 'card' || m === 'visa' || m === 'mastercard') return { label: method, color: 'bg-accent-blue/10 text-accent-blue' };
  if (m === 'apple pay') return { label: 'Apple Pay', color: 'bg-surface text-text-primary' };
  if (m.includes('transfer') || m === 'bank') return { label: 'Bank Transfer', color: 'bg-accent-purple/10 text-accent-purple' };
  return { label: method, color: 'bg-surface text-text-secondary' };
}

function saleStatus(sale: SaleWithItems['sale']): { label: string; cls: string } {
  if (sale.profit > 0) return { label: 'Completed', cls: 'bg-accent-green/10 text-accent-green' };
  if (sale.profit === 0) return { label: 'Pending', cls: 'bg-accent-orange/10 text-accent-orange' };
  return { label: 'Refunded', cls: 'bg-accent-red/10 text-accent-red' };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(uiLocale(), { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + d.toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit', hour12: true });
}

/** Date and time as two short lines for table cells. */
function formatDateParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString(uiLocale(), { month: 'short', day: 'numeric', year: 'numeric' }),
    time: d.toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit', hour12: true }),
  };
}

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

const AVATAR_COLORS = [
  'bg-accent-blue/10 text-accent-blue',
  'bg-accent-purple/10 text-accent-purple',
  'bg-accent-orange/10 text-accent-orange',
  'bg-accent-green/10 text-accent-green',
  'bg-accent-red/10 text-accent-red',
  'bg-navy/10 text-navy',
  'bg-border text-text-secondary',
];
function avatarColor(id: number): string {
  return AVATAR_COLORS[id % AVATAR_COLORS.length];
}

export default function Sales() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [deleteMode, setDeleteMode] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  // Fixed-position menu: anchored to the ⋯ button via getBoundingClientRect so
  // it escapes the table's overflow-x-auto/overflow-hidden clipping ancestors
  // and always sits on top of the container.
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const menuBtnRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const [invoiceSale, setInvoiceSale] = useState<SaleWithItems | null>(null);
  const [shippingSale, setShippingSale] = useState<SaleWithItems | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SaleWithItems | null>(null);
  // Reference time for the relative date filters. Read from state (never Date.now()
  // during render) and refreshed every minute so the 7d/30d windows stay current.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const deleteMutation = useMutation({
    mutationFn: (id: number) => invoke('delete_sale', { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['sales-summary'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      setDeleteTarget(null);
      toast.success(t('toast.saleDeleted'));
    },
    onError: () => toast.error(t('toast.error')),
  });
  const handleDeleteSale = (s: SaleWithItems) => setDeleteTarget(s);
  // Position the fixed dropdown at the button's bottom-left corner and open it.
  const openMenu = (id: number) => {
    const btn = menuBtnRefs.current[id];
    if (btn) {
      const r = btn.getBoundingClientRect();
      // left keeps the ~160px menu on-screen when the button is far right.
      const left = Math.max(8, Math.min(r.left, window.innerWidth - 176));
      setMenuPos({ top: r.bottom + 4, left });
    }
    setMenuOpenId(id);
  };
  // Close the menu on scroll/resize so it never floats detached from its row.
  useEffect(() => {
    if (menuOpenId == null) return;
    const close = () => setMenuOpenId(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menuOpenId]);
  const { data: sales } = useQuery({
    queryKey: ['sales'],
    queryFn: () => invoke<SaleWithItems[]>('get_sales'),
  });
  const { data: summary } = useQuery({
    queryKey: ['sales-summary'],
    queryFn: () => invoke<SalesSummary>('get_sales_summary'),
  });
  const { data: customers } = useQuery({
    queryKey: ['customers'],
    queryFn: () => invoke<Customer[]>('get_customers'),
  });
  const customerMap = new Map((customers ?? []).map(c => [c.id, c]));
  const filtered = (sales ?? []).filter(s => {
    if (search) {
      const q = search.toLowerCase();
      const cust = s.sale.customer_id ? customerMap.get(s.sale.customer_id) : null;
      const txId = `#TXN-${90000 + s.sale.id}`;
      if (!txId.toLowerCase().includes(q) && !(cust?.name.toLowerCase().includes(q))) return false;
    }
    if (statusFilter !== 'all') {
      const st = saleStatus(s.sale).label.toLowerCase();
      if (st !== statusFilter) return false;
    }
    if (dateFilter === '30d') {
      const d = new Date(s.sale.created_at);
      if (d < new Date(now - 30 * 86400000)) return false;
    } else if (dateFilter === '7d') {
      const d = new Date(s.sale.created_at);
      if (d < new Date(now - 7 * 86400000)) return false;
    }
    return true;
  });
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / ITEMS_PER_PAGE));
  const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);
  const totalSales = summary?.total_sales ?? 0;
  const avgTx = summary?.avg_transaction ?? 0;
  const pendingAmount = summary?.pending_amount ?? 0;
  const pendingCount = summary?.pending_count ?? 0;
  const totalTx = summary?.total_transactions ?? total;
  // Real period-over-period change: last 30 days vs the 30 days before.
  // Refunded sales don't count as revenue.
  const periodTotal = (from: number, to: number) => (sales ?? [])
    .filter(s => {
      const ts = new Date(s.sale.created_at).getTime();
      return ts >= from && ts < to && saleStatus(s.sale).label !== 'Refunded';
    })
    .reduce((sum, s) => sum + s.sale.total_amount, 0);
  const DAY = 86400000;
  const recentTotal = periodTotal(now - 30 * DAY, now + DAY);
  const previousTotal = periodTotal(now - 60 * DAY, now - 30 * DAY);
  const trendPct = previousTotal > 0 ? ((recentTotal - previousTotal) / previousTotal) * 100 : null;
  const refundedCount = (sales ?? []).filter(s => saleStatus(s.sale).label === 'Refunded').length;
  const hasFilters = search !== '' || statusFilter !== 'all' || dateFilter !== 'all';
  const handleExportCSV = () => {
    const header = 'Transaction ID,Date,Customer,Method,Amount,Status,Items\n';
    const rows = filtered.map(s => {
      const cust = s.sale.customer_id ? customerMap.get(s.sale.customer_id) : null;
      const itemNames = s.items.map(it => `${it.product_name}${it.variant_name ? ` (${it.variant_name})` : ''} x${it.quantity}`).join('; ');
      return `#TXN-${90000 + s.sale.id},"${formatDate(s.sale.created_at)}","${cust?.name ?? 'Walk-in'}","${s.sale.payment_method}",${s.sale.total_amount.toFixed(2)} DA,"${saleStatus(s.sale).label}","${itemNames}"`;
    }).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'sales-history.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-8">
      {/* Content sits in its own wrapper so the entrance transform never
          re-anchors the fixed overlays rendered below it. */}
      <div className="animate-fade-up">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <span className="eyebrow-accent mb-3 flex w-fit">{t('sidebar.groupSell')}</span>
            <h2 className="page-title">{t('sales.title')}</h2>
            <p className="page-subtitle">{t('sales.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2.5">
            <button type="button" onClick={handleExportCSV} className="btn-secondary">
              <Download size={15} /> {t('sales.exportCSV')}
            </button>
            <button type="button" onClick={() => window.print()} className="btn-primary">
              <Printer size={15} /> {t('sales.printSummary')}
            </button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-4 gap-5 mb-6">
          <div className="card p-5">
            <p className="text-[13px] font-medium text-text-secondary">{t('sales.totalSales')}</p>
            <p className="text-[24px] font-semibold tracking-[-0.02em] text-text-primary tabular-nums mt-1.5">{totalSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}&lrm; DA</p>
            {trendPct === null ? (
              <p className="text-[13px] text-text-muted mt-2">{totalTx} {t('sales.transactions')}</p>
            ) : (
              <div className="flex items-center gap-2 mt-2">
                <span className={`badge ${trendPct >= 0 ? 'bg-accent-green/10 text-accent-green' : 'bg-accent-red/10 text-accent-red'}`}>
                  {trendPct >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  {trendPct >= 0 ? '+' : ''}{trendPct.toFixed(1)}%
                </span>
                <span className="text-[13px] text-text-muted">{t('sales.vsLastMonth')}</span>
              </div>
            )}
          </div>
          <div className="card p-5">
            <p className="text-[13px] font-medium text-text-secondary">{t('sales.avgTransaction')}</p>
            <p className="text-[24px] font-semibold tracking-[-0.02em] text-text-primary tabular-nums mt-1.5">{avgTx.toFixed(2)}&lrm; DA</p>
            <p className="text-[13px] text-text-muted mt-2">{t('sales.basedOnEntries', { count: totalTx })}</p>
          </div>
          <div className="card p-5">
            <p className="text-[13px] font-medium text-text-secondary">{t('sales.pendingClearance')}</p>
            <p className="text-[24px] font-semibold tracking-[-0.02em] text-accent-orange tabular-nums mt-1.5">{pendingAmount.toFixed(2)}&lrm; DA</p>
            <p className="text-[13px] text-text-muted mt-2">{pendingCount} {t('sales.transactions')}</p>
          </div>
          <div className="card p-5">
            <p className="text-[13px] font-medium text-text-secondary">{t('sales.refundRate')}</p>
            <p className="text-[24px] font-semibold tracking-[-0.02em] text-accent-red tabular-nums mt-1.5">{totalTx > 0 ? ((filtered.filter(s => saleStatus(s.sale).label === 'Refunded').length / totalTx) * 100).toFixed(1) : '0.0'}%</p>
            <p className="text-[13px] text-text-muted mt-2">{t('sales.refundedCount', { count: refundedCount })}</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <input type="text" aria-label={t('common.search')} placeholder={t('sales.searchPlaceholder')} value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="form-input pl-10" />
          </div>
          <CustomSelect
            value={dateFilter}
            onChange={(v) => { setDateFilter(v); setPage(1); }}
            options={[
              { value: 'all', label: t('sales.allTime') },
              { value: '7d', label: t('sales.last7Days') },
              { value: '30d', label: t('sales.last30Days') },
            ]}
            icon={<Calendar size={14} />}
            size="sm"
            className="w-[150px]"
          />
          <CustomSelect
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); setPage(1); }}
            options={[
              { value: 'all', label: t('sales.allStatuses') },
              { value: 'completed', label: t('sales.completed') },
              { value: 'pending', label: t('sales.pending') },
              { value: 'refunded', label: t('sales.refunded') },
            ]}
            icon={<Filter size={14} />}
            size="sm"
            className="w-[150px]"
          />
          <button type="button" aria-label={t('common.refresh')} title={t('common.refresh')} className="btn-secondary px-3">
            <RefreshCw size={15} />
          </button>
          <button
            type="button"
            onClick={() => setDeleteMode(!deleteMode)}
            aria-pressed={deleteMode}
            className={deleteMode ? 'btn-danger' : 'btn-secondary'}
            title={deleteMode ? t('sales.exitDelete') : t('sales.deleteTransactions')}
          >
            <Trash2 size={15} />
            {deleteMode ? t('sales.exitDelete') : t('sales.deleteMode')}
          </button>
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border-light bg-surface/60">
                  <th className="text-left py-3 px-3 text-text-muted font-medium text-[13px] w-8"></th>
                  <th className="text-left py-3 px-3 text-text-muted font-medium text-[13px] whitespace-nowrap">{t('sales.transactionId')}</th>
                  <th className="text-left py-3 px-3 text-text-muted font-medium text-[13px] whitespace-nowrap">{t('sales.dateTime')}</th>
                  <th className="text-left py-3 px-3 text-text-muted font-medium text-[13px] whitespace-nowrap">{t('sales.customer')}</th>
                  <th className="text-left py-3 px-3 text-text-muted font-medium text-[13px] whitespace-nowrap">{t('sales.itemsSold')}</th>
                  <th className="text-left py-3 px-3 text-text-muted font-medium text-[13px] whitespace-nowrap">{t('sales.method')}</th>
                  <th className="text-right py-3 px-3 text-text-muted font-medium text-[13px] whitespace-nowrap">{t('sales.amount')}</th>
                  <th className="text-center py-3 px-3 text-text-muted font-medium text-[13px] whitespace-nowrap">{t('common.status')}</th>
                  <th className="text-center py-3 px-3 text-text-muted font-medium text-[13px] whitespace-nowrap w-16">{t('products.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {paginated.length === 0 ? (
                  <tr><td colSpan={9} className="py-16">
                    <div className="flex flex-col items-center text-center">
                      <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center text-text-muted mb-3">
                        <Receipt size={22} />
                      </div>
                      <p className="text-[14px] font-medium text-text-primary">{t('sales.noTransactions')}</p>
                      {hasFilters && (
                        <button
                          type="button"
                          onClick={() => { setSearch(''); setDateFilter('all'); setStatusFilter('all'); setPage(1); }}
                          className="btn-secondary mt-4 py-2"
                        >
                          {t('sales.clearFilters')}
                        </button>
                      )}
                    </div>
                  </td></tr>
                ) : (
                  paginated.map((s) => {
                    const cust = s.sale.customer_id ? customerMap.get(s.sale.customer_id) : null;
                    const custName = cust?.name ?? t('sales.walkIn');
                    const initials = getInitials(custName);
                    const status = saleStatus(s.sale);
                    const statusText = status.label === 'Completed'
                      ? t('sales.completed')
                      : status.label === 'Pending' ? t('sales.pending') : t('sales.refunded');
                    const method = methodInfo(s.sale.payment_method);
                    const isExpanded = expandedId === s.sale.id;
                    const firstItem = s.items[0];
                    const itemSummary = firstItem
                      ? s.items.length === 1
                        ? `${firstItem.product_name}${firstItem.variant_name ? ` (${firstItem.variant_name})` : ''}`
                        : t('sales.itemsMore', { name: `${firstItem.product_name}${firstItem.variant_name ? ` (${firstItem.variant_name})` : ''}`, count: s.items.length - 1 })
                      : t('sales.noItems');
                    return (
                      <Fragment key={s.sale.id}>
                        <tr onClick={() => setExpandedId(isExpanded ? null : s.sale.id)}
                          className={`border-b border-border-light hover:bg-surface transition-colors cursor-pointer ${isExpanded ? 'bg-surface' : ''}`}>
                          <td className="py-3.5 px-3 text-text-muted">
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </td>
                          <td className="py-3.5 px-3 font-semibold text-navy tabular-nums whitespace-nowrap">#{`TXN-${90000 + s.sale.id}`}</td>
                          <td className="py-3.5 px-3 text-[13px] tabular-nums leading-snug">
                            <div className="whitespace-nowrap text-text-secondary">{formatDateParts(s.sale.created_at).date}</div>
                            <div className="whitespace-nowrap text-text-muted">{formatDateParts(s.sale.created_at).time}</div>
                          </td>
                          <td className="py-3.5 px-3">
                            <div className="flex items-center gap-2.5">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-semibold flex-shrink-0 ${avatarColor(s.sale.id)}`}>
                                {initials}
                              </div>
                              <span className="whitespace-nowrap text-text-primary font-medium">{custName}</span>
                            </div>
                          </td>
                          <td className="py-3.5 px-3">
                            <span className="text-[13px] text-text-secondary truncate max-w-[180px] block">{itemSummary}</span>
                          </td>
                          <td className="py-3.5 px-3">
                            <span className={`badge ${method.color}`}>
                              {method.label === 'Cash' ? t('checkout.cash') : method.label.toLowerCase() === 'card' ? t('checkout.card') : method.label === 'Bank Transfer' ? t('sales.bankTransfer') : method.label}
                            </span>
                          </td>
                          <td className="py-3.5 px-3 text-right font-semibold text-text-primary tabular-nums whitespace-nowrap">
                            {fmt(s.sale.total_amount)}
                          </td>
                          <td className="py-3.5 px-3 text-center">
                            <span className={`badge ${status.cls}`}>
                              <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" />
                              {statusText}
                            </span>
                          </td>
                          <td className="py-3.5 px-5 text-center">
                            {deleteMode ? (
                              <button
                                type="button"
                                onClick={() => handleDeleteSale(s)}
                                aria-label={t('sales.deleteTransaction', { id: 90000 + s.sale.id })}
                                className="p-1.5 rounded-lg text-accent-red hover:bg-accent-red/10 transition-colors"
                                title={t('sales.deleteTransactions')}
                              >
                                <Trash2 size={15} />
                              </button>
                            ) : (
                              <div className="relative inline-block">
                                <button
                                  type="button"
                                  ref={(el) => { menuBtnRefs.current[s.sale.id] = el; }}
                                  aria-label={t('common.moreActions')}
                                  aria-expanded={menuOpenId === s.sale.id}
                                  onClick={(e) => { e.stopPropagation(); if (menuOpenId === s.sale.id) setMenuOpenId(null); else openMenu(s.sale.id); }}
                                  className="p-1.5 rounded-lg hover:bg-surface transition-colors text-text-muted"
                                >
                                  <MoreHorizontal size={16} />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${s.sale.id}-detail`} className="border-b border-border-light">
                            <td colSpan={9} className="px-5 py-3 bg-surface">
                              <div className="rounded-xl border border-border-light overflow-hidden bg-card">
                                <table className="w-full text-[13px]">
                                  <thead>
                                    <tr className="border-b border-border-light">
                                      <th className="text-left py-2.5 px-4 text-text-muted font-medium">{t('products.product')}</th>
                                      <th className="text-left py-2.5 px-4 text-text-muted font-medium">{t('sales.variant')}</th>
                                      <th className="text-center py-2.5 px-4 text-text-muted font-medium">{t('sales.qty')}</th>
                                      <th className="text-right py-2.5 px-4 text-text-muted font-medium">{t('sales.unitPrice')}</th>
                                      <th className="text-right py-2.5 px-4 text-text-muted font-medium">{t('sales.unitCost')}</th>
                                      <th className="text-right py-2.5 px-4 text-text-muted font-medium">{t('sales.subtotal')}</th>
                                      <th className="text-right py-2.5 px-4 text-text-muted font-medium">{t('sales.profit')}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {s.items.map((item, idx) => {
                                      const coverImg = getCoverImage(item.product_image);
                                      return (
                                        <tr key={idx} className="border-b border-border-light last:border-0">
                                          <td className="py-2.5 px-4">
                                            <div className="flex items-center gap-2.5">
                                              <div className="w-8 h-8 rounded-lg bg-surface flex items-center justify-center flex-shrink-0 overflow-hidden border border-border-light">
                                                {coverImg ? (
                                                  <img src={convertFileSrc(coverImg)} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                  <Package size={14} className="text-text-muted" />
                                                )}
                                              </div>
                                              <span className="text-text-primary font-medium">{item.product_name}</span>
                                            </div>
                                          </td>
                                          <td className="py-2.5 px-4">
                                            {item.variant_name ? (
                                              <span className="badge bg-accent-blue/10 text-accent-blue text-[13px] px-2 py-0.5">
                                                <Layers size={10} />{item.variant_name}
                                              </span>
                                            ) : (
                                              <span className="text-text-muted text-[13px]">{t('sales.base')}</span>
                                            )}
                                          </td>
                                          <td className="py-2.5 px-4 text-center text-text-secondary tabular-nums">{item.quantity}</td>
                                          <td className="py-2.5 px-4 text-right text-text-secondary tabular-nums">{fmt(item.unit_price)}</td>
                                          <td className="py-2.5 px-4 text-right text-text-muted tabular-nums">{fmt(item.unit_cost)}</td>
                                          <td className="py-2.5 px-4 text-right font-semibold text-text-primary tabular-nums">{fmt(item.subtotal)}</td>
                                          <td className="py-2.5 px-4 text-right tabular-nums">
                                            <span className={`font-semibold ${(item.unit_price - item.unit_cost) >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                                              {fmt((item.unit_price - item.unit_cost) * item.quantity)}
                                            </span>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          {total > 0 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-border-light">
              <p className="text-[13px] text-text-muted">
                {t('sales.showing', { start: (page - 1) * ITEMS_PER_PAGE + 1, end: Math.min(page * ITEMS_PER_PAGE, total), total })}
              </p>
              <div className="flex items-center gap-1">
                <button type="button" aria-label={t('common.previous')} disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                  className="p-1.5 rounded-lg text-text-secondary hover:bg-surface transition-colors disabled:opacity-40 disabled:pointer-events-none">
                  <ChevronLeft size={16} />
                </button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  const pg = i + 1;
                  return (
                    <button type="button" key={pg} onClick={() => setPage(pg)}
                      aria-current={page === pg ? 'page' : undefined}
                      className={`min-w-[28px] h-7 px-2 rounded-lg text-[13px] font-medium tabular-nums transition-colors ${
                        page === pg ? 'bg-navy text-white' : 'text-text-secondary hover:bg-surface'
                      }`}>{pg}</button>
                  );
                })}
                {totalPages > 5 && <span className="px-1 text-text-muted text-[13px]">...</span>}
                {totalPages > 5 && (
                  <button type="button" onClick={() => setPage(totalPages)}
                    className="min-w-[28px] h-7 px-2 rounded-lg text-[13px] font-medium tabular-nums text-text-secondary hover:bg-surface transition-colors">{totalPages}</button>
                )}
                <button type="button" aria-label={t('common.next')} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                  className="p-1.5 rounded-lg text-text-secondary hover:bg-surface transition-colors disabled:opacity-40 disabled:pointer-events-none">
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {invoiceSale && (
        <Invoice
          sale={invoiceSale.sale}
          items={invoiceSale.items}
          customer={invoiceSale.sale.customer_id ? customerMap.get(invoiceSale.sale.customer_id) ?? null : null}
          onClose={() => setInvoiceSale(null)}
        />
      )}

      {shippingSale && (
        <ShippingLabel
          sale={shippingSale.sale}
          items={shippingSale.items}
          customer={shippingSale.sale.customer_id ? customerMap.get(shippingSale.sale.customer_id) ?? null : null}
          onClose={() => setShippingSale(null)}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        variant="danger"
        title={t('common.delete')}
        description={t('sales.deleteConfirm', { id: deleteTarget ? 90000 + deleteTarget.sale.id : 0 })}
        confirmLabel={t('common.delete')}
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.sale.id)}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Fixed-position row actions menu — rendered once at the root so it floats
          above the table's overflow scroll container instead of being clipped. */}
      {menuOpenId != null && menuPos && (() => {
        const s = (sales ?? []).find(x => x.sale.id === menuOpenId);
        if (!s) return null;
        return (
          <>
            <div className="fixed inset-0 z-[150]" onClick={() => setMenuOpenId(null)} />
            <div
              className="fixed z-[160] bg-card border border-border rounded-xl shadow-raised min-w-[176px] overflow-hidden py-1"
              style={{ top: menuPos.top, left: menuPos.left }}
            >
              <button
                type="button"
                onClick={() => { setInvoiceSale(s); setMenuOpenId(null); }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-text-primary hover:bg-surface transition-colors text-left"
              >
                <Printer size={14} className="text-text-muted" />
                {t('checkout.printInvoice')}
              </button>
              <button
                type="button"
                onClick={() => { setShippingSale(s); setMenuOpenId(null); }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-text-primary hover:bg-surface transition-colors text-left"
              >
                <Printer size={14} className="text-text-muted" />
                {t('shipping.printLabel')}
              </button>
              <div className="h-px bg-border-light my-1" />
              <button
                type="button"
                onClick={() => { handleDeleteSale(s); setMenuOpenId(null); }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-accent-red hover:bg-accent-red/10 transition-colors text-left"
              >
                <Trash2 size={14} />
                {t('sales.deleteTransaction', { id: 90000 + s.sale.id })}
              </button>
            </div>
          </>
        );
      })()}
    </div>
  );
}

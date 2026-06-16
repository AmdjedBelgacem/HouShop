import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import type { SaleWithItems, SalesSummary, Customer } from '../lib/types';
import Invoice from '../components/Invoice';
import CustomSelect from '../components/CustomSelect';
import { useI18n } from '../i18n';
import {
  Search, Download, Printer, Calendar, Filter,
  RefreshCw, MoreHorizontal, ChevronLeft, ChevronRight,
  TrendingUp, Clock, ChevronDown, ChevronUp, Package, Layers, Trash2,
} from 'lucide-react';
const ITEMS_PER_PAGE = 10;
const fmt = (n: number) => `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DA`;
function getCoverImage(imagePath: string | null): string | null {
  if (!imagePath) return null;
  try {
    const parsed = JSON.parse(imagePath);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed[0];
  } catch {  }
  return imagePath;
}
function methodInfo(method: string): { label: string; color: string } {
  const m = method.toLowerCase();
  if (m === 'cash') return { label: 'Cash', color: 'bg-surface text-text-secondary' };
  if (m === 'card' || m === 'visa' || m === 'mastercard') return { label: method, color: 'bg-blue-50 text-accent-blue' };
  if (m === 'apple pay') return { label: 'Apple Pay', color: 'bg-surface text-text-primary' };
  if (m.includes('transfer') || m === 'bank') return { label: 'Bank Transfer', color: 'bg-purple-50 text-purple-600' };
  return { label: method, color: 'bg-surface text-text-secondary' };
}
function saleStatus(sale: SaleWithItems['sale']): { label: string; cls: string } {
  if (sale.profit > 0) return { label: 'Completed', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (sale.profit === 0) return { label: 'Pending', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
  return { label: 'Refunded', cls: 'bg-rose-50 text-rose-600 border-rose-200' };
}
function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}
function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}
const AVATAR_COLORS = ['#3B82F6', '#8B5CF6', '#F59E0B', '#6B7280', '#06B6D4', '#EC4899', '#10B981'];
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
  const [invoiceSale, setInvoiceSale] = useState<SaleWithItems | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (id: number) => invoke('delete_sale', { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['sales-summary'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
  });
  const handleDeleteSale = (id: number) => {
    if (window.confirm(t('sales.deleteConfirm', { id: 90000 + id }))) {
      deleteMutation.mutate(id);
    }
  };
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
      if (d < new Date(Date.now() - 30 * 86400000)) return false;
    } else if (dateFilter === '7d') {
      const d = new Date(s.sale.created_at);
      if (d < new Date(Date.now() - 7 * 86400000)) return false;
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
      {}
      <div className="flex items-start justify-between mb-7">
        <div>
          <h2 className="text-[26px] font-bold text-text-primary leading-tight">{t('sales.title')}</h2>
          <p className="text-[14px] text-text-secondary mt-1.5">
            {t('sales.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-[12.5px] font-medium text-text-secondary hover:bg-surface transition-colors bg-card">
            <Download size={14} /> {t('sales.exportCSV')}
          </button>
          <button onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-navy text-white text-[12.5px] font-medium hover:bg-navy-light transition-colors">
            <Printer size={14} /> {t('sales.printSummary')}
          </button>
        </div>
      </div>
      {}
      <div className="grid grid-cols-4 gap-5 mb-6">
        <div className="card px-5 py-4">
          <p className="text-[10.5px] font-semibold text-text-muted tracking-[0.08em] uppercase">{t('sales.totalSales')}</p>
          <p className="text-[22px] font-bold text-text-primary mt-1">{totalSales.toLocaleString('en-US', { minimumFractionDigits: 2 })} DA</p>
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="flex items-center gap-0.5 text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">
              <TrendingUp size={11} /> +12.5%
            </span>
            <span className="text-[11px] text-text-muted">{t('sales.vsLastMonth')}</span>
          </div>
        </div>
        <div className="card px-5 py-4">
          <p className="text-[10.5px] font-semibold text-text-muted tracking-[0.08em] uppercase">{t('sales.avgTransaction')}</p>
          <p className="text-[22px] font-bold text-text-primary mt-1">{avgTx.toFixed(2)} DA</p>
          <p className="text-[11px] text-text-muted mt-1.5">{t('sales.basedOnEntries', { count: totalTx })}</p>
        </div>
        <div className="card px-5 py-4">
          <p className="text-[10.5px] font-semibold text-text-muted tracking-[0.08em] uppercase">{t('sales.pendingClearance')}</p>
          <p className="text-[22px] font-bold text-amber-600 mt-1">{pendingAmount.toFixed(2)} DA</p>
          <p className="text-[11px] text-text-muted mt-1.5">{pendingCount} {t('sales.transactions')}</p>
        </div>
        <div className="card px-5 py-4">
          <p className="text-[10.5px] font-semibold text-text-muted tracking-[0.08em] uppercase">{t('sales.refundRate')}</p>
          <p className="text-[22px] font-bold text-accent-red mt-1">{totalTx > 0 ? ((filtered.filter(s => saleStatus(s.sale).label === 'Refunded').length / totalTx) * 100).toFixed(1) : '0.0'}%</p>
          <p className="text-[11px] text-text-muted mt-1.5">{t('sales.industryAvg')}</p>
        </div>
      </div>
      {}
      <div className="card px-4 py-3 mb-5 flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input type="text" placeholder={t('sales.searchPlaceholder')} value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-border text-[13px] focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy/30 placeholder:text-text-muted bg-surface" />
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
        <button className="p-2 rounded-lg border border-border text-text-muted hover:bg-surface transition-colors" title="Refresh">
          <RefreshCw size={15} />
        </button>
        <button
          onClick={() => setDeleteMode(!deleteMode)}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-medium transition-colors ${
            deleteMode
              ? 'bg-accent-red text-white hover:bg-red-600'
              : 'border border-border text-text-secondary hover:bg-surface'
          }`}
          title={deleteMode ? t('sales.exitDelete') : t('sales.deleteTransactions')}
        >
          <Trash2 size={14} />
          {deleteMode ? t('sales.exitDelete') : t('sales.deleteMode')}
        </button>
      </div>
      {}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-sidebar/50">
                <th className="text-left py-3 px-5 text-text-muted font-semibold text-[11px] uppercase tracking-wider w-8"></th>
                <th className="text-left py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">Transaction ID</th>
                <th className="text-left py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">Date & Time</th>
                <th className="text-left py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">Customer</th>
                <th className="text-left py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">Items</th>
                <th className="text-left py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">Method</th>
                <th className="text-right py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">Amount</th>
                <th className="text-center py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">Status</th>
                <th className="text-center py-3 px-5 text-text-muted font-semibold text-[11px] uppercase tracking-wider w-16">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr><td colSpan={9} className="py-16 text-center text-text-muted">
                  <Clock size={28} className="mx-auto mb-2 opacity-30" />
                  No transactions found
                </td></tr>
              ) : (
                paginated.map((s) => {
                  const cust = s.sale.customer_id ? customerMap.get(s.sale.customer_id) : null;
                  const custName = cust?.name ?? 'Walk-in';
                  const initials = getInitials(custName);
                  const status = saleStatus(s.sale);
                  const method = methodInfo(s.sale.payment_method);
                  const isExpanded = expandedId === s.sale.id;
                  const firstItem = s.items[0];
                  const itemSummary = firstItem
                    ? s.items.length === 1
                      ? `${firstItem.product_name}${firstItem.variant_name ? ` (${firstItem.variant_name})` : ''}`
                      : `${firstItem.product_name}${firstItem.variant_name ? ` (${firstItem.variant_name})` : ''} + ${s.items.length - 1} more`
                    : 'No items';
                  return (
                    <>
                      <tr key={s.sale.id} onClick={() => setExpandedId(isExpanded ? null : s.sale.id)}
                        className={`border-b border-border-light hover:bg-sidebar/30 transition-colors cursor-pointer ${isExpanded ? 'bg-sidebar/30' : ''}`}>
                        <td className="py-3 px-5 text-text-muted">
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </td>
                        <td className="py-3 px-4 font-semibold text-navy">#{`TXN-${90000 + s.sale.id}`}</td>
                        <td className="py-3 px-4 text-text-secondary text-[12px]">{formatDate(s.sale.created_at)}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                              style={{ background: avatarColor(s.sale.id) }}>
                              {initials}
                            </div>
                            <span className="text-text-primary font-medium text-[12.5px]">{custName}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-[12px] text-text-secondary truncate max-w-[180px] block">{itemSummary}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${method.color}`}>
                            {method.label}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-semibold text-text-primary">
                          {fmt(s.sale.total_amount)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${status.cls}`}>
                            {status.label}
                          </span>
                        </td>
                        <td className="py-3 px-5 text-center">
                          {deleteMode ? (
                            <button
                              onClick={() => handleDeleteSale(s.sale.id)}
                              className="p-1.5 rounded-md text-accent-red hover:bg-red-50 transition-colors"
                              title="Delete transaction"
                            >
                              <Trash2 size={15} />
                            </button>
                          ) : (
                            <div className="relative inline-block">
                              <button
                                onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === s.sale.id ? null : s.sale.id); }}
                                className="p-1 rounded hover:bg-surface transition-colors text-text-muted"
                              >
                                <MoreHorizontal size={16} />
                              </button>
                              {menuOpenId === s.sale.id && (
                                <>
                                  <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setMenuOpenId(null); }} />
                                  <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-xl shadow-lg z-40 min-w-[160px] overflow-hidden">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setInvoiceSale(s); setMenuOpenId(null); }}
                                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12.5px] text-text-primary hover:bg-surface transition-colors text-left"
                                    >
                                      <Printer size={14} className="text-text-muted" />
                                      {t('checkout.printInvoice')}
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleDeleteSale(s.sale.id); setMenuOpenId(null); }}
                                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12.5px] text-accent-red hover:bg-red-50 transition-colors text-left"
                                    >
                                      <Trash2 size={14} />
                                      {t('sales.deleteTransaction', { id: 90000 + s.sale.id })}
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                      {}
                      {isExpanded && (
                        <tr key={`${s.sale.id}-detail`} className="border-b border-border-light">
                          <td colSpan={9} className="px-5 py-3 bg-surface/50">
                            <div className="rounded-lg border border-border overflow-hidden">
                              <table className="w-full text-[12px]">
                                <thead>
                                  <tr className="bg-card border-b border-border">
                                    <th className="text-left py-2 px-4 text-text-muted font-semibold text-[10px] uppercase tracking-wider">Product</th>
                                    <th className="text-left py-2 px-4 text-text-muted font-semibold text-[10px] uppercase tracking-wider">Variant</th>
                                    <th className="text-center py-2 px-4 text-text-muted font-semibold text-[10px] uppercase tracking-wider">Qty</th>
                                    <th className="text-right py-2 px-4 text-text-muted font-semibold text-[10px] uppercase tracking-wider">Unit Price</th>
                                    <th className="text-right py-2 px-4 text-text-muted font-semibold text-[10px] uppercase tracking-wider">Unit Cost</th>
                                    <th className="text-right py-2 px-4 text-text-muted font-semibold text-[10px] uppercase tracking-wider">Subtotal</th>
                                    <th className="text-right py-2 px-4 text-text-muted font-semibold text-[10px] uppercase tracking-wider">Profit</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {s.items.map((item, idx) => {
                                    const coverImg = getCoverImage(item.product_image);
                                    return (
                                      <tr key={idx} className="border-b border-border-light last:border-0 bg-card">
                                        <td className="py-2 px-4">
                                          <div className="flex items-center gap-2">
                                            <div className="w-8 h-8 rounded bg-surface flex items-center justify-center flex-shrink-0 overflow-hidden border border-border-light">
                                              {coverImg ? (
                                                <img src={convertFileSrc(coverImg)} alt="" className="w-full h-full object-cover" />
                                              ) : (
                                                <Package size={14} className="text-text-muted" />
                                              )}
                                            </div>
                                            <span className="text-text-primary font-medium">{item.product_name}</span>
                                          </div>
                                        </td>
                                        <td className="py-2 px-4">
                                          {item.variant_name ? (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-accent-blue bg-blue-50 px-2 py-0.5 rounded">
                                              <Layers size={9} />{item.variant_name}
                                            </span>
                                          ) : (
                                            <span className="text-text-muted text-[11px]">Base</span>
                                          )}
                                        </td>
                                        <td className="py-2 px-4 text-center text-text-secondary">{item.quantity}</td>
                                        <td className="py-2 px-4 text-right text-text-secondary">{fmt(item.unit_price)}</td>
                                        <td className="py-2 px-4 text-right text-text-muted">{fmt(item.unit_cost)}</td>
                                        <td className="py-2 px-4 text-right font-semibold text-text-primary">{fmt(item.subtotal)}</td>
                                        <td className="py-2 px-4 text-right">
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
                    </>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {}
        {total > 0 && (
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-border bg-sidebar/30">
            <p className="text-[12px] text-text-muted">
              Showing {(page - 1) * ITEMS_PER_PAGE + 1} to {Math.min(page * ITEMS_PER_PAGE, total)} of {total} transactions
            </p>
            <div className="flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                className="p-1.5 rounded-md text-text-muted hover:bg-card disabled:opacity-30 transition-colors">
                <ChevronLeft size={16} />
              </button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const pg = i + 1;
                return (
                  <button key={pg} onClick={() => setPage(pg)}
                    className={`w-7 h-7 rounded-md text-[12px] font-medium transition-colors ${
                      page === pg ? 'bg-navy text-white' : 'text-text-secondary hover:bg-card'
                    }`}>{pg}</button>
                );
              })}
              {totalPages > 5 && <span className="px-1 text-text-muted text-[12px]">...</span>}
              {totalPages > 5 && (
                <button onClick={() => setPage(totalPages)}
                  className={`w-7 h-7 rounded-md text-[12px] font-medium text-text-secondary hover:bg-card transition-colors`}>{totalPages}</button>
              )}
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                className="p-1.5 rounded-md text-text-muted hover:bg-card disabled:opacity-30 transition-colors">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
      {}
      {invoiceSale && (
        <Invoice
          sale={invoiceSale.sale}
          items={invoiceSale.items}
          customer={invoiceSale.sale.customer_id ? customerMap.get(invoiceSale.sale.customer_id) ?? null : null}
          onClose={() => setInvoiceSale(null)}
        />
      )}
    </div>
  );
}

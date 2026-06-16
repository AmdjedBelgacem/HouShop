import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import type { SaleWithItems, Product, CustomerWithStats, ReservationWithDetails } from '../lib/types';
import CustomSelect from '../components/CustomSelect';
import { useI18n } from '../i18n';
import {
  ArrowLeft, ShoppingCart, Package, UserPlus, CalendarCheck,
  Filter, Search, Clock, ChevronDown, ChevronUp, TrendingUp,
  Layers, DollarSign, CheckCircle, XCircle,
} from 'lucide-react';
interface LogEntry {
  id: string;
  type: 'sale' | 'product' | 'customer' | 'reservation';
  title: string;
  description: string;
  timestamp: string;
  amount?: number;
  status?: string;
  icon: React.ReactNode;
  iconColor: string;
}
function timeAgo(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  const days = Math.floor(mins / 1440);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function getCoverImage(imagePath: string | null): string | null {
  if (!imagePath) return null;
  try {
    const parsed = JSON.parse(imagePath);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed[0];
  } catch {  }
  return imagePath;
}
interface LogsProps {
  onBack: () => void;
}
export default function Logs({ onBack }: LogsProps) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data: sales } = useQuery({
    queryKey: ['sales'],
    queryFn: () => invoke<SaleWithItems[]>('get_sales'),
  });
  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: () => invoke<Product[]>('get_products'),
  });
  const { data: customers } = useQuery({
    queryKey: ['customers-with-stats'],
    queryFn: () => invoke<CustomerWithStats[]>('get_customers_with_stats'),
  });
  const { data: reservations } = useQuery({
    queryKey: ['reservations'],
    queryFn: () => invoke<ReservationWithDetails[]>('get_reservations'),
  });
  const logs = useMemo(() => {
    const entries: LogEntry[] = [];
    (sales ?? []).forEach(sale => {
      const itemNames = sale.items.map(it =>
        `${it.product_name}${it.variant_name ? ` (${it.variant_name})` : ''} x${it.quantity}`
      ).join(', ');
      entries.push({
        id: `sale-${sale.sale.id}`,
        type: 'sale',
        title: `Sale #TXN-${90000 + sale.sale.id}`,
        description: itemNames,
        timestamp: sale.sale.created_at,
        amount: sale.sale.total_amount,
        status: sale.sale.payment_method,
        icon: <ShoppingCart size={16} />,
        iconColor: 'bg-blue-100 text-accent-blue',
      });
    });
    (products ?? []).forEach(p => {
      const img = getCoverImage(p.image_path);
      entries.push({
        id: `product-${p.id}`,
        type: 'product',
        title: `Product: ${p.name}`,
        description: `${p.quantity} units in stock — ${p.category_name ?? 'Uncategorized'} — SKU: ${p.sku ?? 'N/A'}`,
        timestamp: p.created_at,
        amount: p.selling_price,
        icon: <Package size={16} />,
        iconColor: 'bg-green-100 text-accent-green',
      });
    });
    (customers ?? []).forEach(c => {
      entries.push({
        id: `customer-${c.id}`,
        type: 'customer',
        title: `Customer: ${c.name}`,
        description: `${c.phone ?? 'No phone'} — ${c.order_count} orders — ${c.total_spent.toFixed(2)} DA spent`,
        timestamp: c.created_at,
        icon: <UserPlus size={16} />,
        iconColor: 'bg-purple-100 text-purple-600',
      });
    });
    (reservations ?? []).forEach(r => {
      entries.push({
        id: `reservation-${r.id}`,
        type: 'reservation',
        title: `Reservation: ${r.product_name}`,
        description: `${r.customer_name} — Qty: ${r.quantity} — Deposit: ${r.deposit_amount.toFixed(2)} DA`,
        timestamp: r.created_at,
        amount: r.total_price,
        status: r.status,
        icon: <CalendarCheck size={16} />,
        iconColor: 'bg-amber-100 text-amber-600',
      });
    });
    entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return entries;
  }, [sales, products, customers, reservations]);
  const filtered = useMemo(() => {
    return logs.filter(log => {
      if (typeFilter !== 'all' && log.type !== typeFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return log.title.toLowerCase().includes(q) || log.description.toLowerCase().includes(q);
      }
      return true;
    });
  }, [logs, typeFilter, search]);
  const typeOptions = [
    { value: 'all', label: t('logs.allTypes') },
    { value: 'sale', label: t('logs.sales') },
    { value: 'product', label: t('logs.products') },
    { value: 'customer', label: t('logs.customers') },
    { value: 'reservation', label: t('logs.reservations') },
  ];
  return (
    <div className="p-8">
      {}
      <div className="flex items-center gap-4 mb-7">
        <button onClick={onBack}
          className="p-2 rounded-lg hover:bg-surface transition-colors text-text-secondary">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h2 className="text-[26px] font-bold text-text-primary leading-tight">{t('logs.title')}</h2>
          <p className="text-[14px] text-text-secondary mt-1">
            {t('logs.subtitle')}
          </p>
        </div>
        <div className="ml-auto text-[12.5px] text-text-muted">
          {filtered.length} {t('logs.entries')}
        </div>
      </div>
      {}
      <div className="card p-4 mb-5 flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('logs.searchPlaceholder')}
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-border text-[13px] focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy/30 placeholder:text-text-muted bg-surface"
          />
        </div>
        <CustomSelect
          value={typeFilter}
          onChange={setTypeFilter}
          options={typeOptions}
          icon={<Filter size={14} />}
          size="sm"
          className="w-[160px]"
        />
      </div>
      {}
      {filtered.length > 0 ? (
        <div className="space-y-2">
          {filtered.map(log => (
            <div key={log.id} className="card overflow-hidden">
              <button
                onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                className="w-full flex items-center gap-4 px-5 py-4 hover:bg-surface/50 transition-colors text-left"
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${log.iconColor}`}>
                  {log.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-semibold text-text-primary">{log.title}</p>
                  <p className="text-[12px] text-text-secondary mt-0.5 truncate">{log.description}</p>
                </div>
                {log.amount !== undefined && (
                  <span className="text-[13px] font-semibold text-text-primary flex-shrink-0">
                    {log.amount.toFixed(2)} DA
                  </span>
                )}
                {log.status && (
                  <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-semibold capitalize flex-shrink-0 ${
                    log.status === 'completed' || log.status === 'active' ? 'bg-emerald-50 text-emerald-600' :
                    log.status === 'cancelled' ? 'bg-red-50 text-accent-red' :
                    log.status === 'cash' ? 'bg-green-50 text-green-700' :
                    'bg-surface text-text-secondary'
                  }`}>
                    {log.status}
                  </span>
                )}
                <span className="text-[11px] text-text-muted flex-shrink-0">{timeAgo(log.timestamp)}</span>
                {expandedId === log.id ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
              </button>
              {expandedId === log.id && (
                <div className="px-5 pb-4 border-t border-border-light">
                  <div className="grid grid-cols-3 gap-4 py-3 text-[12px]">
                    <div>
                      <p className="text-text-muted font-semibold text-[10px] uppercase tracking-wider mb-1">{t('logs.type')}</p>
                      <p className="text-text-primary capitalize">{log.type}</p>
                    </div>
                    <div>
                      <p className="text-text-muted font-semibold text-[10px] uppercase tracking-wider mb-1">{t('common.date')}</p>
                      <p className="text-text-primary">{new Date(log.timestamp).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-text-muted font-semibold text-[10px] uppercase tracking-wider mb-1">{t('logs.details')}</p>
                      <p className="text-text-primary">{log.description}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="card p-12 flex flex-col items-center justify-center text-text-muted">
          <Clock size={36} strokeWidth={1.5} className="mb-3 text-text-muted/40" />
          <p className="text-[14px] font-medium">{t('logs.noLogs')}</p>
          <p className="text-[12.5px] mt-1">{t('logs.tryAdjusting')}</p>
        </div>
      )}
    </div>
  );
}

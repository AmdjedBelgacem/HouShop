import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import type { SaleWithItems, Product, CustomerWithStats, ReservationWithDetails } from '../lib/types';
import { useI18n } from '../i18n';
import {
  ArrowLeft, ShoppingCart, Package, UserPlus, CalendarCheck,
  Search, Clock, ChevronDown, ChevronUp,
} from 'lucide-react';
import { uiLocale } from '../i18n/locale';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30';

interface LogEntry {
  id: string;
  type: 'sale' | 'product' | 'customer' | 'reservation';
  title: string;
  description: string;
  timestamp: string;
  amount?: number;
  status?: string;
  icon: ReactNode;
  iconColor: string;
}

function timeAgo(dateStr: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return t('profile.justNow');
  if (mins < 60) return t('logs.minsAgo', { count: mins });
  if (mins < 1440) return t('logs.hoursAgo', { count: Math.floor(mins / 60) });
  const days = Math.floor(mins / 1440);
  if (days === 1) return t('logs.yesterday');
  if (days < 7) return t('logs.daysAgo', { count: days });
  return new Date(dateStr).toLocaleDateString(uiLocale(), { month: 'short', day: 'numeric' });
}

function statusTone(status: string): string {
  if (status === 'completed' || status === 'active' || status === 'cash') return 'bg-accent-green/10 text-accent-green';
  if (status === 'cancelled') return 'bg-accent-red/10 text-accent-red';
  return 'bg-surface text-text-secondary';
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
        title: t('logs.saleTitle', { id: 90000 + sale.sale.id }),
        description: itemNames,
        timestamp: sale.sale.created_at,
        amount: sale.sale.total_amount,
        status: sale.sale.payment_method,
        icon: <ShoppingCart size={16} />,
        iconColor: 'bg-accent-blue/10 text-accent-blue',
      });
    });
    (products ?? []).forEach(p => {
      entries.push({
        id: `product-${p.id}`,
        type: 'product',
        title: t('logs.productTitle', { name: p.name }),
        description: t('logs.productDesc', { count: p.quantity, category: p.category_name ?? t('checkout.uncategorized'), sku: p.sku ?? t('logs.notAvailable') }),
        timestamp: p.created_at,
        amount: p.selling_price,
        icon: <Package size={16} />,
        iconColor: 'bg-accent-green/10 text-accent-green',
      });
    });
    (customers ?? []).forEach(c => {
      entries.push({
        id: `customer-${c.id}`,
        type: 'customer',
        title: t('logs.customerTitle', { name: c.name }),
        description: t('logs.customerDesc', { phone: c.phone ?? t('logs.noPhone'), count: c.order_count, amount: c.total_spent.toFixed(2) }),
        timestamp: c.created_at,
        icon: <UserPlus size={16} />,
        iconColor: 'bg-accent-purple/10 text-accent-purple',
      });
    });
    (reservations ?? []).forEach(r => {
      entries.push({
        id: `reservation-${r.id}`,
        type: 'reservation',
        title: t('logs.reservationTitle', { name: r.product_name }),
        description: t('logs.reservationDesc', { customer: r.customer_name, qty: r.quantity, amount: r.deposit_amount.toFixed(2) }),
        timestamp: r.created_at,
        amount: r.total_price,
        status: r.status,
        icon: <CalendarCheck size={16} />,
        iconColor: 'bg-accent-orange/10 text-accent-orange',
      });
    });
    entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return entries;
  }, [sales, products, customers, reservations, t]);

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

  // Display-only labels; the raw type/status values still drive filtering and tone.
  const typeLabels: Record<LogEntry['type'], string> = {
    sale: t('logs.typeSale'),
    product: t('logs.typeProduct'),
    customer: t('logs.typeCustomer'),
    reservation: t('logs.typeReservation'),
  };
  const statusLabels: Record<string, string> = {
    cash: t('checkout.cash'),
    card: t('checkout.card'),
    transfer: t('checkout.transfer'),
    active: t('reservations.active'),
    completed: t('reservations.completed'),
    cancelled: t('reservations.cancelled'),
  };
  const statusLabel = (status: string) => statusLabels[status.toLowerCase()] ?? status;

  const typeOptions = [
    { value: 'all', label: t('logs.allTypes') },
    { value: 'sale', label: t('logs.sales') },
    { value: 'product', label: t('logs.products') },
    { value: 'customer', label: t('logs.customers') },
    { value: 'reservation', label: t('logs.reservations') },
  ];

  return (
    <div className="p-8 animate-fade-up">
      {/* Header */}
      <div className="flex items-center gap-4 mb-7">
        <button type="button" onClick={onBack} aria-label={t('common.back')}
          className={`p-2 rounded-lg text-text-secondary hover:bg-surface hover:text-text-primary transition-colors ${FOCUS}`}>
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <span className="eyebrow-accent mb-3 flex w-fit">{t('sidebar.groupSell')}</span>
          <h2 className="page-title">{t('logs.title')}</h2>
          <p className="page-subtitle">{t('logs.subtitle')}</p>
        </div>
        <span className="text-[13px] text-text-muted tabular-nums whitespace-nowrap">
          {filtered.length} {t('logs.entries')}
        </span>
      </div>

      {/* Toolbar */}
      <div className="card p-3 mb-5 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={t('logs.searchPlaceholder')}
            placeholder={t('logs.searchPlaceholder')}
            className="form-input pl-10 py-2 text-[13px]"
          />
        </div>
        <Segmented
          label={t('logs.type')}
          options={typeOptions}
          value={typeFilter}
          onChange={setTypeFilter}
        />
      </div>

      {/* Entries */}
      {filtered.length > 0 ? (
        <div className="card overflow-hidden divide-y divide-border-light">
          {filtered.map(log => {
            const isOpen = expandedId === log.id;
            return (
              <div key={log.id}>
                <button
                  type="button"
                  onClick={() => setExpandedId(isOpen ? null : log.id)}
                  aria-expanded={isOpen}
                  className={`w-full flex items-center gap-4 px-5 py-3.5 text-left hover:bg-surface transition-colors ${FOCUS}`}
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${log.iconColor}`}>
                    {log.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-text-primary truncate">{log.title}</p>
                    <p className="text-[13px] text-text-secondary mt-0.5 truncate">{log.description}</p>
                  </div>
                  {log.amount !== undefined && (
                    <span className="text-[13px] font-semibold text-text-primary tabular-nums whitespace-nowrap flex-shrink-0">
                      {log.amount.toFixed(2)}&lrm; DA
                    </span>
                  )}
                  {log.status && (
                    <span className={`badge capitalize flex-shrink-0 ${statusTone(log.status)}`}>
                      {statusLabel(log.status)}
                    </span>
                  )}
                  <span className="text-[13px] text-text-muted whitespace-nowrap flex-shrink-0 w-20 text-right">{timeAgo(log.timestamp, t)}</span>
                  {isOpen
                    ? <ChevronUp size={14} className="text-text-muted flex-shrink-0" />
                    : <ChevronDown size={14} className="text-text-muted flex-shrink-0" />}
                </button>
                {isOpen && (
                  <div className="px-5 pb-4">
                    <div className="grid grid-cols-3 gap-4 p-4 rounded-xl bg-surface text-[13px]">
                      <div>
                        <p className="text-[13px] font-medium text-text-muted mb-1">{t('logs.type')}</p>
                        <p className="text-text-primary capitalize">{typeLabels[log.type]}</p>
                      </div>
                      <div>
                        <p className="text-[13px] font-medium text-text-muted mb-1">{t('common.date')}</p>
                        <p className="text-text-primary">{new Date(log.timestamp).toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-[13px] font-medium text-text-muted mb-1">{t('logs.details')}</p>
                        <p className="text-text-primary break-words">{log.description}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
          <span className="w-11 h-11 rounded-full bg-surface text-text-muted flex items-center justify-center">
            <Clock size={20} />
          </span>
          <p className="text-[14px] font-medium text-text-primary">{t('logs.noLogs')}</p>
          <p className="text-[13px] text-text-secondary">{t('logs.tryAdjusting')}</p>
        </div>
      )}
    </div>
  );
}

function Segmented({ label, options, value, onChange }: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div role="group" aria-label={label}
      className="inline-flex max-w-full gap-1 p-1 rounded-xl bg-surface border border-border-light overflow-x-auto">
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 rounded-lg text-[13px] font-medium whitespace-nowrap transition-colors ${FOCUS} ${
              active ? 'bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

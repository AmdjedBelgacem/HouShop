import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { useI18n } from '../i18n';
import type {
  ReservationWithDetails, ReservationStats, Product, ProductVariant,
  CustomerWithStats, CreateReservation, Category,
} from '../lib/types';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  Search, Plus, CalendarCheck, CheckCircle, XCircle, Banknote,
  Clock, X, Package, Layers, ArrowLeft,
} from 'lucide-react';
import { uiLocale } from '../i18n/locale';

const ITEMS_PER_PAGE = 10;
const FOCUS = 'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30';

const fmt = (n: number) => `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\u200E DA`;

function getCoverImage(imagePath: string | null): string | null {
  if (!imagePath) return null;
  try {
    const parsed = JSON.parse(imagePath);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed[0];
  } catch {
    // Not JSON — the raw value is already a single image path.
  }
  return imagePath;
}

export default function Reservations() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    { kind: 'complete' | 'cancel'; reservation: ReservationWithDetails } | null
  >(null);
  const { data: reservations } = useQuery({
    queryKey: ['reservations'],
    queryFn: () => invoke<ReservationWithDetails[]>('get_reservations'),
  });
  const { data: stats } = useQuery({
    queryKey: ['reservation-stats'],
    queryFn: () => invoke<ReservationStats>('get_reservation_stats'),
  });
  const completeMutation = useMutation({
    mutationFn: (id: number) => invoke('complete_reservation', { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      queryClient.invalidateQueries({ queryKey: ['reservation-stats'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      setConfirmAction(null);
      toast.success(t('toast.reservationCompleted'));
    },
    onError: () => toast.error(t('toast.error')),
  });
  const cancelMutation = useMutation({
    mutationFn: (id: number) => invoke('cancel_reservation', { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      queryClient.invalidateQueries({ queryKey: ['reservation-stats'] });
      setConfirmAction(null);
      toast.success(t('toast.reservationCancelled'));
    },
    onError: () => toast.error(t('toast.error')),
  });
  const filtered = (reservations ?? []).filter(r => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (search && !r.customer_name.toLowerCase().includes(search.toLowerCase()) &&
        !r.product_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  if (showForm) {
    return <ReservationBuilder onClose={() => setShowForm(false)} />;
  }

  const statusOptions = [
    { value: 'all', label: t('reservations.allStatus') },
    { value: 'active', label: t('reservations.active') },
    { value: 'completed', label: t('reservations.completed') },
    { value: 'cancelled', label: t('reservations.cancelled') },
  ];

  return (
    <div className="p-8">
      <div className="animate-fade-up">
        <div className="flex items-start justify-between gap-4 mb-7">
          <div>
            <span className="eyebrow-accent mb-3 flex w-fit">{t('sidebar.groupSell')}</span>
            <h2 className="page-title">{t('reservations.title')}</h2>
            <p className="page-subtitle">{t('reservations.subtitle')}</p>
          </div>
          <button type="button" onClick={() => setShowForm(true)} className="btn-primary shrink-0">
            <Plus size={15} /> {t('reservations.newReservation')}
          </button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <KPICard label={t('reservations.activeReservations')} value={stats?.active_count ?? 0} icon={<CalendarCheck size={18} />} color="blue" />
          <KPICard label={t('reservations.totalDeposits')} value={fmt(stats?.total_deposits ?? 0)} icon={<Banknote size={18} />} color="green" />
          <KPICard label={t('reservations.pendingCompletion')} value={stats?.pending_completion ?? 0} icon={<Clock size={18} />} color="amber" />
          <KPICard label={t('reservations.cancelledCount')} value={stats?.cancelled_count ?? 0} icon={<XCircle size={18} />} color="red" />
        </div>

        {/* Toolbar */}
        <div className="card p-3 mb-4 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              aria-label={t('reservations.searchPlaceholder')}
              placeholder={t('reservations.searchPlaceholder')}
              className="form-input pl-10 py-2 text-[13px]"
            />
          </div>
          <Segmented
            label={t('reservations.status')}
            options={statusOptions}
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); setPage(1); }}
          />
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border-light bg-surface/60">
                  <th className="text-left py-3 px-5 text-[13px] font-medium text-text-muted whitespace-nowrap">{t('reservations.customer')}</th>
                  <th className="text-left py-3 px-5 text-[13px] font-medium text-text-muted whitespace-nowrap">{t('reservations.product')}</th>
                  <th className="text-center py-3 px-5 text-[13px] font-medium text-text-muted whitespace-nowrap">{t('reservations.qty')}</th>
                  <th className="text-right py-3 px-5 text-[13px] font-medium text-text-muted whitespace-nowrap">{t('reservations.deposit')}</th>
                  <th className="text-right py-3 px-5 text-[13px] font-medium text-text-muted whitespace-nowrap">{t('reservations.remaining')}</th>
                  <th className="text-center py-3 px-5 text-[13px] font-medium text-text-muted whitespace-nowrap">{t('reservations.status')}</th>
                  <th className="text-left py-3 px-5 text-[13px] font-medium text-text-muted whitespace-nowrap">{t('common.date')}</th>
                  <th className="text-center py-3 px-5 text-[13px] font-medium text-text-muted whitespace-nowrap">{t('reservations.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {paginated.length === 0 ? (
                  <tr><td colSpan={8} className="py-10">
                    <EmptyState
                      icon={<CalendarCheck size={20} />}
                      message={t('reservations.noReservations')}
                      action={
                        <button type="button" onClick={() => setShowForm(true)} className={`btn-secondary px-3.5 py-1.5 text-[13px] rounded-lg ${FOCUS}`}>
                          <Plus size={14} /> {t('reservations.newReservation')}
                        </button>
                      }
                    />
                  </td></tr>
                ) : (
                  paginated.map(r => (
                    <tr key={r.id} className="border-b border-border-light last:border-0 hover:bg-surface transition-colors">
                      <td className="py-3 px-5 font-medium text-text-primary">{r.customer_name}</td>
                      <td className="py-3 px-5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-text-primary">{r.product_name}</span>
                          {r.variant_name && (
                            <span className="badge bg-accent-blue/10 text-accent-blue text-[13px] px-2 py-0.5">{r.variant_name}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-5 text-center text-text-secondary tabular-nums">{r.quantity}</td>
                      <td className="py-3 px-5 text-right text-text-primary tabular-nums">{fmt(r.deposit_amount)}</td>
                      <td className="py-3 px-5 text-right font-semibold text-accent-red tabular-nums">{fmt(r.remaining_amount)}</td>
                      <td className="py-3 px-5 text-center">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="py-3 px-5 text-text-muted text-[13px] whitespace-nowrap">
                        {new Date(r.created_at).toLocaleDateString(uiLocale(), { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      <td className="py-3 px-5">
                        <div className="flex items-center justify-center gap-1">
                          {r.status === 'active' && (
                            <>
                              <button type="button" onClick={() => setConfirmAction({ kind: 'complete', reservation: r })}
                                aria-label={t('reservations.complete')} title={t('reservations.complete')}
                                className={`w-8 h-8 inline-flex items-center justify-center rounded-lg text-accent-green hover:bg-accent-green/10 transition-colors ${FOCUS}`}>
                                <CheckCircle size={16} />
                              </button>
                              <button type="button" onClick={() => setConfirmAction({ kind: 'cancel', reservation: r })}
                                aria-label={t('reservations.cancel')} title={t('reservations.cancel')}
                                className={`w-8 h-8 inline-flex items-center justify-center rounded-lg text-accent-red hover:bg-accent-red/10 transition-colors ${FOCUS}`}>
                                <XCircle size={16} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-4 px-5 py-3 border-t border-border-light">
              <span className="text-[13px] text-text-muted tabular-nums">
                {t('reservations.showing', { start: (page - 1) * ITEMS_PER_PAGE + 1, end: Math.min(page * ITEMS_PER_PAGE, filtered.length), total: filtered.length })}
              </span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className={`btn-secondary px-3 py-1.5 text-[13px] rounded-lg ${FOCUS}`}>{t('reservations.prev')}</button>
                <span className="px-1 text-[13px] font-medium text-text-primary tabular-nums">{page} / {totalPages}</span>
                <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className={`btn-secondary px-3 py-1.5 text-[13px] rounded-lg ${FOCUS}`}>{t('reservations.next')}</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Rendered outside the animated wrapper so the fixed overlay covers the viewport. */}
      <ConfirmDialog
        open={!!confirmAction}
        variant={confirmAction?.kind === 'cancel' ? 'danger' : 'default'}
        title={confirmAction?.kind === 'cancel' ? t('reservations.cancel') : t('reservations.complete')}
        description={
          confirmAction?.kind === 'cancel'
            ? t('reservations.cancelConfirm')
            : t('reservations.completeConfirm')
        }
        confirmLabel={confirmAction?.kind === 'cancel' ? t('reservations.cancel') : t('reservations.complete')}
        loading={completeMutation.isPending || cancelMutation.isPending}
        onConfirm={() => {
          if (!confirmAction) return;
          if (confirmAction.kind === 'cancel') cancelMutation.mutate(confirmAction.reservation.id);
          else completeMutation.mutate(confirmAction.reservation.id);
        }}
        onCancel={() => setConfirmAction(null)}
      />
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

function EmptyState({ icon, message, action }: { icon: ReactNode; message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 text-center">
      <span className="w-11 h-11 rounded-full bg-surface text-text-muted flex items-center justify-center">{icon}</span>
      <p className="text-[13px] text-text-secondary">{message}</p>
      {action}
    </div>
  );
}

function KPICard({ label, value, icon, color }: { label: string; value: string | number; icon: ReactNode; color: string }) {
  const tone = color === 'blue' ? 'bg-accent-blue/10 text-accent-blue' :
               color === 'green' ? 'bg-accent-green/10 text-accent-green' :
               color === 'amber' ? 'bg-accent-orange/10 text-accent-orange' :
               'bg-accent-red/10 text-accent-red';
  return (
    <div className="card p-5">
      <div className="flex items-center gap-3.5">
        <div className={`w-10 h-10 rounded-xl ${tone} flex items-center justify-center flex-shrink-0`}>{icon}</div>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-text-secondary truncate">{label}</p>
          <p className="text-[22px] font-semibold tracking-[-0.02em] text-text-primary tabular-nums leading-tight mt-0.5">{value}</p>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === 'active' ? 'bg-accent-blue/10 text-accent-blue' :
               status === 'completed' ? 'bg-accent-green/10 text-accent-green' :
               'bg-accent-red/10 text-accent-red';
  return <span className={`badge capitalize ${tone}`}>{status}</span>;
}

function ReservationBuilder({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [totalPrice, setTotalPrice] = useState('');
  const [deposit, setDeposit] = useState('');
  const [notes, setNotes] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const { data: customers } = useQuery({
    queryKey: ['customers-with-stats'],
    queryFn: () => invoke<CustomerWithStats[]>('get_customers_with_stats'),
  });
  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: () => invoke<Product[]>('get_products'),
  });
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => invoke<Category[]>('get_categories'),
  });
  const { data: variants } = useQuery({
    queryKey: ['product-variants', selectedProduct?.id],
    queryFn: () => invoke<ProductVariant[]>('get_product_variants', { productId: selectedProduct!.id }),
    enabled: !!selectedProduct,
  });
  const createMutation = useMutation({
    mutationFn: (data: CreateReservation) => invoke('create_reservation', { data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      queryClient.invalidateQueries({ queryKey: ['reservation-stats'] });
      onClose();
      toast.success(t('toast.reservationCreated'));
    },
    onError: () => toast.error(t('toast.error')),
  });
  // Auto-select the only variant when a product has exactly one, so the
  // merchant doesn't have to click a single option. (Variants are mandatory,
  // so a product always has at least one.) Inlined here rather than calling
  // selectVariant (defined below) to avoid a temporal-dead-zone reference.
  // Done during render rather than in an effect; the condition is false once the variant is set, so it settles in one pass.
  if (selectedProduct && variants && variants.length === 1 && !selectedVariant && variants[0]) {
    setSelectedVariant(variants[0]);
    setTotalPrice(variants[0].selling_price.toString());
  }
  const filteredCustomers = (customers ?? []).filter(c =>
    c.name.toLowerCase().includes(customerSearch.toLowerCase())
  ).slice(0, 8);
  const filteredProducts = (products ?? []).filter(p => {
    if (activeCategory !== 'all' && (p.category_name ?? '') !== activeCategory) return false;
    if (productSearch && !p.name.toLowerCase().includes(productSearch.toLowerCase())) return false;
    return true;
  });
  const remaining = (parseFloat(totalPrice) || 0) - (parseFloat(deposit) || 0);
  const availableStock = selectedVariant ? selectedVariant.quantity : selectedProduct?.quantity ?? 0;
  const coverImg = selectedProduct ? getCoverImage(selectedProduct.image_path) : null;
  const selectProduct = (p: Product) => {
    setSelectedProduct(p);
    setSelectedVariant(null);
    setTotalPrice(p.selling_price.toString());
    setQuantity(1);
  };
  const selectVariant = (v: ProductVariant | null) => {
    setSelectedVariant(v);
    const price = v ? v.selling_price : selectedProduct?.selling_price ?? 0;
    setTotalPrice(price.toString());
  };
  const handleSubmit = () => {
    // A variant is required — reservations are against sellable units.
    if (!customerId || !selectedProduct || !selectedVariant) return;
    createMutation.mutate({
      customer_id: customerId,
      product_id: selectedProduct.id,
      variant_id: selectedVariant.id,
      quantity,
      deposit_amount: parseFloat(deposit) || 0,
      total_price: parseFloat(totalPrice) || 0,
      notes: notes || null,
    });
  };

  const categoryOptions = [
    { value: 'all', label: t('reservations.allCategory') },
    ...(categories ?? []).map(c => ({ value: c.name, label: c.name })),
  ];

  return (
    <div className="flex h-screen overflow-hidden animate-fade-up">
      {/* Product catalogue */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="flex items-center gap-4 mb-6">
          <button type="button" onClick={onClose} aria-label={t('common.back')}
            className={`p-2 rounded-lg text-text-secondary hover:bg-surface hover:text-text-primary transition-colors ${FOCUS}`}>
            <ArrowLeft size={18} />
          </button>
          <div>
            <h2 className="page-title">{t('reservations.newReservationTitle')}</h2>
            <p className="page-subtitle">{t('reservations.selectProductDesc')}</p>
          </div>
        </div>

        <div className="mb-4 max-w-full">
          <Segmented
            label={t('common.allCategories')}
            options={categoryOptions}
            value={activeCategory}
            onChange={setActiveCategory}
          />
        </div>

        <div className="relative mb-5">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input value={productSearch} onChange={e => setProductSearch(e.target.value)}
            aria-label={t('reservations.searchProducts')}
            placeholder={t('reservations.searchProducts')}
            className="form-input pl-10 py-2 text-[13px]" />
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredProducts.length === 0 ? (
            <div className="col-span-full py-12">
              <EmptyState icon={<Package size={20} />} message={t('reservations.noProductsFound')} />
            </div>
          ) : (
            filteredProducts.map(p => {
              const img = getCoverImage(p.image_path);
              const isSelected = selectedProduct?.id === p.id;
              const soldOut = p.quantity <= 0;
              return (
                <button key={p.id} type="button" onClick={() => !soldOut && selectProduct(p)} disabled={soldOut}
                  aria-pressed={isSelected}
                  className={`card overflow-hidden text-left transition-[box-shadow,opacity] duration-150 enabled:hover:shadow-md disabled:cursor-not-allowed ${FOCUS} ${
                    isSelected ? 'ring-2 ring-navy border-navy' : ''
                  } ${soldOut ? 'opacity-50' : ''}`}>
                  <span className="relative block h-28 bg-surface">
                    <span className="absolute inset-0 flex items-center justify-center">
                      {img ? (
                        <img src={convertFileSrc(img)} alt={p.name} className="w-full h-full object-cover" />
                      ) : (
                        <Package size={24} className="text-text-muted" />
                      )}
                    </span>
                    {soldOut && (
                      <span className="badge absolute top-2.5 right-2.5 bg-accent-red text-white text-[13px] font-semibold px-2 py-0.5">
                        {t('checkout.soldOut')}
                      </span>
                    )}
                    {!soldOut && p.quantity <= 5 && (
                      <span className="badge absolute top-2.5 right-2.5 bg-accent-orange text-white text-[13px] font-semibold px-2 py-0.5">
                        {t('reservations.lowStock')}
                      </span>
                    )}
                  </span>
                  <span className="block p-3">
                    <span className="block text-[13px] font-medium text-text-muted truncate">{p.category_name ?? t('checkout.uncategorized')}</span>
                    <span className="block text-[13px] font-semibold text-text-primary mt-0.5 truncate">{p.name}</span>
                    <span className="flex items-center justify-between gap-2 mt-1.5">
                      <span className="text-[13px] font-semibold text-text-primary tabular-nums">{fmt(p.selling_price)}</span>
                      <span className="text-[13px] text-text-muted tabular-nums">{t('reservations.unitsCount', { count: p.quantity })}</span>
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Reservation details */}
      <div className="w-[380px] min-w-[380px] bg-card border-l border-border flex flex-col h-full">
        <div className="px-5 py-4 border-b border-border-light">
          <h3 className="text-[15px] font-semibold text-text-primary">{t('reservations.reservationDetails')}</h3>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {!selectedProduct ? (
            <EmptyState icon={<Package size={20} />} message={t('reservations.selectProductPrompt')} />
          ) : (
            <>
              {/* Selected product */}
              <div className="p-3 rounded-xl border border-border bg-surface flex gap-3">
                <div className="w-14 h-14 rounded-lg bg-card flex items-center justify-center flex-shrink-0 overflow-hidden border border-border-light">
                  {coverImg ? <img src={convertFileSrc(coverImg)} alt="" className="w-full h-full object-cover" /> : <Package size={18} className="text-text-muted" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-text-primary truncate">{selectedProduct.name}</p>
                  <p className="text-[13px] text-text-muted truncate">{selectedProduct.category_name ?? t('checkout.uncategorized')}</p>
                  <p className="text-[13px] font-semibold text-navy mt-0.5 tabular-nums">{fmt(selectedProduct.selling_price)}</p>
                </div>
                <button type="button" onClick={() => { setSelectedProduct(null); setSelectedVariant(null); }}
                  aria-label={t('common.remove')}
                  className={`p-1 rounded-md text-text-muted hover:text-accent-red hover:bg-accent-red/10 self-start transition-colors ${FOCUS}`}>
                  <X size={14} />
                </button>
              </div>

              {/* Variants are the only sellable unit, so the picker lists them
                  exclusively — there is no "base product" option to reserve. */}
              {variants && variants.length > 0 && (
                <div>
                  <p className="text-[13px] font-medium text-text-secondary mb-2">{t('reservations.selectVariantLabel')}</p>
                  <div className="space-y-2">
                    {variants.map(v => {
                      const vImg = getCoverImage(v.image_path ?? null);
                      const selected = selectedVariant?.id === v.id;
                      return (
                        <button key={v.id} type="button" onClick={() => selectVariant(v)} aria-pressed={selected}
                          className={`w-full flex items-center gap-3 p-2.5 rounded-xl border text-[13px] transition-colors text-left ${FOCUS} ${
                            selected ? 'border-navy bg-navy/5' : 'border-border text-text-secondary hover:bg-surface'
                          }`}>
                          <span className="w-9 h-9 rounded-lg bg-surface flex items-center justify-center flex-shrink-0 overflow-hidden">
                            {vImg ? <img src={convertFileSrc(vImg)} alt="" className="w-full h-full object-cover" /> : <Layers size={14} className="text-accent-blue" />}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block font-semibold text-text-primary truncate">{v.variant_name}</span>
                            <span className="block text-[13px] text-text-muted">{t('reservations.availableCount', { count: v.quantity })}</span>
                          </span>
                          <span className="font-semibold text-text-primary tabular-nums">{fmt(v.selling_price)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-surface text-[13px]">
                <Package size={14} className="text-text-muted" />
                <span className="text-text-secondary">{t('reservations.availableStock')}</span>
                <span className="font-semibold text-text-primary tabular-nums">{availableStock} {t('reservations.unitsLabel')}</span>
              </div>

              {/* Customer */}
              <div>
                <label htmlFor="reservation-customer" className="block text-[13px] font-medium text-text-secondary mb-1.5">{t('reservations.customerLabel')}</label>
                {customerId ? (
                  <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-surface border border-border">
                    <span className="text-[13px] font-medium text-text-primary">{customers?.find(c => c.id === customerId)?.name}</span>
                    <button type="button" onClick={() => setCustomerId(null)} aria-label={t('common.remove')}
                      className={`p-1 rounded-md text-text-muted hover:text-accent-red hover:bg-accent-red/10 transition-colors ${FOCUS}`}>
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input id="reservation-customer" value={customerSearch} onChange={e => setCustomerSearch(e.target.value)}
                      placeholder={t('reservations.searchCustomer')} className="form-input py-2 text-[13px]" />
                    {customerSearch && (
                      <div className="absolute top-full mt-1.5 left-0 right-0 bg-card rounded-xl border border-border shadow-raised z-20 max-h-48 overflow-y-auto p-1">
                        {filteredCustomers.map(c => (
                          <button key={c.id} type="button" onClick={() => { setCustomerId(c.id); setCustomerSearch(''); }}
                            className="w-full text-left px-3 py-2 rounded-lg text-[13px] hover:bg-surface transition-colors text-text-primary">
                            <span className="font-medium">{c.name}</span>
                            {c.phone && <span className="text-text-muted ml-2 text-[13px]">{c.phone}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Qty / total / deposit */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="reservation-qty" className="block text-[13px] font-medium text-text-secondary mb-1.5">{t('reservations.qtyLabel')}</label>
                  <input id="reservation-qty" type="number" min={1} max={availableStock} value={quantity} onChange={e => setQuantity(parseInt(e.target.value) || 1)}
                    className="form-input py-2 text-[13px] tabular-nums" />
                </div>
                <div>
                  <label htmlFor="reservation-total" className="block text-[13px] font-medium text-text-secondary mb-1.5">{t('reservations.totalLabel')}</label>
                  <input id="reservation-total" type="number" step="0.01" value={totalPrice} onChange={e => setTotalPrice(e.target.value)}
                    placeholder="0.00" className="form-input py-2 text-[13px] tabular-nums" />
                </div>
                <div>
                  <label htmlFor="reservation-deposit" className="block text-[13px] font-medium text-text-secondary mb-1.5">{t('reservations.depositLabel')}</label>
                  <input id="reservation-deposit" type="number" step="0.01" value={deposit} onChange={e => setDeposit(e.target.value)}
                    placeholder="0.00" className="form-input py-2 text-[13px] tabular-nums" />
                </div>
              </div>

              {/* Remaining */}
              <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-surface">
                <span className="text-[13px] text-text-secondary">{t('reservations.remainingToPay')}</span>
                <span className="text-[16px] font-semibold text-accent-red tabular-nums">{fmt(Math.max(0, remaining))}</span>
              </div>

              {/* Notes */}
              <div>
                <label htmlFor="reservation-notes" className="block text-[13px] font-medium text-text-secondary mb-1.5">{t('reservations.notesLabel')}</label>
                <textarea id="reservation-notes" value={notes} onChange={e => setNotes(e.target.value)}
                  rows={2} className="form-input py-2 text-[13px] resize-none" placeholder={t('reservations.optionalNotes')} />
              </div>
            </>
          )}
        </div>

        {selectedProduct && (
          <div className="border-t border-border-light px-5 py-4 space-y-3">
            <button type="button" onClick={handleSubmit} disabled={!customerId || !selectedVariant || createMutation.isPending}
              className="btn-primary w-full py-3 text-[14px]">
              {createMutation.isPending ? t('reservations.creating') : t('reservations.createAmount', { amount: fmt(parseFloat(totalPrice) || 0) })}
            </button>
            {createMutation.isError && (
              <p className="text-[13px] text-accent-red">{String(createMutation.error)}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

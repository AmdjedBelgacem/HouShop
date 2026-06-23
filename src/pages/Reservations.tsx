import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { useI18n } from '../i18n';
import type {
  ReservationWithDetails, ReservationStats, Product, ProductVariant,
  CustomerWithStats, CreateReservation, Category,
} from '../lib/types';
import CustomSelect from '../components/CustomSelect';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  Search, Plus, CalendarCheck, CheckCircle, XCircle, Banknote,
  Clock, Filter, X, ChevronDown, Package, Layers, ArrowLeft,
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
  return (
    <div className="p-8">
      <div className="mb-7">
        <h2 className="text-[26px] font-bold text-text-primary leading-tight">{t('reservations.title')}</h2>
        <p className="text-[14px] text-text-secondary mt-1">{t('reservations.subtitle')}</p>
      </div>
      {}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <KPICard label={t('reservations.activeReservations')} value={stats?.active_count ?? 0} icon={<CalendarCheck size={18} />} color="blue" />
        <KPICard label={t('reservations.totalDeposits')} value={fmt(stats?.total_deposits ?? 0)} icon={<Banknote size={18} />} color="green" />
        <KPICard label={t('reservations.pendingCompletion')} value={stats?.pending_completion ?? 0} icon={<Clock size={18} />} color="amber" />
        <KPICard label={t('reservations.cancelledCount')} value={stats?.cancelled_count ?? 0} icon={<XCircle size={18} />} color="red" />
      </div>
      {}
      <div className="card p-4 mb-4 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder={t('reservations.searchPlaceholder')}
            className="form-input !pl-9 !py-2 !text-[13px]" />
        </div>
        <CustomSelect
          value={statusFilter}
          onChange={(v) => { setStatusFilter(v); setPage(1); }}
          options={[
            { value: 'all', label: t('reservations.allStatus') },
            { value: 'active', label: t('reservations.active') },
            { value: 'completed', label: t('reservations.completed') },
            { value: 'cancelled', label: t('reservations.cancelled') },
          ]}
          icon={<Filter size={14} />}
          size="sm"
          className="w-[150px]"
        />
        <button onClick={() => setShowForm(true)}
          className="ml-auto px-5 py-2 rounded-lg bg-navy text-white text-[13px] font-medium hover:bg-navy-light transition-colors flex items-center gap-2">
          <Plus size={15} /> {t('reservations.newReservation')}
        </button>
      </div>
      {}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface/50">
                <th className="text-left py-3 px-5 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('reservations.customer')}</th>
                <th className="text-left py-3 px-5 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('reservations.product')}</th>
                <th className="text-center py-3 px-5 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('reservations.qty')}</th>
                <th className="text-right py-3 px-5 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('reservations.deposit')}</th>
                <th className="text-right py-3 px-5 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('reservations.remaining')}</th>
                <th className="text-center py-3 px-5 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('reservations.status')}</th>
                <th className="text-left py-3 px-5 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('common.date')}</th>
                <th className="text-center py-3 px-5 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('reservations.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-text-muted">{t('reservations.noReservations')}</td></tr>
              ) : (
                paginated.map(r => (
                  <tr key={r.id} className="border-b border-border-light hover:bg-surface/30 transition-colors">
                    <td className="py-3 px-5 font-medium text-text-primary">{r.customer_name}</td>
                    <td className="py-3 px-5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-text-primary">{r.product_name}</span>
                        {r.variant_name && (
                          <span className="text-[10px] font-medium text-accent-blue bg-blue-50 px-1.5 py-0.5 rounded">{r.variant_name}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-5 text-center text-text-secondary">{r.quantity}</td>
                    <td className="py-3 px-5 text-right font-semibold text-text-primary">{fmt(r.deposit_amount)}</td>
                    <td className="py-3 px-5 text-right font-semibold text-accent-red">{fmt(r.remaining_amount)}</td>
                    <td className="py-3 px-5 text-center">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="py-3 px-5 text-text-muted text-[12px]">
                      {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="py-3 px-5">
                      <div className="flex items-center justify-center gap-1">
                        {r.status === 'active' && (
                          <>
                            <button onClick={() => setConfirmAction({ kind: 'complete', reservation: r })}
                              className="p-1.5 rounded-md text-accent-green hover:bg-green-50 transition-colors" title={t('reservations.complete')}>
                              <CheckCircle size={15} />
                            </button>
                            <button onClick={() => setConfirmAction({ kind: 'cancel', reservation: r })}
                              className="p-1.5 rounded-md text-accent-red hover:bg-red-50 transition-colors" title={t('reservations.cancel')}>
                              <XCircle size={15} />
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
        {}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-border">
            <span className="text-[12px] text-text-muted">
              {t('reservations.showing', { start: (page - 1) * ITEMS_PER_PAGE + 1, end: Math.min(page * ITEMS_PER_PAGE, filtered.length), total: filtered.length })}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-2.5 py-1 rounded text-[12px] text-text-secondary hover:bg-surface disabled:opacity-30 transition-colors">{t('reservations.prev')}</button>
              <span className="px-2 text-[12px] text-text-primary font-medium">{page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-2.5 py-1 rounded text-[12px] text-text-secondary hover:bg-surface disabled:opacity-30 transition-colors">{t('reservations.next')}</button>
            </div>
          </div>
        )}
      </div>

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
function KPICard({ label, value, icon, color }: { label: string; value: string | number; icon: React.ReactNode; color: string }) {
  const bg = color === 'blue' ? 'bg-blue-50 text-accent-blue' :
             color === 'green' ? 'bg-green-50 text-accent-green' :
             color === 'amber' ? 'bg-amber-50 text-amber-600' :
             'bg-red-50 text-accent-red';
  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center`}>{icon}</div>
        <div>
          <p className="text-[10px] font-semibold text-text-muted tracking-[0.06em] uppercase">{label}</p>
          <p className="text-[20px] font-bold text-text-primary leading-tight mt-0.5">{value}</p>
        </div>
      </div>
    </div>
  );
}
function StatusBadge({ status }: { status: string }) {
  const cls = status === 'active' ? 'bg-blue-50 text-accent-blue' :
              status === 'completed' ? 'bg-green-50 text-accent-green' :
              'bg-red-50 text-accent-red';
  return <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold capitalize ${cls}`}>{status}</span>;
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
  const filteredCustomers = (customers ?? []).filter(c =>
    c.name.toLowerCase().includes(customerSearch.toLowerCase())
  ).slice(0, 8);
  const filteredProducts = (products ?? []).filter(p => {
    if (activeCategory !== 'all' && (p.category_name ?? '') !== activeCategory) return false;
    if (productSearch && !p.name.toLowerCase().includes(productSearch.toLowerCase())) return false;
    return true;
  });
  const remaining = (parseFloat(totalPrice) || 0) - (parseFloat(deposit) || 0);
  const sellingPrice = selectedVariant ? selectedVariant.selling_price : selectedProduct?.selling_price ?? 0;
  const availableStock = selectedVariant ? selectedVariant.quantity : selectedProduct?.quantity ?? 0;
  const coverImg = selectedProduct ? getCoverImage(selectedProduct.image_path) : null;
  const variantImg = selectedVariant ? getCoverImage(selectedVariant.image_path ?? null) : null;
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
    if (!customerId || !selectedProduct) return;
    createMutation.mutate({
      customer_id: customerId,
      product_id: selectedProduct.id,
      variant_id: selectedVariant?.id ?? null,
      quantity,
      deposit_amount: parseFloat(deposit) || 0,
      total_price: parseFloat(totalPrice) || 0,
      notes: notes || null,
    });
  };
  return (
    <div className="flex h-screen overflow-hidden">
      {}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="flex items-center gap-3 mb-5">
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-card border border-transparent hover:border-border transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h2 className="text-[22px] font-bold text-text-primary">{t('reservations.newReservationTitle')}</h2>
            <p className="text-[13px] text-text-secondary">{t('reservations.selectProductDesc')}</p>
          </div>
        </div>
        {}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <button onClick={() => setActiveCategory('all')}
            className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-colors ${activeCategory === 'all' ? 'bg-navy text-white' : 'bg-card border border-border text-text-secondary hover:bg-surface'}`}>
            {t('reservations.allCategory')}
          </button>
          {(categories ?? []).map(c => (
            <button key={c.id} onClick={() => setActiveCategory(c.name)}
              className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-colors ${activeCategory === c.name ? 'bg-navy text-white' : 'bg-card border border-border text-text-secondary hover:bg-surface'}`}>
              {c.name}
            </button>
          ))}
        </div>
        {}
        <div className="relative mb-4">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input value={productSearch} onChange={e => setProductSearch(e.target.value)}
            placeholder={t('reservations.searchProducts')}
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-border text-[13px] focus:outline-none focus:ring-2 focus:ring-navy/15 bg-surface" />
        </div>
        {}
        <div className="grid grid-cols-3 gap-3">
          {filteredProducts.length === 0 ? (
            <div className="col-span-3 py-12 text-center text-text-muted">
              <Package size={28} className="mx-auto mb-2 opacity-30" />
              {t('reservations.noProductsFound')}
            </div>
          ) : (
            filteredProducts.map(p => {
              const img = getCoverImage(p.image_path);
              const isSelected = selectedProduct?.id === p.id;
              const soldOut = p.quantity <= 0;
              return (
                <button key={p.id} onClick={() => !soldOut && selectProduct(p)} disabled={soldOut}
                  className={`card overflow-hidden text-left transition-all ${isSelected ? 'ring-2 ring-navy border-navy' : 'hover:shadow-md'} ${soldOut ? 'opacity-50' : ''}`}>
                  <div className="relative h-28 bg-gradient-to-br from-gray-100 to-gray-50 flex items-center justify-center">
                    {img ? (
                      <img src={convertFileSrc(img)} alt={p.name} className="w-full h-full object-cover" />
                    ) : (
                      <Package size={24} className="text-gray-300" />
                    )}
                    {soldOut && (
                      <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-accent-red/90 text-[10px] font-semibold text-white">
                        {t('checkout.soldOut')}
                      </span>
                    )}
                    {!soldOut && p.quantity <= 5 && (
                      <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-amber-500/90 text-[10px] font-semibold text-white">
                        {t('reservations.lowStock')}
                      </span>
                    )}
                  </div>
                  <div className="p-2.5">
                    <p className="text-[10px] font-semibold text-text-muted uppercase">{p.category_name ?? t('checkout.uncategorized')}</p>
                    <p className="text-[12.5px] font-bold text-text-primary mt-0.5 truncate">{p.name}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[12px] font-bold text-text-primary">{fmt(p.selling_price)}</span>
                      <span className="text-[10px] text-text-muted">{t('reservations.unitsCount', { count: p.quantity })}</span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
      {}
      <div className="w-[380px] min-w-[380px] bg-card border-l border-border flex flex-col h-full">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-[15px] font-bold text-text-primary">{t('reservations.reservationDetails')}</h3>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {}
          {!selectedProduct ? (
            <div className="flex flex-col items-center justify-center py-12 text-text-muted">
              <Package size={28} className="mb-2 opacity-30" />
              <p className="text-[13px]">{t('reservations.selectProductPrompt')}</p>
            </div>
          ) : (
            <>
              {}
              <div className="p-3 rounded-xl border border-border bg-surface">
                <div className="flex gap-3">
                  <div className="w-14 h-14 rounded-lg bg-surface flex items-center justify-center flex-shrink-0 overflow-hidden border border-border-light">
                    {coverImg ? <img src={convertFileSrc(coverImg)} alt="" className="w-full h-full object-cover" /> : <Package size={18} className="text-text-muted" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold text-text-primary truncate">{selectedProduct.name}</p>
                    <p className="text-[12px] text-text-muted">{selectedProduct.category_name ?? t('checkout.uncategorized')}</p>
                    <p className="text-[13px] font-bold text-navy mt-0.5">{fmt(selectedProduct.selling_price)}</p>
                  </div>
                  <button onClick={() => { setSelectedProduct(null); setSelectedVariant(null); }}
                    className="text-text-muted hover:text-accent-red self-start"><X size={14} /></button>
                </div>
              </div>
              {}
              {variants && variants.length > 0 && (
                <div>
                  <label className="block text-[11px] font-semibold text-text-muted tracking-[0.06em] uppercase mb-2">{t('reservations.selectVariantLabel')}</label>
                  <div className="space-y-1.5">
                    <button onClick={() => selectVariant(null)}
                      className={`w-full flex items-center gap-2.5 p-2.5 rounded-lg border text-[12.5px] transition-colors text-left ${!selectedVariant ? 'border-navy bg-navy/5 font-medium' : 'border-border text-text-secondary hover:bg-surface'}`}>
                      <div className="w-8 h-8 rounded bg-surface flex items-center justify-center flex-shrink-0">
                        <Package size={14} className="text-text-muted" />
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-text-primary">{t('reservations.baseProduct')}</p>
                        <p className="text-[10px] text-text-muted">{t('reservations.availableCount', { count: selectedProduct.quantity })}</p>
                      </div>
                      <span className="font-bold text-text-primary">{fmt(selectedProduct.selling_price)}</span>
                    </button>
                    {variants.map(v => {
                      const vImg = getCoverImage(v.image_path ?? null);
                      return (
                        <button key={v.id} onClick={() => selectVariant(v)}
                          className={`w-full flex items-center gap-2.5 p-2.5 rounded-lg border text-[12.5px] transition-colors text-left ${selectedVariant?.id === v.id ? 'border-navy bg-navy/5 font-medium' : 'border-border text-text-secondary hover:bg-surface'}`}>
                          <div className="w-8 h-8 rounded bg-surface flex items-center justify-center flex-shrink-0 overflow-hidden">
                            {vImg ? <img src={convertFileSrc(vImg)} alt="" className="w-full h-full object-cover" /> : <Layers size={14} className="text-accent-blue" />}
                          </div>
                          <div className="flex-1">
                            <p className="font-semibold text-text-primary">{v.variant_name}</p>
                            <p className="text-[10px] text-text-muted">{t('reservations.availableCount', { count: v.quantity })}</p>
                          </div>
                          <span className="font-bold text-text-primary">{fmt(v.selling_price)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {}
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface border border-border-light text-[12px]">
                <Package size={14} className="text-text-muted" />
                <span className="text-text-secondary">{t('reservations.availableStock')}</span>
                <span className="font-bold text-text-primary">{availableStock} {t('reservations.unitsLabel')}</span>
              </div>
              {}
              <div>
                <label className="block text-[11px] font-semibold text-text-muted tracking-[0.06em] uppercase mb-1.5">{t('reservations.customerLabel')}</label>
                {customerId ? (
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-surface border border-border">
                    <span className="text-[13px] font-medium text-text-primary">{customers?.find(c => c.id === customerId)?.name}</span>
                    <button onClick={() => setCustomerId(null)} className="text-text-muted hover:text-accent-red"><X size={14} /></button>
                  </div>
                ) : (
                  <div className="relative">
                    <input value={customerSearch} onChange={e => setCustomerSearch(e.target.value)}
                      placeholder={t('reservations.searchCustomer')} className="form-input !py-2 !text-[13px]" />
                    {customerSearch && (
                      <div className="absolute top-full mt-1 left-0 right-0 bg-card rounded-lg border border-border shadow-lg z-20 max-h-40 overflow-y-auto">
                        {filteredCustomers.map(c => (
                          <button key={c.id} onClick={() => { setCustomerId(c.id); setCustomerSearch(''); }}
                            className="w-full text-left px-3.5 py-2 text-[13px] hover:bg-surface transition-colors text-text-primary">
                            <span className="font-medium">{c.name}</span>
                            {c.phone && <span className="text-text-muted ml-2 text-[11px]">{c.phone}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {}
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-text-muted tracking-[0.06em] uppercase mb-1.5">{t('reservations.qtyLabel')}</label>
                  <input type="number" min={1} max={availableStock} value={quantity} onChange={e => setQuantity(parseInt(e.target.value) || 1)}
                    className="form-input !py-2 !text-[13px]" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-text-muted tracking-[0.06em] uppercase mb-1.5">{t('reservations.totalLabel')}</label>
                  <input type="number" step="0.01" value={totalPrice} onChange={e => setTotalPrice(e.target.value)}
                    placeholder="0.00" className="form-input !py-2 !text-[13px]" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-text-muted tracking-[0.06em] uppercase mb-1.5">{t('reservations.depositLabel')}</label>
                  <input type="number" step="0.01" value={deposit} onChange={e => setDeposit(e.target.value)}
                    placeholder="0.00" className="form-input !py-2 !text-[13px]" />
                </div>
              </div>
              {}
              <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-surface border border-border-light">
                <span className="text-[13px] text-text-secondary">{t('reservations.remainingToPay')}</span>
                <span className="text-[16px] font-bold text-accent-red">{fmt(Math.max(0, remaining))}</span>
              </div>
              {}
              <div>
                <label className="block text-[11px] font-semibold text-text-muted tracking-[0.06em] uppercase mb-1.5">{t('reservations.notesLabel')}</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                  rows={2} className="form-input !py-2 !text-[13px]" placeholder={t('reservations.optionalNotes')} />
              </div>
            </>
          )}
        </div>
        {}
        {selectedProduct && (
          <div className="border-t border-border px-5 py-4 space-y-3">
            <button onClick={handleSubmit} disabled={!customerId || createMutation.isPending}
              className="w-full py-3 rounded-lg bg-navy text-white text-[13.5px] font-semibold hover:bg-navy-light disabled:opacity-50 transition-colors">
              {createMutation.isPending ? t('reservations.creating') : t('reservations.createAmount', { amount: fmt(parseFloat(totalPrice) || 0) })}
            </button>
            {createMutation.isError && (
              <p className="text-[12px] text-accent-red">{String(createMutation.error)}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

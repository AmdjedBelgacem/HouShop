import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { useI18n } from '../i18n';
import type { Customer, Product, ProductVariant } from '../lib/types';
import { X, Search, User, Shield, Package, Check } from 'lucide-react';
interface CartItemData {
  product: Product;
  variant: ProductVariant | null;
  quantity: number;
  customPrice: number;
}
interface WarrantyEntry {
  product_id: number;
  product_name: string;
  variant_name: string | null;
  warranty_months: number | null;
}
interface SaleCompletionModalProps {
  cart: CartItemData[];
  paymentMethod: string;
  total: number;
  onConfirm: (customerId: number | null, warrantyNotes: string) => void;
  onCancel: () => void;
  fmt: (n: number) => string;
}
export default function SaleCompletionModal({
  cart, paymentMethod, total, onConfirm, onCancel, fmt,
}: SaleCompletionModalProps) {
  const { t } = useI18n();
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [warranties, setWarranties] = useState<Record<number, string>>({});
  const { data: customers } = useQuery({
    queryKey: ['customers'],
    queryFn: () => invoke<Customer[]>('get_customers'),
  });
  const filteredCustomers = useMemo(() => {
    if (!customerSearch || !customers) return [];
    const q = customerSearch.toLowerCase();
    return customers.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.phone && c.phone.includes(q))
    ).slice(0, 8);
  }, [customerSearch, customers]);
  const selectedCustomer = customers?.find(c => c.id === customerId);
  const itemCount = cart.reduce((s, i) => s + i.quantity, 0);
  const paymentLabel = paymentMethod === 'card'
    ? t('checkout.card')
    : paymentMethod === 'cash'
      ? t('checkout.cash')
      : paymentMethod;
  const handleConfirm = () => {
    const warrantyEntries: WarrantyEntry[] = [];
    cart.forEach((item, idx) => {
      const months = warranties[idx] ? parseInt(warranties[idx]) : null;
      if (months && months > 0) {
        warrantyEntries.push({
          product_id: item.product.id,
          product_name: item.product.name,
          variant_name: item.variant?.variant_name ?? null,
          warranty_months: months,
        });
      }
    });
    let notes = '';
    if (warrantyEntries.length > 0) {
      notes = JSON.stringify({ warranty: warrantyEntries });
    }
    onConfirm(customerId, notes);
  };
  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[100] p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sale-completion-title"
        className="bg-card rounded-2xl w-full max-w-[540px] shadow-raised overflow-hidden max-h-[85vh] flex flex-col animate-fade-up"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-border-light">
          <div className="min-w-0">
            <h3 id="sale-completion-title" className="text-[17px] font-semibold text-text-primary">{t('checkout.completeSale')}</h3>
            <p className="text-[13px] text-text-secondary mt-0.5">{t('checkout.completeSaleDesc')}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t('common.close')}
            className="p-1.5 -mr-1 -mt-0.5 rounded-lg text-text-muted hover:bg-surface hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Customer */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <User size={14} className="text-text-muted" />
              <h4 className="text-[13px] font-semibold text-text-primary">{t('checkout.linkCustomer')}</h4>
              <span className="text-[13px] text-text-muted ml-auto">{t('checkout.optional')}</span>
            </div>
            {selectedCustomer ? (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-surface">
                <div className="w-9 h-9 rounded-full bg-navy flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-[13px] font-semibold">{selectedCustomer.name.charAt(0)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-text-primary truncate">{selectedCustomer.name}</p>
                  {selectedCustomer.phone && <p className="text-[13px] text-text-muted tabular-nums">{selectedCustomer.phone}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => setCustomerId(null)}
                  aria-label={t('common.remove')}
                  className="p-1.5 rounded-lg text-text-muted hover:bg-card hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                <input
                  value={customerSearch}
                  aria-label={t('checkout.searchCustomer')}
                  onChange={e => { setCustomerSearch(e.target.value); setShowCustomerDropdown(true); }}
                  onFocus={() => setShowCustomerDropdown(true)}
                  placeholder={t('checkout.searchCustomer')}
                  className="w-full pl-9 pr-3.5 py-2.5 rounded-xl border border-border bg-surface text-[13px] text-text-primary placeholder:text-text-muted transition-[border-color,box-shadow] duration-150 focus:outline-none focus:ring-[3px] focus:ring-navy/20 focus:border-navy"
                />
                {showCustomerDropdown && customerSearch && filteredCustomers.length > 0 && (
                  <div className="absolute top-full mt-1.5 left-0 right-0 bg-card rounded-xl border border-border shadow-raised z-20 max-h-56 overflow-y-auto py-1 animate-fade-up">
                    {filteredCustomers.map(c => (
                      <button
                        type="button"
                        key={c.id}
                        onClick={() => { setCustomerId(c.id); setCustomerSearch(''); setShowCustomerDropdown(false); }}
                        className="w-full text-left flex items-center gap-3 px-3.5 py-2.5 hover:bg-surface transition-colors"
                      >
                        <div className="w-7 h-7 rounded-full bg-navy/10 flex items-center justify-center flex-shrink-0">
                          <span className="text-navy text-[13px] font-semibold">{c.name.charAt(0)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-text-primary truncate">{c.name}</p>
                          {c.phone && <p className="text-[13px] text-text-muted tabular-nums">{c.phone}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Warranty */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Shield size={14} className="text-text-muted" />
              <h4 className="text-[13px] font-semibold text-text-primary">{t('checkout.warrantyTitle')}</h4>
              <span className="text-[13px] text-text-muted ml-auto">{t('checkout.optional')}</span>
            </div>
            <div className="space-y-2">
              {cart.map((item, idx) => {
                const name = item.variant
                  ? `${item.product.name} (${item.variant.variant_name})`
                  : item.product.name;
                return (
                  <div key={idx} className="flex items-center gap-3 p-3 rounded-xl bg-surface">
                    <div className="w-8 h-8 rounded-lg bg-card flex items-center justify-center flex-shrink-0">
                      <Package size={14} className="text-text-muted" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-text-primary truncate">{name}</p>
                      <p className="text-[13px] text-text-muted tabular-nums">
                        {t('checkout.qtyPrice', { qty: item.quantity, price: fmt(item.customPrice * item.quantity) })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <input
                        type="number"
                        min="0"
                        max="120"
                        aria-label={`${name} — ${t('checkout.months')}`}
                        value={warranties[idx] || ''}
                        onChange={e => setWarranties(prev => ({ ...prev, [idx]: e.target.value }))}
                        placeholder="0"
                        className="w-14 text-center py-1.5 rounded-lg border border-border bg-card text-[13px] tabular-nums text-text-primary placeholder:text-text-muted transition-[border-color,box-shadow] duration-150 focus:outline-none focus:ring-[3px] focus:ring-navy/20 focus:border-navy"
                      />
                      <span className="text-[13px] text-text-muted w-12">{t('checkout.months')}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Summary */}
          <div className="p-4 rounded-xl bg-surface space-y-2.5 text-[13px] tabular-nums">
            <div className="flex justify-between">
              <span className="text-text-secondary">{t('checkout.paymentMethod')}</span>
              <span className="font-medium text-text-primary">{paymentLabel}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">{t('common.items')}</span>
              <span className="font-medium text-text-primary">{itemCount}</span>
            </div>
            <div className="flex justify-between items-baseline pt-2.5 border-t border-border">
              <span className="text-[15px] font-semibold text-text-primary">{t('checkout.totalLabel')}</span>
              <span className="text-[18px] font-semibold text-text-primary">{fmt(total)}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border-light flex items-center gap-3">
          <button type="button" onClick={onCancel} className="btn-secondary flex-1">
            {t('common.cancel')}
          </button>
          <button type="button" onClick={handleConfirm} className="btn-primary flex-[2]">
            <Check size={16} />
            {t('checkout.confirmSale', { amount: fmt(total) })}
          </button>
        </div>
      </div>
    </div>
  );
}

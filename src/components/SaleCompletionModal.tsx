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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]" onClick={onCancel}>
      <div
        className="bg-card rounded-2xl w-full max-w-[540px] shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h3 className="text-[17px] font-bold text-text-primary">{t('checkout.completeSale')}</h3>
            <p className="text-[12px] text-text-muted mt-0.5">{t('checkout.completeSaleDesc')}</p>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-surface transition-colors text-text-muted">
            <X size={18} />
          </button>
        </div>
        {}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <User size={14} className="text-text-muted" />
              <h4 className="text-[13px] font-semibold text-text-primary">{t('checkout.linkCustomer')}</h4>
              <span className="text-[10px] text-text-muted ml-auto">{t('checkout.optional')}</span>
            </div>
            {selectedCustomer ? (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-surface border border-border">
                <div className="w-8 h-8 rounded-full bg-navy flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-[12px] font-bold">{selectedCustomer.name.charAt(0)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-text-primary truncate">{selectedCustomer.name}</p>
                  {selectedCustomer.phone && <p className="text-[11px] text-text-muted">{selectedCustomer.phone}</p>}
                </div>
                <button
                  onClick={() => setCustomerId(null)}
                  className="p-1 rounded-lg hover:bg-card text-text-muted transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  value={customerSearch}
                  onChange={e => { setCustomerSearch(e.target.value); setShowCustomerDropdown(true); }}
                  onFocus={() => setShowCustomerDropdown(true)}
                  placeholder={t('checkout.searchCustomer')}
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-border bg-surface text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy/30 transition-all"
                />
                {showCustomerDropdown && customerSearch && filteredCustomers.length > 0 && (
                  <div className="absolute top-full mt-1 left-0 right-0 bg-card rounded-xl border border-border shadow-lg z-20 max-h-48 overflow-y-auto">
                    {filteredCustomers.map(c => (
                      <button
                        key={c.id}
                        onClick={() => { setCustomerId(c.id); setCustomerSearch(''); setShowCustomerDropdown(false); }}
                        className="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-surface transition-colors"
                      >
                        <div className="w-7 h-7 rounded-full bg-navy/10 flex items-center justify-center flex-shrink-0">
                          <span className="text-navy text-[11px] font-bold">{c.name.charAt(0)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12.5px] font-medium text-text-primary truncate">{c.name}</p>
                          {c.phone && <p className="text-[10.5px] text-text-muted">{c.phone}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Shield size={14} className="text-text-muted" />
              <h4 className="text-[13px] font-semibold text-text-primary">{t('checkout.warrantyTitle')}</h4>
              <span className="text-[10px] text-text-muted ml-auto">{t('checkout.optional')}</span>
            </div>
            <div className="space-y-2">
              {cart.map((item, idx) => {
                const name = item.variant
                  ? `${item.product.name} (${item.variant.variant_name})`
                  : item.product.name;
                return (
                  <div key={idx} className="flex items-center gap-3 p-3 rounded-xl bg-surface border border-border">
                    <div className="w-8 h-8 rounded-lg bg-card flex items-center justify-center flex-shrink-0">
                      <Package size={14} className="text-text-muted" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] font-medium text-text-primary truncate">{name}</p>
                      <p className="text-[10.5px] text-text-muted">
                        {t('checkout.qtyPrice', { qty: item.quantity, price: fmt(item.customPrice * item.quantity) })}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <input
                        type="number"
                        min="0"
                        max="120"
                        value={warranties[idx] || ''}
                        onChange={e => setWarranties(prev => ({ ...prev, [idx]: e.target.value }))}
                        placeholder="0"
                        className="w-12 text-center py-1.5 rounded-lg border border-border bg-card text-[12px] text-text-primary focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy/30"
                      />
                      <span className="text-[10px] text-text-muted w-12">{t('checkout.months')}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {}
          <div className="p-4 rounded-xl bg-surface border border-border space-y-2">
            <div className="flex justify-between text-[13px]">
              <span className="text-text-secondary">{t('checkout.paymentMethod')}</span>
              <span className="font-medium text-text-primary capitalize">{paymentMethod}</span>
            </div>
            <div className="flex justify-between text-[13px]">
              <span className="text-text-secondary">{t('checkout.itemsCount', { count: cart.reduce((s, i) => s + i.quantity, 0) })}</span>
              <span className="font-medium text-text-primary">{cart.reduce((s, i) => s + i.quantity, 0)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-border">
              <span className="text-[15px] font-bold text-text-primary">{t('checkout.totalLabel')}</span>
              <span className="text-[15px] font-bold text-text-primary">{fmt(total)}</span>
            </div>
          </div>
        </div>
        {}
        <div className="px-6 py-4 border-t border-border flex items-center gap-3">
          <button onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl border border-border text-[13px] font-medium text-text-secondary hover:bg-surface transition-colors">
            {t('common.cancel')}
          </button>
          <button onClick={handleConfirm}
            className="flex-[2] py-2.5 rounded-xl bg-navy text-white text-[13px] font-semibold hover:bg-navy-light transition-colors flex items-center justify-center gap-2">
            <Check size={16} />
            {t('checkout.confirmSale', { amount: fmt(total) })}
          </button>
        </div>
      </div>
    </div>
  );
}

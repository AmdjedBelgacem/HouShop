import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import type { Product, CartDisplayItem, CreateSale } from '../lib/types';
import { useI18n } from '../i18n';
import { Search, Plus, Minus, Trash2, ShoppingCart, CreditCard, Banknote, CheckCircle } from 'lucide-react';

const segmentClass = (active: boolean) =>
  `flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[13px] font-medium transition-colors ${
    active ? 'bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
  }`;

const stepperClass =
  'w-7 h-7 rounded-lg flex items-center justify-center text-text-secondary bg-card border border-border hover:bg-surface transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30';

export default function POS() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartDisplayItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [saleComplete, setSaleComplete] = useState(false);
  const { data: products } = useQuery({
    queryKey: ['products', search],
    queryFn: () => search
      ? invoke<Product[]>('search_products', { query: search })
      : invoke<Product[]>('get_products'),
    enabled: search.length > 0 || true,
  });
  const createSaleMutation = useMutation({
    mutationFn: (data: CreateSale) => invoke('create_sale', { data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      setCart([]);
      setSaleComplete(true);
      setTimeout(() => setSaleComplete(false), 3000);
    },
  });
  const addToCart = (product: Product) => {
    if (product.quantity <= 0) return;
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        if (existing.quantity >= product.quantity) return prev;
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };
  const updateQuantity = (productId: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product.id !== productId) return item;
          const newQty = item.quantity + delta;
          if (newQty <= 0) return null;
          if (newQty > item.product.quantity) return item;
          return { ...item, quantity: newQty };
        })
        .filter(Boolean) as CartDisplayItem[]
    );
  };
  const removeFromCart = (productId: number) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };
  const total = cart.reduce((sum, item) => sum + item.product.selling_price * item.quantity, 0);
  const totalCost = cart.reduce((sum, item) => sum + item.product.cost_price * item.quantity, 0);
  const profit = total - totalCost;
  const itemCount = cart.reduce((sum, i) => sum + i.quantity, 0);
  const handleCheckout = () => {
    if (cart.length === 0) return;
    createSaleMutation.mutate({
      items: cart.map((item) => ({
        product_id: item.product.id,
        quantity: item.quantity,
        unit_price: item.product.selling_price,
        unit_cost: item.product.cost_price,
      })),
      customer_id: null,
      payment_method: paymentMethod,
    });
  };
  return (
    <div className="h-full flex animate-fade-up">
      {/* Catalogue */}
      <div className="flex-1 p-6 flex flex-col overflow-hidden">
        <div className="mb-5">
          <span className="eyebrow-accent mb-3 flex w-fit">{t('sidebar.groupSell')}</span>
          <h2 className="page-title">{t('checkout.posTitle')}</h2>
          <p className="page-subtitle">{t('checkout.posSubtitle')}</p>
        </div>
        <div className="relative mb-5">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            type="text"
            placeholder={t('pos.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="form-input pl-10 pr-4 py-2.5 text-[13px]"
            autoFocus
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {products?.filter((p) => p.quantity > 0).map((product) => (
              <button
                type="button"
                key={product.id}
                onClick={() => addToCart(product)}
                className="card p-4 text-left transition-[box-shadow,transform] duration-150 hover:shadow-raised active:scale-[0.98] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30"
              >
                <p className="text-[14px] font-semibold text-text-primary truncate">{product.name}</p>
                <p className="text-[13px] text-text-secondary mt-0.5 truncate">{product.category_name ?? t('checkout.uncategorized')}</p>
                <div className="flex items-center justify-between gap-2 mt-4">
                  <span className="text-[16px] font-semibold text-text-primary tabular-nums">{product.selling_price.toFixed(2)}&lrm; DA</span>
                  <span className={`badge text-[13px] tabular-nums ${
                    product.quantity <= product.low_stock_threshold ? 'bg-accent-red/10 text-accent-red' : 'bg-surface text-text-secondary'
                  }`}>
                    {t('pos.stockLeft', { count: product.quantity })}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Cart */}
      <aside className="w-96 bg-card border-l border-border flex flex-col">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2.5">
          <ShoppingCart size={18} className="text-navy" />
          <h3 className="text-[16px] font-semibold text-text-primary">{t('checkout.cart')}</h3>
          <span className="badge ml-auto bg-navy/10 text-navy text-[13px] tabular-nums">
            {t('checkout.itemsCount', { count: itemCount })}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6 py-12 text-text-muted">
              <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center mb-3">
                <ShoppingCart size={22} />
              </div>
              <p className="text-[14px] font-medium text-text-secondary">{t('checkout.cartEmptyDesc')}</p>
            </div>
          ) : (
            <ul className="divide-y divide-border-light">
              {cart.map((item) => (
                <li key={item.product.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-medium text-text-primary truncate">{item.product.name}</p>
                    <button
                      type="button"
                      onClick={() => removeFromCart(item.product.id)}
                      aria-label={t('common.remove')}
                      className="p-1 -mt-0.5 rounded-md text-text-muted hover:text-accent-red hover:bg-surface transition-colors flex-shrink-0"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-2.5">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.product.id, -1)}
                        aria-label={t('checkout.decreaseQty')}
                        className={stepperClass}
                      >
                        <Minus size={12} />
                      </button>
                      <span className="text-[13px] font-semibold tabular-nums w-7 text-center text-text-primary">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.product.id, 1)}
                        aria-label={t('checkout.increaseQty')}
                        className={stepperClass}
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    <span className="text-[14px] font-semibold text-text-primary tabular-nums">
                      {(item.product.selling_price * item.quantity).toFixed(2)}&lrm; DA
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="p-5 border-t border-border space-y-4">
          <div className="flex gap-1 p-1 rounded-xl bg-surface">
            <button
              type="button"
              onClick={() => setPaymentMethod('cash')}
              aria-pressed={paymentMethod === 'cash'}
              className={segmentClass(paymentMethod === 'cash')}
            >
              <Banknote size={15} /> {t('checkout.cash')}
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethod('card')}
              aria-pressed={paymentMethod === 'card'}
              className={segmentClass(paymentMethod === 'card')}
            >
              <CreditCard size={15} /> {t('checkout.card')}
            </button>
          </div>

          <div className="space-y-2 text-[13px] tabular-nums">
            <div className="flex justify-between text-text-secondary">
              <span>{t('common.subtotal')}</span><span className="text-text-primary">{total.toFixed(2)}&lrm; DA</span>
            </div>
            <div className="flex justify-between text-text-secondary">
              <span>{t('common.profit')}</span><span className="text-accent-green font-medium">{profit.toFixed(2)}&lrm; DA</span>
            </div>
            <div className="flex justify-between items-baseline pt-3 mt-1 border-t border-border">
              <span className="text-[15px] font-semibold text-text-primary">{t('checkout.totalLabel')}</span>
              <span className="text-[18px] font-semibold text-text-primary">{total.toFixed(2)}&lrm; DA</span>
            </div>
          </div>

          {saleComplete && (
            <div role="status" className="flex items-center gap-2 text-accent-green bg-accent-green/10 rounded-xl px-3.5 py-3 text-[13px] font-medium">
              <CheckCircle size={16} /> {t('checkout.saleCompleted')}
            </div>
          )}

          <button
            type="button"
            onClick={handleCheckout}
            disabled={cart.length === 0 || createSaleMutation.isPending}
            className="btn-primary w-full py-3"
          >
            {createSaleMutation.isPending ? t('checkout.processing') : `${t('checkout.completeSale')} — ${total.toFixed(2)}\u200E DA`}
          </button>
        </div>
      </aside>
    </div>
  );
}

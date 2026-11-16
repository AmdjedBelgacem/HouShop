import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { useI18n } from '../i18n';
import type { Product, Category, ProductVariant, CreateSale, Sale, SaleItemWithProduct, Customer } from '../lib/types';
import ProductFilter from '../components/ProductFilter';
import { useProductFilterState } from '../hooks/useProductFilterState';
import { Plus, Minus, X, ShoppingCart, Package, Layers, Printer, CheckCircle } from 'lucide-react';
import SaleCompletionModal from '../components/SaleCompletionModal';
import ConfirmDialog from '../components/ConfirmDialog';
import Invoice from '../components/Invoice';
import ShippingLabel from '../components/ShippingLabel';

const CHECKOUT_FILTER_STORAGE_KEY = 'houshop.checkout.filters';
interface CheckoutProps {
  scannedProduct?: Product | null;
  /** If the scan matched a variant barcode, this is that variant — auto-add it
   *  instead of opening the variant picker. */
  scannedVariant?: ProductVariant | null;
  onScanHandled?: () => void;
}
interface CartItem {
  product: Product;
  variant: ProductVariant | null;
  quantity: number;
  customPrice: number;
}
function getCoverImage(imagePath: string | null): string | null {
  if (!imagePath) return null;
  try {
    const parsed = JSON.parse(imagePath);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed[0];
  } catch {
    // JSON parse failed; fall through to return imagePath.
  }
  return imagePath;
}
const segmentClass = (active: boolean) =>
  `py-2 rounded-lg text-[13px] font-medium transition-colors ${
    active ? 'bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
  }`;
const stepperButtonClass =
  'w-7 h-7 flex items-center justify-center text-text-secondary hover:bg-surface transition-colors focus-visible:outline-none focus-visible:bg-surface';
export default function Checkout({ scannedProduct, scannedVariant, onScanHandled }: CheckoutProps) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash');
  const { filters, updateFilters, clearFilters } = useProductFilterState(CHECKOUT_FILTER_STORAGE_KEY, { stockStatus: 'in-stock' });
  const [variantPicker, setVariantPicker] = useState<{ product: Product; variants: ProductVariant[] } | null>(null);
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);
  const [showInvoice, setShowInvoice] = useState(false);
  const [showShippingLabel, setShowShippingLabel] = useState(false);
  const [completedSaleItems, setCompletedSaleItems] = useState<SaleItemWithProduct[]>([]);
  const [completedSaleCustomer, setCompletedSaleCustomer] = useState<Customer | null>(null);
  const [showVoidDialog, setShowVoidDialog] = useState(false);
  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: () => invoke<Product[]>('get_products'),
  });
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => invoke<Category[]>('get_categories'),
  });
  const { data: customers } = useQuery({
    queryKey: ['customers'],
    queryFn: () => invoke<Customer[]>('get_customers'),
  });

  // The last scan that was added to the cart, by object identity. Each scan from the parent
  // arrives as a new object, so comparing identities handles repeat scans of the same product
  // and cannot re-add a scan when an effect dependency changes.
  const handledScanRef = useRef<{ product: Product | null; variant: ProductVariant | null }>({ product: null, variant: null });
  const createSale = useMutation({
    mutationFn: (data: CreateSale) => invoke<Sale>('create_sale', { data }),
    onSuccess: (sale) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['sales-summary'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      setCart([]);
      setShowCompletionModal(false);
      setCompletedSaleItems(cart.map((item, idx) => ({
        id: idx + 1,
        sale_id: sale.id,
        product_id: item.product.id,
        product_name: item.product.name,
        product_image: item.product.image_path,
        variant_id: item.variant?.id ?? null,
        variant_name: item.variant?.variant_name ?? null,
        quantity: item.quantity,
        unit_price: item.customPrice,
        unit_cost: item.variant ? item.variant.cost_price : item.product.cost_price,
        subtotal: item.customPrice * item.quantity,
      })));
      setCompletedSale(sale);
      toast.success(t('toast.saleCompleted'));
    },
    onError: () => toast.error(t('toast.error')),
  });
  const fetchVariants = useCallback(async (productId: number): Promise<ProductVariant[]> => {
    try {
      return await invoke<ProductVariant[]>('get_product_variants', { productId });
    } catch {
      return [];
    }
  }, []);
  const addToCartWithVariant = useCallback((product: Product, variant: ProductVariant | null) => {
    // A product is always sold as one of its variants. `variant` is null only
    // as a defensive fallback; in practice the caller always passes one.
    const key = variant ? `v-${variant.id}` : `p-${product.id}`;
    setCart(prev => {
      const existing = prev.find(item => {
        const itemKey = item.variant ? `v-${item.variant.id}` : `p-${item.product.id}`;
        return itemKey === key;
      });
      if (existing) {
        return prev.map(item => {
          const itemKey = item.variant ? `v-${item.variant.id}` : `p-${item.product.id}`;
          return itemKey === key ? { ...item, quantity: item.quantity + 1 } : item;
        });
      }
      const price = variant ? variant.selling_price : product.selling_price;
      return [...prev, { product, variant, quantity: 1, customPrice: price }];
    });
    setVariantPicker(null);
  }, []);
  const handleAddToCart = useCallback(async (product: Product) => {
    const variants = await fetchVariants(product.id);
    // Variants are the sellable unit. Single-variant products go straight in;
    // multi-variant products open the picker. (A product with zero variants is
    // unsellable and shouldn't appear post-migration.)
    if (variants.length === 1) {
      addToCartWithVariant(product, variants[0]);
    } else if (variants.length > 1) {
      setVariantPicker({ product, variants });
    }
  }, [fetchVariants, addToCartWithVariant]);

  // Scan handling: placed after handleAddToCart / addToCartWithVariant so the
  // effect can reference them without "used before declaration" warnings.
  // onScanHandled is read through a ref: a new callback identity from the parent must not
  // re-run the scan effect, because the scan key below is unique per run and would re-add the item.
  const onScanHandledRef = useRef(onScanHandled);
  useEffect(() => {
    onScanHandledRef.current = onScanHandled;
  }, [onScanHandled]);

  useEffect(() => {
    if (scannedProduct) {
      const prev = handledScanRef.current;
      if (prev.product !== scannedProduct || prev.variant !== scannedVariant) {
        handledScanRef.current = { product: scannedProduct, variant: scannedVariant };
        // If the scan matched a specific variant barcode, add that variant
        // directly — no need to open the picker to re-select it.
        if (scannedVariant) {
          // The cart update from a scan is an intentional response to an external event
          // (the barcode scanner). Moving it into render would double-add in strict mode.
          addToCartWithVariant(scannedProduct, scannedVariant); // eslint-disable-line react-hooks/set-state-in-effect
        } else {
          handleAddToCart(scannedProduct);
        }
        onScanHandledRef.current?.();
      }
    }
  }, [scannedProduct, scannedVariant, handleAddToCart, addToCartWithVariant]);

  const updateQty = (idx: number, delta: number) => {
    setCart(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const newQty = item.quantity + delta;
      if (newQty <= 0) return item;
      return { ...item, quantity: newQty };
    }));
  };
  const removeFromCart = (idx: number) => {
    setCart(prev => prev.filter((_, i) => i !== idx));
  };
  // Directly set a line's selling price — used for per-item discounts. The
  // input is always visible; invalid/empty values are ignored (≥0 enforced).
  const setPrice = (idx: number, value: number) => {
    if (!Number.isFinite(value) || value < 0) return;
    setCart(prev => prev.map((item, i) => i === idx ? { ...item, customPrice: value } : item));
  };
  const filteredProducts = (products ?? []).filter(p => {
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (![p.name, p.category_name ?? '', p.sku ?? '', p.barcode ?? '', p.description ?? ''].some(value => value.toLowerCase().includes(q))) return false;
    }
    if (filters.categoryId != null && p.category_id !== filters.categoryId) return false;
    if (filters.minPrice && p.selling_price < parseFloat(filters.minPrice)) return false;
    if (filters.maxPrice && p.selling_price > parseFloat(filters.maxPrice)) return false;
    if (filters.stockStatus === 'in-stock') return p.quantity > 0;
    if (filters.stockStatus === 'out-of-stock') return p.quantity <= 0;
    return true;
  });
  const subtotal = cart.reduce((sum, item) => sum + item.customPrice * item.quantity, 0);
  const totalCost = cart.reduce((sum, item) => {
    const cost = item.variant ? item.variant.cost_price : item.product.cost_price;
    return sum + cost * item.quantity;
  }, 0);
  const total = subtotal;
  const profit = subtotal - totalCost;
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const handleCompleteSale = () => {
    if (cart.length === 0) return;
    setShowCompletionModal(true);
  };
  const handleConfirmSale = (customerId: number | null, warrantyNotes: string) => {
    const customer = customerId ? customers?.find(c => c.id === customerId) ?? null : null;
    setCompletedSaleCustomer(customer);
    createSale.mutate({
      items: cart.map(item => ({
        product_id: item.product.id,
        variant_id: item.variant?.id ?? null,
        variant_name: item.variant?.variant_name ?? null,
        quantity: item.quantity,
        unit_price: item.customPrice,
        unit_cost: item.variant ? item.variant.cost_price : item.product.cost_price,
      })),
      customer_id: customerId,
      payment_method: paymentMethod,
      notes: warrantyNotes || null,
    });
  };
  const fmt = (n: number) => `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\u200E DA`;
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Product catalogue */}
      <div className="flex-1 overflow-y-auto p-8 animate-fade-up">
        <div className="mb-6">
          <span className="eyebrow-accent mb-3 flex w-fit">{t('sidebar.groupSell')}</span>
          <h2 className="page-title">{t('checkout.posTitle')}</h2>
          <p className="page-subtitle">{t('checkout.posSubtitle')}</p>
        </div>

        <ProductFilter
          filters={filters}
          onChange={updateFilters}
          onClear={clearFilters}
          categories={categories ?? []}
          placeholder={t('checkout.searchProducts')}
        />

        <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredProducts.length === 0 ? (
            <div className="col-span-full flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center mb-3 text-text-muted">
                <Package size={22} />
              </div>
              <p className="text-[14px] font-medium text-text-secondary">{t('checkout.noProductsFound')}</p>
            </div>
          ) : (
            filteredProducts.map(p => {
              const inCart = cart.filter(c => c.product.id === p.id);
              const inCartQty = inCart.reduce((s, c) => s + c.quantity, 0);
              const soldOut = p.quantity <= 0;
              const coverImage = getCoverImage(p.image_path);
              return (
                <div key={p.id} className="card overflow-hidden transition-shadow duration-150 hover:shadow-raised">
                  <div className="relative h-36 bg-surface flex items-center justify-center">
                    {coverImage ? (
                      <img src={convertFileSrc(coverImage)} alt={p.name} className="w-full h-full object-cover" />
                    ) : (
                      <Package size={30} className="text-text-muted" />
                    )}
                    {soldOut ? (
                      <span className="badge absolute top-2.5 right-2.5 bg-accent-red text-white text-[13px] font-semibold">
                        {t('checkout.soldOut')}
                      </span>
                    ) : (
                      <span className="badge absolute top-2.5 right-2.5 bg-card/90 text-text-primary text-[13px] font-semibold border border-border-light">
                        {t('checkout.inStock')}
                      </span>
                    )}
                  </div>
                  <div className="p-4">
                    <p className="eyebrow truncate">
                      {p.category_name ?? t('checkout.uncategorized')}
                    </p>
                    <p className="text-[14px] font-semibold text-text-primary mt-1 leading-tight truncate">{p.name}</p>
                    <p className="text-[15px] font-semibold text-text-primary tabular-nums mt-1">{fmt(p.selling_price)}</p>
                    <div className="flex items-center justify-between gap-2 mt-3">
                      <span className="text-[13px] text-text-muted truncate">{t('checkout.unitsLeft', { count: p.quantity })}</span>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {inCartQty > 0 && (
                          <span className="badge bg-navy/10 text-navy text-[13px] font-medium tabular-nums">
                            {t('checkout.inCart', { count: inCartQty })}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => handleAddToCart(p)}
                          aria-label={t('common.add')}
                          className="w-8 h-8 rounded-full bg-navy text-white flex items-center justify-center hover:bg-navy-light shadow-sm active:scale-95 transition-[background-color,transform] duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30"
                        >
                          <Plus size={16} strokeWidth={2.5} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Cart */}
      <aside className="w-[360px] min-w-[360px] bg-card border-l border-border flex flex-col h-full">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
          <h3 className="text-[16px] font-semibold text-text-primary">{t('checkout.activeCart')}</h3>
          <span className="badge bg-surface text-text-secondary text-[13px] tabular-nums">{t('checkout.itemsCount', { count: cartCount })}</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full px-6 text-center text-text-muted">
              <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center mb-3">
                <ShoppingCart size={22} />
              </div>
              <p className="text-[14px] font-medium text-text-secondary">{t('checkout.cartEmptyDesc')}</p>
              <p className="text-[13px] mt-1">{t('checkout.selectToBegin')}</p>
            </div>
          ) : (
            <ul className="divide-y divide-border-light">
              {cart.map((item, idx) => (
                <li key={`${item.product.id}-${item.variant?.id ?? 'base'}-${idx}`} className="flex gap-3 px-5 py-4">
                  <div className="w-14 h-14 rounded-xl bg-surface flex items-center justify-center flex-shrink-0 overflow-hidden border border-border-light">
                    {getCoverImage(item.product.image_path) ? (
                      <img src={convertFileSrc(getCoverImage(item.product.image_path)!)} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Package size={18} className="text-text-muted" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[14px] font-medium text-text-primary truncate">{item.product.name}</p>
                        {item.variant && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <Layers size={11} className="text-accent-blue flex-shrink-0" />
                            <p className="text-[13px] text-accent-blue font-medium truncate">{item.variant.variant_name}</p>
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFromCart(idx)}
                        aria-label={t('common.remove')}
                        className="p-1 -mt-0.5 rounded-md text-text-muted hover:text-accent-red hover:bg-surface transition-colors flex-shrink-0"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    {/* Per-line price (discount) */}
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <span className="text-[13px] text-text-muted">{t('common.price')}</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        aria-label={t('common.price')}
                        value={item.customPrice}
                        onChange={(e) => setPrice(idx, parseFloat(e.target.value))}
                        className="w-20 px-2 py-1 text-[13px] font-medium tabular-nums rounded-lg border border-border bg-surface text-text-primary transition-[border-color,box-shadow] duration-150 focus:outline-none focus:border-navy focus:ring-[3px] focus:ring-navy/20"
                      />
                      <span className="text-[13px] text-text-muted">DA</span>
                      {item.variant && item.customPrice !== item.variant.selling_price && (
                        <span className="text-[13px] text-text-muted line-through tabular-nums">{fmt(item.variant.selling_price)}</span>
                      )}
                      {!item.variant && item.customPrice !== item.product.selling_price && (
                        <span className="text-[13px] text-text-muted line-through tabular-nums">{fmt(item.product.selling_price)}</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-2.5">
                      <div className="flex items-center rounded-lg border border-border overflow-hidden bg-card">
                        <button
                          type="button"
                          onClick={() => updateQty(idx, -1)}
                          aria-label={t('checkout.decreaseQty')}
                          className={stepperButtonClass}
                        >
                          <Minus size={12} />
                        </button>
                        <span className="w-8 h-7 flex items-center justify-center text-[13px] font-semibold tabular-nums text-text-primary border-x border-border">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateQty(idx, 1)}
                          aria-label={t('checkout.increaseQty')}
                          className={stepperButtonClass}
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                      <p className="text-[14px] font-semibold text-text-primary tabular-nums">
                        {fmt(item.customPrice * item.quantity)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Totals and payment */}
        {cart.length > 0 && (
          <div className="border-t border-border px-5 py-4 space-y-4">
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-surface">
              <button
                type="button"
                onClick={() => setPaymentMethod('cash')}
                aria-pressed={paymentMethod === 'cash'}
                className={segmentClass(paymentMethod === 'cash')}
              >
                {t('checkout.cash')}
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod('card')}
                aria-pressed={paymentMethod === 'card'}
                className={segmentClass(paymentMethod === 'card')}
              >
                {t('checkout.card')}
              </button>
            </div>
            <div className="space-y-2 text-[13px] tabular-nums">
              <div className="flex justify-between">
                <span className="text-text-secondary">{t('checkout.subtotalLabel')}</span>
                <span className="text-text-primary">{fmt(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">{t('checkout.projectedProfit')}</span>
                <span className="text-accent-green font-medium">+{fmt(profit)}</span>
              </div>
              <div className="flex justify-between items-baseline pt-3 mt-1 border-t border-border">
                <span className="text-[15px] font-semibold text-text-primary">{t('checkout.totalLabel')}</span>
                <span className="text-[18px] font-semibold text-text-primary">{fmt(total)}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleCompleteSale}
              disabled={createSale.isPending}
              className="btn-primary w-full py-3"
            >
              {createSale.isPending ? t('checkout.processing') : t('checkout.completeSaleAmount', { amount: fmt(total) })}
            </button>
            <button
              type="button"
              onClick={() => setShowVoidDialog(true)}
              className="w-full py-1.5 rounded-lg text-[13px] font-medium text-text-muted hover:text-accent-red hover:bg-surface transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/20"
            >
              {t('checkout.voidTransaction')}
            </button>
          </div>
        )}
      </aside>

      {/* Variant picker */}
      {variantPicker && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[100] p-4" onClick={() => setVariantPicker(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="variant-picker-title"
            className="bg-card rounded-2xl w-full max-w-md shadow-raised overflow-hidden animate-fade-up"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-border-light">
              <h3 id="variant-picker-title" className="text-[17px] font-semibold text-text-primary min-w-0">
                {t('checkout.selectVariantTitle', { name: variantPicker.product.name })}
              </h3>
              <button
                type="button"
                onClick={() => setVariantPicker(null)}
                aria-label={t('common.close')}
                className="p-1.5 -mr-1 -mt-0.5 rounded-lg text-text-muted hover:bg-surface hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30"
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-2 max-h-80 overflow-y-auto">
              {variantPicker.variants.map(v => (
                <button
                  type="button"
                  key={v.id}
                  onClick={() => addToCartWithVariant(variantPicker.product, v)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:border-navy/30 hover:bg-navy/5 transition-colors text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/20"
                >
                  <div className="w-10 h-10 rounded-lg bg-surface flex items-center justify-center flex-shrink-0">
                    <Layers size={18} className="text-text-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-text-primary truncate">{v.variant_name}</p>
                    <p className="text-[13px] text-text-muted">
                      {v.condition_note && <span>{v.condition_note} · </span>}
                      {t('checkout.unitsAvailable', { count: v.quantity })}
                    </p>
                  </div>
                  <p className="text-[14px] font-semibold text-text-primary tabular-nums">{fmt(v.selling_price)}</p>
                </button>
              ))}
            </div>
            <div className="px-6 py-4 border-t border-border-light">
              <button type="button" onClick={() => setVariantPicker(null)} className="btn-secondary w-full">
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCompletionModal && (
        <SaleCompletionModal
          cart={cart}
          paymentMethod={paymentMethod}
          total={total}
          onConfirm={handleConfirmSale}
          onCancel={() => setShowCompletionModal(false)}
          fmt={fmt}
        />
      )}

      {/* Post-sale notice */}
      {completedSale && !showInvoice && !showShippingLabel && (
        <div
          role="status"
          className="invoice-no-print fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] card shadow-raised py-2 pl-4 pr-2 flex items-center gap-3 animate-fade-up"
        >
          <CheckCircle size={18} className="text-accent-green flex-shrink-0" />
          <span className="text-[13px] font-medium text-text-primary tabular-nums">{t('checkout.saleCompleted', { id: 90000 + completedSale.id })}</span>
          <div className="flex items-center gap-1.5 ml-1">
            <button
              type="button"
              onClick={() => setShowInvoice(true)}
              className="btn-secondary py-1.5 px-3 text-[13px]"
            >
              <Printer size={13} /> {t('checkout.printInvoice')}
            </button>
            <button
              type="button"
              onClick={() => setShowShippingLabel(true)}
              className="btn-secondary py-1.5 px-3 text-[13px]"
            >
              <Printer size={13} /> {t('shipping.printLabel')}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setCompletedSale(null)}
            aria-label={t('common.close')}
            className="p-1.5 rounded-lg text-text-muted hover:bg-surface hover:text-text-primary transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {showInvoice && completedSale && (
        <Invoice
          sale={completedSale}
          items={completedSaleItems}
          customer={completedSaleCustomer}
          onClose={() => { setShowInvoice(false); setCompletedSale(null); }}
        />
      )}

      {showShippingLabel && completedSale && (
        <ShippingLabel
          sale={completedSale}
          items={completedSaleItems}
          customer={completedSaleCustomer}
          onClose={() => { setShowShippingLabel(false); setCompletedSale(null); }}
        />
      )}

      <ConfirmDialog
        open={showVoidDialog}
        variant="danger"
        title={t('checkout.voidTransaction')}
        description={t('checkout.voidConfirm')}
        confirmLabel={t('checkout.voidTransaction')}
        onCancel={() => setShowVoidDialog(false)}
        onConfirm={() => { setCart([]); setShowVoidDialog(false); toast.success(t('toast.cartCleared')); }}
      />
    </div>
  );
}

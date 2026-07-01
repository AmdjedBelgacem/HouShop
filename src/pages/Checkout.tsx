import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { useI18n } from '../i18n';
import type { Product, Category, ProductVariant, CreateSale, Sale, SaleItemWithProduct, Customer } from '../lib/types';
import { Plus, Minus, X, ShoppingCart, Package, Layers, Printer } from 'lucide-react';
import SaleCompletionModal from '../components/SaleCompletionModal';
import ConfirmDialog from '../components/ConfirmDialog';
import Invoice from '../components/Invoice';
import ShippingLabel from '../components/ShippingLabel';
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
  } catch {  }
  return imagePath;
}
export default function Checkout({ scannedProduct, scannedVariant, onScanHandled }: CheckoutProps) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash');
  const [activeCategory, setActiveCategory] = useState<string>('all');
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

  const prevScannedRef = useRef<string | null>(null);
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
  const fetchVariants = async (productId: number): Promise<ProductVariant[]> => {
    try {
      return await invoke<ProductVariant[]>('get_product_variants', { productId });
    } catch {
      return [];
    }
  };
  const addToCartWithVariant = (product: Product, variant: ProductVariant | null) => {
    // A product is always sold as one of its variants. `variant` is null only
    // as a defensive fallback; in practice the caller always passes one.
    const key = variant ? `v-${variant.id}` : `p-${product.id}`;
    setCart(prev => {
      const existing = prev.find(item => {
        const itemKey = item.variant ? `v-${item.variant.id}` : `p-${item.product.id}`;
        return itemKey === key;
      });
      const stock = variant ? variant.quantity : product.quantity;
      if (existing) {
        if (existing.quantity >= stock) return prev;
        return prev.map(item => {
          const itemKey = item.variant ? `v-${item.variant.id}` : `p-${item.product.id}`;
          return itemKey === key ? { ...item, quantity: item.quantity + 1 } : item;
        });
      }
      const price = variant ? variant.selling_price : product.selling_price;
      return [...prev, { product, variant, quantity: 1, customPrice: price }];
    });
    setVariantPicker(null);
  };
  const handleAddToCart = async (product: Product) => {
    const variants = await fetchVariants(product.id);
    // Variants are the sellable unit. Single-variant products go straight in;
    // multi-variant products open the picker. (A product with zero variants is
    // unsellable and shouldn't appear post-migration.)
    if (variants.length === 1) {
      addToCartWithVariant(product, variants[0]);
    } else if (variants.length > 1) {
      setVariantPicker({ product, variants });
    }
  };

  // Scan handling: placed after handleAddToCart / addToCartWithVariant so the
  // effect can reference them without "used before declaration" warnings.
  useEffect(() => {
    if (scannedProduct) {
      const key = `scan-${scannedProduct.id}-${scannedVariant?.id ?? 'base'}-${Date.now()}`;
      if (key !== prevScannedRef.current) {
        prevScannedRef.current = key;
        // If the scan matched a specific variant barcode, add that variant
        // directly — no need to open the picker to re-select it.
        if (scannedVariant) {
          addToCartWithVariant(scannedProduct, scannedVariant);
        } else {
          handleAddToCart(scannedProduct);
        }
        onScanHandled?.();
      }
    }
  }, [scannedProduct, scannedVariant]);

  const updateQty = (idx: number, delta: number) => {
    setCart(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const stock = item.variant ? item.variant.quantity : item.product.quantity;
      const newQty = item.quantity + delta;
      if (newQty <= 0 || newQty > stock) return item;
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
    if (activeCategory === 'all') return true;
    return (p.category_name ?? '').toLowerCase() === activeCategory.toLowerCase();
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
  const categoryButtons = [
    { id: 'all', label: t('checkout.allItems') },
    ...(categories ?? []).map(c => ({ id: c.name, label: c.name })),
  ];
  const fmt = (n: number) => `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DA`;
  return (
    <div className="flex h-screen overflow-hidden">
      {}
      <div className="flex-1 overflow-y-auto p-8 pb-8">
        <div className="mb-6">
          <h2 className="text-[26px] font-bold text-text-primary leading-tight">{t('checkout.posTitle')}</h2>
          <p className="text-[14px] text-text-secondary mt-1.5">
            {t('checkout.posSubtitle')}
          </p>
        </div>
        {}
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          {categoryButtons.map(cat => (
            <button key={cat.id} onClick={() => setActiveCategory(cat.id)}
              className={`px-4 py-2 rounded-full text-[12.5px] font-medium transition-colors ${
                activeCategory === cat.id
                  ? 'bg-navy text-white'
                  : 'bg-card border border-border text-text-primary hover:bg-surface'
              }`}>
              {cat.label}
            </button>
          ))}
        </div>
        {}
        <div className="grid grid-cols-3 gap-4">
          {filteredProducts.length === 0 ? (
            <div className="col-span-3 py-16 text-center text-text-muted">
              <Package size={32} className="mx-auto mb-2 opacity-30" />
              {t('checkout.noProductsFound')}
            </div>
          ) : (
            filteredProducts.map(p => {
              const inCart = cart.filter(c => c.product.id === p.id);
              const inCartQty = inCart.reduce((s, c) => s + c.quantity, 0);
              const soldOut = p.quantity <= 0;
              return (
                <div key={p.id} className="card overflow-hidden hover:shadow-md transition-shadow">
                  <div className="relative h-36 bg-surface flex items-center justify-center">
                    {getCoverImage(p.image_path) ? (
                      <img src={convertFileSrc(getCoverImage(p.image_path)!)} alt={p.name} className="w-full h-full object-cover" />
                    ) : (
                      <Package size={32} className="text-text-muted" />
                    )}
                    {!soldOut && (
                      <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-white/90 text-[10px] font-semibold text-text-primary border border-border/50">
                        {t('checkout.inStock')}
                      </span>
                    )}
                    {soldOut && (
                      <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-accent-red/90 text-[10px] font-semibold text-white">
                        {t('checkout.soldOut')}
                      </span>
                    )}
                  </div>
                  <div className="p-3.5">
                    <p className="text-[10px] font-semibold text-text-muted tracking-[0.06em] uppercase">
                      {p.category_name ?? t('checkout.uncategorized')}
                    </p>
                    <p className="text-[14px] font-bold text-text-primary mt-0.5 leading-tight truncate">{p.name}</p>
                    <p className="text-[16px] font-bold text-text-primary mt-1">{fmt(p.selling_price)}</p>
                    <div className="flex items-center justify-between mt-2.5">
                      <span className="text-[11px] text-text-muted">{t('checkout.unitsLeft', { count: p.quantity })}</span>
                      {inCartQty > 0 && (
                        <span className="text-[10px] font-bold text-navy bg-navy/10 px-2 py-0.5 rounded-full">
                          {t('checkout.inCart', { count: inCartQty })}
                        </span>
                      )}
                      <button onClick={() => handleAddToCart(p)} disabled={soldOut}
                        className="w-8 h-8 rounded-full bg-navy text-white flex items-center justify-center hover:bg-navy-light disabled:opacity-30 disabled:cursor-not-allowed transition-colors shadow-sm">
                        <Plus size={16} strokeWidth={2.5} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      {}
      <div className="w-[360px] min-w-[360px] bg-card border-l border-border flex flex-col h-full">
        <div className="px-5 py-4 border-b border-border">
          <div className="flex items-center justify-between">
            <h3 className="text-[16px] font-bold text-text-primary">{t('checkout.activeCart')}</h3>
            <span className="text-[12px] text-text-muted">{t('checkout.itemsCount', { count: cartCount })}</span>
          </div>
        </div>
        {}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-text-muted">
              <ShoppingCart size={32} className="mb-2 opacity-30" />
              <p className="text-[13px]">{t('checkout.cartEmptyDesc')}</p>
              <p className="text-[11px] mt-1">{t('checkout.selectToBegin')}</p>
            </div>
          ) : (
            cart.map((item, idx) => (
              <div key={`${item.product.id}-${item.variant?.id ?? 'base'}-${idx}`} className="flex gap-3">
                <div className="w-14 h-14 rounded-lg bg-surface flex items-center justify-center flex-shrink-0 overflow-hidden border border-border-light">
                  {getCoverImage(item.product.image_path) ? (
                    <img src={convertFileSrc(getCoverImage(item.product.image_path)!)} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Package size={18} className="text-text-muted" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-text-primary truncate">{item.product.name}</p>
                      {item.variant && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <Layers size={10} className="text-accent-blue" />
                          <p className="text-[11px] text-accent-blue font-medium">{item.variant.variant_name}</p>
                        </div>
                      )}
                    </div>
                    <button onClick={() => removeFromCart(idx)}
                      className="p-0.5 text-text-muted hover:text-accent-red transition-colors flex-shrink-0 ml-1">
                      <X size={13} />
                    </button>
                  </div>
                  {}
                  <div className="flex items-center gap-1.5 mt-1">
                    <label className="text-[10px] text-text-muted">Price</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={item.customPrice}
                      onChange={(e) => setPrice(idx, parseFloat(e.target.value))}
                      className="w-20 px-1.5 py-0.5 text-[12px] font-semibold border border-border rounded focus:outline-none focus:border-navy focus:ring-1 focus:ring-navy bg-card"
                    />
                    <span className="text-[10px] text-text-muted">DA</span>
                    {item.variant && item.customPrice !== item.variant.selling_price && (
                      <span className="text-[10px] text-text-muted line-through">{fmt(item.variant.selling_price)}</span>
                    )}
                    {!item.variant && item.customPrice !== item.product.selling_price && (
                      <span className="text-[10px] text-text-muted line-through">{fmt(item.product.selling_price)}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-0 border border-border rounded-lg overflow-hidden">
                      <button onClick={() => updateQty(idx, -1)}
                        className="w-7 h-7 flex items-center justify-center text-text-secondary hover:bg-surface transition-colors">
                        <Minus size={12} />
                      </button>
                      <span className="w-7 h-7 flex items-center justify-center text-[12px] font-semibold text-text-primary border-x border-border">
                        {item.quantity}
                      </span>
                      <button onClick={() => updateQty(idx, 1)}
                        className="w-7 h-7 flex items-center justify-center text-text-secondary hover:bg-surface transition-colors">
                        <Plus size={12} />
                      </button>
                    </div>
                    <p className="text-[13px] font-bold text-text-primary">
                      {fmt(item.customPrice * item.quantity)}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        {}
        {cart.length > 0 && (
          <div className="border-t border-border px-5 py-4 space-y-4">
            <div className="flex gap-2">
              <button onClick={() => setPaymentMethod('cash')}
                className={`flex-1 py-2 rounded-lg text-[12.5px] font-medium transition-colors ${
                  paymentMethod === 'cash' ? 'bg-navy text-white' : 'bg-surface text-text-secondary border border-border'
                }`}>Cash</button>
              <button onClick={() => setPaymentMethod('card')}
                className={`flex-1 py-2 rounded-lg text-[12.5px] font-medium transition-colors ${
                  paymentMethod === 'card' ? 'bg-navy text-white' : 'bg-surface text-text-secondary border border-border'
                }`}>Card</button>
            </div>
            <div className="space-y-2 text-[13px]">
              <div className="flex justify-between">
                <span className="text-text-secondary">{t('checkout.subtotalLabel')}</span>
                <span className="text-text-primary">{fmt(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">{t('checkout.projectedProfit')}</span>
                <span className="text-accent-green font-semibold">+{fmt(profit)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-border">
                <span className="text-[15px] font-bold text-text-primary">{t('checkout.totalLabel')}</span>
                <span className="text-[15px] font-bold text-text-primary">{fmt(total)}</span>
              </div>
            </div>
            <button onClick={handleCompleteSale} disabled={createSale.isPending}
              className="w-full py-3 rounded-lg bg-navy text-white text-[13.5px] font-semibold hover:bg-navy-light disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
              {createSale.isPending ? t('checkout.processing') : t('checkout.completeSaleAmount', { amount: fmt(total) })}
            </button>
            <button onClick={() => setShowVoidDialog(true)}
              className="w-full text-center text-[12px] text-text-muted hover:text-accent-red transition-colors">
              {t('checkout.voidTransaction')}
            </button>
          </div>
        )}
      </div>
      {}
      {variantPicker && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100]" onClick={() => setVariantPicker(null)}>
          <div className="bg-card rounded-2xl w-full max-w-md shadow-xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[16px] font-bold text-text-primary">{t('checkout.selectVariantTitle', { name: variantPicker.product.name })}</h3>
              <button onClick={() => setVariantPicker(null)} className="text-text-muted hover:text-text-primary">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {variantPicker.variants.map(v => (
                <button
                  key={v.id}
                  onClick={() => v.quantity > 0 && addToCartWithVariant(variantPicker.product, v)}
                  disabled={v.quantity <= 0}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:border-navy/30 hover:bg-navy/5 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <div className="w-10 h-10 rounded-lg bg-surface flex items-center justify-center">
                    <Layers size={18} className="text-text-muted" />
                  </div>
                  <div className="flex-1">
                    <p className="text-[13px] font-semibold text-text-primary">{v.variant_name}</p>
                    <p className="text-[11px] text-text-muted">
                      {v.condition_note && <span>{v.condition_note} · </span>}
                      {t('checkout.unitsAvailable', { count: v.quantity })}
                    </p>
                  </div>
                  <p className="text-[14px] font-bold text-text-primary">{fmt(v.selling_price)}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {}
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
      {}
      {completedSale && !showInvoice && !showShippingLabel && (
        <div className="invoice-no-print fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] bg-accent-green text-white px-6 py-3 rounded-xl shadow-lg flex items-center gap-4">
          <span className="text-[13px] font-semibold">{t('checkout.saleCompleted', { id: 90000 + completedSale.id })}</span>
          <button
            onClick={() => setShowInvoice(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-[12px] font-medium transition-colors"
          >
            <Printer size={13} /> {t('checkout.printInvoice')}
          </button>
          <button
            onClick={() => setShowShippingLabel(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-[12px] font-medium transition-colors"
          >
            <Printer size={13} /> {t('shipping.printLabel')}
          </button>
          <button
            onClick={() => setCompletedSale(null)}
            className="p-1 rounded hover:bg-white/20 transition-colors"
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

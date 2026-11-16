import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import type {
  Product,
  Category,
  CreateInventoryTransaction,
  ProductVariant,
} from '../lib/types';
import ProductFilter from '../components/ProductFilter';
import { useProductFilterState } from '../hooks/useProductFilterState';
import BarcodePrintModal from '../components/BarcodePrintModal';
import ConfirmDialog from '../components/ConfirmDialog';
import { useI18n } from '../i18n';
import {
  Plus, Edit3, Trash2, PackagePlus, X,
  ArrowUpDown, ScanBarcode, Layers, ChevronDown, ChevronUp, MoveRight, Search,
} from 'lucide-react';

const PRODUCT_FILTER_STORAGE_KEY = 'houshop.products.filters';

type ProductSortField = 'name' | 'category_name' | 'quantity' | 'cost_price' | 'selling_price';

interface ProductsProps {
  onAddProduct: () => void;
  onEditProduct: (product: Product) => void;
}

export default function Products({ onAddProduct, onEditProduct }: ProductsProps) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const { filters, updateFilters, clearFilters } = useProductFilterState(PRODUCT_FILTER_STORAGE_KEY);
  const [showStock, setShowStock] = useState(false);
  const [stockProduct, setStockProduct] = useState<Product | null>(null);
  const [sortField, setSortField] = useState<ProductSortField>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [barcodeProduct, setBarcodeProduct] = useState<Product | null>(null);
  // When printing from an expanded variant row, preselect that variant.
  const [barcodeVariantName, setBarcodeVariantName] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  // Expanded product row: fetch its variants lazily and show inline actions.
  const [expandedProductId, setExpandedProductId] = useState<number | null>(null);
  // Variant targeted for deletion (from an expanded row).
  const [deleteVariantTarget, setDeleteVariantTarget] = useState<ProductVariant | null>(null);
  const [moveProduct, setMoveProduct] = useState<Product | null>(null);
  const [moveVariants, setMoveVariants] = useState<ProductVariant[]>([]);
  const [selectedMoveVariantIds, setSelectedMoveVariantIds] = useState<number[]>([]);
  const [moveTargetProductId, setMoveTargetProductId] = useState<number | null>(null);
  const [moveSearch, setMoveSearch] = useState('');
  const [loadingMoveVariants, setLoadingMoveVariants] = useState(false);

  const { data: products, isLoading } = useQuery({
    queryKey: ['products', filters.search],
    queryFn: () => filters.search
      ? invoke<Product[]>('search_products', { query: filters.search })
      : invoke<Product[]>('get_products'),
  });
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => invoke<Category[]>('get_categories'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => invoke('delete_product', { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-valuation'] });
      setDeleteTarget(null);
      toast.success(t('toast.productDeleted'));
    },
    onError: () => toast.error(t('toast.error')),
  });

  // Variants for the currently expanded product row. Fetched lazily so opening
  // one row doesn't pay for the whole catalog's variants up front.
  const { data: expandedVariants } = useQuery({
    queryKey: ['product-variants', expandedProductId],
    queryFn: () => invoke<ProductVariant[]>('get_product_variants', { productId: expandedProductId! }),
    enabled: expandedProductId != null,
  });

  // Delete a single variant from an expanded row (without editing the product).
  const deleteVariantMutation = useMutation({
    mutationFn: (id: number) => invoke('delete_variant', { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product-variants'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-valuation'] });
      setDeleteVariantTarget(null);
      toast.success(t('toast.variantDeleted'));
    },
    onError: () => toast.error(t('toast.error')),
  });

  const moveVariantsMutation = useMutation({
    mutationFn: (data: { variantIds: number[]; targetProductId: number }) =>
      invoke('move_variants_to_product', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product-variants'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['low-stock'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-valuation'] });
      setMoveProduct(null);
      setMoveVariants([]);
      setSelectedMoveVariantIds([]);
      setMoveTargetProductId(null);
      setMoveSearch('');
      toast.success(t('toast.variantsMoved'));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e || t('toast.error'))),
  });

  // Open the barcode modal scoped to a specific variant. Passing the variant
  // name makes the modal default-select that variant's label.
  const printVariantBarcode = (p: Product, v: ProductVariant) => {
    setBarcodeProduct(p);
    setBarcodeVariantName(v.variant_name);
  };

  const openMoveVariants = async (p: Product) => {
    setMoveProduct(p);
    setMoveVariants([]);
    setSelectedMoveVariantIds([]);
    setMoveTargetProductId(null);
    setMoveSearch('');
    setLoadingMoveVariants(true);
    try {
      const vs = await invoke<ProductVariant[]>('get_product_variants', { productId: p.id });
      setMoveVariants(vs);
    } catch {
      toast.error(t('toast.error'));
      setMoveProduct(null);
    } finally {
      setLoadingMoveVariants(false);
    }
  };

  const [stockForm, setStockForm] = useState({ quantity: '', unit_cost: '', notes: '' });
  // Variants for the product currently in the restock modal, so the merchant
  // can pick which variant receives the stock.
  const [stockVariants, setStockVariants] = useState<ProductVariant[]>([]);
  const [stockVariantId, setStockVariantId] = useState<number | null>(null);

  const openStock = (p: Product) => {
    setStockProduct(p);
    setStockForm({ quantity: '', unit_cost: '', notes: '' });
    setStockVariantId(null);
    setStockVariants([]);
    setShowStock(true);
    invoke<ProductVariant[]>('get_product_variants', { productId: p.id })
      .then(vs => {
        setStockVariants(vs);
        // Default to the first variant; stock lives on variants, so we need one.
        setStockVariantId(vs[0]?.id ?? null);
      })
      .catch(() => { /* no variants — handled below */ });
  };
  const handleAddStock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockProduct || !stockVariantId) return;
    const variant = stockVariants.find(v => v.id === stockVariantId);
    const data: CreateInventoryTransaction = {
      product_id: stockProduct.id,
      variant_id: stockVariantId,
      quantity: parseInt(stockForm.quantity) || 0,
      unit_cost: parseFloat(stockForm.unit_cost) || (variant?.cost_price ?? stockProduct.cost_price),
      transaction_type: 'purchase',
      notes: stockForm.notes || null,
    };
    invoke('add_stock', { data })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['products'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
        queryClient.invalidateQueries({ queryKey: ['low-stock'] });
        queryClient.invalidateQueries({ queryKey: ['product-variants'] });
        queryClient.invalidateQueries({ queryKey: ['inventory-valuation'] });
        setStockProduct(null);
        setShowStock(false);
        toast.success(t('toast.stockAdded'));
      })
      .catch(() => toast.error(t('toast.error')));
  };

  const toggleSort = (field: ProductSortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const filteredProducts = [...(products ?? [])]
    .filter(p => filters.categoryId === null || p.category_id === filters.categoryId)
    .filter(p => {
      if (filters.minPrice && p.selling_price < parseFloat(filters.minPrice)) return false;
      if (filters.maxPrice && p.selling_price > parseFloat(filters.maxPrice)) return false;
      return true;
    })
    .filter(p => {
      if (filters.stockStatus === 'in-stock') return p.quantity > 0;
      if (filters.stockStatus === 'out-of-stock') return p.quantity <= 0;
      return true;
    })
    .sort((a, b) => {
      const mul = sortDir === 'asc' ? 1 : -1;
      if (sortField === 'name') return a.name.localeCompare(b.name) * mul;
      if (sortField === 'category_name') {
        const ac = a.category_name ?? '';
        const bc = b.category_name ?? '';
        return (ac.localeCompare(bc) || a.name.localeCompare(b.name)) * mul;
      }
      return ((a[sortField] as number) - (b[sortField] as number)) * mul;
    });
  const moveTargetOptions = (products ?? [])
    .filter(p => p.id !== moveProduct?.id)
    .filter(p => {
      const q = moveSearch.trim().toLowerCase();
      if (!q) return true;
      return [
        p.name,
        p.category_name ?? '',
        p.sku ?? '',
        p.barcode ?? '',
        p.description ?? '',
      ].some(value => value.toLowerCase().includes(q));
    })
    .sort((a, b) =>
      (a.category_name ?? '').localeCompare(b.category_name ?? '') ||
      a.name.localeCompare(b.name)
    );
  const selectedMoveVariants = moveVariants.filter(v => selectedMoveVariantIds.includes(v.id));
  const canMoveSelected =
    !!moveProduct &&
    !!moveTargetProductId &&
    selectedMoveVariantIds.length > 0 &&
    selectedMoveVariantIds.length < moveVariants.length &&
    !moveVariantsMutation.isPending;

  return (
    <div className="p-8 animate-fade-up">
      <div className="flex items-start justify-between gap-4 mb-7">
        <div>
          <span className="eyebrow-accent mb-3 flex w-fit">{t('sidebar.groupStock')}</span>
          <h2 className="page-title">{t('products.title')}</h2>
          <p className="page-subtitle">
            {t('products.subtitle')}
          </p>
        </div>
        <button onClick={onAddProduct} className="btn-primary shrink-0">
          <Plus size={16} strokeWidth={2} /> {t('products.addProduct')}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-5 mb-6">
        <div className="card px-5 py-4">
          <p className="eyebrow">{t('products.totalProducts')}</p>
          <p className="text-[22px] font-semibold tracking-[-0.01em] text-text-primary mt-1 tabular-nums">{products?.length ?? 0}</p>
        </div>
        <div className="card px-5 py-4">
          <p className="eyebrow">{t('products.categories')}</p>
          <p className="text-[22px] font-semibold tracking-[-0.01em] text-text-primary mt-1 tabular-nums">{categories?.length ?? 0}</p>
        </div>
      </div>

      <ProductFilter
        filters={filters}
        onChange={updateFilters}
        onClear={clearFilters}
        categories={categories ?? []}
      />

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border-light bg-surface/60">
                <SortHeader label={t('products.product')} align="left" padding="px-5" onSort={() => toggleSort('name')} />
                <SortHeader label={t('common.category')} align="left" padding="px-4" onSort={() => toggleSort('category_name')} />
                <th className="text-left py-3 px-4 text-text-muted font-semibold text-[13px] uppercase tracking-[0.06em]">{t('products.variants')}</th>
                <SortHeader label={t('products.stock')} align="right" padding="px-4" onSort={() => toggleSort('quantity')} />
                <SortHeader label={t('common.cost')} align="right" padding="px-4" onSort={() => toggleSort('cost_price')} />
                <SortHeader label={t('common.price')} align="right" padding="px-4" onSort={() => toggleSort('selling_price')} />
                <th className="text-right py-3 px-5 text-text-muted font-semibold text-[13px] uppercase tracking-[0.06em]">{t('products.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="py-16 text-center text-text-muted">{t('products.loading')}</td></tr>
              ) : filteredProducts.length === 0 ? (
                <tr><td colSpan={7} className="py-14">
                  <div className="flex flex-col items-center text-center">
                    <div className="w-12 h-12 rounded-2xl bg-surface flex items-center justify-center mb-3">
                      <PackagePlus size={22} className="text-text-muted" />
                    </div>
                    <p className="text-[14px] font-medium text-text-primary">{t('products.noProducts')}</p>
                    <button onClick={onAddProduct} className="btn-secondary mt-4 px-4 py-2 text-[13px]">
                      <Plus size={14} strokeWidth={2} /> {t('products.addProduct')}
                    </button>
                  </div>
                </td></tr>
              ) : (
                filteredProducts.flatMap((p) => {
                  const isExpanded = expandedProductId === p.id;
                  const soldOut = p.quantity <= 0;
                  return [
                    <tr key={p.id} className={`border-b border-border-light last:border-0 hover:bg-surface transition-colors ${isExpanded ? 'bg-surface' : ''}`}>
                      <td className="py-3 px-5 font-medium text-text-primary">
                        <button
                          onClick={() => setExpandedProductId(isExpanded ? null : p.id)}
                          aria-expanded={isExpanded}
                          className="flex items-center gap-2 text-left group rounded-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30"
                        >
                          {isExpanded
                            ? <ChevronUp size={14} className="text-text-muted flex-shrink-0" />
                            : <ChevronDown size={14} className="text-text-muted flex-shrink-0" />}
                          <span className="group-hover:text-navy transition-colors">{p.name}</span>
                        </button>
                      </td>
                      <td className="py-3 px-4 text-text-secondary">{p.category_name ?? <span className="text-text-muted italic">{t('products.noCategory')}</span>}</td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1.5 text-text-secondary tabular-nums">
                          <Layers size={12} className="text-text-muted" />
                          {p.variant_count}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {/* Neutral stock badge — color only signals sold-out, not a threshold. */}
                        <span className={`badge tabular-nums ${
                          soldOut
                            ? 'bg-accent-red/10 text-accent-red'
                            : 'bg-surface text-text-secondary'
                        }`}>
                          {p.quantity}
                        </span>
                      </td>
                      {/* Cost is a "from" aggregate (min across variants). */}
                      <td className="whitespace-nowrap py-3 px-4 text-right text-text-secondary tabular-nums">
                        {p.variant_count > 1 && <span className="text-text-muted text-[13px]">{t('products.fromPrefix')} </span>}
                        {p.cost_price.toFixed(2)}&lrm; DA
                      </td>
                      {/* Price is now a "from" aggregate across variants. */}
                      <td className="whitespace-nowrap py-3 px-4 text-right font-semibold text-text-primary tabular-nums">
                        {p.variant_count > 1 && <span className="text-text-muted text-[13px] font-normal">{t('products.fromPrefix')} </span>}
                        {p.selling_price.toFixed(2)}&lrm; DA
                      </td>
                      <td className="py-3 px-5">
                        <div className="flex items-center justify-end gap-0.5">
                          <button onClick={() => openStock(p)} aria-label={t('products.addStock')} title={t('products.addStock')}
                            className="p-1.5 rounded-lg text-accent-green hover:bg-accent-green/10 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30">
                            <PackagePlus size={15} />
                          </button>
                          <button onClick={() => onEditProduct(p)} aria-label={t('common.edit')} title={t('common.edit')}
                            className="p-1.5 rounded-lg text-accent-blue hover:bg-accent-blue/10 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30">
                            <Edit3 size={15} />
                          </button>
                          <button onClick={() => openMoveVariants(p)} aria-label={t('products.moveVariants')} title={t('products.moveVariants')}
                            className="p-1.5 rounded-lg text-text-muted hover:bg-surface hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30">
                            <MoveRight size={15} />
                          </button>
                          <button onClick={() => setDeleteTarget(p)} aria-label={t('common.delete')} title={t('common.delete')}
                            className="p-1.5 rounded-lg text-accent-red hover:bg-accent-red/10 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30">
                            <Trash2 size={15} />
                          </button>
                          {p.barcode && (
                            <button onClick={() => { setBarcodeProduct(p); setBarcodeVariantName(null); }} aria-label={t('barcode.print')} title={t('barcode.print')}
                              className="p-1.5 rounded-lg text-text-muted hover:bg-surface hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30">
                              <ScanBarcode size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>,
                    // Expanded sub-row: lists each variant with its stock and
                    // inline actions (print barcode for that variant, delete the
                    // variant without opening the product editor).
                    isExpanded && (
                      <tr key={`${p.id}-variants`} className="border-b border-border-light last:border-0 bg-surface">
                        <td colSpan={7} className="px-5 py-4">
                          {expandedVariants === undefined ? (
                            <p className="text-[13px] text-text-muted py-2">{t('products.loadingVariants')}</p>
                          ) : expandedVariants.length === 0 ? (
                            <p className="text-[13px] text-text-muted py-2">{t('products.noVariants')}</p>
                          ) : (
                            <div className="rounded-xl border border-border bg-card overflow-hidden">
                              <table className="w-full text-[13px]">
                                <thead>
                                  <tr className="border-b border-border-light">
                                    <th className="text-left py-2.5 px-4 text-text-muted font-semibold text-[10.5px] uppercase tracking-[0.06em]">{t('products.variant')}</th>
                                    <th className="text-right py-2.5 px-4 text-text-muted font-semibold text-[10.5px] uppercase tracking-[0.06em]">{t('products.stock')}</th>
                                    <th className="text-right py-2.5 px-4 text-text-muted font-semibold text-[10.5px] uppercase tracking-[0.06em]">{t('common.cost')}</th>
                                    <th className="text-right py-2.5 px-4 text-text-muted font-semibold text-[10.5px] uppercase tracking-[0.06em]">{t('common.price')}</th>
                                    <th className="text-right py-2.5 px-4 text-text-muted font-semibold text-[10.5px] uppercase tracking-[0.06em]">{t('products.actions')}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {expandedVariants.map(v => (
                                    <tr key={v.id} className="border-b border-border-light last:border-0 hover:bg-surface transition-colors">
                                      <td className="py-2.5 px-4">
                                        <div className="flex items-center gap-2">
                                          <Layers size={12} className="text-accent-blue flex-shrink-0" />
                                          <span className="text-text-primary font-medium">{v.variant_name}</span>
                                          {v.condition_note && <span className="text-text-muted text-[13px]">· {v.condition_note}</span>}
                                        </div>
                                      </td>
                                      <td className="py-2.5 px-4 text-right text-text-secondary tabular-nums">{v.quantity}</td>
                                      <td className="py-2.5 px-4 text-right text-text-muted tabular-nums">{v.cost_price.toFixed(2)}&lrm; DA</td>
                                      <td className="py-2.5 px-4 text-right font-semibold text-text-primary tabular-nums">{v.selling_price.toFixed(2)}&lrm; DA</td>
                                      <td className="py-2.5 px-4">
                                        <div className="flex items-center justify-end gap-0.5">
                                          {v.barcode && (
                                            <button onClick={() => printVariantBarcode(p, v)} aria-label={t('products.printVariantBarcode')} title={t('products.printVariantBarcode')}
                                              className="p-1.5 rounded-lg text-text-muted hover:bg-surface hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30">
                                              <ScanBarcode size={14} />
                                            </button>
                                          )}
                                          <button
                                            onClick={() => setDeleteVariantTarget(v)}
                                            disabled={expandedVariants.length <= 1}
                                            aria-label={expandedVariants.length <= 1 ? t('products.cantDeleteLastVariant') : t('products.deleteVariant')}
                                            className="p-1.5 rounded-lg text-accent-red hover:bg-accent-red/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30"
                                            title={expandedVariants.length <= 1 ? t('products.cantDeleteLastVariant') : t('products.deleteVariant')}
                                          >
                                            <Trash2 size={14} />
                                          </button>
                                          <button
                                            onClick={() => openMoveVariants(p)}
                                            aria-label={t('products.moveVariants')} title={t('products.moveVariants')}
                                            className="p-1.5 rounded-lg text-text-muted hover:bg-surface hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30"
                                          >
                                            <MoveRight size={14} />
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    ),
                  ];
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showStock && stockProduct && (
        <ModalOverlay onClose={() => setShowStock(false)}>
          <div className="bg-card rounded-2xl w-full max-w-md shadow-raised border border-border overflow-hidden">
            <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-border-light">
              <div>
                <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-text-primary">{t('products.addStock')}</h3>
                <p className="text-[13px] text-text-secondary mt-0.5 tabular-nums">{t('products.stockTotal', { name: stockProduct.name, count: stockProduct.quantity })}</p>
              </div>
              <button onClick={() => setShowStock(false)} aria-label={t('common.close')}
                className="p-1.5 rounded-lg text-text-muted hover:bg-surface hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddStock} className="p-6 space-y-4">
              {/* Stock is per variant — let the merchant pick which one to restock. */}
              <Field label={t('products.variant')} required>
                {stockVariants.length === 0 ? (
                  <p className="text-[13px] text-text-muted py-2.5">{t('products.loadingVariants')}</p>
                ) : (
                  <select
                    value={stockVariantId ?? ''}
                    onChange={(e) => setStockVariantId(e.target.value ? Number(e.target.value) : null)}
                    className="form-input"
                  >
                    {stockVariants.map(v => (
                      <option key={v.id} value={v.id}>
                        {t('products.variantStockOption', { name: v.variant_name, count: v.quantity, cost: v.cost_price.toFixed(2) })}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label={t('products.quantityToAdd')} required>
                <input type="number" required min="1" value={stockForm.quantity} onChange={(e) => setStockForm({...stockForm, quantity: e.target.value})}
                  className="form-input tabular-nums" placeholder="0" autoFocus />
              </Field>
              <Field label={t('products.unitCost')}>
                <input type="number" step="0.01" value={stockForm.unit_cost} onChange={(e) => setStockForm({...stockForm, unit_cost: e.target.value})}
                  className="form-input tabular-nums" placeholder={t('products.defaultCost', { amount: (stockVariants.find(v => v.id === stockVariantId)?.cost_price ?? stockProduct.cost_price).toFixed(2) })} />
              </Field>
              <Field label={t('common.notes')}>
                <input type="text" value={stockForm.notes} onChange={(e) => setStockForm({...stockForm, notes: e.target.value})}
                  className="form-input" placeholder={t('products.optionalNote')} />
              </Field>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowStock(false)} className="btn-secondary flex-1">{t('common.cancel')}</button>
                <button type="submit" disabled={!stockVariantId} className="btn-primary flex-1">
                  {t('products.addStock')}
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}

      {moveProduct && (
        <ModalOverlay onClose={() => !moveVariantsMutation.isPending && setMoveProduct(null)}>
          <div className="bg-card rounded-2xl w-full max-w-2xl shadow-raised border border-border overflow-hidden">
            <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-border-light">
              <div>
                <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-text-primary">{t('products.moveVariants')}</h3>
                <p className="text-[13px] text-text-secondary mt-0.5">
                  {t('products.moveFrom', { name: moveProduct.name, category: moveProduct.category_name ?? t('checkout.uncategorized') })}
                </p>
              </div>
              <button
                onClick={() => setMoveProduct(null)}
                disabled={moveVariantsMutation.isPending}
                aria-label={t('common.close')}
                className="p-1.5 rounded-lg text-text-muted hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <h4 className="eyebrow mb-2">{t('products.selectVariants')}</h4>
                <div className="rounded-xl border border-border overflow-hidden max-h-[300px] overflow-y-auto">
                  {loadingMoveVariants ? (
                    <p className="px-4 py-8 text-center text-[13px] text-text-muted">{t('products.loadingVariants')}</p>
                  ) : moveVariants.length === 0 ? (
                    <p className="px-4 py-8 text-center text-[13px] text-text-muted">{t('products.noVariantsFound')}</p>
                  ) : (
                    moveVariants.map(v => {
                      const checked = selectedMoveVariantIds.includes(v.id);
                      const disabled = moveVariants.length <= 1;
                      return (
                        <label
                          key={v.id}
                          className={`flex items-start gap-3 px-4 py-3 border-b border-border-light last:border-0 transition-colors ${disabled ? 'opacity-50' : 'cursor-pointer hover:bg-surface'}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={e => {
                              setSelectedMoveVariantIds(ids =>
                                e.target.checked
                                  ? [...ids, v.id]
                                  : ids.filter(id => id !== v.id)
                              );
                            }}
                            className="mt-1 accent-navy"
                          />
                          <span className="min-w-0">
                            <span className="block text-[13px] font-medium text-text-primary">{v.variant_name}</span>
                            <span className="block text-[13px] text-text-secondary mt-0.5 tabular-nums">
                              {t('products.variantStockPrice', { count: v.quantity, price: v.selling_price.toFixed(2) })}
                              {v.barcode ? ` · ${v.barcode}` : ''}
                            </span>
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
                {moveVariants.length <= 1 && !loadingMoveVariants && (
                  <p className="text-[13px] text-text-muted mt-2 leading-relaxed">
                    {t('products.keepOneVariant')}
                  </p>
                )}
              </div>

              <div>
                <h4 className="eyebrow mb-2">{t('products.destinationProduct')}</h4>
                <div className="relative mb-2">
                  <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                  <input
                    value={moveSearch}
                    onChange={e => setMoveSearch(e.target.value)}
                    placeholder={t('products.moveSearchPlaceholder')}
                    className="form-input pl-9 py-2 text-[13px]"
                  />
                </div>
                <div className="rounded-xl border border-border overflow-hidden max-h-[255px] overflow-y-auto">
                  {moveTargetOptions.length === 0 ? (
                    <p className="px-4 py-8 text-center text-[13px] text-text-muted">{t('products.noDestinationProducts')}</p>
                  ) : (
                    moveTargetOptions.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={moveTargetProductId === p.id}
                        onClick={() => setMoveTargetProductId(p.id)}
                        className={`w-full text-left px-4 py-3 border-b border-border-light last:border-0 transition-colors focus-visible:outline-none focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-navy/30 ${
                          moveTargetProductId === p.id
                            ? 'bg-navy/10 text-text-primary'
                            : 'hover:bg-surface text-text-secondary'
                        }`}
                      >
                        <span className="block text-[13px] font-medium text-text-primary">{p.name}</span>
                        <span className="block text-[13px] text-text-muted mt-0.5">
                          {t('products.categoryVariantCount', { category: p.category_name ?? t('checkout.uncategorized'), count: p.variant_count })}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-border-light bg-surface flex items-center justify-between gap-4">
              <p className="text-[13px] text-text-secondary">
                {selectedMoveVariants.length > 0
                  ? t('products.variantsSelected', { count: selectedMoveVariants.length })
                  : t('products.selectAtLeastOneVariant')}
              </p>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setMoveProduct(null)}
                  disabled={moveVariantsMutation.isPending}
                  className="btn-secondary px-4 py-2 text-[13px]"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  disabled={!canMoveSelected}
                  onClick={() => moveTargetProductId && moveVariantsMutation.mutate({
                    variantIds: selectedMoveVariantIds,
                    targetProductId: moveTargetProductId,
                  })}
                  className="btn-primary px-4 py-2 text-[13px]"
                >
                  <MoveRight size={14} />
                  {moveVariantsMutation.isPending ? t('products.moving') : t('products.moveVariants')}
                </button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {barcodeProduct && barcodeProduct.barcode && (
        <BarcodePrintModal
          barcode={barcodeProduct.barcode}
          productName={barcodeProduct.name}
          productId={barcodeProduct.id}
          variantName={barcodeVariantName}
          sku={barcodeProduct.sku ?? null}
          price={barcodeProduct.selling_price}
          onClose={() => { setBarcodeProduct(null); setBarcodeVariantName(null); }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        variant="danger"
        title={t('common.delete')}
        description={t('products.deleteConfirm', { name: deleteTarget?.name ?? '' })}
        confirmLabel={t('common.delete')}
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteVariantTarget}
        variant="danger"
        title={t('products.deleteVariant')}
        description={t('products.deleteVariantConfirm', { name: deleteVariantTarget?.variant_name ?? '' })}
        confirmLabel={t('common.delete')}
        loading={deleteVariantMutation.isPending}
        onConfirm={() => deleteVariantTarget && deleteVariantMutation.mutate(deleteVariantTarget.id)}
        onCancel={() => setDeleteVariantTarget(null)}
      />
    </div>
  );
}

function SortHeader({ label, align, padding, onSort }: {
  label: string; align: 'left' | 'right'; padding: string; onSort: () => void;
}) {
  return (
    <th className={`p-0 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={onSort}
        className={`w-full flex items-center gap-1.5 ${padding} py-3 text-[13px] font-semibold uppercase tracking-[0.06em] text-text-muted hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:text-navy ${align === 'right' ? 'justify-end' : ''}`}
      >
        {label} <ArrowUpDown size={11} />
      </button>
    </th>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-text-secondary mb-1.5">
        {label}{required && <span className="text-accent-red ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import type { Product, Category, CreateInventoryTransaction, ProductVariant } from '../lib/types';
import CustomSelect from '../components/CustomSelect';
import BarcodePrintModal from '../components/BarcodePrintModal';
import ConfirmDialog from '../components/ConfirmDialog';
import { useI18n } from '../i18n';
import {
  Search, Plus, Edit3, Trash2, PackagePlus, X,
  ArrowUpDown, ScanBarcode, Layers, ChevronDown, ChevronUp, MoveRight,
} from 'lucide-react';

const PRODUCT_CATEGORY_FILTER_KEY = 'houshop.products.categoryFilter';

type ProductSortField = 'name' | 'category_name' | 'quantity' | 'cost_price' | 'selling_price';

function loadSavedCategoryFilter(): number | null {
  try {
    const raw = localStorage.getItem(PRODUCT_CATEGORY_FILTER_KEY);
    if (!raw) return null;
    const id = Number(raw);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

interface ProductsProps {
  onAddProduct: () => void;
  onEditProduct: (product: Product) => void;
}

export default function Products({ onAddProduct, onEditProduct }: ProductsProps) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<number | null>(loadSavedCategoryFilter);
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
    queryKey: ['products', search],
    queryFn: () => search
      ? invoke<Product[]>('search_products', { query: search })
      : invoke<Product[]>('get_products'),
  });
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => invoke<Category[]>('get_categories'),
  });

  useEffect(() => {
    try {
      if (categoryFilter == null) localStorage.removeItem(PRODUCT_CATEGORY_FILTER_KEY);
      else localStorage.setItem(PRODUCT_CATEGORY_FILTER_KEY, String(categoryFilter));
    } catch {
      // Non-critical: filtering still works even if storage is unavailable.
    }
  }, [categoryFilter]);

  useEffect(() => {
    if (categoryFilter == null || !categories) return;
    if (!categories.some(c => c.id === categoryFilter)) setCategoryFilter(null);
  }, [categories, categoryFilter]);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => invoke('delete_product', { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
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
      setDeleteVariantTarget(null);
      toast.success('Variant deleted');
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
      setMoveProduct(null);
      setMoveVariants([]);
      setSelectedMoveVariantIds([]);
      setMoveTargetProductId(null);
      setMoveSearch('');
      toast.success('Variants moved');
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
    .filter(p => categoryFilter === null || p.category_id === categoryFilter)
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
    <div className="p-8">
      <div className="flex items-start justify-between mb-7">
        <div>
          <h2 className="text-[26px] font-bold text-text-primary leading-tight">{t('products.title')}</h2>
          <p className="text-[14px] text-text-secondary mt-1.5">
            {t('products.subtitle')}
          </p>
        </div>
        <button onClick={onAddProduct} className="flex items-center gap-2 px-5 py-2.5 bg-navy text-white rounded-lg text-[13px] font-medium hover:bg-navy-light transition-colors">
          <Plus size={16} strokeWidth={2} /> {t('products.addProduct')}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-5 mb-6">
        <div className="card px-5 py-3.5">
          <p className="text-[10.5px] font-semibold text-text-muted tracking-[0.08em] uppercase">Total Products</p>
          <p className="text-[20px] font-bold text-text-primary mt-0.5">{products?.length ?? 0}</p>
        </div>
        <div className="card px-5 py-3.5">
          <p className="text-[10.5px] font-semibold text-text-muted tracking-[0.08em] uppercase">Categories</p>
          <p className="text-[20px] font-bold text-text-primary mt-0.5">{categories?.length ?? 0}</p>
        </div>
      </div>

      <div className="card px-4 py-3 mb-5 flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder={t('products.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-border text-[13px] focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy/30 placeholder:text-text-muted bg-surface"
          />
        </div>
        <CustomSelect
          value={categoryFilter != null ? String(categoryFilter) : ''}
          onChange={(v) => setCategoryFilter(v ? Number(v) : null)}
          options={[{ value: '', label: t('common.allCategories') }, ...(categories ?? []).map(c => ({ value: String(c.id), label: c.name }))]}
          size="sm"
          className="w-[180px]"
        />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-sidebar/50">
                <th className="text-left py-3 px-5 text-text-muted font-semibold text-[11px] uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort('name')}>
                  <span className="flex items-center gap-1.5">Product <ArrowUpDown size={11} /></span>
                </th>
                <th className="text-left py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort('category_name')}>
                  <span className="flex items-center gap-1.5">Category <ArrowUpDown size={11} /></span>
                </th>
                <th className="text-left py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">Variants</th>
                <th className="text-right py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort('quantity')}>
                  <span className="flex items-center justify-end gap-1.5">Stock <ArrowUpDown size={11} /></span>
                </th>
                <th className="text-right py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort('cost_price')}>
                  <span className="flex items-center justify-end gap-1.5">Cost <ArrowUpDown size={11} /></span>
                </th>
                <th className="text-right py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort('selling_price')}>
                  <span className="flex items-center justify-end gap-1.5">Price <ArrowUpDown size={11} /></span>
                </th>
                <th className="text-right py-3 px-5 text-text-muted font-semibold text-[11px] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="py-16 text-center text-text-muted">Loading products...</td></tr>
              ) : filteredProducts.length === 0 ? (
                <tr><td colSpan={7} className="py-16 text-center text-text-muted">
                  <PackagePlus size={32} className="mx-auto mb-2 opacity-30" />
                  No products found
                </td></tr>
              ) : (
                filteredProducts.flatMap((p) => {
                  const isExpanded = expandedProductId === p.id;
                  const soldOut = p.quantity <= 0;
                  return [
                    <tr key={p.id} className={`border-b border-border-light hover:bg-sidebar/30 transition-colors ${isExpanded ? 'bg-sidebar/30' : ''}`}>
                      <td className="py-3 px-5 font-medium text-text-primary">
                        <button
                          onClick={() => setExpandedProductId(isExpanded ? null : p.id)}
                          className="flex items-center gap-2 text-left group"
                        >
                          {isExpanded
                            ? <ChevronUp size={14} className="text-text-muted flex-shrink-0" />
                            : <ChevronDown size={14} className="text-text-muted flex-shrink-0" />}
                          <span className="group-hover:text-navy transition-colors">{p.name}</span>
                        </button>
                      </td>
                      <td className="py-3 px-4 text-text-secondary">{p.category_name ?? <span className="text-text-muted italic">None</span>}</td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1 text-text-secondary">
                          <Layers size={12} className="text-text-muted" />
                          {p.variant_count}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {/* Neutral stock badge — color only signals sold-out, not a threshold. */}
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          soldOut
                            ? 'bg-red-50 text-accent-red border border-red-200'
                            : 'bg-surface text-text-secondary border border-border'
                        }`}>
                          {p.quantity}
                        </span>
                      </td>
                      {/* Cost is a "from" aggregate (min across variants). */}
                      <td className="py-3 px-4 text-right text-text-secondary">
                        {p.variant_count > 1 && <span className="text-text-muted text-[11px] font-normal">from </span>}
                        {p.cost_price.toFixed(2)} DA
                      </td>
                      {/* Price is now a "from" aggregate across variants. */}
                      <td className="py-3 px-4 text-right font-semibold text-text-primary">
                        {p.variant_count > 1 && <span className="text-text-muted text-[11px] font-normal">from </span>}
                        {p.selling_price.toFixed(2)} DA
                      </td>
                      <td className="py-3 px-5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openStock(p)}
                            className="p-1.5 rounded-md text-accent-green hover:bg-green-50 transition-colors" title="Add Stock">
                            <PackagePlus size={15} />
                          </button>
                          <button onClick={() => onEditProduct(p)}
                            className="p-1.5 rounded-md text-accent-blue hover:bg-blue-50 transition-colors" title="Edit">
                            <Edit3 size={15} />
                          </button>
                          <button onClick={() => openMoveVariants(p)}
                            className="p-1.5 rounded-md text-text-muted hover:bg-surface transition-colors" title="Move variants">
                            <MoveRight size={15} />
                          </button>
                          <button onClick={() => setDeleteTarget(p)}
                            className="p-1.5 rounded-md text-accent-red hover:bg-red-50 transition-colors" title="Delete">
                            <Trash2 size={15} />
                          </button>
                          {p.barcode && (
                            <button onClick={() => { setBarcodeProduct(p); setBarcodeVariantName(null); }}
                              className="p-1.5 rounded-md text-text-muted hover:bg-surface transition-colors" title="Print Barcode">
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
                      <tr key={`${p.id}-variants`} className="border-b border-border-light bg-surface/40">
                        <td colSpan={7} className="px-5 py-3">
                          {expandedVariants === undefined ? (
                            <p className="text-[12px] text-text-muted py-2">Loading variants…</p>
                          ) : expandedVariants.length === 0 ? (
                            <p className="text-[12px] text-text-muted py-2">No variants.</p>
                          ) : (
                            <div className="rounded-lg border border-border overflow-hidden">
                              <table className="w-full text-[12px]">
                                <thead>
                                  <tr className="bg-card border-b border-border">
                                    <th className="text-left py-2 px-4 text-text-muted font-semibold text-[10px] uppercase tracking-wider">Variant</th>
                                    <th className="text-right py-2 px-4 text-text-muted font-semibold text-[10px] uppercase tracking-wider">Stock</th>
                                    <th className="text-right py-2 px-4 text-text-muted font-semibold text-[10px] uppercase tracking-wider">Cost</th>
                                    <th className="text-right py-2 px-4 text-text-muted font-semibold text-[10px] uppercase tracking-wider">Price</th>
                                    <th className="text-right py-2 px-4 text-text-muted font-semibold text-[10px] uppercase tracking-wider">Actions</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {expandedVariants.map(v => (
                                    <tr key={v.id} className="border-b border-border-light last:border-0 bg-card">
                                      <td className="py-2 px-4">
                                        <div className="flex items-center gap-2">
                                          <Layers size={12} className="text-accent-blue flex-shrink-0" />
                                          <span className="text-text-primary font-medium">{v.variant_name}</span>
                                          {v.condition_note && <span className="text-text-muted text-[11px]">· {v.condition_note}</span>}
                                        </div>
                                      </td>
                                      <td className="py-2 px-4 text-right text-text-secondary">{v.quantity}</td>
                                      <td className="py-2 px-4 text-right text-text-muted">{v.cost_price.toFixed(2)} DA</td>
                                      <td className="py-2 px-4 text-right font-semibold text-text-primary">{v.selling_price.toFixed(2)} DA</td>
                                      <td className="py-2 px-4">
                                        <div className="flex items-center justify-end gap-1">
                                          {v.barcode && (
                                            <button onClick={() => printVariantBarcode(p, v)}
                                              className="p-1.5 rounded-md text-text-muted hover:bg-surface transition-colors" title="Print this variant's barcode">
                                              <ScanBarcode size={14} />
                                            </button>
                                          )}
                                          <button
                                            onClick={() => setDeleteVariantTarget(v)}
                                            disabled={expandedVariants.length <= 1}
                                            className="p-1.5 rounded-md text-accent-red hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                            title={expandedVariants.length <= 1 ? "Can't delete the last variant" : 'Delete variant'}
                                          >
                                            <Trash2 size={14} />
                                          </button>
                                          <button
                                            onClick={() => openMoveVariants(p)}
                                            className="p-1.5 rounded-md text-text-muted hover:bg-surface transition-colors"
                                            title="Move variants"
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
          <div className="bg-card rounded-2xl w-full max-w-md shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <h3 className="text-[16px] font-bold text-text-primary">Add Stock</h3>
                <p className="text-[12px] text-text-secondary mt-0.5">{stockProduct.name} · Total: {stockProduct.quantity} units</p>
              </div>
              <button onClick={() => setShowStock(false)} className="p-1 rounded-lg hover:bg-surface transition-colors"><X size={18} /></button>
            </div>
            <form onSubmit={handleAddStock} className="p-6 space-y-4">
              {/* Stock is per variant — let the merchant pick which one to restock. */}
              <Field label="Variant" required>
                {stockVariants.length === 0 ? (
                  <p className="text-[12px] text-text-muted">Loading variants…</p>
                ) : (
                  <select
                    value={stockVariantId ?? ''}
                    onChange={(e) => setStockVariantId(e.target.value ? Number(e.target.value) : null)}
                    className="form-input"
                  >
                    {stockVariants.map(v => (
                      <option key={v.id} value={v.id}>
                        {v.variant_name} · {v.quantity} in stock · cost {v.cost_price.toFixed(2)} DA
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Quantity to Add" required>
                <input type="number" required min="1" value={stockForm.quantity} onChange={(e) => setStockForm({...stockForm, quantity: e.target.value})}
                  className="form-input" placeholder="0" autoFocus />
              </Field>
              <Field label="Unit Cost (DA)">
                <input type="number" step="0.01" value={stockForm.unit_cost} onChange={(e) => setStockForm({...stockForm, unit_cost: e.target.value})}
                  className="form-input" placeholder={`Default: ${(stockVariants.find(v => v.id === stockVariantId)?.cost_price ?? stockProduct.cost_price).toFixed(2)} DA`} />
              </Field>
              <Field label="Notes">
                <input type="text" value={stockForm.notes} onChange={(e) => setStockForm({...stockForm, notes: e.target.value})}
                  className="form-input" placeholder="Optional note" />
              </Field>
              <div className="flex gap-3 pt-3">
                <button type="button" onClick={() => setShowStock(false)}
                  className="flex-1 py-2.5 rounded-lg border border-border text-[13px] font-medium text-text-secondary hover:bg-surface transition-colors">Cancel</button>
                <button type="submit" disabled={!stockVariantId}
                  className="flex-1 py-2.5 rounded-lg bg-accent-green text-white text-[13px] font-medium hover:opacity-90 disabled:opacity-50 transition-colors">
                  Add Stock
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}

      {moveProduct && (
        <ModalOverlay onClose={() => !moveVariantsMutation.isPending && setMoveProduct(null)}>
          <div className="bg-card rounded-2xl w-full max-w-2xl shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <h3 className="text-[16px] font-bold text-text-primary">Move variants</h3>
                <p className="text-[12px] text-text-secondary mt-0.5">
                  From {moveProduct.name} · {moveProduct.category_name ?? 'Uncategorized'}
                </p>
              </div>
              <button
                onClick={() => setMoveProduct(null)}
                disabled={moveVariantsMutation.isPending}
                className="p-1 rounded-lg hover:bg-surface transition-colors disabled:opacity-50"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted mb-2">Select variants</h4>
                <div className="rounded-xl border border-border overflow-hidden max-h-[300px] overflow-y-auto">
                  {loadingMoveVariants ? (
                    <p className="px-4 py-8 text-center text-[12px] text-text-muted">Loading variants…</p>
                  ) : moveVariants.length === 0 ? (
                    <p className="px-4 py-8 text-center text-[12px] text-text-muted">No variants found.</p>
                  ) : (
                    moveVariants.map(v => {
                      const checked = selectedMoveVariantIds.includes(v.id);
                      const disabled = moveVariants.length <= 1;
                      return (
                        <label
                          key={v.id}
                          className={`flex items-start gap-3 px-4 py-3 border-b border-border-light last:border-0 ${disabled ? 'opacity-50' : 'cursor-pointer hover:bg-surface/60'}`}
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
                            <span className="block text-[11.5px] text-text-secondary mt-0.5">
                              {v.quantity} stock · {v.selling_price.toFixed(2)} DA
                              {v.barcode ? ` · ${v.barcode}` : ''}
                            </span>
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
                {moveVariants.length <= 1 && !loadingMoveVariants && (
                  <p className="text-[11.5px] text-text-muted mt-2">
                    A product must keep at least one variant. Edit the product category if the whole product is misplaced.
                  </p>
                )}
              </div>

              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted mb-2">Destination product</h4>
                <div className="relative mb-2">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    value={moveSearch}
                    onChange={e => setMoveSearch(e.target.value)}
                    placeholder="Search product, category, SKU, barcode..."
                    className="w-full pl-8 pr-3 py-2 rounded-lg border border-border text-[12.5px] bg-surface focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy/30"
                  />
                </div>
                <div className="rounded-xl border border-border overflow-hidden max-h-[255px] overflow-y-auto">
                  {moveTargetOptions.length === 0 ? (
                    <p className="px-4 py-8 text-center text-[12px] text-text-muted">No destination products found.</p>
                  ) : (
                    moveTargetOptions.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setMoveTargetProductId(p.id)}
                        className={`w-full text-left px-4 py-3 border-b border-border-light last:border-0 transition-colors ${
                          moveTargetProductId === p.id
                            ? 'bg-navy/[0.08] text-text-primary'
                            : 'hover:bg-surface/60 text-text-secondary'
                        }`}
                      >
                        <span className="block text-[13px] font-medium text-text-primary">{p.name}</span>
                        <span className="block text-[11.5px] text-text-muted mt-0.5">
                          {p.category_name ?? 'Uncategorized'} · {p.variant_count} variants
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-border bg-surface/40 flex items-center justify-between gap-4">
              <p className="text-[12px] text-text-secondary">
                {selectedMoveVariants.length > 0
                  ? `${selectedMoveVariants.length} variant${selectedMoveVariants.length === 1 ? '' : 's'} selected`
                  : 'Select at least one variant'}
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setMoveProduct(null)}
                  disabled={moveVariantsMutation.isPending}
                  className="px-4 py-2 rounded-lg border border-border text-[13px] font-medium text-text-secondary hover:bg-card transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!canMoveSelected}
                  onClick={() => moveTargetProductId && moveVariantsMutation.mutate({
                    variantIds: selectedMoveVariantIds,
                    targetProductId: moveTargetProductId,
                  })}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-navy text-white text-[13px] font-medium hover:bg-navy-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <MoveRight size={14} />
                  {moveVariantsMutation.isPending ? 'Moving…' : 'Move variants'}
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
        title="Delete variant"
        description={`Delete variant "${deleteVariantTarget?.variant_name ?? ''}"? This cannot be undone.`}
        confirmLabel={t('common.delete')}
        loading={deleteVariantMutation.isPending}
        onConfirm={() => deleteVariantTarget && deleteVariantMutation.mutate(deleteVariantTarget.id)}
        onCancel={() => setDeleteVariantTarget(null)}
      />
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">
        {label}{required && <span className="text-accent-red ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-[2px] flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

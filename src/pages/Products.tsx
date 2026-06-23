import { useState } from 'react';
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
  ArrowUpDown, AlertCircle, ScanBarcode, Layers,
} from 'lucide-react';

interface ProductsProps {
  onAddProduct: () => void;
  onEditProduct: (product: Product) => void;
}

export default function Products({ onAddProduct, onEditProduct }: ProductsProps) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null);
  const [showStock, setShowStock] = useState(false);
  const [stockProduct, setStockProduct] = useState<Product | null>(null);
  const [sortField, setSortField] = useState<'name' | 'quantity' | 'selling_price'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [barcodeProduct, setBarcodeProduct] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);

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

  const deleteMutation = useMutation({
    mutationFn: (id: number) => invoke('delete_product', { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['low-stock'] });
      setDeleteTarget(null);
      toast.success(t('toast.productDeleted'));
    },
    onError: () => toast.error(t('toast.error')),
  });

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

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };
  const filteredProducts = (products ?? [])
    .filter(p => categoryFilter === null || p.category_id === categoryFilter)
    .sort((a, b) => {
      const mul = sortDir === 'asc' ? 1 : -1;
      if (sortField === 'name') return a.name.localeCompare(b.name) * mul;
      return ((a[sortField] as number) - (b[sortField] as number)) * mul;
    });
  // Header badge: count products whose aggregate quantity is at/below their
  // threshold (approximation of the backend's "any variant low" rule).
  const lowStockCount = (products ?? []).filter(p => p.quantity <= p.low_stock_threshold).length;

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

      <div className="grid grid-cols-3 gap-5 mb-6">
        <div className="card px-5 py-3.5">
          <p className="text-[10.5px] font-semibold text-text-muted tracking-[0.08em] uppercase">Total Products</p>
          <p className="text-[20px] font-bold text-text-primary mt-0.5">{products?.length ?? 0}</p>
        </div>
        <div className="card px-5 py-3.5">
          <p className="text-[10.5px] font-semibold text-text-muted tracking-[0.08em] uppercase">Categories</p>
          <p className="text-[20px] font-bold text-text-primary mt-0.5">{categories?.length ?? 0}</p>
        </div>
        <div className="card px-5 py-3.5">
          <p className="text-[10.5px] font-semibold text-text-muted tracking-[0.08em] uppercase">Low Stock Alerts</p>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-[20px] font-bold text-text-primary">{lowStockCount}</p>
            {lowStockCount > 0 && <AlertCircle size={16} className="text-accent-red" />}
          </div>
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
                <th className="text-left py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">Category</th>
                <th className="text-left py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">Variants</th>
                <th className="text-right py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort('quantity')}>
                  <span className="flex items-center justify-end gap-1.5">Stock <ArrowUpDown size={11} /></span>
                </th>
                <th className="text-right py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort('selling_price')}>
                  <span className="flex items-center justify-end gap-1.5">Price <ArrowUpDown size={11} /></span>
                </th>
                <th className="text-right py-3 px-5 text-text-muted font-semibold text-[11px] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="py-16 text-center text-text-muted">Loading products...</td></tr>
              ) : filteredProducts.length === 0 ? (
                <tr><td colSpan={6} className="py-16 text-center text-text-muted">
                  <PackagePlus size={32} className="mx-auto mb-2 opacity-30" />
                  No products found
                </td></tr>
              ) : (
                filteredProducts.map((p) => (
                  <tr key={p.id} className="border-b border-border-light hover:bg-sidebar/30 transition-colors">
                    <td className="py-3 px-5 font-medium text-text-primary">{p.name}</td>
                    <td className="py-3 px-4 text-text-secondary">{p.category_name ?? <span className="text-text-muted italic">None</span>}</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1 text-text-secondary">
                        <Layers size={12} className="text-text-muted" />
                        {p.variant_count}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        p.quantity <= p.low_stock_threshold
                          ? 'bg-red-50 text-accent-red border border-red-200'
                          : 'bg-green-50 text-accent-green border border-green-200'
                      }`}>
                        {p.quantity}
                      </span>
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
                        <button onClick={() => setDeleteTarget(p)}
                          className="p-1.5 rounded-md text-accent-red hover:bg-red-50 transition-colors" title="Delete">
                          <Trash2 size={15} />
                        </button>
                        {p.barcode && (
                          <button onClick={() => setBarcodeProduct(p)}
                            className="p-1.5 rounded-md text-text-muted hover:bg-surface transition-colors" title="Print Barcode">
                            <ScanBarcode size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
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

      {barcodeProduct && barcodeProduct.barcode && (
        <BarcodePrintModal
          barcode={barcodeProduct.barcode}
          productName={barcodeProduct.name}
          productId={barcodeProduct.id}
          sku={barcodeProduct.sku ?? null}
          price={barcodeProduct.selling_price}
          onClose={() => setBarcodeProduct(null)}
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

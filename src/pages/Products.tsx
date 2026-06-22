import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import type { Product, Category, CreateProduct, UpdateProduct, CreateInventoryTransaction } from '../lib/types';
import CustomSelect from '../components/CustomSelect';
import BarcodePrintModal from '../components/BarcodePrintModal';
import { useI18n } from '../i18n';
import {
  Search, Plus, Edit3, Trash2, PackagePlus, X,
  ChevronDown, ArrowUpDown, AlertCircle, ScanBarcode,
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
  const [showForm, setShowForm] = useState(false);
  const [showStock, setShowStock] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [stockProduct, setStockProduct] = useState<Product | null>(null);
  const [sortField, setSortField] = useState<'name' | 'quantity' | 'selling_price'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [barcodeProduct, setBarcodeProduct] = useState<Product | null>(null);
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
  const createMutation = useMutation({
    mutationFn: (data: CreateProduct) => invoke('create_product', { data }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] }); setShowForm(false); },
  });
  const updateMutation = useMutation({
    mutationFn: (data: UpdateProduct) => invoke('update_product', { data }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); setEditing(null); setShowForm(false); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => invoke('delete_product', { id }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] }); },
  });
  const addStockMutation = useMutation({
    mutationFn: (data: CreateInventoryTransaction) => invoke('add_stock', { data }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] }); setStockProduct(null); setShowStock(false); },
  });
  const [form, setForm] = useState({
    name: '', category_id: null as number | null, cost_price: '', selling_price: '',
    barcode: '', quantity: '', low_stock_threshold: '5',
  });
  const [stockForm, setStockForm] = useState({ quantity: '', unit_cost: '', notes: '' });
  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', category_id: null, cost_price: '', selling_price: '', barcode: '', quantity: '0', low_stock_threshold: '5' });
    setShowForm(true);
  };
  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      name: p.name, category_id: p.category_id, cost_price: p.cost_price.toString(),
      selling_price: p.selling_price.toString(), barcode: p.barcode ?? '',
      quantity: '0', low_stock_threshold: p.low_stock_threshold.toString(),
    });
    setShowForm(true);
  };
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editing) {
      updateMutation.mutate({
        id: editing.id, name: form.name, category_id: form.category_id,
        cost_price: parseFloat(form.cost_price) || 0, selling_price: parseFloat(form.selling_price) || 0,
        barcode: form.barcode || null, low_stock_threshold: parseInt(form.low_stock_threshold) || 5,
      });
    } else {
      createMutation.mutate({
        name: form.name, category_id: form.category_id,
        cost_price: parseFloat(form.cost_price) || 0, selling_price: parseFloat(form.selling_price) || 0,
        barcode: form.barcode || null, quantity: parseInt(form.quantity) || 0,
        low_stock_threshold: parseInt(form.low_stock_threshold) || 5,
      });
    }
  };
  const handleAddStock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockProduct) return;
    addStockMutation.mutate({
      product_id: stockProduct.id, quantity: parseInt(stockForm.quantity) || 0,
      unit_cost: parseFloat(stockForm.unit_cost) || stockProduct.cost_price,
      transaction_type: 'purchase', notes: stockForm.notes || null,
    });
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
  const lowStockCount = (products ?? []).filter(p => p.quantity <= p.low_stock_threshold).length;
  return (
    <div className="p-8">
      {}
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
      {}
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
      {}
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
      {}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-sidebar/50">
                <th className="text-left py-3 px-5 text-text-muted font-semibold text-[11px] uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort('name')}>
                  <span className="flex items-center gap-1.5">Product <ArrowUpDown size={11} /></span>
                </th>
                <th className="text-left py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">Category</th>
                <th className="text-right py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort('quantity')}>
                  <span className="flex items-center justify-end gap-1.5">Stock <ArrowUpDown size={11} /></span>
                </th>
                <th className="text-right py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">Cost</th>
                <th className="text-right py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort('selling_price')}>
                  <span className="flex items-center justify-end gap-1.5">Price <ArrowUpDown size={11} /></span>
                </th>
                <th className="text-left py-3 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">Barcode</th>
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
                filteredProducts.map((p) => (
                  <tr key={p.id} className="border-b border-border-light hover:bg-sidebar/30 transition-colors">
                    <td className="py-3 px-5 font-medium text-text-primary">{p.name}</td>
                    <td className="py-3 px-4 text-text-secondary">{p.category_name ?? <span className="text-text-muted italic">None</span>}</td>
                    <td className="py-3 px-4 text-right">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        p.quantity <= p.low_stock_threshold
                          ? 'bg-red-50 text-accent-red border border-red-200'
                          : 'bg-green-50 text-accent-green border border-green-200'
                      }`}>
                        {p.quantity}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-text-secondary">{p.cost_price.toFixed(2)} DA</td>
                    <td className="py-3 px-4 text-right font-semibold text-text-primary">{p.selling_price.toFixed(2)} DA</td>
                    <td className="py-3 px-4 font-mono text-[11.5px] text-text-muted">{p.barcode ?? '—'}</td>
                    <td className="py-3 px-5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => { setStockProduct(p); setShowStock(true); }}
                          className="p-1.5 rounded-md text-accent-green hover:bg-green-50 transition-colors" title="Add Stock">
                          <PackagePlus size={15} />
                        </button>
                        <button onClick={() => onEditProduct(p)}
                          className="p-1.5 rounded-md text-accent-blue hover:bg-blue-50 transition-colors" title="Edit">
                          <Edit3 size={15} />
                        </button>
                        <button onClick={() => { if (confirm(`Delete "${p.name}"?`)) deleteMutation.mutate(p.id); }}
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
      {}
      {showForm && (
        <ModalOverlay onClose={() => setShowForm(false)}>
          <div className="bg-card rounded-2xl w-full max-w-lg shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-[16px] font-bold text-text-primary">{editing ? 'Edit Product' : 'Add New Product'}</h3>
              <button onClick={() => setShowForm(false)} className="p-1 rounded-lg hover:bg-surface transition-colors"><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <Field label={t('products.productName')} required>
                <input type="text" required value={form.name} onChange={(e) => setForm({...form, name: e.target.value})}
                  className="form-input" placeholder={t('products.quickAdd')} />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label={t('common.category')}>
                  <CustomSelect
                    value={form.category_id != null ? String(form.category_id) : ''}
                    onChange={(v) => setForm({...form, category_id: v ? Number(v) : null})}
                    options={[{ value: '', label: t('common.selectCategory') }, ...(categories ?? []).map(c => ({ value: String(c.id), label: c.name }))]}
                    placeholder={t('common.selectCategory')}
                  />
                </Field>
                <Field label={t('products.barcode')}>
                  <input type="text" value={form.barcode} onChange={(e) => setForm({...form, barcode: e.target.value})}
                    className="form-input" placeholder="Optional" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label={t('products.costPrice')} required>
                  <input type="number" step="0.01" required value={form.cost_price} onChange={(e) => setForm({...form, cost_price: e.target.value})}
                    className="form-input" placeholder="0.00" />
                </Field>
                <Field label="Selling Price ($)" required>
                  <input type="number" step="0.01" required value={form.selling_price} onChange={(e) => setForm({...form, selling_price: e.target.value})}
                    className="form-input" placeholder="0.00" />
                </Field>
              </div>
              {!editing && (
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Initial Stock">
                    <input type="number" value={form.quantity} onChange={(e) => setForm({...form, quantity: e.target.value})}
                      className="form-input" />
                  </Field>
                  <Field label="Low Stock Alert At">
                    <input type="number" value={form.low_stock_threshold} onChange={(e) => setForm({...form, low_stock_threshold: e.target.value})}
                      className="form-input" />
                  </Field>
                </div>
              )}
              {editing && (
                <Field label="Low Stock Alert At">
                  <input type="number" value={form.low_stock_threshold} onChange={(e) => setForm({...form, low_stock_threshold: e.target.value})}
                    className="form-input" />
                </Field>
              )}
              <div className="flex gap-3 pt-3">
                <button type="button" onClick={() => setShowForm(false)}
                  className="flex-1 py-2.5 rounded-lg border border-border text-[13px] font-medium text-text-secondary hover:bg-surface transition-colors">Cancel</button>
                <button type="submit" disabled={createMutation.isPending || updateMutation.isPending}
                  className="flex-1 py-2.5 rounded-lg bg-navy text-white text-[13px] font-medium hover:bg-navy-light disabled:opacity-50 transition-colors">
                  {editing ? 'Save Changes' : 'Add Product'}
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}
      {}
      {showStock && stockProduct && (
        <ModalOverlay onClose={() => setShowStock(false)}>
          <div className="bg-card rounded-2xl w-full max-w-md shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <h3 className="text-[16px] font-bold text-text-primary">Add Stock</h3>
                <p className="text-[12px] text-text-secondary mt-0.5">{stockProduct.name} · Current: {stockProduct.quantity} units</p>
              </div>
              <button onClick={() => setShowStock(false)} className="p-1 rounded-lg hover:bg-surface transition-colors"><X size={18} /></button>
            </div>
            <form onSubmit={handleAddStock} className="p-6 space-y-4">
              <Field label="Quantity to Add" required>
                <input type="number" required min="1" value={stockForm.quantity} onChange={(e) => setStockForm({...stockForm, quantity: e.target.value})}
                  className="form-input" placeholder="0" autoFocus />
              </Field>
              <Field label="Unit Cost ($)">
                <input type="number" step="0.01" value={stockForm.unit_cost} onChange={(e) => setStockForm({...stockForm, unit_cost: e.target.value})}
                  className="form-input" placeholder={`Default: ${stockProduct.cost_price.toFixed(2)} DA`} />
              </Field>
              <Field label="Notes">
                <input type="text" value={stockForm.notes} onChange={(e) => setStockForm({...stockForm, notes: e.target.value})}
                  className="form-input" placeholder="Optional note" />
              </Field>
              <div className="flex gap-3 pt-3">
                <button type="button" onClick={() => setShowStock(false)}
                  className="flex-1 py-2.5 rounded-lg border border-border text-[13px] font-medium text-text-secondary hover:bg-surface transition-colors">Cancel</button>
                <button type="submit" disabled={addStockMutation.isPending}
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

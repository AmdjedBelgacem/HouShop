import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { useI18n } from '../i18n';
import type { Category, CreateProduct, Product, UpdateProduct, ProductVariant, CreateVariant } from '../lib/types';
import CustomSelect from '../components/CustomSelect';
import BarcodePrintModal from '../components/BarcodePrintModal';
import JsBarcode from 'jsbarcode';
import {
  ArrowLeft, ImagePlus, Cloud, X, Plus, Eye, Info, DollarSign,
  BarChart3, Layers, Trash2, ChevronDown, ChevronUp, Star, RefreshCw,
} from 'lucide-react';
interface AddProductProps {
  onBack: () => void;
  editProduct?: Product | null;
}
function parseImages(imagePath: string | null): string[] {
  if (!imagePath) return [];
  try {
    const parsed = JSON.parse(imagePath);
    if (Array.isArray(parsed)) return parsed;
  } catch {  }
  return [imagePath];
}
function serializeImages(images: string[]): string | null {
  if (images.length === 0) return null;
  if (images.length === 1) return images[0];
  return JSON.stringify(images);
}
export default function AddProduct({ onBack, editProduct }: AddProductProps) {
  const isEditing = !!editProduct;
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const initialImages = isEditing ? parseImages(editProduct?.image_path ?? null) : [];
  const [form, setForm] = useState({
    name: editProduct?.name ?? '',
    sku: editProduct?.sku ?? '',
    category_id: editProduct?.category_id ?? null,
    description: editProduct?.description ?? '',
    selling_price: editProduct ? String(editProduct.selling_price) : '',
    cost_price: editProduct ? String(editProduct.cost_price) : '',
    quantity: editProduct ? String(editProduct.quantity) : '0',
    low_stock_threshold: editProduct ? String(editProduct.low_stock_threshold) : '5',
    barcode: editProduct?.barcode ?? '',
  });
  const [images, setImages] = useState<string[]>(initialImages);
  const [visible, setVisible] = useState(false);
  const [featured, setFeatured] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);
  const [hasVariants, setHasVariants] = useState(false);
  const [variants, setVariants] = useState<(CreateVariant & { _expanded?: boolean })[]>([]);
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const barcodeSvgRef = useRef<SVGSVGElement>(null);

  function generateBarcodeValue(_name: string): string {
    const digits: number[] = [];
    for (let i = 0; i < 12; i++) {
      digits.push(Math.floor(Math.random() * 10));
    }
    return digits.join('');
  }

  function generateSkuValue(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    const abbr = words.map(w => {
      const clean = w.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (clean.length <= 3) return clean;
      return clean.slice(0, 2) + clean.slice(-1);
    }).join('-');
    const num = String(Math.floor(Math.random() * 900) + 100);
    return `HPS-${abbr || 'ITEM'}-${num}`;
  }

  useEffect(() => {
    if (barcodeSvgRef.current && form.barcode) {
      try {
        JsBarcode(barcodeSvgRef.current, form.barcode, {
          format: 'CODE128', width: 1.5, height: 40, displayValue: true,
          fontSize: 12, margin: 2, background: 'transparent', lineColor: 'currentColor',
        });
      } catch { }
    }
  }, [form.barcode]);
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => invoke<Category[]>('get_categories'),
  });
  const { data: existingVariants } = useQuery({
    queryKey: ['product-variants', editProduct?.id],
    queryFn: () => invoke<ProductVariant[]>('get_product_variants', { productId: editProduct!.id }),
    enabled: isEditing && !!editProduct,
  });
  useEffect(() => {
    if (existingVariants && existingVariants.length > 0) {
      setHasVariants(true);
      setVariants(existingVariants.map(v => ({
        product_id: v.product_id,
        variant_name: v.variant_name,
        condition_note: v.condition_note ?? undefined,
        quantity: v.quantity,
        cost_price: v.cost_price,
        selling_price: v.selling_price,
        barcode: v.barcode ?? undefined,
        sku: v.sku ?? undefined,
        image_path: v.image_path ?? undefined,
        _expanded: true,
      })));
    }
  }, [existingVariants]);
  const createMutation = useMutation({
    mutationFn: (data: CreateProduct) => invoke<Product>('create_product', { data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
  });
  const updateMutation = useMutation({
    mutationFn: (data: UpdateProduct) => invoke('update_product', { data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
  });
  const handleSubmit = async () => {
    const imagePayload = serializeImages(images);
    const payload = {
      name: form.name,
      category_id: form.category_id,
      cost_price: parseFloat(form.cost_price) || 0,
      selling_price: parseFloat(form.selling_price) || 0,
      quantity: parseInt(form.quantity) || 0,
      barcode: form.barcode || null,
      sku: form.sku || null,
      description: form.description || null,
      image_path: imagePayload,
      low_stock_threshold: parseInt(form.low_stock_threshold) || 5,
    };
    let productId: number | null = null;
    try {
      if (isEditing && editProduct) {
        await updateMutation.mutateAsync({ id: editProduct.id, ...payload });
        productId = editProduct.id;
      } else {
        const created = await createMutation.mutateAsync(payload);
        productId = created.id;
      }
      if (productId && hasVariants && variants.length > 0) {
        for (const v of variants) {
          try {
            const { _expanded, ...variantData } = v;
            await invoke('create_variant', { data: { ...variantData, product_id: productId } });
          } catch (err) {
            console.error('Failed to save variant:', err);
          }
        }
        queryClient.invalidateQueries({ queryKey: ['product-variants'] });
      }
      if (!isEditing && form.barcode) {
        setShowBarcodeModal(true);
      } else {
        onBack();
      }
    } catch (err) {
      console.error('Failed to save product:', err);
    }
  };
  const handleImageSelect = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files ?? []);
      for (const file of files) {
        if (file.type.startsWith('image/')) await processImageFile(file);
      }
    };
    input.click();
  };
  const processImageFile = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      try {
        const path = await invoke<string>('save_image', { data: dataUrl, filename: file.name });
        setImages(prev => [...prev, path]);
      } catch (err) {
        console.error('Failed to save image:', err);
      }
    };
    reader.readAsDataURL(file);
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      if (file.type.startsWith('image/')) await processImageFile(file);
    }
  };
  const removeImage = (idx: number) => setImages(prev => prev.filter((_, i) => i !== idx));
  const moveImageLeft = (idx: number) => {
    if (idx === 0) return;
    setImages(prev => {
      const arr = [...prev];
      [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
      return arr;
    });
  };
  const moveImageRight = (idx: number) => {
    if (idx === images.length - 1) return;
    setImages(prev => {
      const arr = [...prev];
      [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
      return arr;
    });
  };
  const handleVariantImageSelect = async (variantIdx: number) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        try {
          const path = await invoke<string>('save_image', { data: dataUrl, filename: file.name });
          setVariants(prev => prev.map((v, i) => i === variantIdx ? { ...v, image_path: path } : v));
        } catch (err) {
          console.error('Failed to save variant image:', err);
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };
  const addTag = () => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      setTags([...tags, newTag.trim()]);
      setNewTag('');
    }
    setShowTagInput(false);
  };
  const unitPrice = parseFloat(form.selling_price) || 0;
  const costPrice = parseFloat(form.cost_price) || 0;
  const profit = unitPrice - costPrice;
  const profitPct = unitPrice > 0 ? ((profit / unitPrice) * 100).toFixed(1) : '0.0';
  return (
    <div className="p-8">
      {}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-card hover:border-border border border-transparent transition-colors">
              <ArrowLeft size={20} />
            </button>
            <h2 className="text-[26px] font-bold text-text-primary leading-tight">{isEditing ? t('addProduct.editTitle') : t('addProduct.title')}</h2>
          </div>
          <p className="text-[14px] text-text-secondary ml-11">
            {isEditing ? t('addProduct.editSubtitle') : t('addProduct.newSubtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button onClick={onBack}
            className="px-5 py-2.5 rounded-lg border border-border text-[13px] font-medium text-text-secondary hover:bg-card transition-colors">
            {t('common.cancel')}
          </button>
          <button onClick={handleSubmit} disabled={!form.name || createMutation.isPending}
            className="px-6 py-2.5 rounded-lg bg-navy text-white text-[13px] font-medium hover:bg-navy-light disabled:opacity-50 transition-colors">
            {createMutation.isPending || updateMutation.isPending ? t('addProduct.saving') : (isEditing ? t('addProduct.saveChanges') : t('addProduct.saveProduct'))}
          </button>
        </div>
      </div>
      {}
      <div className="grid grid-cols-3 gap-6">
        {}
        <div className="col-span-2 space-y-6">
          {}
          <section className="card p-6">
            <div className="flex items-center gap-2 mb-5">
              <Info size={16} className="text-text-muted" />
              <h3 className="text-[15px] font-bold text-text-primary">{t('addProduct.basicInformation')}</h3>
            </div>
            <div className="space-y-4">
              <Field label={t('addProduct.productNameLabel')} required>
                <input type="text" required value={form.name}
                  onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                  className="form-input" placeholder={t('addProduct.productNamePlaceholder')} />
              </Field>
              <Field label={t('addProduct.skuLabel')}>
                <div className="flex items-center gap-2">
                  <input type="text" value={form.sku}
                    onChange={(e) => setForm(f => ({ ...f, sku: e.target.value }))}
                    className="form-input flex-1" placeholder={t('addProduct.skuPlaceholder')} />
                  <button type="button" onClick={() => setForm(f => ({ ...f, sku: generateSkuValue(f.name) }))}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-[12px] font-medium text-text-secondary hover:bg-surface transition-colors flex-shrink-0">
                    <RefreshCw size={13} /> {t('barcode.generate')}
                  </button>
                </div>
              </Field>
              <Field label={t('barcode.label')}>
                <div className="flex items-center gap-2">
                  <input type="text" value={form.barcode}
                    onChange={(e) => setForm(f => ({ ...f, barcode: e.target.value }))}
                    className="form-input flex-1 font-mono" placeholder="e.g. 6291041500213" />
                  <button type="button" onClick={() => setForm(f => ({ ...f, barcode: generateBarcodeValue(f.name) }))}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-[12px] font-medium text-text-secondary hover:bg-surface transition-colors flex-shrink-0">
                    <RefreshCw size={13} /> {t('barcode.generate')}
                  </button>
                </div>
                {form.barcode && (
                  <div className="mt-2 flex justify-center p-2 rounded-lg bg-surface border border-border">
                    <svg ref={barcodeSvgRef} className="h-10" />
                  </div>
                )}
              </Field>
              <Field label={t('addProduct.categoryLabel')}>
                <CustomSelect
                  value={form.category_id != null ? String(form.category_id) : ''}
                  onChange={(v) => setForm(f => ({ ...f, category_id: v ? Number(v) : null }))}
                  options={[{ value: '', label: t('common.selectCategory') }, ...(categories ?? []).map(c => ({ value: String(c.id), label: c.name }))]}
                  placeholder={t('common.selectCategory')}
                />
              </Field>
              <Field label={t('addProduct.descriptionLabel')}>
                <textarea value={form.description}
                  onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                  className="form-input min-h-[100px] resize-y"
                  placeholder={t('addProduct.descriptionPlaceholder')} />
              </Field>
            </div>
          </section>
          {}
          <section className="card p-6">
            <div className="flex items-center gap-2 mb-5">
              <DollarSign size={16} className="text-text-muted" />
              <h3 className="text-[15px] font-bold text-text-primary">{t('addProduct.pricingInventory')}</h3>
            </div>
            <div className="grid grid-cols-4 gap-4 mb-4">
              <Field label={t('addProduct.unitPrice')} required>
                <input type="number" step="0.01" required value={form.selling_price}
                  onChange={(e) => setForm(f => ({ ...f, selling_price: e.target.value }))}
                  className="form-input" placeholder="0.00" />
              </Field>
              <Field label={t('addProduct.costPriceLabel')} required>
                <input type="number" step="0.01" required value={form.cost_price}
                  onChange={(e) => setForm(f => ({ ...f, cost_price: e.target.value }))}
                  className="form-input" placeholder="0.00" />
              </Field>
              <Field label={t('addProduct.initialStockLabel')}>
                <input type="number" value={form.quantity}
                  onChange={(e) => setForm(f => ({ ...f, quantity: e.target.value }))}
                  className="form-input" />
              </Field>
              <Field label={t('addProduct.alertThresholdLabel')}>
                <input type="number" value={form.low_stock_threshold}
                  onChange={(e) => setForm(f => ({ ...f, low_stock_threshold: e.target.value }))}
                  className="form-input" />
              </Field>
            </div>
            {}
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-surface border border-border-light">
              <BarChart3 size={18} className="text-text-muted flex-shrink-0" />
              <p className="text-[13px] text-text-secondary">
                {t('addProduct.profitPerUnit')} <span className="font-bold text-accent-green">{profit.toFixed(2)} DA</span>
                <span className="text-text-muted ml-1">({profitPct}%)</span>
              </p>
            </div>
          </section>
          {}
          <section className="card p-6">
            <div className="flex items-center gap-2 mb-4">
              <ImagePlus size={16} className="text-text-muted" />
              <h3 className="text-[15px] font-bold text-text-primary">{t('addProduct.productImages')}</h3>
              {images.length > 0 && (
                <span className="text-[11px] text-text-muted ml-auto">{t('addProduct.imagesCount', { count: images.length, plural: images.length > 1 ? 's' : '' })}</span>
              )}
            </div>
            <div
              onClick={handleImageSelect}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className="border-2 border-dashed border-border rounded-xl p-5 flex flex-col items-center justify-center cursor-pointer hover:border-navy/30 hover:bg-navy/5 transition-colors mb-4"
            >
              <Cloud size={24} className="text-text-muted mb-1.5" />
              <p className="text-[13px] font-medium text-text-primary">{t('addProduct.dragDropImages')}</p>
              <p className="text-[11.5px] text-text-muted mt-0.5">{t('addProduct.imagesFormat')}</p>
              <button type="button" onClick={(e) => { e.stopPropagation(); handleImageSelect(); }}
                className="mt-3 px-4 py-1.5 rounded-lg border border-border text-[12px] font-medium text-text-secondary hover:bg-card transition-colors">
                {t('addProduct.browseFiles')}
              </button>
            </div>
            {}
            {images.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {images.map((img, idx) => (
                  <div key={idx} className={`relative group w-20 h-20 rounded-lg overflow-hidden border-2 transition-colors ${idx === 0 ? 'border-navy' : 'border-border'}`}>
                    <img src={convertFileSrc(img)} alt={`Product ${idx + 1}`} className="w-full h-full object-cover" />
                    {}
                    {idx === 0 && (
                      <div className="absolute top-0 left-0 px-1.5 py-0.5 bg-navy text-white text-[9px] font-bold rounded-br">
                        <Star size={8} className="inline mr-0.5" />{t('addProduct.cover')}
                      </div>
                    )}
                    {}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                      {idx > 0 && (
                        <button onClick={(e) => { e.stopPropagation(); moveImageLeft(idx); }} className="p-0.5 rounded bg-card/80 text-text-primary hover:bg-card">
                          <ChevronDown size={12} className="rotate-90" />
                        </button>
                      )}
                      {idx < images.length - 1 && (
                        <button onClick={(e) => { e.stopPropagation(); moveImageRight(idx); }} className="p-0.5 rounded bg-card/80 text-text-primary hover:bg-card">
                          <ChevronUp size={12} className="rotate-90" />
                        </button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); removeImage(idx); }} className="p-0.5 rounded bg-red-500 text-white hover:bg-red-600">
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                ))}
                {}
                <div onClick={handleImageSelect}
                  className="w-20 h-20 rounded-lg border-2 border-dashed border-border flex items-center justify-center cursor-pointer hover:border-navy/30 transition-colors">
                  <Plus size={18} className="text-text-muted" />
                </div>
              </div>
            )}
          </section>
        </div>
        {}
        <div className="space-y-6">
          {}
          <section className="card p-6">
            <div className="flex items-center gap-2 mb-3">
              <Layers size={16} className="text-text-muted" />
              <h3 className="text-[15px] font-bold text-text-primary">{t('addProduct.productVariants')}</h3>
            </div>
            <p className="text-[11.5px] text-text-muted mb-4">{t('addProduct.variantsDesc')}</p>
            <ToggleRow label={t('addProduct.hasVariants')} desc={t('addProduct.variantsToggleDesc')} value={hasVariants} onChange={(v) => { setHasVariants(v); if (!v) setVariants([]); }} />
            {hasVariants && (
              <div className="mt-4 space-y-3">
                {variants.map((v, i) => (
                  <div key={i} className="rounded-xl border border-border overflow-hidden">
                    {}
                    <button
                      onClick={() => setVariants(prev => prev.map((vv, j) => j === i ? { ...vv, _expanded: !vv._expanded } : vv))}
                      className="w-full flex items-center gap-2 px-3.5 py-2.5 bg-surface hover:bg-card transition-colors text-left"
                    >
                      {v.image_path ? (
                        <img src={convertFileSrc(v.image_path)} alt="" className="w-7 h-7 rounded object-cover border border-border flex-shrink-0" />
                      ) : (
                        <div className="w-7 h-7 rounded bg-card flex items-center justify-center flex-shrink-0">
                          <Layers size={12} className="text-text-muted" />
                        </div>
                      )}
                      <span className="text-[13px] font-semibold text-text-primary truncate flex-1">{v.variant_name || t('addProduct.variantLabel', { n: i + 1 })}</span>
                      <span className="text-[11px] text-text-muted">{t('addProduct.unitsCount', { count: v.quantity })}</span>
                      {v._expanded ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
                    </button>
                    {}
                    {v._expanded !== false && (
                      <div className="px-3.5 py-3 space-y-3 bg-card">
                        <div className="grid grid-cols-2 gap-2.5">
                          <Field label={t('addProduct.variantNameLabel')} required>
                            <input value={v.variant_name} onChange={(e) => {
                              const updated = [...variants]; updated[i] = { ...updated[i], variant_name: e.target.value }; setVariants(updated);
                            }} placeholder={t('addProduct.variantNamePlaceholder')} className="form-input !py-1.5 !text-[12px]" />
                          </Field>
                          <Field label={t('addProduct.conditionNoteLabel')}>
                            <input value={v.condition_note ?? ''} onChange={(e) => {
                              const updated = [...variants]; updated[i] = { ...updated[i], condition_note: e.target.value || undefined }; setVariants(updated);
                            }} placeholder={t('addProduct.conditionPlaceholder')} className="form-input !py-1.5 !text-[12px]" />
                          </Field>
                        </div>
                        <div className="grid grid-cols-3 gap-2.5">
                          <Field label={t('addProduct.stockQtyLabel')}>
                            <input type="number" value={v.quantity ?? 0} onChange={(e) => {
                              const updated = [...variants]; updated[i] = { ...updated[i], quantity: parseInt(e.target.value) || 0 }; setVariants(updated);
                            }} placeholder="0" className="form-input !py-1.5 !text-[12px]" />
                          </Field>
                          <Field label={t('addProduct.costDaLabel')}>
                            <input type="number" step="0.01" value={v.cost_price} onChange={(e) => {
                              const updated = [...variants]; updated[i] = { ...updated[i], cost_price: parseFloat(e.target.value) || 0 }; setVariants(updated);
                            }} placeholder="0.00" className="form-input !py-1.5 !text-[12px]" />
                          </Field>
                          <Field label={t('addProduct.sellDaLabel')}>
                            <input type="number" step="0.01" value={v.selling_price} onChange={(e) => {
                              const updated = [...variants]; updated[i] = { ...updated[i], selling_price: parseFloat(e.target.value) || 0 }; setVariants(updated);
                            }} placeholder="0.00" className="form-input !py-1.5 !text-[12px]" />
                          </Field>
                        </div>
                        {}
                        <div>
                          <label className="block text-[11px] font-semibold text-text-muted tracking-[0.06em] uppercase mb-1.5">{t('addProduct.variantImage')}</label>
                          {v.image_path ? (
                            <div className="flex items-center gap-2">
                              <img src={convertFileSrc(v.image_path)} alt="" className="w-14 h-14 rounded-lg object-cover border border-border" />
                              <button onClick={() => setVariants(prev => prev.map((vv, j) => j === i ? { ...vv, image_path: undefined } : vv))}
                                className="text-[11px] text-accent-red hover:underline">{t('common.remove')}</button>
                              <button onClick={() => handleVariantImageSelect(i)}
                                className="text-[11px] text-navy hover:underline">{t('addProduct.change')}</button>
                            </div>
                          ) : (
                            <button onClick={() => handleVariantImageSelect(i)}
                              className="w-full py-2.5 rounded-lg border border-dashed border-border text-[11px] text-text-muted hover:border-navy/30 hover:bg-navy/5 transition-colors flex items-center justify-center gap-1.5">
                              <ImagePlus size={13} /> {t('addProduct.addImage')}
                            </button>
                          )}
                        </div>
                        <button onClick={() => setVariants(variants.filter((_, j) => j !== i))}
                          className="flex items-center gap-1 text-[11.5px] text-accent-red hover:underline">
                          <Trash2 size={12} /> {t('addProduct.removeVariant')}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                <button onClick={() => setVariants([...variants, { product_id: 0, variant_name: '', quantity: 0, cost_price: 0, selling_price: 0, _expanded: true }])}
                  className="w-full py-2.5 rounded-xl border border-dashed border-border text-[12px] font-medium text-text-secondary hover:bg-card hover:border-navy/30 transition-colors flex items-center justify-center gap-1.5">
                  <Plus size={14} /> {t('addProduct.addNewVariant')}
                </button>
              </div>
            )}
          </section>
          {}
          <section className="card p-6">
            <div className="flex items-center gap-2 mb-4">
              <Eye size={16} className="text-text-muted" />
              <h3 className="text-[15px] font-bold text-text-primary">{t('addProduct.publishing')}</h3>
            </div>
            <div className="space-y-4">
              <ToggleRow label={t('addProduct.productStatus')} desc={t('addProduct.visibleInCatalog')} value={visible} onChange={setVisible} />
              <ToggleRow label={t('addProduct.featureOnWeb')} desc={t('addProduct.promoteOnHomepage')} value={featured} onChange={setFeatured} />
              <div>
                <label className="block text-[11px] font-semibold text-text-muted tracking-[0.08em] uppercase mb-2">{t('addProduct.tags')}</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {tags.map(t => (
                    <span key={t} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface border border-border text-[11.5px] font-medium text-text-secondary">
                      {t}
                      <button onClick={() => setTags(tags.filter(x => x !== t))} className="text-text-muted hover:text-accent-red"><X size={11} /></button>
                    </span>
                  ))}
                </div>
                {showTagInput ? (
                  <div className="flex gap-2">
                    <input type="text" value={newTag} onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
                      className="form-input flex-1 !py-1.5 !text-[12px]" placeholder={t('addProduct.tagName')} autoFocus />
                    <button onClick={addTag} className="px-3 py-1.5 rounded-lg bg-navy text-white text-[11px] font-medium">{t('common.add')}</button>
                  </div>
                ) : (
                  <button onClick={() => setShowTagInput(true)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-[11.5px] font-medium text-text-secondary hover:bg-card transition-colors">
                    <Plus size={12} /> {t('addProduct.addTag')}
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>

      {showBarcodeModal && form.barcode && (
        <BarcodePrintModal
          barcode={form.barcode}
          productName={form.name}
          sku={form.sku || null}
          price={parseFloat(form.selling_price) || null}
          onClose={() => { setShowBarcodeModal(false); onBack(); }}
        />
      )}
    </div>
  );
}
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-text-muted tracking-[0.06em] uppercase mb-1.5">
        {label}{required && <span className="text-accent-red ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
function ToggleRow({ label, desc, value, onChange }: { label: string; desc: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-[13px] font-medium text-text-primary">{label}</p>
        <p className="text-[11.5px] text-text-muted">{desc}</p>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-10 h-[22px] rounded-full transition-colors ${value ? 'bg-navy' : 'bg-border'}`}
      >
        <span className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow transition-transform ${value ? 'left-[21px]' : 'left-[3px]'}`} />
      </button>
    </div>
  );
}

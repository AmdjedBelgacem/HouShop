import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { useI18n } from '../i18n';
import type { Category, CreateProduct, Product, UpdateProduct, ProductVariant, VariantInput } from '../lib/types';
import CustomSelect from '../components/CustomSelect';
import BarcodePrintModal from '../components/BarcodePrintModal';
import JsBarcode from 'jsbarcode';
import {
  ArrowLeft, ImagePlus, Cloud, X, Plus, Info,
  Layers, Trash2, ChevronDown, ChevronUp, Star, RefreshCw,
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

/** A variant being edited in the form, with UI-only helpers. */
interface FormVariant extends VariantInput {
  _expanded?: boolean;
  _id?: number;
}

export default function AddProduct({ onBack, editProduct }: AddProductProps) {
  const isEditing = !!editProduct;
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const initialImages = isEditing ? parseImages(editProduct?.image_path ?? null) : [];
  const [form, setForm] = useState({
    name: editProduct?.name ?? '',
    category_id: editProduct?.category_id ?? null,
    description: editProduct?.description ?? '',
  });
  const [images, setImages] = useState<string[]>(initialImages);
  // The first variant is always present and prefilled. New variants get a
  // freshly generated unique SKU + barcode so the merchant never has to.
  const [variants, setVariants] = useState<FormVariant[]>([]);
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const [createdProductId, setCreatedProductId] = useState<number | null>(null);
  const [createdVariantBarcode, setCreatedVariantBarcode] = useState<string | null>(null);

  function generateBarcodeValue(): string {
    // 12 random data digits + the EAN-13 check digit, so the stored value
    // matches exactly what JsBarcode renders and the scanner reads back.
    const digits: number[] = [];
    for (let i = 0; i < 12; i++) {
      digits.push(Math.floor(Math.random() * 10));
    }
    return digits.join('') + ean13CheckDigit(digits);
  }
  function ean13CheckDigit(digits: number[]): string {
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += digits[i] * (i % 2 === 0 ? 1 : 3);
    }
    return String((10 - (sum % 10)) % 10);
  }
  function generateSkuValue(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    const abbr = words.map(w => {
      const clean = w.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (clean.length <= 3) return clean;
      return clean.slice(0, 2) + clean.slice(-1);
    }).join('-');
    const num = String(Math.floor(Math.random() * 9000) + 1000);
    return `HPS-${abbr || 'ITEM'}-${num}`;
  }

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => invoke<Category[]>('get_categories'),
  });
  // When editing, load the product's existing variants so they can be edited
  // in place. On create, seed exactly one prefilled variant.
  const { data: existingVariants } = useQuery({
    queryKey: ['product-variants', editProduct?.id],
    queryFn: () => invoke<ProductVariant[]>('get_product_variants', { productId: editProduct!.id }),
    enabled: isEditing && !!editProduct,
  });
  useEffect(() => {
    if (isEditing && existingVariants) {
      setVariants(existingVariants.map(v => ({
        id: v.id,
        variant_name: v.variant_name,
        condition_note: v.condition_note ?? undefined,
        quantity: v.quantity,
        cost_price: v.cost_price,
        selling_price: v.selling_price,
        barcode: v.barcode ?? undefined,
        sku: v.sku ?? undefined,
        image_path: v.image_path ?? undefined,
        low_stock_threshold: v.low_stock_threshold,
        _id: v.id,
        _expanded: true,
      })));
    }
  }, [existingVariants, isEditing]);
  // Seed one prefilled variant on create. Done via a ref-guarded effect rather
  // than a lazy initializer because generating its SKU/barcode at module load
  // would run even when editing.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!isEditing && !seededRef.current) {
      seededRef.current = true;
      setVariants([makeBlankVariant(form.name, generateSkuValue, generateBarcodeValue)]);
    }
  }, [isEditing]); // eslint-disable-line react-hooks/exhaustive-deps

  const createMutation = useMutation({
    mutationFn: (data: CreateProduct) => invoke<Product>('create_product', { data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['low-stock'] });
    },
  });
  const updateMutation = useMutation({
    mutationFn: (data: UpdateProduct) => invoke('update_product', { data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['low-stock'] });
      queryClient.invalidateQueries({ queryKey: ['product-variants'] });
    },
  });

  // Build the payload and send it. The product + its variants are saved in one
  // atomic backend call, so uniqueness/ordering issues surface as a single error.
  const handleSubmit = async () => {
    if (variants.length === 0) {
      toast.error(t('addProduct.variantRequired'));
      return;
    }
    const payload = {
      name: form.name,
      category_id: form.category_id,
      description: form.description || null,
      image_path: serializeImages(images),
      // Strip UI-only fields (_expanded, _id) before sending to the backend.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      variants: variants.map(({ _expanded, _id, ...v }) => v),
    };
    try {
      let productId: number | null = null;
      if (isEditing && editProduct) {
        await updateMutation.mutateAsync({ id: editProduct.id, ...payload });
        productId = editProduct.id;
      } else {
        const created = await createMutation.mutateAsync(payload);
        productId = created.id;
      }
      toast.success(isEditing ? t('toast.productUpdated') : t('toast.productCreated'));
      // After creating, offer to print the first variant's barcode label.
      if (!isEditing && variants[0]?.barcode) {
        setCreatedProductId(productId);
        setCreatedVariantBarcode(variants[0].barcode);
        setShowBarcodeModal(true);
      } else {
        onBack();
      }
    } catch (err) {
      console.error('Failed to save product:', err);
      toast.error(typeof err === 'string' ? err : t('toast.error'));
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
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      if (file.type.startsWith('image/')) await processImageFile(file);
    }
  };
  const removeImage = (idx: number) => setImages(prev => prev.filter((_, i) => i !== idx));
  const moveImage = (idx: number, dir: -1 | 1) => {
    setImages(prev => {
      const arr = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= arr.length) return prev;
      [arr[idx], arr[target]] = [arr[target], arr[idx]];
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

  const addVariant = () => {
    setVariants(prev => [...prev, makeBlankVariant(form.name, generateSkuValue, generateBarcodeValue)]);
  };
  const removeVariant = (idx: number) => {
    setVariants(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);
  };

  const totalStock = variants.reduce((s, v) => s + (v.quantity ?? 0), 0);

  return (
    <div className="p-8">
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

      <div className="space-y-6">
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

        {/* Variants sit directly under Basic Information — they're the sellable
            units and the core of the form, not a sidebar. */}
        <section className="card p-6">
          <div className="flex items-center gap-2 mb-3">
            <Layers size={16} className="text-text-muted" />
            <h3 className="text-[15px] font-bold text-text-primary">{t('addProduct.productVariants')}</h3>
          </div>
          <p className="text-[11.5px] text-text-muted mb-4">{t('addProduct.variantsDesc')}</p>

          <div className="space-y-3">
            {variants.map((v, i) => (
              <VariantCard
                key={v._id ?? `new-${i}`}
                index={i}
                variant={v}
                canRemove={variants.length > 1}
                onChange={(patch) => setVariants(prev => prev.map((vv, j) => j === i ? { ...vv, ...patch } : vv))}
                onToggle={() => setVariants(prev => prev.map((vv, j) => j === i ? { ...vv, _expanded: !vv._expanded } : vv))}
                onRemove={() => removeVariant(i)}
                onImageSelect={() => handleVariantImageSelect(i)}
                onGenSku={() => setVariants(prev => prev.map((vv, j) => j === i ? { ...vv, sku: generateSkuValue(form.name) } : vv))}
                onGenBarcode={() => setVariants(prev => prev.map((vv, j) => j === i ? { ...vv, barcode: generateBarcodeValue() } : vv))}
              />
            ))}
            <button onClick={addVariant}
              className="w-full py-2.5 rounded-xl border border-dashed border-border text-[12px] font-medium text-text-secondary hover:bg-card hover:border-navy/30 transition-colors flex items-center justify-center gap-1.5">
              <Plus size={14} /> {t('addProduct.addNewVariant')}
            </button>
          </div>

          <div className="mt-4 px-4 py-2.5 rounded-lg bg-surface border border-border-light text-[11.5px] text-text-muted flex items-center justify-between">
            <span>{t('addProduct.totalStockLabel')}</span>
            <span className="font-bold text-text-primary">{t('addProduct.unitsCount', { count: totalStock })}</span>
          </div>
        </section>

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
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
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
          {images.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {images.map((img, idx) => (
                <div key={idx} className={`relative group w-20 h-20 rounded-lg overflow-hidden border-2 transition-colors ${idx === 0 ? 'border-navy' : 'border-border'}`}>
                  <img src={convertFileSrc(img)} alt={`Product ${idx + 1}`} className="w-full h-full object-cover" />
                  {idx === 0 && (
                    <div className="absolute top-0 left-0 px-1.5 py-0.5 bg-navy text-white text-[9px] font-bold rounded-br">
                      <Star size={8} className="inline mr-0.5" />{t('addProduct.cover')}
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                    {idx > 0 && (
                      <button onClick={(e) => { e.stopPropagation(); moveImage(idx, -1); }} className="p-0.5 rounded bg-card/80 text-text-primary hover:bg-card">
                        <ChevronDown size={12} className="rotate-90" />
                      </button>
                    )}
                    {idx < images.length - 1 && (
                      <button onClick={(e) => { e.stopPropagation(); moveImage(idx, 1); }} className="p-0.5 rounded bg-card/80 text-text-primary hover:bg-card">
                        <ChevronUp size={12} className="rotate-90" />
                      </button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); removeImage(idx); }} className="p-0.5 rounded bg-red-500 text-white hover:bg-red-600">
                      <X size={12} />
                    </button>
                  </div>
                </div>
              ))}
              <div onClick={handleImageSelect}
                className="w-20 h-20 rounded-lg border-2 border-dashed border-border flex items-center justify-center cursor-pointer hover:border-navy/30 transition-colors">
                <Plus size={18} className="text-text-muted" />
              </div>
            </div>
          )}
        </section>
      </div>

      {showBarcodeModal && createdVariantBarcode && (
        <BarcodePrintModal
          barcode={createdVariantBarcode}
          productName={form.name}
          productId={createdProductId ?? undefined}
          sku={variants[0]?.sku ?? null}
          price={variants[0]?.selling_price ?? null}
          onClose={() => { setShowBarcodeModal(false); onBack(); }}
        />
      )}
    </div>
  );
}

function makeBlankVariant(
  name: string,
  genSku: (n: string) => string,
  genBarcode: () => string,
): FormVariant {
  return {
    variant_name: '',
    condition_note: undefined,
    quantity: 0,
    cost_price: 0,
    selling_price: 0,
    sku: genSku(name),
    barcode: genBarcode(),
    image_path: undefined,
    low_stock_threshold: 5,
    _expanded: true,
  };
}

interface VariantCardProps {
  index: number;
  variant: FormVariant;
  canRemove: boolean;
  onChange: (patch: Partial<FormVariant>) => void;
  onToggle: () => void;
  onRemove: () => void;
  onImageSelect: () => void;
  onGenSku: () => void;
  onGenBarcode: () => void;
}

function VariantCard({
  index, variant, canRemove, onChange, onToggle, onRemove, onImageSelect, onGenSku, onGenBarcode,
}: VariantCardProps) {
  const { t } = useI18n();
  const barcodeSvgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (barcodeSvgRef.current && variant.barcode) {
      try {
        const isEan13 = /^\d{12,13}$/.test(variant.barcode);
        JsBarcode(barcodeSvgRef.current, variant.barcode, {
          format: isEan13 ? 'EAN13' : 'CODE128',
          width: 1.5, height: 36, displayValue: true,
          fontSize: 11, margin: 2, background: 'transparent', lineColor: 'currentColor',
        });
      } catch { }
    }
  }, [variant.barcode]);

  const profit = variant.selling_price - variant.cost_price;
  const profitPct = variant.selling_price > 0 ? ((profit / variant.selling_price) * 100).toFixed(0) : '0';

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 bg-surface hover:bg-card transition-colors text-left"
      >
        {variant.image_path ? (
          <img src={convertFileSrc(variant.image_path)} alt="" className="w-7 h-7 rounded object-cover border border-border flex-shrink-0" />
        ) : (
          <div className="w-7 h-7 rounded bg-card flex items-center justify-center flex-shrink-0">
            <Layers size={12} className="text-text-muted" />
          </div>
        )}
        <span className="text-[13px] font-semibold text-text-primary truncate flex-1">
          {variant.variant_name || t('addProduct.variantLabel', { n: index + 1 })}
        </span>
        <span className="text-[11px] text-text-muted">{t('addProduct.unitsCount', { count: variant.quantity ?? 0 })}</span>
        {variant._expanded ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
      </button>

      {variant._expanded !== false && (
        <div className="px-3.5 py-3 space-y-3 bg-card">
          <div className="grid grid-cols-2 gap-2.5">
            <Field label={t('addProduct.variantNameLabel')} required>
              <input value={variant.variant_name} onChange={(e) => onChange({ variant_name: e.target.value })}
                placeholder={t('addProduct.variantNamePlaceholder')} className="form-input !py-1.5 !text-[12px]" />
            </Field>
            <Field label={t('addProduct.conditionNoteLabel')}>
              <input value={variant.condition_note ?? ''} onChange={(e) => onChange({ condition_note: e.target.value || undefined })}
                placeholder={t('addProduct.conditionPlaceholder')} className="form-input !py-1.5 !text-[12px]" />
            </Field>
          </div>

          {/* SKU */}
          <Field label={t('addProduct.variantSku')}>
            <div className="flex items-center gap-2">
              <input value={variant.sku ?? ''} onChange={(e) => onChange({ sku: e.target.value || undefined })}
                placeholder="HPS-..." className="form-input !py-1.5 !text-[12px] font-mono flex-1" />
              <button type="button" onClick={onGenSku}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border text-[11px] font-medium text-text-secondary hover:bg-surface transition-colors flex-shrink-0">
                <RefreshCw size={12} /> {t('barcode.generate')}
              </button>
            </div>
          </Field>

          {/* Barcode */}
          <Field label={t('addProduct.variantBarcode')}>
            <div className="flex items-center gap-2">
              <input value={variant.barcode ?? ''} onChange={(e) => onChange({ barcode: e.target.value || undefined })}
                placeholder="EAN-13" className="form-input !py-1.5 !text-[12px] font-mono flex-1" />
              <button type="button" onClick={onGenBarcode}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border text-[11px] font-medium text-text-secondary hover:bg-surface transition-colors flex-shrink-0">
                <RefreshCw size={12} /> {t('barcode.generate')}
              </button>
            </div>
            {variant.barcode && (
              <div className="mt-2 flex justify-center p-2 rounded-lg bg-surface border border-border">
                <svg ref={barcodeSvgRef} className="h-9" />
              </div>
            )}
          </Field>

          <div className="grid grid-cols-3 gap-2.5">
            <Field label={t('addProduct.stockQtyLabel')}>
              <input type="number" value={variant.quantity ?? 0} onChange={(e) => onChange({ quantity: parseInt(e.target.value) || 0 })}
                placeholder="0" className="form-input !py-1.5 !text-[12px]" />
            </Field>
            <Field label={t('addProduct.costDaLabel')}>
              <input type="number" step="0.01" value={variant.cost_price} onChange={(e) => onChange({ cost_price: parseFloat(e.target.value) || 0 })}
                placeholder="0.00" className="form-input !py-1.5 !text-[12px]" />
            </Field>
            <Field label={t('addProduct.sellDaLabel')}>
              <input type="number" step="0.01" value={variant.selling_price} onChange={(e) => onChange({ selling_price: parseFloat(e.target.value) || 0 })}
                placeholder="0.00" className="form-input !py-1.5 !text-[12px]" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <Field label={t('addProduct.alertThresholdLabel')}>
              <input type="number" value={variant.low_stock_threshold ?? 5} onChange={(e) => onChange({ low_stock_threshold: parseInt(e.target.value) || 5 })}
                placeholder="5" className="form-input !py-1.5 !text-[12px]" />
            </Field>
            <div className="flex items-end">
              <div className="w-full px-2.5 py-1.5 rounded-lg bg-surface border border-border-light text-[11px] text-text-muted">
                {t('addProduct.profitPerUnit')} <span className="font-bold text-accent-green">{profit.toFixed(0)} DA</span> <span className="text-text-muted">({profitPct}%)</span>
              </div>
            </div>
          </div>

          {/* Variant image */}
          <div>
            <label className="block text-[11px] font-semibold text-text-muted tracking-[0.06em] uppercase mb-1.5">{t('addProduct.variantImage')}</label>
            {variant.image_path ? (
              <div className="flex items-center gap-2">
                <img src={convertFileSrc(variant.image_path)} alt="" className="w-14 h-14 rounded-lg object-cover border border-border" />
                <button onClick={() => onChange({ image_path: undefined })}
                  className="text-[11px] text-accent-red hover:underline">{t('common.remove')}</button>
                <button onClick={onImageSelect}
                  className="text-[11px] text-navy hover:underline">{t('addProduct.change')}</button>
              </div>
            ) : (
              <button onClick={onImageSelect}
                className="w-full py-2.5 rounded-lg border border-dashed border-border text-[11px] text-text-muted hover:border-navy/30 hover:bg-navy/5 transition-colors flex items-center justify-center gap-1.5">
                <ImagePlus size={13} /> {t('addProduct.addImage')}
              </button>
            )}
          </div>

          {canRemove && (
            <button onClick={onRemove}
              className="flex items-center gap-1 text-[11.5px] text-accent-red hover:underline">
              <Trash2 size={12} /> {t('addProduct.removeVariant')}
            </button>
          )}
        </div>
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

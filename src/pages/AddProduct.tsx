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
  } catch {
    // Not JSON: the value is a single legacy image path
  }
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

interface BarcodeConflictVariant {
  barcode: string;
  variant_id: number;
  variant_name: string;
  product_id: number;
  product_name: string;
  category_name: string | null;
  sku: string | null;
  quantity: number;
  selling_price: number;
}

interface CatalogBarcodeConflictGroup {
  barcode: string;
  current: Array<{ index: number; name: string }>;
  existing: BarcodeConflictVariant[];
}

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

function variantDisplayName(v: FormVariant, index: number, t: TranslateFn): string {
  return v.variant_name.trim() || t('addProduct.variantLabel', { n: index + 1 });
}

function getDuplicateBarcodeGroups(variants: FormVariant[], t: TranslateFn): Array<{ barcode: string; indices: number[]; names: string[] }> {
  const groups = new Map<string, number[]>();
  variants.forEach((variant, index) => {
    const barcode = variant.barcode?.trim();
    if (!barcode) return;
    groups.set(barcode, [...(groups.get(barcode) ?? []), index]);
  });

  return Array.from(groups.entries())
    .filter(([, indices]) => indices.length > 1)
    .map(([barcode, indices]) => ({
      barcode,
      indices,
      names: indices.map(index => variantDisplayName(variants[index], index, t)),
    }));
}

function ean13CheckDigit(digits: number[]): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += digits[i] * (i % 2 === 0 ? 1 : 3);
  }
  return String((10 - (sum % 10)) % 10);
}

/** SKU for a new variant: HPS-<name abbreviations>-<random 4 digits>. Pure. */
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

function generateBarcodeValue(): string {
  const digits: number[] = [];
  digits.push(Math.floor(Math.random() * 9) + 1);
  for (let i = 1; i < 12; i++) {
    digits.push(Math.floor(Math.random() * 10));
  }
  return digits.join('') + ean13CheckDigit(digits);
}

async function generateUniqueBarcode(excludeVariantId?: number): Promise<string> {
  let candidate = generateBarcodeValue();
  for (let i = 0; i < 8; i++) {
    try {
      const taken = await invoke<boolean>('is_barcode_taken', {
        barcode: candidate,
        excludeVariantId: excludeVariantId ?? null,
      });
      if (!taken) return candidate;
    } catch {
      return candidate;
    }
    candidate = generateBarcodeValue();
  }
  return candidate;
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
  const [catalogBarcodeConflicts, setCatalogBarcodeConflicts] = useState<CatalogBarcodeConflictGroup[]>([]);
  const duplicateBarcodeGroups = getDuplicateBarcodeGroups(variants, t);
  const duplicateBarcodeIndices = new Set(duplicateBarcodeGroups.flatMap(group => group.indices));
  const catalogBarcodeConflictIndices = new Set(catalogBarcodeConflicts.flatMap(group => group.current.map(item => item.index)));
  const duplicateBarcodeByIndex = new Map<number, { barcode: string; names: string[] }>();
  duplicateBarcodeGroups.forEach(group => {
    group.indices.forEach(index => duplicateBarcodeByIndex.set(index, { barcode: group.barcode, names: group.names }));
  });
  const catalogConflictByIndex = new Map<number, CatalogBarcodeConflictGroup>();
  catalogBarcodeConflicts.forEach(group => {
    group.current.forEach(item => catalogConflictByIndex.set(item.index, group));
  });

  const regenerateVariantBarcode = async (index: number) => {
    const excludeId = variants[index]?.id;
    const barcode = await generateUniqueBarcode(excludeId);
    setVariants(prev => prev.map((variant, i) => i === index ? { ...variant, barcode, _expanded: true } : variant));
    setCatalogBarcodeConflicts(prev => prev
      .map(group => ({ ...group, current: group.current.filter(item => item.index !== index) }))
      .filter(group => group.current.length > 0));
  };

  async function findCatalogBarcodeConflicts(): Promise<CatalogBarcodeConflictGroup[]> {
    const checks = variants
      .map(variant => ({
        barcode: variant.barcode?.trim() ?? '',
        excludeVariantId: variant.id ?? null,
      }))
      .filter(check => check.barcode);
    if (checks.length === 0) return [];

    const conflicts = await invoke<BarcodeConflictVariant[]>('find_barcode_conflicts', { checks });
    const byBarcode = new Map<string, BarcodeConflictVariant[]>();
    conflicts.forEach(conflict => {
      byBarcode.set(conflict.barcode, [...(byBarcode.get(conflict.barcode) ?? []), conflict]);
    });

    return Array.from(byBarcode.entries()).map(([barcode, existing]) => ({
      barcode,
      existing,
      current: variants
        .map((variant, index) => ({ variant, index }))
        .filter(({ variant }) => variant.barcode?.trim() === barcode)
        .map(({ variant, index }) => ({ index, name: variantDisplayName(variant, index, t) })),
    })).filter(group => group.current.length > 0 && group.existing.length > 0);
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
  // Load each fetched set of existing variants into the form once. This is done
  // during render (React's "adjust state when a prop changes" pattern), not in an effect.
  const [syncedVariants, setSyncedVariants] = useState<ProductVariant[] | undefined>(undefined);
  if (isEditing && existingVariants && existingVariants !== syncedVariants) {
    setSyncedVariants(existingVariants);
    // Existing variants start collapsed — only the one the merchant opens
    // expands, keeping a long edit list scannable.
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
      _expanded: false,
    })));
  }
  // Seed one prefilled variant on create. Done via a ref-guarded effect rather
  // than a lazy initializer because generating its SKU/barcode at module load
  // would run even when editing. The seeded barcode is then checked against the
  // catalog and regenerated if it happens to collide (two products can't share a
  // barcode).
  const seededRef = useRef(false);
  useEffect(() => {
    if (!isEditing && !seededRef.current) {
      seededRef.current = true;
      setVariants([makeBlankVariant(form.name, generateSkuValue, generateBarcodeValue)]);
      // Fix up the seeded barcode to be catalog-unique (fresh variant has no id).
      generateUniqueBarcode().then(bc => {
        setVariants(prev => prev.length > 0 ? [{ ...prev[0], barcode: bc }, ...prev.slice(1)] : prev);
      });
    }
  }, [isEditing, form.name]);

  const createMutation = useMutation({
    mutationFn: (data: CreateProduct) => invoke<Product>('create_product', { data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['low-stock'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-valuation'] });
    },
  });
  const updateMutation = useMutation({
    mutationFn: (data: UpdateProduct) => invoke('update_product', { data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['low-stock'] });
      queryClient.invalidateQueries({ queryKey: ['product-variants'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-valuation'] });
    },
  });

  // Build the payload and send it. The product + its variants are saved in one
  // atomic backend call, so uniqueness/ordering issues surface as a single error.
  const handleSubmit = async () => {
    if (variants.length === 0) {
      toast.error(t('addProduct.variantRequired'));
      return;
    }
    const duplicateGroups = getDuplicateBarcodeGroups(variants, t);
    if (duplicateGroups.length > 0) {
      const duplicateIndices = new Set(duplicateGroups.flatMap(group => group.indices));
      setVariants(prev => prev.map((variant, index) => ({
        ...variant,
        _expanded: duplicateIndices.has(index) ? true : variant._expanded,
      })));
      const details = duplicateGroups
        .map(group => `${group.barcode}: ${group.names.join(', ')}`)
        .join(' · ');
      toast.error(t('addProduct.duplicateBarcodeFound', { details }));
      return;
    }
    const catalogConflicts = await findCatalogBarcodeConflicts();
    if (catalogConflicts.length > 0) {
      const conflictIndices = new Set(catalogConflicts.flatMap(group => group.current.map(item => item.index)));
      setVariants(prev => prev.map((variant, index) => ({
        ...variant,
        _expanded: conflictIndices.has(index) ? true : variant._expanded,
      })));
      setCatalogBarcodeConflicts(catalogConflicts);
      toast.error(t('addProduct.barcodeUsedByOther'));
      return;
    }
    setCatalogBarcodeConflicts([]);
    const payload = {
      name: form.name,
      category_id: form.category_id,
      description: form.description || null,
      image_path: serializeImages(images),
      // Strip UI-only fields (_expanded, _id) before sending to the backend.
      variants: variants.map((variant): VariantInput => {
        const payloadVariant: Partial<typeof variant> = { ...variant };
        delete payloadVariant._expanded;
        delete payloadVariant._id;
        return payloadVariant as VariantInput;
      }),
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
      const msg = typeof err === 'string' ? err : (err instanceof Error ? err.message : t('toast.error'));
      // A duplicate barcode trips the unique index on save. Surface a clear
      // message so the merchant knows to regenerate rather than debug a raw error.
      if (/barcode/i.test(msg) && /unique/i.test(msg)) {
        toast.error(t('toast.duplicateBarcode'));
      } else {
        toast.error(msg);
      }
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
    // Collapse all existing variants so the form stays compact, then append a
    // single expanded blank variant the merchant can fill in right away.
    setVariants(prev => [
      ...prev.map(v => ({ ...v, _expanded: false })),
      makeBlankVariant(form.name, generateSkuValue, generateBarcodeValue),
    ]);
    // Make the new variant's barcode catalog-unique. Fresh variant has no id,
    // so no exclusion — the unique DB index is the final guard on save.
    generateUniqueBarcode().then(bc => {
      setVariants(prev => {
        if (prev.length === 0) return prev;
        const next = [...prev];
        next[next.length - 1] = { ...next[next.length - 1], barcode: bc };
        return next;
      });
    });
  };
  const removeVariant = (idx: number) => {
    setVariants(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);
  };

  const totalStock = variants.reduce((s, v) => s + (v.quantity ?? 0), 0);

  return (
    <div className="p-8 animate-fade-up">
      <div className="flex items-start justify-between gap-4 mb-7">
        <div className="flex items-start gap-2 min-w-0">
          <button type="button" onClick={onBack} aria-label={t('common.back')} title={t('common.back')}
            className="mt-1 -ml-2 p-2 rounded-xl text-text-secondary hover:bg-card hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30">
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0">
            <span className="eyebrow-accent mb-3 flex w-fit">{t('sidebar.groupStock')}</span>
            <h2 className="page-title">{isEditing ? t('addProduct.editTitle') : t('addProduct.title')}</h2>
            <p className="page-subtitle">
              {isEditing ? t('addProduct.editSubtitle') : t('addProduct.newSubtitle')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <button type="button" onClick={onBack} className="btn-secondary">
            {t('common.cancel')}
          </button>
          <button type="button" onClick={handleSubmit} disabled={!form.name || createMutation.isPending} className="btn-primary">
            {createMutation.isPending || updateMutation.isPending ? t('addProduct.saving') : (isEditing ? t('addProduct.saveChanges') : t('addProduct.saveProduct'))}
          </button>
        </div>
      </div>

      <div className="space-y-6">
        <section className="card p-6">
          <div className="flex items-center gap-2 mb-5">
            <Info size={16} className="text-text-muted" />
            <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-text-primary">{t('addProduct.basicInformation')}</h3>
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
            <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-text-primary">{t('addProduct.productVariants')}</h3>
          </div>
          <p className="text-[13px] text-text-muted mb-4">{t('addProduct.variantsDesc')}</p>
          {duplicateBarcodeGroups.length > 0 && (
            <div className="mb-4 rounded-xl border border-accent-red/30 bg-accent-red/10 px-4 py-3">
              <p className="text-[13px] font-semibold text-accent-red">{t('addProduct.duplicateBarcodeDetected')}</p>
              <div className="mt-1.5 space-y-1">
                {duplicateBarcodeGroups.map(group => (
                  <p key={group.barcode} className="text-[13px] text-accent-red/90">
                    <span className="font-mono font-semibold">{group.barcode}</span>
                    {' '}{t('addProduct.barcodeUsedBy', { names: group.names.join(t('addProduct.listAnd')) })}
                  </p>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            {variants.map((v, i) => (
              <VariantCard
                key={v._id ?? `new-${i}`}
                index={i}
                variant={v}
                canRemove={variants.length > 1}
                onChange={(patch) => {
                  if ('barcode' in patch) setCatalogBarcodeConflicts([]);
                  setVariants(prev => prev.map((vv, j) => j === i ? { ...vv, ...patch } : vv));
                }}
                onToggle={() => setVariants(prev => prev.map((vv, j) => j === i ? { ...vv, _expanded: !vv._expanded } : vv))}
                onRemove={() => removeVariant(i)}
                onImageSelect={() => handleVariantImageSelect(i)}
                onGenSku={() => setVariants(prev => prev.map((vv, j) => j === i ? { ...vv, sku: generateSkuValue(form.name) } : vv))}
                onGenBarcode={() => {
                  // Regenerate a fresh unique barcode for this variant. Excludes
                  // the variant's own id when editing so it can keep its value.
                  const id = v.id;
                  generateUniqueBarcode(id).then(bc => {
                    setVariants(prev => prev.map((vv, j) => j === i ? { ...vv, barcode: bc } : vv));
                    setCatalogBarcodeConflicts([]);
                  });
                }}
                duplicateBarcode={duplicateBarcodeIndices.has(i) || catalogBarcodeConflictIndices.has(i)}
                duplicateBarcodeMessage={duplicateBarcodeByIndex.get(i)?.names
                  .filter(name => name !== variantDisplayName(v, i, t))
                  .join(t('addProduct.listAnd')) || catalogConflictByIndex.get(i)?.existing
                    .map(existing => `${existing.product_name} / ${existing.variant_name}`)
                    .join(t('addProduct.listAnd'))}
              />
            ))}
            <button onClick={addVariant}
              className="w-full py-2.5 rounded-xl border border-dashed border-border text-[13px] font-medium text-text-secondary hover:bg-card hover:border-navy/30 hover:text-navy transition-colors flex items-center justify-center gap-1.5">
              <Plus size={14} /> {t('addProduct.addNewVariant')}
            </button>
          </div>

          <div className="mt-4 px-4 py-2.5 rounded-xl bg-surface border border-border-light text-[13px] text-text-muted flex items-center justify-between">
            <span>{t('addProduct.totalStockLabel')}</span>
            <span className="font-semibold text-text-primary tabular-nums">{t('addProduct.unitsCount', { count: totalStock })}</span>
          </div>
        </section>

        <section className="card p-6">
          <div className="flex items-center gap-2 mb-4">
            <ImagePlus size={16} className="text-text-muted" />
            <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-text-primary">{t('addProduct.productImages')}</h3>
            {images.length > 0 && (
              <span className="text-[13px] text-text-muted ml-auto">{t('addProduct.imagesCount', { count: images.length, plural: images.length > 1 ? 's' : '' })}</span>
            )}
          </div>
          <div
            onClick={handleImageSelect}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={handleDrop}
            className="border-2 border-dashed border-border rounded-2xl p-5 flex flex-col items-center justify-center cursor-pointer hover:border-navy/30 hover:bg-navy/5 transition-colors mb-4"
          >
            <Cloud size={24} className="text-text-muted mb-1.5" />
            <p className="text-[13px] font-medium text-text-primary">{t('addProduct.dragDropImages')}</p>
            <p className="text-[13px] text-text-muted mt-0.5">{t('addProduct.imagesFormat')}</p>
            <button type="button" onClick={(e) => { e.stopPropagation(); handleImageSelect(); }}
              className="mt-3 px-4 py-1.5 rounded-lg border border-border text-[13px] font-medium text-text-secondary hover:bg-card transition-colors">
              {t('addProduct.browseFiles')}
            </button>
          </div>
          {images.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {images.map((img, idx) => (
                <div key={idx} className={`relative group w-20 h-20 rounded-lg overflow-hidden border-2 transition-colors ${idx === 0 ? 'border-navy' : 'border-border'}`}>
                  <img src={convertFileSrc(img)} alt={t('addProduct.imageAlt', { n: idx + 1 })} className="w-full h-full object-cover" />
                  {idx === 0 && (
                    <div className="absolute top-0 left-0 px-1.5 py-0.5 bg-navy text-white text-[13px] font-semibold rounded-br">
                      <Star size={8} className="inline mr-0.5" />{t('addProduct.cover')}
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                    {idx > 0 && (
                      <button type="button" aria-label={t('addProduct.moveImageUp')} title={t('addProduct.moveImageUp')} onClick={(e) => { e.stopPropagation(); moveImage(idx, -1); }} className="p-0.5 rounded bg-card/90 text-text-primary hover:bg-card transition-colors">
                        <ChevronDown size={12} className="rotate-90" />
                      </button>
                    )}
                    {idx < images.length - 1 && (
                      <button type="button" aria-label={t('addProduct.moveImageDown')} title={t('addProduct.moveImageDown')} onClick={(e) => { e.stopPropagation(); moveImage(idx, 1); }} className="p-0.5 rounded bg-card/90 text-text-primary hover:bg-card transition-colors">
                        <ChevronUp size={12} className="rotate-90" />
                      </button>
                    )}
                    <button type="button" aria-label={t('common.remove')} title={t('common.remove')} onClick={(e) => { e.stopPropagation(); removeImage(idx); }} className="p-0.5 rounded bg-accent-red text-white hover:brightness-110 transition-[filter]">
                      <X size={12} />
                    </button>
                  </div>
                </div>
              ))}
              <button type="button" onClick={handleImageSelect} aria-label={t('addProduct.browseFiles')}
                className="w-20 h-20 rounded-lg border-2 border-dashed border-border flex items-center justify-center cursor-pointer hover:border-navy/30 hover:bg-navy/5 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30">
                <Plus size={18} className="text-text-muted" />
              </button>
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

      {catalogBarcodeConflicts.length > 0 && (
        <BarcodeConflictModal
          groups={catalogBarcodeConflicts}
          onClose={() => setCatalogBarcodeConflicts([])}
          onRegenerate={regenerateVariantBarcode}
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
  duplicateBarcode?: boolean;
  duplicateBarcodeMessage?: string;
}

function VariantCard({
  index, variant, canRemove, onChange, onToggle, onRemove, onImageSelect, onGenSku, onGenBarcode,
  duplicateBarcode, duplicateBarcodeMessage,
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
      } catch {
        // JsBarcode rejects some values; the preview is then simply left empty
      }
    }
  }, [variant.barcode]);

  const profit = variant.selling_price - variant.cost_price;
  const profitPct = variant.selling_price > 0 ? ((profit / variant.selling_price) * 100).toFixed(0) : '0';

  return (
    <div className={`rounded-xl border overflow-hidden ${duplicateBarcode ? 'border-accent-red ring-2 ring-accent-red/10' : 'border-border'}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={variant._expanded !== false}
        className={`w-full flex items-center gap-2 px-3.5 py-2.5 hover:bg-card transition-colors text-left focus-visible:outline-none focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-navy/30 ${duplicateBarcode ? 'bg-accent-red/10' : 'bg-surface'}`}
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
        <span className="text-[13px] text-text-muted">{t('addProduct.unitsCount', { count: variant.quantity ?? 0 })}</span>
        {variant._expanded ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
      </button>

      {variant._expanded !== false && (
        <div className="px-3.5 py-3 space-y-3 bg-card">
          <div className="grid grid-cols-2 gap-2.5">
            <Field label={t('addProduct.variantNameLabel')} required>
              <input value={variant.variant_name} onChange={(e) => onChange({ variant_name: e.target.value })}
                placeholder={t('addProduct.variantNamePlaceholder')} className="form-input !py-1.5 !text-[13px]" />
            </Field>
            <Field label={t('addProduct.conditionNoteLabel')}>
              <input value={variant.condition_note ?? ''} onChange={(e) => onChange({ condition_note: e.target.value || undefined })}
                placeholder={t('addProduct.conditionPlaceholder')} className="form-input !py-1.5 !text-[13px]" />
            </Field>
          </div>

          {/* SKU */}
          <Field label={t('addProduct.variantSku')}>
            <div className="flex items-center gap-2">
              <input value={variant.sku ?? ''} onChange={(e) => onChange({ sku: e.target.value || undefined })}
                placeholder="HPS-..." className="form-input !py-1.5 !text-[13px] font-mono flex-1" />
              <button type="button" onClick={onGenSku}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border text-[13px] font-medium text-text-secondary hover:bg-surface transition-colors flex-shrink-0">
                <RefreshCw size={12} /> {t('barcode.generate')}
              </button>
            </div>
          </Field>

          {/* Barcode */}
          <Field label={t('addProduct.variantBarcode')}>
            <div className="flex items-center gap-2">
              <input value={variant.barcode ?? ''} onChange={(e) => onChange({ barcode: e.target.value || undefined })}
                placeholder="EAN-13"
                className={`form-input !py-1.5 !text-[13px] font-mono flex-1 ${duplicateBarcode ? '!border-accent-red !bg-accent-red/10 focus:!ring-accent-red/15 focus:!border-accent-red' : ''}`} />
              <button type="button" onClick={onGenBarcode}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border text-[13px] font-medium text-text-secondary hover:bg-surface transition-colors flex-shrink-0">
                <RefreshCw size={12} /> {t('barcode.generate')}
              </button>
            </div>
            {duplicateBarcode && (
              <p className="mt-1.5 text-[13px] font-medium text-accent-red">
                {t('addProduct.sameBarcodeAs', { names: duplicateBarcodeMessage ?? '' })}
              </p>
            )}
            {variant.barcode && (
              <div className="mt-2 flex justify-center p-2 rounded-lg bg-surface border border-border">
                <svg ref={barcodeSvgRef} className="h-9" />
              </div>
            )}
          </Field>

          <div className="grid grid-cols-3 gap-2.5">
            <Field label={t('addProduct.stockQtyLabel')}>
              <input type="number" value={variant.quantity ?? 0} onChange={(e) => onChange({ quantity: parseInt(e.target.value) || 0 })}
                placeholder="0" className="form-input !py-1.5 !text-[13px]" />
            </Field>
            <Field label={t('addProduct.costDaLabel')}>
              <input type="number" step="0.01" value={variant.cost_price} onChange={(e) => onChange({ cost_price: parseFloat(e.target.value) || 0 })}
                placeholder="0.00" className="form-input !py-1.5 !text-[13px]" />
            </Field>
            <Field label={t('addProduct.sellDaLabel')}>
              <input type="number" step="0.01" value={variant.selling_price} onChange={(e) => onChange({ selling_price: parseFloat(e.target.value) || 0 })}
                placeholder="0.00" className="form-input !py-1.5 !text-[13px]" />
            </Field>
          </div>

          {/* Profit readout (threshold is no longer surfaced in the UI). */}
          <div className="w-full px-2.5 py-1.5 rounded-lg bg-surface border border-border-light text-[13px] text-text-muted">
            {t('addProduct.profitPerUnit')} <span className="font-semibold text-accent-green tabular-nums">{profit.toFixed(0)}&lrm; DA</span> <span className="text-text-muted">({profitPct}%)</span>
          </div>

          {/* Variant image */}
          <div>
            <label className="block text-[13px] font-medium text-text-secondary mb-1.5">{t('addProduct.variantImage')}</label>
            {variant.image_path ? (
              <div className="flex items-center gap-2">
                <img src={convertFileSrc(variant.image_path)} alt="" className="w-14 h-14 rounded-lg object-cover border border-border" />
                <button onClick={() => onChange({ image_path: undefined })}
                  className="text-[13px] text-accent-red hover:underline">{t('common.remove')}</button>
                <button onClick={onImageSelect}
                  className="text-[13px] text-navy hover:underline">{t('addProduct.change')}</button>
              </div>
            ) : (
              <button onClick={onImageSelect}
                className="w-full py-2.5 rounded-lg border border-dashed border-border text-[13px] text-text-muted hover:border-navy/30 hover:bg-navy/5 transition-colors flex items-center justify-center gap-1.5">
                <ImagePlus size={13} /> {t('addProduct.addImage')}
              </button>
            )}
          </div>

          {canRemove && (
            <button onClick={onRemove}
              className="flex items-center gap-1 text-[13px] text-accent-red hover:underline">
              <Trash2 size={12} /> {t('addProduct.removeVariant')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function BarcodeConflictModal({
  groups,
  onClose,
  onRegenerate,
}: {
  groups: CatalogBarcodeConflictGroup[];
  onClose: () => void;
  onRegenerate: (index: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-3xl max-h-[86vh] overflow-hidden rounded-2xl bg-card border border-border shadow-raised"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-border-light">
          <div>
            <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-text-primary">{t('addProduct.barcodeConflict')}</h3>
            <p className="text-[13px] text-text-secondary mt-0.5">
              {t('addProduct.barcodeConflictDesc')}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}
            className="p-1.5 rounded-lg text-text-muted hover:bg-surface hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto max-h-[calc(86vh-76px)]">
          {groups.map(group => (
            <div key={group.barcode} className="rounded-xl border border-accent-red/30 bg-accent-red/5 overflow-hidden">
              <div className="px-4 py-3 border-b border-accent-red/20">
                <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-accent-red">{t('addProduct.duplicateBarcode')}</p>
                <p className="mt-0.5 font-mono text-[14px] font-semibold text-text-primary">{group.barcode}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
                <div className="p-4 border-b md:border-b-0 md:border-r border-accent-red/20">
                  <h4 className="text-[13px] font-semibold text-text-primary mb-2">{t('addProduct.currentForm')}</h4>
                  <div className="space-y-2">
                    {group.current.map(current => (
                      <div key={current.index} className="rounded-lg border border-border bg-card px-3 py-2">
                        <p className="text-[13px] font-medium text-text-primary">{current.name}</p>
                        <p className="text-[13px] text-text-muted mt-0.5">{t('addProduct.variantNumber', { n: current.index + 1 })}</p>
                        <button
                          type="button"
                          onClick={() => onRegenerate(current.index)}
                          className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-[13px] font-medium text-text-secondary hover:bg-surface transition-colors"
                        >
                          <RefreshCw size={12} />
                          {t('addProduct.regenerateBarcode')}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-4">
                  <h4 className="text-[13px] font-semibold text-text-primary mb-2">{t('addProduct.alreadyInCatalog')}</h4>
                  <div className="space-y-2">
                    {group.existing.map(existing => (
                      <div key={existing.variant_id} className="rounded-lg border border-border bg-card px-3 py-2">
                        <p className="text-[13px] font-medium text-text-primary">{existing.product_name}</p>
                        <p className="text-[13px] text-text-secondary mt-0.5">
                          {existing.variant_name} · {existing.category_name ?? t('checkout.uncategorized')}
                        </p>
                        <p className="text-[13px] text-text-muted mt-0.5">
                          {t('products.variantStockPrice', { count: existing.quantity, price: existing.selling_price.toFixed(2) })}
                          {existing.sku ? ` · ${existing.sku}` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
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

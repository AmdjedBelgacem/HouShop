import { useI18n } from '../i18n';
import CustomSelect from './CustomSelect';
import { Search, X } from 'lucide-react';
import type { ProductFilterState } from '../hooks/useProductFilterState';
import type { Category } from '../lib/types';

interface ProductFilterProps {
  filters: ProductFilterState;
  onChange: (filters: ProductFilterState) => void;
  onClear: () => void;
  categories: Category[];
  showCategoryFilter?: boolean;
  showPriceFilter?: boolean;
  showStockFilter?: boolean;
  placeholder?: string;
}

export default function ProductFilter({
  filters,
  onChange,
  onClear,
  categories,
  showCategoryFilter = true,
  showPriceFilter = true,
  showStockFilter = true,
  placeholder,
}: ProductFilterProps) {
  const { t } = useI18n();

  const updateFilters = (updates: Partial<ProductFilterState>) => {
    onChange({ ...filters, ...updates });
  };

  const hasActiveFilters =
    !!filters.search ||
    filters.categoryId != null ||
    !!filters.minPrice ||
    !!filters.maxPrice ||
    filters.stockStatus !== 'all';

  const categoryOptions = [
    { value: '', label: t('common.allCategories') },
    ...(categories ?? []).map(c => ({ value: String(c.id), label: c.name })),
  ];

  const stockOptions = [
    { value: 'all', label: t('filter.allStock') },
    { value: 'in-stock', label: t('filter.inStock') },
    { value: 'out-of-stock', label: t('filter.outOfStock') },
  ];

  return (
    <div className="card px-4 py-3 mb-5">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder={placeholder ?? t('products.searchPlaceholder')}
            value={filters.search}
            onChange={(e) => updateFilters({ search: e.target.value })}
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-border text-[13px] focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy/30 placeholder:text-text-muted bg-surface"
          />
        </div>

        {showCategoryFilter && (
          <CustomSelect
            value={filters.categoryId != null ? String(filters.categoryId) : ''}
            onChange={(v) => updateFilters({ categoryId: v ? Number(v) : null })}
            options={categoryOptions}
            size="sm"
            className="w-[180px]"
          />
        )}

        {showPriceFilter && (
          <>
            <input
              type="number"
              placeholder={t('filter.minPrice')}
              value={filters.minPrice}
              onChange={(e) => updateFilters({ minPrice: e.target.value })}
              className="w-[100px] px-3 py-2 rounded-lg border border-border text-[13px] focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy/30 placeholder:text-text-muted bg-surface"
            />
            <span className="text-text-muted text-[13px]">-</span>
            <input
              type="number"
              placeholder={t('filter.maxPrice')}
              value={filters.maxPrice}
              onChange={(e) => updateFilters({ maxPrice: e.target.value })}
              className="w-[100px] px-3 py-2 rounded-lg border border-border text-[13px] focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy/30 placeholder:text-text-muted bg-surface"
            />
          </>
        )}

        {showStockFilter && (
          <CustomSelect
            value={filters.stockStatus}
            onChange={(v) => updateFilters({ stockStatus: v as ProductFilterState['stockStatus'] })}
            options={stockOptions}
            size="sm"
            className="w-[140px]"
          />
        )}
      </div>

      {hasActiveFilters && (
        <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-border-light">
          <span className="text-[11px] text-text-muted">
            {t('filter.activeFilters')}
          </span>
          <button
            onClick={onClear}
            className="flex items-center gap-1 text-[12px] text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={12} /> {t('filter.clearFilters')}
          </button>
        </div>
      )}
    </div>
  );
}

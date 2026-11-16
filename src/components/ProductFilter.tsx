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

const fieldClass = 'rounded-xl border border-border bg-surface text-[13px] text-text-primary placeholder:text-text-muted transition-[border-color,box-shadow] duration-150 focus:outline-none focus:ring-[3px] focus:ring-navy/20 focus:border-navy';

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
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            type="text"
            aria-label={placeholder ?? t('products.searchPlaceholder')}
            placeholder={placeholder ?? t('products.searchPlaceholder')}
            value={filters.search}
            onChange={(e) => updateFilters({ search: e.target.value })}
            className={`w-full ps-9 pe-3.5 py-2 ${fieldClass}`}
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
          <div className="flex shrink-0 items-center gap-2.5">
            <input
              type="number"
              aria-label={t('filter.minPrice')}
              placeholder={t('filter.minPrice')}
              value={filters.minPrice}
              onChange={(e) => updateFilters({ minPrice: e.target.value })}
              className={`w-[124px] px-3 py-2 tabular-nums ${fieldClass}`}
            />
            <span className="text-text-muted text-[13px]" aria-hidden="true">–</span>
            <input
              type="number"
              aria-label={t('filter.maxPrice')}
              placeholder={t('filter.maxPrice')}
              value={filters.maxPrice}
              onChange={(e) => updateFilters({ maxPrice: e.target.value })}
              className={`w-[124px] px-3 py-2 tabular-nums ${fieldClass}`}
            />
          </div>
        )}

        {showStockFilter && (
          <CustomSelect
            value={filters.stockStatus}
            onChange={(v) => updateFilters({ stockStatus: v as ProductFilterState['stockStatus'] })}
            options={stockOptions}
            size="sm"
            className="w-[168px]"
          />
        )}
      </div>

      {hasActiveFilters && (
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border-light">
          <span className="text-[13px] text-text-muted">
            {t('filter.activeFilters')}
          </span>
          <button
            type="button"
            onClick={onClear}
            className="flex items-center gap-1.5 px-2 py-1 -mr-2 rounded-lg text-[13px] font-medium text-navy hover:bg-navy/5 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/20"
          >
            <X size={12} /> {t('filter.clearFilters')}
          </button>
        </div>
      )}
    </div>
  );
}

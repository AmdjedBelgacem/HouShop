import { useState, useCallback } from 'react';

export interface ProductFilterState {
  search: string;
  categoryId: number | null;
  minPrice: string;
  maxPrice: string;
  stockStatus: 'all' | 'in-stock' | 'out-of-stock';
}

export const DEFAULT_FILTERS: ProductFilterState = {
  search: '',
  categoryId: null,
  minPrice: '',
  maxPrice: '',
  stockStatus: 'all',
};

export function loadFilterState(
  storageKey: string,
  initialFilters: Partial<ProductFilterState> = {}
): ProductFilterState {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { ...DEFAULT_FILTERS, ...initialFilters };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_FILTERS, ...initialFilters, ...parsed };
  } catch {
    return { ...DEFAULT_FILTERS, ...initialFilters };
  }
}

function saveFilterState(storageKey: string, state: ProductFilterState) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Non-critical
  }
}

export function useProductFilterState(
  storageKey: string,
  initialFilters: Partial<ProductFilterState> = {}
) {
  const [filters, setFilters] = useState<ProductFilterState>(() =>
    loadFilterState(storageKey, initialFilters)
  );

  const updateFilters = useCallback((updates: Partial<ProductFilterState>) => {
    setFilters(prev => {
      const next = { ...prev, ...updates };
      saveFilterState(storageKey, next);
      return next;
    });
  }, [storageKey]);

  const clearFilters = useCallback(() => {
    updateFilters({ ...DEFAULT_FILTERS });
  }, [updateFilters]);

  return { filters, updateFilters, clearFilters };
}

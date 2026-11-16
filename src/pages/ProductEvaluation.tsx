import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { useI18n } from '../i18n';
import type { InventoryValuationSummary, InventoryValuationProduct } from '../lib/types';
import {
  Calculator,
  ChevronDown,
  ChevronUp,
  Eye,
  Layers,
  TrendingUp,
  WalletCards,
} from 'lucide-react';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30';

function formatMoney(value: number): string {
  return `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\u200E DA`;
}

function profitTone(value: number): string {
  if (value > 0) return 'text-accent-green';
  if (value < 0) return 'text-accent-red';
  return 'text-text-secondary';
}

export default function ProductEvaluation() {
  const { t } = useI18n();
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [expandedProductId, setExpandedProductId] = useState<number | null>(null);
  const { data: valuation, isLoading } = useQuery({
    queryKey: ['inventory-valuation'],
    queryFn: () => invoke<InventoryValuationSummary>('get_inventory_valuation'),
  });

  const visibleCategories = categoryFilter === 'all'
    ? (valuation?.categories ?? [])
    : (valuation?.categories ?? []).filter(category => category.name === categoryFilter);
  const visibleProducts = visibleCategories.flatMap(category => category.products);
  const selectedScope = categoryFilter === 'all'
    ? valuation
    : valuation?.categories.find(category => category.name === categoryFilter);
  const scopeCost = selectedScope?.total_cost ?? 0;
  const scopeRevenue = selectedScope?.projected_revenue ?? 0;
  const scopeProfit = selectedScope?.projected_profit ?? 0;
  const scopeQty = selectedScope?.quantity ?? 0;
  const margin = scopeRevenue > 0 ? (scopeProfit / scopeRevenue) * 100 : 0;
  const productsByCost = [...visibleProducts].sort((a, b) => b.total_cost - a.total_cost);

  return (
    <div className="p-8 animate-fade-up">
      <div className="mb-7 flex items-start justify-between gap-4">
        <div>
          <span className="eyebrow-accent mb-3 flex w-fit">{t('sidebar.groupStock')}</span>
          <h2 className="page-title">{t('sidebar.productEvaluation')}</h2>
          <p className="page-subtitle">{t('eval.subtitle')}</p>
        </div>
        <div className="hidden md:flex h-11 w-11 items-center justify-center rounded-xl bg-navy/10 text-navy">
          <Calculator size={21} />
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <ValuationMetric label={t('eval.totalCost')} value={formatMoney(scopeCost)} icon={<WalletCards size={16} />} />
        <ValuationMetric label={t('eval.projectedRevenue')} value={formatMoney(scopeRevenue)} icon={<Eye size={16} />} />
        <ValuationMetric label={t('eval.projectedProfit')} value={formatMoney(scopeProfit)} icon={<TrendingUp size={16} />} tone={profitTone(scopeProfit)} sub={t('eval.margin', { value: margin.toFixed(1) })} />
        <ValuationMetric label={t('eval.unitsAvailable')} value={scopeQty.toLocaleString('en-US')} icon={<Layers size={16} />} />
      </div>

      <section className="card p-5 mb-6">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="text-[15px] font-semibold text-text-primary">{t('eval.categoryTotals')}</h3>
            <p className="text-[13px] text-text-secondary mt-0.5">{t('eval.categoryTotalsDesc')}</p>
          </div>
          <button
            type="button"
            onClick={() => setCategoryFilter('all')}
            aria-pressed={categoryFilter === 'all'}
            className={`btn-secondary px-3.5 py-1.5 text-[13px] rounded-lg ${FOCUS} ${
              categoryFilter === 'all' ? 'border-navy/30 bg-navy/10 text-navy' : ''
            }`}
          >
            {t('eval.allCategories')}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {(valuation?.categories ?? []).map(category => {
            const active = categoryFilter === category.name;
            return (
              <button
                key={category.name}
                type="button"
                onClick={() => setCategoryFilter(category.name)}
                aria-pressed={active}
                className={`rounded-xl border px-4 py-3.5 text-start transition-colors ${FOCUS} ${
                  active
                    ? 'border-navy/40 bg-navy/[0.06]'
                    : 'border-border-light bg-surface/60 hover:bg-surface'
                }`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-[14px] font-semibold text-text-primary truncate">{category.name}</span>
                  <span className="text-[13px] text-text-muted tabular-nums whitespace-nowrap">{t('eval.units', { count: category.quantity })}</span>
                </span>
                <span className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
                  <span className="block text-text-secondary">
                    {t('eval.cost')}
                    <span className="block mt-0.5 text-[13px] font-semibold text-text-primary tabular-nums">{formatMoney(category.total_cost)}</span>
                  </span>
                  <span className="block text-end text-text-secondary">
                    {t('eval.profit')}
                    <span className={`block mt-0.5 text-[13px] font-semibold tabular-nums ${profitTone(category.projected_profit)}`}>{formatMoney(category.projected_profit)}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-border-light flex items-center justify-between gap-4">
          <div>
            <h3 className="text-[15px] font-semibold text-text-primary">{t('eval.tableTitle')}</h3>
            <p className="text-[13px] text-text-secondary mt-0.5">{t('eval.tableDesc')}</p>
          </div>
          <span className="badge bg-surface text-text-secondary text-[13px] whitespace-nowrap">
            {categoryFilter === 'all' ? t('eval.allCategories') : categoryFilter}
          </span>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[900px]">
            <div className="grid grid-cols-[minmax(220px,1fr)_90px_150px_150px_150px] gap-3 px-5 py-2.5 bg-surface/60 border-b border-border-light text-[13px] font-medium text-text-muted">
              <span>{t('eval.product')}</span>
              <span className="text-end">{t('eval.unitsCol')}</span>
              <span className="text-end">{t('eval.cost')}</span>
              <span className="text-end">{t('eval.revenue')}</span>
              <span className="text-end">{t('eval.profit')}</span>
            </div>
            {isLoading ? (
              <p className="px-5 py-14 text-center text-[13px] text-text-muted">{t('eval.loading')}</p>
            ) : productsByCost.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-5 py-14 text-center">
                <span className="w-11 h-11 rounded-full bg-surface text-text-muted flex items-center justify-center">
                  <Calculator size={20} />
                </span>
                <p className="text-[13px] text-text-secondary">{t('eval.empty')}</p>
              </div>
            ) : (
              productsByCost.map(product => (
                <ProductValuationRow
                  key={product.id}
                  product={product}
                  expanded={expandedProductId === product.id}
                  onToggle={() => setExpandedProductId(prev => prev === product.id ? null : product.id)}
                />
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function ProductValuationRow({
  product,
  expanded,
  onToggle,
}: {
  product: InventoryValuationProduct;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="border-b border-border-light last:border-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={`w-full grid grid-cols-[minmax(220px,1fr)_90px_150px_150px_150px] gap-3 px-5 py-3.5 text-start hover:bg-surface transition-colors ${FOCUS}`}
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2 min-w-0">
            {expanded ? <ChevronUp size={13} className="text-text-muted shrink-0" /> : <ChevronDown size={13} className="text-text-muted shrink-0" />}
            <span className="truncate text-[13px] font-semibold text-text-primary">{product.name}</span>
          </span>
          <span className="block ps-5 mt-0.5 text-[13px] text-text-muted">
            {product.category_name ?? t('eval.uncategorized')} · {t('eval.variants', { count: product.variants.length })}
          </span>
        </span>
        <span className="text-end text-[13px] text-text-secondary tabular-nums">{product.quantity}</span>
        <span className="text-end text-[13px] font-semibold text-text-primary tabular-nums">{formatMoney(product.total_cost)}</span>
        <span className="text-end text-[13px] text-text-secondary tabular-nums">{formatMoney(product.projected_revenue)}</span>
        <span className={`text-end text-[13px] font-semibold tabular-nums ${profitTone(product.projected_profit)}`}>{formatMoney(product.projected_profit)}</span>
      </button>
      {expanded && (
        <div className="bg-surface/60 px-5 pb-4">
          <div className="rounded-xl border border-border-light bg-card overflow-hidden">
            {product.variants.map(variant => (
              <div key={variant.id} className="grid grid-cols-[minmax(180px,1fr)_90px_130px_130px_130px] gap-3 px-4 py-2.5 border-b border-border-light last:border-0 text-[13px]">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-text-primary">{variant.variant_name}</span>
                  <span className="text-text-muted tabular-nums">{variant.quantity} × {formatMoney(variant.unit_cost)}</span>
                </span>
                <span className="text-end text-text-secondary tabular-nums">{variant.quantity}</span>
                <span className="text-end text-text-primary tabular-nums">{formatMoney(variant.total_cost)}</span>
                <span className="text-end text-text-secondary tabular-nums">{formatMoney(variant.projected_revenue)}</span>
                <span className={`text-end font-semibold tabular-nums ${profitTone(variant.projected_profit)}`}>{formatMoney(variant.projected_profit)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ValuationMetric({
  label,
  value,
  icon,
  tone,
  sub,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone?: string;
  sub?: string;
}) {
  return (
    <div className="card p-5 min-w-0">
      <div className="flex items-center gap-2 text-text-secondary">
        <span className="text-text-muted">{icon}</span>
        <span className="text-[13px] font-medium truncate">{label}</span>
      </div>
      <p className={`mt-2.5 text-[22px] font-semibold tracking-[-0.02em] tabular-nums truncate ${tone ?? 'text-text-primary'}`}>{value}</p>
      {sub && <p className="text-[13px] text-text-muted mt-0.5">{sub}</p>}
    </div>
  );
}

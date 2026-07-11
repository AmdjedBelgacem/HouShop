import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
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

function formatMoney(value: number): string {
  return `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DA`;
}

function profitTone(value: number): string {
  if (value > 0) return 'text-accent-green';
  if (value < 0) return 'text-accent-red';
  return 'text-text-secondary';
}

export default function ProductEvaluation() {
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
    <div className="p-8">
      <div className="mb-7 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[26px] font-bold text-text-primary leading-tight">Product Evaluation</h2>
          <p className="text-[14px] text-text-secondary mt-1.5">
            Cost basis and projected profit across variants, products, categories, and total inventory.
          </p>
        </div>
        <div className="hidden md:flex h-11 w-11 items-center justify-center rounded-xl bg-navy/10 text-navy">
          <Calculator size={21} />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-5 mb-5">
        <ValuationMetric label="Total Cost" value={formatMoney(scopeCost)} icon={<WalletCards size={16} />} />
        <ValuationMetric label="Projected Revenue" value={formatMoney(scopeRevenue)} icon={<Eye size={16} />} />
        <ValuationMetric label="Projected Profit" value={formatMoney(scopeProfit)} icon={<TrendingUp size={16} />} tone={profitTone(scopeProfit)} />
        <ValuationMetric label="Units Available" value={scopeQty.toLocaleString('en-US')} icon={<Layers size={16} />} sub={`${margin.toFixed(1)}% margin`} />
      </div>

      <section className="card p-5 mb-5">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="text-[15px] font-bold text-text-primary">Category totals</h3>
            <p className="text-[12px] text-text-secondary mt-0.5">Filter valuation by category or compare category totals.</p>
          </div>
          <button
            type="button"
            onClick={() => setCategoryFilter('all')}
            className={`px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-colors ${
              categoryFilter === 'all'
                ? 'border-navy/30 bg-navy/[0.08] text-text-primary'
                : 'border-border bg-surface text-text-secondary hover:bg-card'
            }`}
          >
            All categories
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {(valuation?.categories ?? []).map(category => (
            <button
              key={category.name}
              type="button"
              onClick={() => setCategoryFilter(category.name)}
              className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                categoryFilter === category.name
                  ? 'border-navy/30 bg-navy/[0.08]'
                  : 'border-border bg-surface/40 hover:bg-surface'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-semibold text-text-primary truncate">{category.name}</span>
                <span className="text-[11.5px] text-text-muted">{category.quantity} units</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                <span className="text-text-secondary">Cost<br /><span className="font-semibold text-text-primary">{formatMoney(category.total_cost)}</span></span>
                <span className="text-text-secondary text-right">Profit<br /><span className={`font-semibold ${profitTone(category.projected_profit)}`}>{formatMoney(category.projected_profit)}</span></span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-4">
          <div>
            <h3 className="text-[15px] font-bold text-text-primary">Product and variant valuation</h3>
            <p className="text-[12px] text-text-secondary mt-0.5">
              Expand a product to see each variant's total cost and projected profit.
            </p>
          </div>
          <span className="text-[12px] font-medium text-text-secondary">
            {categoryFilter === 'all' ? 'All categories' : categoryFilter}
          </span>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[900px]">
            <div className="grid grid-cols-[minmax(220px,1fr)_90px_150px_150px_150px] gap-3 px-5 py-3 bg-sidebar/50 border-b border-border text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-muted">
              <span>Product</span>
              <span className="text-right">Units</span>
              <span className="text-right">Cost</span>
              <span className="text-right">Revenue</span>
              <span className="text-right">Profit</span>
            </div>
            {isLoading ? (
              <p className="px-5 py-12 text-center text-text-muted">Loading valuation...</p>
            ) : productsByCost.length === 0 ? (
              <p className="px-5 py-12 text-center text-text-muted">No inventory to evaluate yet.</p>
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
  return (
    <div className="border-b border-border-light last:border-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full grid grid-cols-[minmax(220px,1fr)_90px_150px_150px_150px] gap-3 px-5 py-3 text-left hover:bg-surface/60 transition-colors"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2 min-w-0">
            {expanded ? <ChevronUp size={13} className="text-text-muted shrink-0" /> : <ChevronDown size={13} className="text-text-muted shrink-0" />}
            <span className="truncate text-[13px] font-semibold text-text-primary">{product.name}</span>
          </span>
          <span className="block pl-5 mt-0.5 text-[11px] text-text-muted">
            {product.category_name ?? 'Uncategorized'} · {product.variants.length} variants
          </span>
        </span>
        <span className="text-right text-[13px] text-text-secondary tabular-nums">{product.quantity}</span>
        <span className="text-right text-[13px] font-semibold text-text-primary tabular-nums">{formatMoney(product.total_cost)}</span>
        <span className="text-right text-[13px] text-text-secondary tabular-nums">{formatMoney(product.projected_revenue)}</span>
        <span className={`text-right text-[13px] font-semibold tabular-nums ${profitTone(product.projected_profit)}`}>{formatMoney(product.projected_profit)}</span>
      </button>
      {expanded && (
        <div className="bg-surface/40 px-5 pb-4">
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            {product.variants.map(variant => (
              <div key={variant.id} className="grid grid-cols-[minmax(180px,1fr)_90px_130px_130px_130px] gap-3 px-3 py-2 border-b border-border-light last:border-0 text-[12px]">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-text-primary">{variant.variant_name}</span>
                  <span className="text-text-muted">{variant.quantity} × {formatMoney(variant.unit_cost)}</span>
                </span>
                <span className="text-right text-text-secondary tabular-nums">{variant.quantity}</span>
                <span className="text-right text-text-primary tabular-nums">{formatMoney(variant.total_cost)}</span>
                <span className="text-right text-text-secondary tabular-nums">{formatMoney(variant.projected_revenue)}</span>
                <span className={`text-right font-semibold tabular-nums ${profitTone(variant.projected_profit)}`}>{formatMoney(variant.projected_profit)}</span>
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
    <div className="card px-4 py-3 min-w-0">
      <div className="flex items-center gap-2 text-text-muted">
        {icon}
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] truncate">{label}</span>
      </div>
      <p className={`mt-2 text-[18px] font-bold tabular-nums truncate ${tone ?? 'text-text-primary'}`}>{value}</p>
      {sub && <p className="text-[11px] text-text-muted mt-0.5">{sub}</p>}
    </div>
  );
}

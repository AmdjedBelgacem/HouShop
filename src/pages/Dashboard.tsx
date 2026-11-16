import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import type { DashboardStats, Product, SaleWithItems, DailyReport } from '../lib/types';
import { useI18n } from '../i18n';
import {
  XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip,
  PieChart, Pie, Cell, Area, AreaChart,
} from 'recharts';
import {
  ShoppingCart, AlertTriangle, Package, TrendingUp, BarChart3,
  DollarSign, ArrowUpRight,
} from 'lucide-react';
import { uiLocale } from '../i18n/locale';

function getCoverImage(imagePath: string | null): string | null {
  if (!imagePath) return null;
  try {
    const parsed = JSON.parse(imagePath);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed[0];
  } catch {
    // Not a JSON array of images: fall back to the raw value below.
  }
  return imagePath;
}

function getInventoryDistribution(products: Product[] | undefined, uncategorizedLabel: string) {
  if (!products || products.length === 0) {
    return { segments: [], totalItems: 0 };
  }
  const categories: Record<string, number> = {};
  let totalQty = 0;
  products.forEach((p) => {
    const cat = p.category_name ?? uncategorizedLabel;
    categories[cat] = (categories[cat] ?? 0) + p.quantity;
    totalQty += p.quantity;
  });
  const sorted = Object.entries(categories).sort((a, b) => b[1] - a[1]);
  const segments = sorted.slice(0, 5).map(([name, qty]) => ({
    name,
    value: qty,
    percentage: totalQty > 0 ? Math.round((qty / totalQty) * 100) : 0,
  }));
  return { segments, totalItems: totalQty };
}

function getMostSoldProducts(sales: SaleWithItems[] | undefined) {
  if (!sales || sales.length === 0) return [];
  const productMap: Record<string, { name: string; image: string | null; quantity: number; revenue: number }> = {};
  sales.forEach(s => {
    s.items.forEach(item => {
      const key = item.product_name;
      if (!productMap[key]) {
        productMap[key] = { name: key, image: getCoverImage(item.product_image), quantity: 0, revenue: 0 };
      }
      productMap[key].quantity += item.quantity;
      productMap[key].revenue += item.subtotal;
    });
  });
  return Object.values(productMap)
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5);
}

// Chart colours come from the design system: revenue is violet, profit is teal.
// Categories use distinct hues that also differ in lightness, and always carry a text legend.
const ACCENT = 'var(--color-accent-blue)';
const MUTED = 'var(--color-chart-gray)';
const DONUT_COLORS = [
  '#60a5fa', // blue
  '#2dd4bf', // teal
  '#fbbf24', // gold
  '#a3e635', // lime
  '#a4a1a8', // neutral
];

const KPI_TONE = {
  blue: 'bg-accent-blue/10 text-accent-blue',
  green: 'bg-accent-green/10 text-accent-green',
  purple: 'bg-accent-purple/10 text-accent-purple',
  amber: 'bg-accent-orange/10 text-accent-orange',
} as const;

interface DashboardProps {
  onNavigate?: (page: string) => void;
}

export default function Dashboard({ onNavigate }: DashboardProps) {
  const [chartMode, setChartMode] = useState<'7d' | '30d'>('7d');
  // Current time for "minutes ago" labels, refreshed once a minute instead of during render.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const { t } = useI18n();

  const { data: stats } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => invoke<DashboardStats>('get_dashboard_stats'),
  });
  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: () => invoke<Product[]>('get_products'),
  });
  const { data: lowStock } = useQuery({
    queryKey: ['low-stock'],
    queryFn: () => invoke<Product[]>('get_low_stock_products'),
  });
  const { data: sales } = useQuery({
    queryKey: ['sales'],
    queryFn: () => invoke<SaleWithItems[]>('get_sales'),
  });
  const dateRange = useMemo(() => {
    const end = new Date();
    const days = chartMode === '7d' ? 7 : 30;
    const start = new Date();
    start.setDate(start.getDate() - days);
    return {
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0],
    };
  }, [chartMode]);
  const { data: reports } = useQuery({
    queryKey: ['reports', dateRange.start, dateRange.end],
    queryFn: () => invoke<DailyReport[]>('get_reports_by_range', {
      startDate: dateRange.start,
      endDate: dateRange.end,
    }),
  });

  const chartData = useMemo(() => {
    const reportMap: Record<string, DailyReport> = {};
    (reports ?? []).forEach(r => { reportMap[r.date] = r; });
    const days = chartMode === '7d' ? 7 : 30;
    const data = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const report = reportMap[dateStr];
      data.push({
        name: chartMode === '7d'
          ? d.toLocaleDateString(uiLocale(), { weekday: 'short' })
          : d.toLocaleDateString(uiLocale(), { month: 'short', day: 'numeric' }),
        revenue: report?.total_sales ?? 0,
        profit: report?.total_profit ?? 0,
      });
    }
    return data;
  }, [reports, chartMode]);

  const { segments, totalItems } = getInventoryDistribution(products, t('dashboard.uncategorized'));
  const mostSold = getMostSoldProducts(sales);

  const recentActivity: { icon: React.ReactNode; title: string; desc: string; time: string; iconColor: string }[] = [];
  if (sales && sales.length > 0) {
    const latest = sales[0];
    const minsAgo = Math.max(1, Math.floor((now - new Date(latest.sale.created_at).getTime()) / 60000));
    const timeStr = minsAgo < 60 ? t('dashboard.minsAgo', { count: minsAgo }) : t('dashboard.hoursAgo', { count: Math.floor(minsAgo / 60) });
    recentActivity.push({
      icon: <ShoppingCart size={16} />,
      iconColor: 'bg-accent-blue/10 text-accent-blue',
      title: t('dashboard.newSaleCompleted'),
      desc: t('dashboard.itemsSoldCount', { count: latest.items.length, amount: latest.sale.total_amount.toFixed(2) }),
      time: timeStr,
    });
  }
  if (products && products.length > 0) {
    const newest = products[products.length - 1];
    recentActivity.push({
      icon: <Package size={16} />,
      iconColor: 'bg-accent-green/10 text-accent-green',
      title: t('dashboard.newInventoryAdded'),
      desc: t('dashboard.unitsOfProduct', { count: newest.quantity, name: newest.name }),
      time: t('dashboard.recently'),
    });
  }
  if (lowStock && lowStock.length > 0) {
    recentActivity.push({
      icon: <AlertTriangle size={16} />,
      iconColor: 'bg-accent-red/10 text-accent-red',
      title: t('dashboard.systemAlert'),
      desc: t('dashboard.stockThreshold', { name: lowStock[0].name }),
      time: t('dashboard.alwaysActive'),
    });
  }

  const totalProducts = stats?.total_products ?? products?.length ?? 0;
  const todaySales = stats?.today_sales ?? 0;
  const todayProfit = stats?.today_profit ?? 0;
  const lowStockCount = stats?.low_stock_count ?? lowStock?.length ?? 0;
  const totalRevenue = chartData.reduce((sum, d) => sum + d.revenue, 0);
  const hasChartData = chartData.some(d => d.revenue > 0);

  return (
    <div className="p-8">
      {/* Page header with the date-range control */}
      <header className="flex flex-wrap items-end justify-between gap-4 mb-8 animate-fade-up">
        <div>
          <span className="eyebrow-accent mb-3 flex w-fit">{t('sidebar.groupSell')}</span>
          <h2 className="page-title">{t('dashboard.title')}</h2>
          <p className="page-subtitle">{t('dashboard.subtitle')}</p>
        </div>
        <div role="group" className="inline-flex items-center gap-1 p-1 rounded-xl bg-surface border border-border-light">
          {([
            { mode: '7d', label: t('dashboard.days7') },
            { mode: '30d', label: t('dashboard.days30') },
          ] as const).map(({ mode, label }) => {
            const active = chartMode === mode;
            return (
              <button
                key={mode}
                type="button"
                aria-pressed={active}
                onClick={() => setChartMode(mode)}
                className={`px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30 ${
                  active
                    ? 'bg-card text-text-primary shadow-sm'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </header>

      {/* KPI tiles */}
      <section className="grid grid-cols-4 gap-5 mb-5">
        <KPICard
          label={t('dashboard.totalProducts')}
          value={`${totalProducts}`}
          helper={`${totalItems} ${t('dashboard.units')}`}
          icon={<Package size={18} />}
          tone="blue"
        />
        <KPICard
          label={t('dashboard.todaySales')}
          value={`${todaySales.toFixed(2)} DA`}
          icon={<DollarSign size={18} />}
          tone="green"
          delay={40}
        />
        <KPICard
          label={t('dashboard.todayProfit')}
          value={`${todayProfit.toFixed(2)} DA`}
          icon={<TrendingUp size={18} />}
          tone="purple"
          delay={80}
        />
        <KPICard
          label={t('dashboard.lowStock')}
          value={`${lowStockCount}`}
          icon={<AlertTriangle size={18} />}
          tone="amber"
          delay={120}
        />
      </section>

      {/* Sales chart + inventory distribution */}
      <section className="grid grid-cols-5 gap-5 mb-5">
        {/* Sales performance */}
        <div className="col-span-3 card p-6 animate-fade-up" style={{ animationDelay: '160ms' }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-text-primary">{t('dashboard.salesPerformance')}</h3>
              <p className="text-[13px] text-text-secondary mt-0.5">
                {t('dashboard.salesChartSubtitle', { days: chartMode === '7d' ? 7 : 30 })}
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="eyebrow">{t('dashboard.total')}</p>
              <p className="text-[20px] font-semibold tracking-[-0.01em] tabular-nums text-text-primary mt-0.5">
                {totalRevenue.toFixed(0)}&lrm; DA
              </p>
            </div>
          </div>

          {hasChartData && (
            <div className="flex items-center gap-4 mt-3 text-[13px] text-text-secondary">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-[3px] rounded-full bg-accent-blue" aria-hidden="true" />
                {t('dashboard.revenue')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 border-t-2 border-dashed border-chart-gray" aria-hidden="true" />
                {t('common.profit')}
              </span>
            </div>
          )}

          <div className="h-[230px] mt-4">
            {hasChartData ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ACCENT} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 4" stroke="var(--color-border)" vertical={false} />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                    dy={8}
                  />
                  <YAxis hide />
                  <Tooltip
                    cursor={{ stroke: 'var(--color-border)', strokeWidth: 1 }}
                    contentStyle={{
                      background: 'var(--color-card)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 12,
                      boxShadow: 'var(--shadow-card)',
                      fontSize: 12,
                      padding: '8px 12px',
                    }}
                    labelStyle={{ color: 'var(--color-text-secondary)', fontWeight: 600, marginBottom: 2 }}
                    itemStyle={{ color: 'var(--color-text-primary)', padding: 0 }}
                    formatter={(value, name) => [`${Number(value).toFixed(2)}\u200E DA`, name]}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    name={t('dashboard.revenue')}
                    stroke={ACCENT}
                    strokeWidth={2.5}
                    fill="url(#revGradient)"
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0, fill: ACCENT }}
                  />
                  <Area
                    type="monotone"
                    dataKey="profit"
                    name={t('common.profit')}
                    stroke={MUTED}
                    strokeWidth={1.75}
                    strokeDasharray="4 4"
                    fill="none"
                    dot={false}
                    activeDot={{ r: 3.5, strokeWidth: 0, fill: MUTED }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <span className="w-12 h-12 rounded-2xl bg-surface flex items-center justify-center mb-3 text-text-muted">
                  <BarChart3 size={22} strokeWidth={1.5} aria-hidden="true" />
                </span>
                <p className="text-[13.5px] font-medium text-text-primary">{t('dashboard.noSalesData')}</p>
                <p className="text-[13px] text-text-secondary mt-1">{t('dashboard.completeSaleHint')}</p>
              </div>
            )}
          </div>
        </div>

        {/* Inventory by category */}
        <div className="col-span-2 card p-6 animate-fade-up" style={{ animationDelay: '200ms' }}>
          <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-text-primary">{t('dashboard.inventoryByCategory')}</h3>
          <p className="text-[13px] text-text-secondary mt-0.5">
            {t('dashboard.totalItemsCategories', { count: totalItems, cat: segments.length })}
          </p>

          {segments.length > 0 ? (
            <>
              <div className="flex justify-center mt-5">
                <div className="relative w-[164px] h-[164px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={segments}
                        cx="50%"
                        cy="50%"
                        innerRadius={54}
                        outerRadius={80}
                        startAngle={90}
                        endAngle={-270}
                        dataKey="value"
                        stroke="var(--color-card)"
                        strokeWidth={2}
                      >
                        {segments.map((_, i) => (
                          <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-[22px] font-semibold tracking-[-0.01em] tabular-nums text-text-primary">{totalItems}</span>
                    <span className="text-[13px] text-text-secondary">{t('dashboard.items')}</span>
                  </div>
                </div>
              </div>

              <ul className="mt-5 divide-y divide-border-light">
                {segments.map((seg, i) => (
                  <li key={seg.name} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }}
                        aria-hidden="true"
                      />
                      <span className="text-text-secondary truncate">{seg.name}</span>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-[13px] text-text-muted tabular-nums">{seg.value} {t('dashboard.units')}</span>
                      <span className="w-10 text-right font-semibold tabular-nums text-text-primary">{seg.percentage}%</span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="h-[220px] flex flex-col items-center justify-center text-center">
              <span className="w-12 h-12 rounded-2xl bg-surface flex items-center justify-center mb-3 text-text-muted">
                <Package size={22} strokeWidth={1.5} aria-hidden="true" />
              </span>
              <p className="text-[13.5px] font-medium text-text-primary">{t('dashboard.noProductsYet')}</p>
            </div>
          )}
        </div>
      </section>

      {/* Top selling + recent activity */}
      <section className="grid grid-cols-5 gap-5">
        {/* Top selling products */}
        <div className="col-span-2 card p-6 animate-fade-up" style={{ animationDelay: '240ms' }}>
          <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-text-primary">{t('dashboard.topSelling')}</h3>
          <p className="text-[13px] text-text-secondary mt-0.5">{t('dashboard.topSellingDesc')}</p>

          {mostSold.length > 0 ? (
            <ul className="mt-4 divide-y divide-border-light">
              {mostSold.map((p, i) => (
                <li key={p.name} className="flex items-center gap-3.5 py-3 first:pt-0 last:pb-0">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[13px] font-semibold tabular-nums flex-shrink-0 ${
                    i < 3 ? 'bg-navy/10 text-navy' : 'bg-surface text-text-muted'
                  }`}>{i + 1}</span>
                  {p.image ? (
                    <img
                      src={convertFileSrc(p.image)}
                      alt=""
                      className="w-10 h-10 rounded-xl object-cover flex-shrink-0 border border-border-light"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-surface flex items-center justify-center flex-shrink-0 border border-border-light">
                      <Package size={15} className="text-text-muted" aria-hidden="true" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-medium text-text-primary truncate">{p.name}</p>
                    <p className="text-[13px] text-text-secondary tabular-nums">{t('dashboard.unitsSold', { count: p.quantity })}</p>
                  </div>
                  <span className="text-[13px] font-semibold tabular-nums text-text-primary flex-shrink-0">{p.revenue.toFixed(0)}&lrm; DA</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="h-[160px] flex flex-col items-center justify-center text-center">
              <span className="w-12 h-12 rounded-2xl bg-surface flex items-center justify-center mb-3 text-text-muted">
                <ShoppingCart size={22} strokeWidth={1.5} aria-hidden="true" />
              </span>
              <p className="text-[13px] text-text-secondary">{t('dashboard.noSalesRecorded')}</p>
            </div>
          )}
        </div>

        {/* Recent activity */}
        <div className="col-span-3 card p-6 animate-fade-up" style={{ animationDelay: '280ms' }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-text-primary">{t('dashboard.recentActivity')}</h3>
              <p className="text-[13px] text-text-secondary mt-0.5">{t('dashboard.recentActivityDesc')}</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate?.('logs')}
              className="btn-ghost px-3 py-1.5 text-[13px] text-navy flex-shrink-0"
            >
              {t('dashboard.viewAllLog')}
              <ArrowUpRight size={14} aria-hidden="true" />
            </button>
          </div>

          {recentActivity.length > 0 ? (
            <ul className="mt-4 divide-y divide-border-light">
              {recentActivity.map((item, i) => (
                <li key={i} className="flex items-center gap-3.5 py-3 first:pt-0 last:pb-0">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${item.iconColor}`} aria-hidden="true">
                    {item.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-medium text-text-primary">{item.title}</p>
                    <p className="text-[13px] text-text-secondary mt-0.5 truncate">{item.desc}</p>
                  </div>
                  <span className="text-[13px] text-text-muted tabular-nums whitespace-nowrap flex-shrink-0">{item.time}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="h-[140px] flex items-center justify-center text-center">
              <p className="text-[13px] text-text-secondary">{t('dashboard.noRecentActivity')}</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function KPICard({
  label,
  value,
  helper,
  icon,
  tone,
  delay = 0,
}: {
  label: string;
  value: string;
  helper?: string;
  icon: React.ReactNode;
  tone: keyof typeof KPI_TONE;
  delay?: number;
}) {
  return (
    <div
      className="card p-5 flex flex-col gap-5 animate-fade-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow text-text-secondary">{label}</p>
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${KPI_TONE[tone]}`}
          aria-hidden="true"
        >
          {icon}
        </div>
      </div>
      <div>
        <KpiFigure value={value} />
        {helper && <p className="text-[13px] text-text-secondary mt-2 tabular-nums">{helper}</p>}
      </div>
    </div>
  );
}

const figureFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/**
 * The hero figure of a KPI tile: large tabular numerals, with a currency suffix set small.
 * Values arrive preformatted (e.g. "2540.00 DA"); only the presentation changes here.
 */
function KpiFigure({ value }: { value: string }) {
  const match = value.match(/^(-?[\d.,]+)\s+(\S+)$/);
  const amount = match ? Number(match[1].replace(/,/g, '')) : NaN;
  const number = match && Number.isFinite(amount) ? figureFormat.format(amount) : null;
  return (
    <p className="text-[40px] font-semibold leading-[44px] tracking-[-0.045em] tabular-nums text-text-primary">
      {number !== null && match ? (
        <>
          {number}
          <span className="ms-1.5 text-[16px] font-medium tracking-normal text-text-muted">{match[2]}</span>
        </>
      ) : (
        value
      )}
    </p>
  );
}

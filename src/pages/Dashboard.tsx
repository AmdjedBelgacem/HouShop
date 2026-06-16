import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import type { DashboardStats, Product, SaleWithItems, DailyReport } from '../lib/types';
import { useI18n } from '../i18n';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip,
  PieChart, Pie, Cell, Area, AreaChart,
} from 'recharts';
import {
  ShoppingCart, UserPlus, AlertTriangle, CheckCircle, ExternalLink,
  Package, TrendingUp, TrendingDown, BarChart3, Layers, DollarSign,
  Users, ArrowUpRight,
} from 'lucide-react';
function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function getCoverImage(imagePath: string | null): string | null {
  if (!imagePath) return null;
  try {
    const parsed = JSON.parse(imagePath);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed[0];
  } catch {  }
  return imagePath;
}
function getInventoryDistribution(products: Product[] | undefined) {
  if (!products || products.length === 0) {
    return { segments: [], totalItems: 0 };
  }
  const categories: Record<string, number> = {};
  let totalQty = 0;
  products.forEach((p) => {
    const cat = p.category_name ?? 'Uncategorized';
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
const DONUT_COLORS = ['#1E293B', '#3B82F6', '#8B5CF6', '#F59E0B', '#D1D5DB'];
interface DashboardProps {
  onNavigate?: (page: string) => void;
}
export default function Dashboard({ onNavigate }: DashboardProps) {
  const [chartMode, setChartMode] = useState<'7d' | '30d'>('7d');
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
          ? d.toLocaleDateString('en-US', { weekday: 'short' })
          : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        revenue: report?.total_sales ?? 0,
        profit: report?.total_profit ?? 0,
      });
    }
    return data;
  }, [reports, chartMode]);
  const { segments, totalItems } = getInventoryDistribution(products);
  const mostSold = getMostSoldProducts(sales);
  const recentActivity: { icon: React.ReactNode; title: string; desc: string; time: string; iconColor: string }[] = [];
  if (sales && sales.length > 0) {
    const latest = sales[0];
    const minsAgo = Math.max(1, Math.floor((Date.now() - new Date(latest.sale.created_at).getTime()) / 60000));
    const timeStr = minsAgo < 60 ? t('dashboard.minsAgo', { count: minsAgo }) : t('dashboard.hoursAgo', { count: Math.floor(minsAgo / 60) });
    recentActivity.push({
      icon: <ShoppingCart size={16} />,
      iconColor: 'bg-blue-100 text-accent-blue',
      title: t('dashboard.newSaleCompleted'),
      desc: t('dashboard.itemsSoldCount', { count: latest.items.length, amount: latest.sale.total_amount.toFixed(2) }),
      time: timeStr,
    });
  }
  if (products && products.length > 0) {
    const newest = products[products.length - 1];
    recentActivity.push({
      icon: <Package size={16} />,
      iconColor: 'bg-green-100 text-accent-green',
      title: t('dashboard.newInventoryAdded'),
      desc: t('dashboard.unitsOfProduct', { count: newest.quantity, name: newest.name }),
      time: t('dashboard.recently'),
    });
  }
  if (lowStock && lowStock.length > 0) {
    recentActivity.push({
      icon: <AlertTriangle size={16} />,
      iconColor: 'bg-red-100 text-accent-red',
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
  const totalProfit = chartData.reduce((sum, d) => sum + d.profit, 0);
  return (
    <div className="p-8">
      {}
      <div className="mb-8">
        <h2 className="text-[26px] font-bold text-text-primary leading-tight">{t('dashboard.title')}</h2>
        <p className="text-[14px] text-text-secondary mt-1.5">
          {t('dashboard.subtitle')}
        </p>
      </div>
      {}
      <div className="grid grid-cols-4 gap-5 mb-7">
        <KPICard label={t('dashboard.totalProducts')} value={`${totalProducts}`} icon={<Package size={18} />} color="blue" />
        <KPICard label={t('dashboard.todaySales')} value={`${todaySales.toFixed(2)} DA`} icon={<DollarSign size={18} />} color="green" />
        <KPICard label={t('dashboard.todayProfit')} value={`${todayProfit.toFixed(2)} DA`} icon={<TrendingUp size={18} />} color="purple" />
        <KPICard label={t('dashboard.lowStock')} value={`${lowStockCount}`} icon={<AlertTriangle size={18} />} color="amber" />
      </div>
      {}
      <div className="grid grid-cols-5 gap-5 mb-7">
        {}
        <div className="col-span-3 card p-6">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h3 className="text-[16px] font-bold text-text-primary">{t('dashboard.salesPerformance')}</h3>
              <p className="text-[12.5px] text-text-secondary mt-0.5">
                {chartMode === '7d' ? t('dashboard.last7Days') : t('dashboard.last30Days')} {t('dashboard.salesChartDesc')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-text-muted mr-1">
                {t('dashboard.total')}: <span className="font-semibold text-text-primary">{totalRevenue.toFixed(0)} DA</span>
              </span>
              <div className="flex rounded-lg border border-border overflow-hidden">
                <button
                  onClick={() => setChartMode('7d')}
                  className={`px-3 py-1.5 text-[11.5px] font-medium transition-colors ${
                    chartMode === '7d' ? 'bg-navy text-white' : 'bg-card text-text-secondary hover:bg-surface'
                  }`}
                >{t('dashboard.days7')}</button>
                <button
                  onClick={() => setChartMode('30d')}
                  className={`px-3 py-1.5 text-[11.5px] font-medium transition-colors ${
                    chartMode === '30d' ? 'bg-navy text-white' : 'bg-card text-text-secondary hover:bg-surface'
                  }`}
                >{t('dashboard.days30')}</button>
              </div>
            </div>
          </div>
          <div className="h-[220px] mt-4">
            {chartData.some(d => d.revenue > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="revGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#1E293B" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#1E293B" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9CA3AF' }} dy={8} />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{ borderRadius: 10, border: '1px solid #E5E7EB', fontSize: 12 }}
                    formatter={(value: number) => [`${value.toFixed(2)} DA`]}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#1E293B" strokeWidth={2.5} fill="url(#revGradient)" name="Revenue" />
                  <Area type="monotone" dataKey="profit" stroke="#3B82F6" strokeWidth={2} fill="url(#profitGradient)" name="Profit" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-text-muted">
                <BarChart3 size={32} strokeWidth={1.5} className="mb-2 text-text-muted/40" />
                <p className="text-[13px]">{t('dashboard.noSalesData')}</p>
                <p className="text-[11px] mt-0.5">{t('dashboard.completeSaleHint')}</p>
              </div>
            )}
          </div>
        </div>
        {}
        <div className="col-span-2 card p-6">
          <h3 className="text-[16px] font-bold text-text-primary">{t('dashboard.inventoryByCategory')}</h3>
          <p className="text-[12.5px] text-text-secondary mt-0.5 mb-4">
            {t('dashboard.totalItemsCategories', { count: totalItems, cat: segments.length })}
          </p>
          {segments.length > 0 ? (
            <>
              <div className="flex justify-center">
                <div className="relative w-[150px] h-[150px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={segments}
                        cx="50%"
                        cy="50%"
                        innerRadius={48}
                        outerRadius={68}
                        startAngle={90}
                        endAngle={-270}
                        dataKey="value"
                        stroke="none"
                      >
                        {segments.map((_, i) => (
                          <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-[22px] font-bold text-text-primary">{totalItems}</span>
                    <span className="text-[11px] text-text-secondary">{t('dashboard.items')}</span>
                  </div>
                </div>
              </div>
              {}
              <div className="mt-4 space-y-2">
                {segments.map((seg, i) => (
                  <div key={seg.name} className="flex items-center justify-between text-[12px]">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                      <span className="text-text-secondary truncate max-w-[100px]">{seg.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-text-muted">{seg.value} {t('dashboard.units')}</span>
                      <span className="font-semibold text-text-primary">{seg.percentage}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[200px] flex flex-col items-center justify-center text-text-muted">
              <Package size={32} strokeWidth={1.5} className="mb-2 text-text-muted/40" />
              <p className="text-[13px]">{t('dashboard.noProductsYet')}</p>
            </div>
          )}
        </div>
      </div>
      {}
      <div className="grid grid-cols-5 gap-5">
        {}
        <div className="col-span-2 card p-6">
          <h3 className="text-[16px] font-bold text-text-primary">{t('dashboard.topSelling')}</h3>
          <p className="text-[12.5px] text-text-secondary mt-0.5 mb-4">{t('dashboard.topSellingDesc')}</p>
          {mostSold.length > 0 ? (
            <div className="space-y-3">
              {mostSold.map((p, i) => (
                <div key={p.name} className="flex items-center gap-3">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                    i === 0 ? 'bg-amber-100 text-amber-700' :
                    i === 1 ? 'bg-border text-text-secondary' :
                    i === 2 ? 'bg-orange-100 text-orange-700' :
                    'bg-surface text-text-muted'
                  }`}>{i + 1}</span>
                  {p.image ? (
                    <img src={convertFileSrc(p.image)} alt={p.name} className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-lg bg-surface flex items-center justify-center flex-shrink-0">
                      <Package size={14} className="text-text-muted" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px] font-semibold text-text-primary truncate">{p.name}</p>
                    <p className="text-[11px] text-text-muted">{t('dashboard.unitsSold', { count: p.quantity })}</p>
                  </div>
                  <span className="text-[12px] font-semibold text-text-primary">{p.revenue.toFixed(0)} DA</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-[150px] flex flex-col items-center justify-center text-text-muted">
              <ShoppingCart size={28} strokeWidth={1.5} className="mb-2 text-text-muted/40" />
              <p className="text-[12.5px]">{t('dashboard.noSalesRecorded')}</p>
            </div>
          )}
        </div>
        {}
        <div className="col-span-3 card p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-[16px] font-bold text-text-primary">{t('dashboard.recentActivity')}</h3>
              <p className="text-[12.5px] text-text-secondary mt-0.5">{t('dashboard.recentActivityDesc')}</p>
            </div>
            <button
              onClick={() => onNavigate?.('logs')}
              className="text-[12px] text-navy hover:text-navy-light transition-colors flex items-center gap-1 font-medium"
            >
              {t('dashboard.viewAllLog')} <ArrowUpRight size={12} />
            </button>
          </div>
          {recentActivity.length > 0 ? (
            <div className="space-y-4">
              {recentActivity.map((item, i) => (
                <div key={i} className="flex items-start gap-4">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${item.iconColor}`}>
                    {item.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-semibold text-text-primary">{item.title}</p>
                    <p className="text-[12.5px] text-text-secondary mt-0.5">{item.desc}</p>
                  </div>
                  <span className="text-[11.5px] text-text-muted flex-shrink-0 pt-0.5">{item.time}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-[120px] flex flex-col items-center justify-center text-text-muted">
              <p className="text-[12.5px]">{t('dashboard.noRecentActivity')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function KPICard({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: 'blue' | 'green' | 'purple' | 'amber' }) {
  const colorMap = {
    blue: 'bg-blue-50 text-accent-blue',
    green: 'bg-emerald-50 text-emerald-600',
    purple: 'bg-purple-50 text-purple-600',
    amber: 'bg-amber-50 text-amber-600',
  };
  return (
    <div className="card px-5 py-4 flex items-center justify-between">
      <div>
        <p className="text-[10.5px] font-semibold text-text-muted tracking-[0.08em] uppercase">{label}</p>
        <p className="text-[22px] font-bold text-text-primary mt-1 leading-tight">{value}</p>
      </div>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${colorMap[color]}`}>
        {icon}
      </div>
    </div>
  );
}

import type { ReactNode } from 'react';
import { useAuth } from '../hooks/authContext';
import { useI18n } from '../i18n';
import { useBranding } from '../hooks/brandingContext';
import UpdateBanner from './UpdateBanner';
import ThemeToggle from './ThemeToggle';
import {
  LayoutGrid, ClipboardList, Clock, Users, ShoppingCart, Plus,
  LogOut, CalendarCheck, RotateCcw, Calculator, Smartphone,
  ShieldCheck, Trash2, Settings,
} from 'lucide-react';

type Page = 'dashboard' | 'products' | 'product-evaluation' | 'add-product' | 'edit-product' | 'history' | 'customers' | 'add-customer' | 'edit-customer' | 'reservations' | 'returns' | 'pos' | 'transfer' | 'diagnostics' | 'wipe' | 'profile' | 'logs';

interface LayoutProps {
  children: ReactNode;
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

const ICON = { size: 18, strokeWidth: 1.8 } as const;

interface NavItem { id: Page; key: string; icon: ReactNode }

const navGroups: { key: string; items: NavItem[] }[] = [
  {
    key: 'sidebar.groupSell',
    items: [
      { id: 'dashboard', key: 'sidebar.dashboard', icon: <LayoutGrid {...ICON} /> },
      { id: 'pos', key: 'sidebar.checkout', icon: <ShoppingCart {...ICON} /> },
      { id: 'history', key: 'sidebar.history', icon: <Clock {...ICON} /> },
      { id: 'returns', key: 'sidebar.returns', icon: <RotateCcw {...ICON} /> },
      { id: 'reservations', key: 'sidebar.reservations', icon: <CalendarCheck {...ICON} /> },
      { id: 'customers', key: 'sidebar.customers', icon: <Users {...ICON} /> },
    ],
  },
  {
    key: 'sidebar.groupStock',
    items: [
      { id: 'products', key: 'sidebar.products', icon: <ClipboardList {...ICON} /> },
      { id: 'product-evaluation', key: 'sidebar.productEvaluation', icon: <Calculator {...ICON} /> },
    ],
  },
  {
    key: 'sidebar.groupDevices',
    items: [
      { id: 'diagnostics', key: 'sidebar.diagnostics', icon: <ShieldCheck {...ICON} /> },
      { id: 'transfer', key: 'sidebar.dataTransfer', icon: <Smartphone {...ICON} /> },
      { id: 'wipe', key: 'sidebar.phoneWipe', icon: <Trash2 {...ICON} /> },
    ],
  },
];

const itemBase =
  'flex w-full items-center gap-3 h-10 rounded-full px-3 text-left text-[14px] font-medium transition-colors duration-150';
const itemOn = 'bg-[rgb(var(--ink)/0.11)] text-text-primary';
const itemOff = 'text-text-secondary hover:bg-[rgb(var(--ink)/0.05)] hover:text-text-primary';

export default function Layout({ children, currentPage, onNavigate }: LayoutProps) {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const { logoUrl, shopName } = useBranding();

  const displayName = user?.username
    ? `${user.username.charAt(0).toUpperCase()}${user.username.slice(1)}`
    : 'Admin';

  const isActive = (id: Page) =>
    currentPage === id ||
    (id === 'products' && (currentPage === 'add-product' || currentPage === 'edit-product')) ||
    (id === 'customers' && (currentPage === 'add-customer' || currentPage === 'edit-customer')) ||
    (id === 'dashboard' && currentPage === 'logs');

  const settingsActive = currentPage === 'profile';

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Navigation rail */}
      <aside className="fixed inset-y-0 start-0 z-50 flex w-[248px] flex-col gap-7 overflow-y-auto border-e border-border-light bg-sidebar px-4 pb-6 pt-7">
        {/* Wordmark */}
        <button
          onClick={() => onNavigate('dashboard')}
          className="flex items-center gap-3 rounded-xl px-3 text-left"
        >
          {/* Logos are often dark artwork: a light tile keeps them visible on the dark rail. */}
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] bg-[#faf8fd] p-1 ring-1 ring-border-light">
            <img src={logoUrl} alt="" className="h-full w-full object-contain" />
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span dir="auto" className="line-clamp-2 break-words text-[18px] font-semibold leading-[22px] tracking-[-0.03em] text-text-primary">
              {shopName}<span className="text-[#3b82f6]">.</span>
            </span>
            <span className="truncate font-mono text-[11px] font-semibold uppercase leading-[15px] tracking-[0.06em] text-text-muted">
              {t('sidebar.managementSuite')}
            </span>
          </span>
        </button>

        {/* The one primary action */}
        <button onClick={() => onNavigate('pos')} className="btn-primary mx-1">
          <Plus size={16} strokeWidth={2.2} />
          {t('sidebar.newSale')}
        </button>

        {/* Groups */}
        <nav aria-label={t('sidebar.managementSuite')} className="flex flex-1 flex-col gap-6">
          {navGroups.map((group) => (
            <div key={group.key} className="flex flex-col gap-0.5">
              <span className="px-3 pb-1.5 font-mono text-[11px] font-semibold uppercase leading-[15px] tracking-[0.06em] text-text-muted">
                {t(group.key)}
              </span>
              {group.items.map((item) => {
                const active = isActive(item.id);
                return (
                  <button
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                    aria-current={active ? 'page' : undefined}
                    className={`${itemBase} ${active ? itemOn : itemOff}`}
                  >
                    <span className={`flex-shrink-0 ${active ? 'text-pink-ink' : 'text-text-muted'}`}>{item.icon}</span>
                    <span className="truncate">{t(item.key)}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="flex flex-col gap-0.5 border-t border-border-light pt-4">
          <button
            onClick={() => onNavigate('profile')}
            aria-current={settingsActive ? 'page' : undefined}
            className={`${itemBase} ${settingsActive ? itemOn : itemOff}`}
          >
            <Settings {...ICON} className={settingsActive ? 'text-pink-ink' : 'text-text-muted'} />
            {t('sidebar.settings')}
          </button>
          <button onClick={logout} className={`${itemBase} ${itemOff}`}>
            <LogOut {...ICON} className="text-text-muted" />
            {t('sidebar.logout')}
          </button>
          <div className="mt-3 flex items-center gap-3 rounded-[14px] bg-[rgb(var(--ink)/0.05)] px-3 py-2.5">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[rgba(59,130,246,0.14)] text-[14px] font-semibold text-pink-ink"
            >
              {displayName.charAt(0)}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-[14px] font-semibold leading-[18px] text-text-primary">{displayName}</span>
              <span className="truncate text-[12px] leading-4 text-text-muted">{t('sidebar.ownerDevice')}</span>
            </span>
            <ThemeToggle className="ms-auto flex-shrink-0" />
          </div>
        </div>
      </aside>

      {/* Content */}
      <main className="ms-[248px] flex-1 overflow-y-auto">
        <UpdateBanner />
        {children}
      </main>
    </div>
  );
}

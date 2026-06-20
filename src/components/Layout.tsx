import type { ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../i18n';
import logoImg from '../assets/logo.png';
import UpdateBanner from './UpdateBanner';
import {
  LayoutGrid, ClipboardList, Clock, Users, ShoppingCart, Plus,
  HelpCircle, LogOut, CalendarCheck,
} from 'lucide-react';
type Page = 'dashboard' | 'products' | 'add-product' | 'edit-product' | 'history' | 'customers' | 'add-customer' | 'edit-customer' | 'reservations' | 'pos' | 'profile' | 'logs';
interface LayoutProps {
  children: ReactNode;
  currentPage: Page;
  onNavigate: (page: Page) => void;
}
const navItemKeys: { id: Page; key: string; icon: ReactNode }[] = [
  { id: 'dashboard', key: 'sidebar.dashboard', icon: <LayoutGrid size={18} strokeWidth={1.8} /> },
  { id: 'products', key: 'sidebar.products', icon: <ClipboardList size={18} strokeWidth={1.8} /> },
  { id: 'history', key: 'sidebar.history', icon: <Clock size={18} strokeWidth={1.8} /> },
  { id: 'customers', key: 'sidebar.customers', icon: <Users size={18} strokeWidth={1.8} /> },
  { id: 'reservations', key: 'sidebar.reservations', icon: <CalendarCheck size={18} strokeWidth={1.8} /> },
  { id: 'pos', key: 'sidebar.checkout', icon: <ShoppingCart size={18} strokeWidth={1.8} /> },
];
export default function Layout({ children, currentPage, onNavigate }: LayoutProps) {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const displayName = user?.username
    ? `${user.username.charAt(0).toUpperCase()}${user.username.slice(1)} Hou`
    : 'Admin Hou';
  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      {}
      <aside className="fixed left-4 top-4 bottom-4 w-[232px] bg-card rounded-2xl border border-border flex flex-col z-50"
        style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)' }}>
        {}
        <div className="px-5 pt-5 pb-4 flex items-center gap-3">
          <img src={logoImg} alt="HouPhone Shop" className="h-11 w-auto object-contain flex-shrink-0" />
          <div>
            <h1 className="text-[15px] font-bold text-text-primary leading-tight tracking-tight">
              HouPhone Shop
            </h1>
            <p className="text-[10.5px] font-medium text-text-muted tracking-[0.03em]">
              {t('sidebar.managementSuite')}
            </p>
          </div>
        </div>
        {}
        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
          {navItemKeys.map((item) => {
            const active = currentPage === item.id || (item.id === 'products' && (currentPage === 'add-product' || currentPage === 'edit-product')) || (item.id === 'customers' && (currentPage === 'add-customer' || currentPage === 'edit-customer'));
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] transition-colors ${
                  active
                    ? 'bg-navy/10 text-navy font-semibold'
                    : 'text-text-secondary font-normal hover:bg-surface hover:text-text-primary'
                }`}
              >
                <span className={active ? 'text-navy' : 'text-text-muted'}>{item.icon}</span>
                {t(item.key)}
              </button>
            );
          })}
        </nav>
        {}
        <div className="px-3 pb-3 space-y-0.5 border-t border-border pt-3">
          <button
            onClick={() => onNavigate('add-product')}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-[13px] font-medium bg-navy text-white hover:bg-navy-light transition-colors"
          >
            <Plus size={16} strokeWidth={2} />
            {t('sidebar.newEntry')}
          </button>
          <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] text-text-secondary hover:bg-surface transition-colors">
            <HelpCircle size={16} strokeWidth={1.8} />
            {t('sidebar.support')}
          </button>
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] text-accent-red hover:bg-accent-red/5 transition-colors"
          >
            <LogOut size={16} strokeWidth={1.8} />
            {t('sidebar.logout')}
          </button>
        </div>
        {}
        <div className="px-4 py-3.5 border-t border-border rounded-b-2xl bg-surface/50">
          <div className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => onNavigate('profile')}>
            <div className="w-8 h-8 rounded-full bg-navy flex items-center justify-center flex-shrink-0 overflow-hidden">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-[12.5px] font-semibold text-text-primary truncate">{displayName}</p>
              <p className="text-[11px] text-text-muted leading-tight">{t('sidebar.premiumTier')}</p>
            </div>
          </div>
        </div>
      </aside>
      {}
      <main className="flex-1 overflow-y-auto ml-[260px]">
        <UpdateBanner />
        {children}
      </main>
    </div>
  );
}

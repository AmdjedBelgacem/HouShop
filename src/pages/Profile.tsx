import { useState, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../i18n';
import type { Language } from '../i18n';
import { useTheme } from '../theme';
import CustomSelect from '../components/CustomSelect';
import {
  Pencil, Shield, Settings, Grid3x3, Clock, Eye, EyeOff,
  MapPin, Laptop, Smartphone, Monitor, ExternalLink, Globe, Moon,
} from 'lucide-react';
export default function Profile() {
  const { user } = useAuth();
  const { t, lang, setLang } = useI18n();
  const { isDark, toggleTheme } = useTheme();
  const displayName = user?.username
    ? `${user.username.charAt(0).toUpperCase()}${user.username.slice(1)} Hou`
    : 'Alex Hou';
  const [form, setForm] = useState({
    name: displayName,
    email: `${user?.username ?? 'admin'}@houphone.com`,
    phone: '+852 9876 5432',
    password: '••••••••',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [editing, setEditing] = useState(false);
  const [twoFA, setTwoFA] = useState(true);
  const [loginAlerts, setLoginAlerts] = useState(true);
  const [emailNotif, setEmailNotif] = useState(false);
  const [compactMode, setCompactMode] = useState(false);
  const sessions = useMemo(() => {
    const ua = navigator.userAgent;
    const isMac = /Mac/.test(ua);
    const isWindows = /Windows/.test(ua);
    const isLinux = /Linux/.test(ua);
    let osName = 'Unknown';
    if (isMac) {
      const versionMatch = ua.match(/Mac OS X ([\d_]+)/);
      const version = versionMatch ? versionMatch[1].replace(/_/g, '.') : 'Sequoia';
      osName = `macOS ${version}`;
    } else if (isWindows) {
      osName = 'Windows 11';
    } else if (isLinux) {
      osName = 'Linux';
    }
    const browserName = /Chrome/.test(ua) ? 'Chrome' : /Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'Browser';
    return [
      { device: `${isMac ? 'MacBook Pro' : isWindows ? 'Windows PC' : 'Linux Desktop'} (${osName})`, icon: <Laptop size={16} />, location: 'Current Location', current: true, time: 'Just now', status: 'active' as const, browser: browserName },
      { device: 'iPhone 15 Pro Max', icon: <Smartphone size={16} />, location: 'Mobile Device', current: false, time: 'Today, 09:42 AM', status: 'signed-out' as const, browser: 'Safari Mobile' },
      { device: 'iPad Pro (Store Terminal)', icon: <Monitor size={16} />, location: 'Store Location', current: false, time: 'Yesterday, 06:15 PM', status: 'expired' as const, browser: 'Safari' },
    ];
  }, []);
  return (
    <div className="p-8">
      {}
      <div className="card p-6 mb-6 flex items-start justify-between">
        <div className="flex items-center gap-5">
          <div className="w-20 h-20 rounded-full bg-navy flex items-center justify-center flex-shrink-0 shadow-lg overflow-hidden">
            <span className="text-white text-[28px] font-bold">
              {displayName.charAt(0)}
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-[22px] font-bold text-text-primary">{displayName}</h2>
              <span className="px-2.5 py-0.5 rounded-full bg-blue-50 text-accent-blue text-[11px] font-bold tracking-wider border border-blue-200">
                ADMIN
              </span>
            </div>
            <p className="text-[13px] text-text-secondary mt-1">Store Manager • HouPhone Global</p>
            <div className="flex items-center gap-1.5 mt-1.5">
              <MapPin size={13} className="text-text-muted" />
              <span className="text-[12px] text-text-muted">Hong Kong Business District</span>
            </div>
          </div>
        </div>
        <button onClick={() => setEditing(!editing)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-navy text-white text-[12.5px] font-medium hover:bg-navy-light transition-colors">
          <Pencil size={14} /> {t('profile.editProfile')}
        </button>
      </div>
      {}
      <div className="grid grid-cols-5 gap-6 mb-6">
        {}
        <div className="col-span-3 card p-6">
          <div className="flex items-center gap-2 mb-5">
            <Settings size={16} className="text-text-muted" />
            <h3 className="text-[15px] font-bold text-text-primary">{t('profile.accountSettings')}</h3>
          </div>
          <div className="space-y-4">
            <Field label={t('profile.fullName')}>
              <input type="text" value={form.name} readOnly={!editing}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                className={`form-input ${!editing ? 'bg-surface' : ''}`} />
            </Field>
            <Field label={t('profile.emailAddress')}>
              <input type="email" value={form.email} readOnly={!editing}
                onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                className={`form-input ${!editing ? 'bg-surface' : ''}`} />
            </Field>
            <Field label={t('profile.phoneNumber')}>
              <input type="text" value={form.phone} readOnly={!editing}
                onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))}
                className={`form-input ${!editing ? 'bg-surface' : ''}`} />
            </Field>
            <Field label={t('profile.currentPassword')}>
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} value={form.password} readOnly={!editing}
                  onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))}
                  className={`form-input pr-10 ${!editing ? 'bg-surface' : ''}`} />
                <button onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors">
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
            {editing && (
              <button className="px-5 py-2.5 rounded-lg border border-border text-[13px] font-medium text-text-primary hover:bg-surface transition-colors mt-2">
                {t('profile.updateInfo')}
              </button>
            )}
          </div>
        </div>
        {}
        <div className="col-span-2 space-y-6">
          {}
          <div className="card p-6">
            <div className="flex items-center gap-2 mb-5">
              <Shield size={16} className="text-text-muted" />
              <h3 className="text-[15px] font-bold text-text-primary">{t('profile.security')}</h3>
            </div>
            <div className="space-y-4">
              <SecurityToggle
                label={t('profile.twoFA')} desc={t('profile.twoFADesc')}
                value={twoFA} onChange={setTwoFA} />
              <SecurityToggle
                label={t('profile.loginAlerts')} desc={t('profile.loginAlertsDesc')}
                value={loginAlerts} onChange={setLoginAlerts} />
            </div>
          </div>
          {}
          <div className="card p-6">
            <div className="flex items-center gap-2 mb-5">
              <Grid3x3 size={16} className="text-text-muted" />
              <h3 className="text-[15px] font-bold text-text-primary">{t('profile.preferences')}</h3>
            </div>
            <div className="space-y-4">
              <SecurityToggle
                label={t('profile.emailNotif')} desc={t('profile.emailNotifDesc')}
                value={emailNotif} onChange={setEmailNotif} />
              <SecurityToggle
                label={t('profile.compactMode')} desc={t('profile.compactModeDesc')}
                value={compactMode} onChange={setCompactMode} />
              {}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Moon size={14} className="text-text-muted" />
                  <div>
                    <p className="text-[13px] font-medium text-text-primary">{t('profile.darkMode')}</p>
                    <p className="text-[11px] text-text-muted">{t('profile.darkModeDesc')}</p>
                  </div>
                </div>
                <button onClick={toggleTheme}
                  className={`relative w-10 h-[22px] rounded-full transition-colors ${isDark ? 'bg-navy' : 'bg-gray-300'}`}>
                  <span className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow transition-transform ${isDark ? 'left-[21px]' : 'left-[3px]'}`} />
                </button>
              </div>
              {}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe size={14} className="text-text-muted" />
                  <div>
                    <p className="text-[13px] font-medium text-text-primary">{t('profile.language')}</p>
                    <p className="text-[11px] text-text-muted">{t('profile.languageDesc')}</p>
                  </div>
                </div>
                <CustomSelect
                  value={lang}
                  onChange={(v) => setLang(v as Language)}
                  options={[
                    { value: 'en', label: 'English' },
                    { value: 'fr', label: 'Fran\u00e7ais' },
                    { value: 'ar', label: '\u0627\u0644\u0639\u0631\u0628\u064a\u0629' },
                  ]}
                  size="sm"
                  className="w-[130px]"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      {}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-text-muted" />
            <h3 className="text-[15px] font-bold text-text-primary">{t('profile.recentActivity')}</h3>
          </div>
          <button className="text-[12px] text-text-secondary hover:text-navy transition-colors flex items-center gap-1">
            {t('profile.viewAllSessions')} <ExternalLink size={11} />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2.5 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('profile.device')}</th>
                <th className="text-left py-2.5 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('profile.browser')}</th>
                <th className="text-left py-2.5 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('profile.location')}</th>
                <th className="text-left py-2.5 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('profile.time')}</th>
                <th className="text-left py-2.5 px-4 text-text-muted font-semibold text-[11px] uppercase tracking-wider">{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s, i) => (
                <tr key={i} className="border-b border-border-light">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      <span className="text-text-muted">{s.icon}</span>
                      <span className="text-text-primary font-medium text-[12.5px]">{s.device}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-text-secondary text-[12.5px]">{s.browser}</td>
                  <td className="py-3 px-4 text-text-secondary text-[12.5px]">
                    {s.location}{s.current && <span className="text-accent-blue rtl:mr-1 ltr:ml-1">({t('profile.current')})</span>}
                  </td>
                  <td className="py-3 px-4 text-text-muted text-[12px]">{s.time}</td>
                  <td className="py-3 px-4">
                    <StatusBadge status={s.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-text-muted tracking-[0.06em] uppercase mb-1.5">{label}</label>
      {children}
    </div>
  );
}
function SecurityToggle({ label, desc, value, onChange }: {
  label: string; desc: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-[13px] font-medium text-text-primary">{label}</p>
        <p className="text-[11px] text-text-muted">{desc}</p>
      </div>
      <button onClick={() => onChange(!value)}
        className={`relative w-10 h-[22px] rounded-full transition-colors ${value ? 'bg-navy' : 'bg-gray-300'}`}>
        <span className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow transition-transform ${value ? 'left-[21px]' : 'left-[3px]'}`} />
      </button>
    </div>
  );
}
function StatusBadge({ status }: { status: 'active' | 'signed-out' | 'expired' }) {
  const { t } = useI18n();
  const configs = {
    'active': { dot: 'bg-emerald-500', text: 'text-emerald-700', label: t('profile.statusActive') },
    'signed-out': { dot: 'bg-gray-400', text: 'text-gray-500', label: t('profile.statusSignedOut') },
    'expired': { dot: 'bg-amber-400', text: 'text-amber-600', label: t('profile.statusExpired') },
  };
  const c = configs[status];
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${c.dot}`} />
      <span className={`text-[12px] font-medium ${c.text}`}>{c.label}</span>
    </div>
  );
}

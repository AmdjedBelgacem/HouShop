import { useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAuth } from '../hooks/authContext';
import { useI18n } from '../i18n';
import type { Language } from '../i18n';
import { uiLocale } from '../i18n/locale';
import { useBranding } from '../hooks/brandingContext';
import { DEFAULT_SHOP_NAME } from '../hooks/useBranding';
import CustomSelect from '../components/CustomSelect';
import { useTheme } from '../theme';
import { toast } from 'sonner';
import {
  KeyRound, Eye, EyeOff, Globe, Sun, Moon,
  ImagePlus, Trash2, Loader2, Store,
} from 'lucide-react';

export default function Profile() {
  const { user } = useAuth();
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  const { logoUrl, logoPath, shopName, saveLogo, resetLogo } = useBranding();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const displayName = user?.username
    ? `${user.username.charAt(0).toUpperCase()}${user.username.slice(1)}`
    : t('profile.defaultName');
  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(uiLocale(), { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  // Only what the backend actually stores is editable here: the password.
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const mismatch = pw.confirm.length > 0 && pw.next !== pw.confirm;
  const canSavePw = pw.current.length > 0 && pw.next.length >= 8 && pw.next === pw.confirm && !savingPw;

  const handleChangePassword = async () => {
    if (!canSavePw) return;
    setSavingPw(true);
    try {
      await invoke('change_password', {
        request: {
          username: user?.username ?? '',
          current_password: pw.current,
          new_password: pw.next,
        },
      });
      toast.success(t('profile.passwordChanged'));
      setPw({ current: '', next: '', confirm: '' });
    } catch (e) {
      toast.error(typeof e === 'string' ? e : e instanceof Error ? e.message : String(e));
    } finally {
      setSavingPw(false);
    }
  };

  const handleLogoPick = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error(t('profile.logoInvalidType'));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error(t('profile.logoTooLarge'));
      return;
    }
    setLogoBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error(t('profile.fileReadFailed')));
        reader.readAsDataURL(file);
      });
      await saveLogo(dataUrl, file.name);
      toast.success(t('profile.logoSaved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('profile.logoSaveFailed'));
    } finally {
      setLogoBusy(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  const handleLogoReset = async () => {
    setLogoBusy(true);
    try {
      await resetLogo();
      toast.success(t('profile.logoReset'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('profile.logoSaveFailed'));
    } finally {
      setLogoBusy(false);
    }
  };

  const pwInput = (
    key: 'current' | 'next' | 'confirm',
    autoComplete: string,
    invalid = false,
  ) => (
    <input
      type={showPassword ? 'text' : 'password'}
      value={pw[key]}
      onChange={(e) => setPw(p => ({ ...p, [key]: e.target.value }))}
      onKeyDown={(e) => { if (e.key === 'Enter') handleChangePassword(); }}
      autoComplete={autoComplete}
      aria-invalid={invalid || undefined}
      className={`form-input ${invalid ? 'border-accent-red/60' : ''}`}
    />
  );

  return (
    <div className="p-8 animate-fade-up">
      <div className="mb-7">
        <span className="eyebrow-accent mb-3 flex w-fit">{t('sidebar.groupAccount')}</span>
        <h2 className="page-title">{t('profile.title')}</h2>
        <p className="page-subtitle">{t('profile.subtitle')}</p>
      </div>

      {/* Identity */}
      <div className="card p-6 mb-6 flex items-center gap-5 min-w-0">
        <div className="w-16 h-16 rounded-full bg-navy flex items-center justify-center flex-shrink-0 shadow-raised">
          <span className="text-white text-[24px] font-semibold">{displayName.charAt(0)}</span>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h3 className="text-[20px] font-semibold tracking-[-0.01em] text-text-primary truncate">{displayName}</h3>
            <span className="badge px-2.5 py-0.5 bg-accent-blue/10 text-accent-blue text-[12px] font-semibold">
              {user?.role === 'admin' || !user?.role ? t('profile.roleAdmin') : user.role}
            </span>
          </div>
          <p className="text-[13px] text-text-secondary mt-1">
            {t('profile.storeManager')}
            {memberSince && <> · {t('profile.memberSince', { date: memberSince })}</>}
          </p>
        </div>
      </div>

      {/* Shop branding — logo drives sidebar + window/app icon */}
      <div className="card p-6 mb-6">
        <div className="flex items-center gap-2 mb-5">
          <Store size={16} className="text-text-muted" />
          <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-text-primary">{t('profile.branding')}</h3>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          <div className="w-24 h-24 rounded-2xl border border-border bg-[#faf8fd] flex items-center justify-center overflow-hidden flex-shrink-0">
            <img src={logoUrl} alt={t('profile.shopLogo')} className="w-full h-full object-contain p-2" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-text-primary">{t('profile.shopLogo')}</p>
            <p className="text-[13px] text-text-muted mt-1 leading-relaxed">
              {t('profile.shopLogoDesc')}
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={e => handleLogoPick(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                disabled={logoBusy}
                onClick={() => logoInputRef.current?.click()}
                className="btn-primary px-4 py-2 text-[13px] shadow-none"
              >
                {logoBusy ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                {t('profile.uploadLogo')}
              </button>
              {logoPath && (
                <button
                  type="button"
                  disabled={logoBusy}
                  onClick={handleLogoReset}
                  className="btn-secondary px-4 py-2 text-[13px] text-text-secondary hover:text-accent-red"
                >
                  <Trash2 size={14} />
                  {t('profile.resetLogo')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Shop name — drives sidebar, login, splash, printed docs, and the OS window title */}
      <ShopNameEditor key={shopName} />

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* Password */}
        <div className="xl:col-span-3 card p-6">
          <div className="flex items-center gap-2 mb-1.5">
            <KeyRound size={16} className="text-text-muted" />
            <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-text-primary">{t('profile.changePassword')}</h3>
          </div>
          <p className="text-[13px] text-text-muted mb-5">{t('profile.changePasswordDesc')}</p>
          <div className="space-y-4">
            <Field label={t('login.username')}>
              <input type="text" value={user?.username ?? ''} readOnly autoComplete="username"
                className="form-input bg-surface text-text-secondary" />
            </Field>
            <Field label={t('profile.currentPassword')}>
              <div className="relative">
                {pwInput('current', 'current-password')}
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? t('profile.hidePassword') : t('profile.showPassword')}
                  className="absolute end-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-text-muted hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label={t('profile.newPassword')}>{pwInput('next', 'new-password')}</Field>
              <Field label={t('profile.confirmPassword')}>{pwInput('confirm', 'new-password', mismatch)}</Field>
            </div>
            {mismatch && <p role="alert" className="text-[13px] text-accent-red">{t('profile.passwordMismatch')}</p>}
            <div className="pt-1">
              <button type="button" onClick={handleChangePassword} disabled={!canSavePw} className="btn-primary px-5 py-2.5 text-[13px]">
                {savingPw && <Loader2 size={14} className="animate-spin" />}
                {t('profile.savePassword')}
              </button>
            </div>
          </div>
        </div>

        {/* Preferences */}
        <div className="xl:col-span-2 card p-6 self-start">
          <div className="flex items-center gap-2 mb-5">
            <Globe size={16} className="text-text-muted" />
            <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-text-primary">{t('profile.preferences')}</h3>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-text-primary">{t('profile.language')}</p>
              <p className="text-[13px] text-text-muted">{t('profile.languageDesc')}</p>
            </div>
            <CustomSelect
              value={lang}
              onChange={(v) => setLang(v as Language)}
              options={[
                { value: 'en', label: 'English' },
                { value: 'fr', label: 'Français' },
                { value: 'ar', label: 'العربية' },
              ]}
              size="sm"
              className="w-[130px]"
            />
          </div>
          <div className="mt-5 flex items-center justify-between gap-4 border-t border-border-light pt-5">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-text-primary">{t('theme.appearance')}</p>
              <p className="text-[13px] text-text-muted">{t('theme.appearanceDesc')}</p>
            </div>
            <div role="radiogroup" aria-label={t('theme.appearance')} className="inline-flex rounded-[10px] border border-border p-0.5">
              {([
                { value: 'light', label: t('theme.light'), icon: <Sun size={14} /> },
                { value: 'dark', label: t('theme.dark'), icon: <Moon size={14} /> },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={theme === opt.value}
                  onClick={() => setTheme(opt.value)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[13px] font-medium transition-colors ${
                    theme === opt.value ? 'bg-navy text-white' : 'text-text-secondary hover:bg-[rgb(var(--ink)/0.06)]'
                  }`}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-text-secondary mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function ShopNameEditor() {
  const { t } = useI18n();
  const { shopName, saveShopName, resetShopName } = useBranding();
  const [draft, setDraft] = useState(shopName);
  const saved = draft.trim() === shopName;
  const handleSave = async () => {
    try {
      await saveShopName(draft);
      toast.success(t('profile.shopNameSaved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('profile.shopNameSaveFailed'));
    }
  };
  const handleReset = async () => {
    try {
      await resetShopName();
      toast.success(t('profile.shopNameReset'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('profile.shopNameSaveFailed'));
    }
  };
  return (
    <div className="card p-6 mb-6">
      <div className="flex items-center gap-2 mb-5">
        <Store size={16} className="text-text-muted" />
        <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-text-primary">{t('profile.shopName')}</h3>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-end gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-text-primary">{t('profile.shopNameLabel')}</p>
          <p className="text-[13px] text-text-muted mt-1 leading-relaxed">
            {t('profile.shopNameDesc')}
          </p>
          <input
            type="text"
            value={draft}
            maxLength={48}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !saved) handleSave(); }}
            placeholder={DEFAULT_SHOP_NAME}
            className="form-input mt-3"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={saved}
            onClick={handleSave}
            className="btn-primary px-4 py-2 text-[13px] shadow-none"
          >
            {t('profile.saveShopName')}
          </button>
          {shopName !== DEFAULT_SHOP_NAME && (
            <button
              type="button"
              onClick={handleReset}
              className="btn-secondary px-4 py-2 text-[13px] text-text-secondary hover:text-accent-red"
            >
              <Trash2 size={14} />
              {t('profile.resetShopName')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

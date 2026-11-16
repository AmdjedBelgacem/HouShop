import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAuth } from '../hooks/authContext';
import { useI18n } from '../i18n';
import { useBranding } from '../hooks/brandingContext';
import type { LoginResponse } from '../lib/types';
import { Eye, EyeOff, User, Lock, ArrowRight, Loader2 } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const { t } = useI18n();
  const { logoUrl, shopName } = useBranding();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // null while checking; true when no account exists yet, so the create-administrator form is shown
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    invoke<boolean>('has_users')
      .then((hasUsers) => setNeedsSetup(!hasUsers))
      .catch(() => setNeedsSetup(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (needsSetup) {
      if (password.length < 8) {
        setError(t('login.passwordTooShort'));
        return;
      }
      if (password !== confirmPassword) {
        setError(t('login.passwordMismatch'));
        return;
      }
    }

    setLoading(true);
    try {
      if (needsSetup) {
        await invoke('create_initial_admin', { username, password });
        setNeedsSetup(false);
      }
      const response = await invoke<LoginResponse>('login', {
        request: { username, password },
      });
      login(response);
    } catch (err) {
      const fallback = needsSetup ? t('login.setupFailed') : t('login.failed');
      setError(typeof err === 'string' ? err : fallback);
    } finally {
      setLoading(false);
    }
  };

  const submitDisabled =
    loading ||
    needsSetup === null ||
    !username ||
    !password ||
    (needsSetup === true && !confirmPassword);

  return (
    <div
      className="flex min-h-screen w-screen flex-col items-center justify-center gap-7 px-5 py-12"
      style={{
        backgroundColor: '#060a14',
        backgroundImage:
          'radial-gradient(900px 520px at 50% -120px, rgba(37,99,235,0.42), transparent 70%), radial-gradient(520px 340px at 85% 0, rgba(59,130,246,0.14), transparent 70%)',
      }}
    >
      {/* Wordmark */}
      <div className="animate-fade-up flex flex-col items-center gap-3 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-[16px] bg-[#faf8fd] p-2">
          <img src={logoUrl} alt="" className="h-full w-full object-contain" />
        </span>
        <span dir="auto" className="text-[40px] font-semibold leading-[44px] tracking-[-0.05em] text-text-primary">
          {shopName}<span className="text-[#3b82f6]">.</span>
        </span>
        <span className="eyebrow-accent">{t('sidebar.managementSuite')}</span>
      </div>

      <form
        onSubmit={handleSubmit}
        className="animate-fade-up flex w-full max-w-[400px] flex-col gap-5 rounded-[20px] border border-border bg-card p-8"
        style={{ boxShadow: 'inset 0 1px 0 rgba(250,248,253,0.06), var(--shadow-raised)' }}
      >
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[28px] font-semibold leading-8 tracking-[-0.03em] text-text-primary">
            {needsSetup ? t('login.setupTitle') : t('login.heading')}<span className="text-[#3b82f6]">.</span>
          </h1>
          <p className="text-[14px] leading-[22px] text-text-secondary">
            {needsSetup ? t('login.setupSubtitle') : t('login.subtitle')}
          </p>
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2.5 rounded-[10px] bg-[rgba(255,77,106,0.14)] px-3.5 py-3 text-[13px] font-medium text-accent-red">
            <span className="mt-px flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-[#ff4d6a] text-[10px] font-bold text-[#060a14]">!</span>
            <span>{error}</span>
          </div>
        )}

        <Field id="login-user" label={t('login.username')} icon={<User size={16} />}>
          <input
            id="login-user"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="form-input h-11 pl-10 text-[15px]"
            placeholder={t('login.enterUsername')}
            required
            autoComplete="username"
            autoFocus
          />
        </Field>

        <Field id="login-pass" label={t('login.password')} icon={<Lock size={16} />}>
          <input
            id="login-pass"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="form-input h-11 pl-10 pr-11 text-[15px]"
            placeholder={t('login.enterPassword')}
            required
            autoComplete={needsSetup ? 'new-password' : 'current-password'}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? t('profile.hidePassword') : t('profile.showPassword')}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-text-muted transition-colors hover:text-text-primary"
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </Field>

        {needsSetup && (
          <Field id="login-confirm" label={t('login.confirmPassword')} icon={<Lock size={16} />}>
            <input
              id="login-confirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="form-input h-11 pl-10 text-[15px]"
              required
              autoComplete="new-password"
            />
          </Field>
        )}

        <button type="submit" disabled={submitDisabled} className="btn-primary group h-12 w-full text-[15px]">
          {loading ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              {t('login.signingIn')}
            </>
          ) : (
            <>
              {needsSetup ? t('login.createAccount') : t('login.signIn')}
              <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </button>

        <p className="text-center text-[12px] leading-[18px] text-text-muted">{t('login.footerHint')}</p>
      </form>

      <div className="flex h-8 items-center gap-2 rounded-full border border-border-light bg-[rgba(13,19,34,0.8)] px-3.5 text-[12px] text-text-secondary">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent-green" />
        {t('login.systemReady')}
      </div>
    </div>
  );
}

function Field({ id, label, icon, children }: { id: string; label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-text-secondary">{label}</label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted">{icon}</span>
        {children}
      </div>
    </div>
  );
}

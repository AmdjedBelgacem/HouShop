import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../i18n';
import type { LoginResponse } from '../lib/types';
import { Eye, EyeOff, User, Lock, ArrowRight, Loader2 } from 'lucide-react';
import logoImg from '../assets/logo.png';
export default function Login() {
  const { login } = useAuth();
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await invoke<LoginResponse>('login', {
        request: { username, password },
      });
      login(response);
    } catch (err) {
      setError(typeof err === 'string' ? err : t('login.failed'));
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="h-screen w-screen flex overflow-hidden bg-surface">
      {}
      <div className="hidden lg:flex lg:w-[55%] relative flex-col items-center justify-center overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #334155 100%)' }}>
        {}
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full opacity-[0.04]" style={{ background: 'white' }} />
        <div className="absolute -bottom-48 -right-24 w-[500px] h-[500px] rounded-full opacity-[0.03]" style={{ background: 'white' }} />
        <div className="absolute top-1/4 right-1/4 w-64 h-64 rounded-full opacity-[0.02]" style={{ background: 'white' }} />
        {}
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }} />
        {}
        <div className="relative z-10 flex flex-col items-center text-center px-12">
          <div className="w-24 h-24 rounded-3xl bg-white/10 backdrop-blur-sm flex items-center justify-center mb-8 shadow-2xl border border-white/10">
            <img src={logoImg} alt="" className="w-16 h-16 object-contain" />
          </div>
          <h1 className="text-[36px] font-bold text-white leading-tight tracking-tight mb-3">
            HouPhone Shop
          </h1>
          <p className="text-[13px] font-medium text-white/40 tracking-[0.15em] uppercase mb-8">
            {t('sidebar.managementSuite')}
          </p>
          <div className="w-12 h-[2px] rounded-full bg-white/15 mb-8" />
          <p className="text-[15px] text-white/60 leading-relaxed max-w-[340px]">
            {t('login.welcomeBack')}
          </p>
        </div>
        {}
        <div className="absolute bottom-8 left-0 right-0 flex justify-center">
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-sm">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] text-white/40 font-medium">{t('login.systemReady')}</span>
          </div>
        </div>
      </div>
      {}
      <div className="flex-1 flex flex-col items-center justify-center px-8 lg:px-16 bg-card relative">
        {}
        <div className="lg:hidden flex flex-col items-center mb-10">
          <div className="w-16 h-16 rounded-2xl bg-navy flex items-center justify-center mb-4 shadow-lg">
            <img src={logoImg} alt="" className="w-10 h-10 object-contain" />
          </div>
          <h1 className="text-[22px] font-bold text-text-primary">HouPhone Shop</h1>
          <p className="text-[11px] text-text-muted tracking-[0.1em] uppercase mt-1">{t('sidebar.managementSuite')}</p>
        </div>
        <div className="w-full max-w-[380px]">
          {}
          <div className="mb-8">
            <h2 className="text-[26px] font-bold text-text-primary leading-tight">
              {t('login.title')}
            </h2>
            <p className="text-[14px] text-text-secondary mt-2">
              {t('login.subtitle')}
            </p>
          </div>
          {}
          {error && (
            <div className="mb-6 flex items-center gap-3 bg-red-50 text-accent-red text-[13px] font-medium rounded-xl px-4 py-3 border border-red-100">
              <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <span className="text-[11px] font-bold">!</span>
              </div>
              {error}
            </div>
          )}
          {}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-[12px] font-semibold text-text-secondary mb-2 tracking-wide">
                {t('login.username')}
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted">
                  <User size={16} />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-border bg-surface text-[14px] text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy/30 transition-all"
                  placeholder={t('login.enterUsername')}
                  required
                  autoComplete="username"
                />
              </div>
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-text-secondary mb-2 tracking-wide">
                {t('login.password')}
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted">
                  <Lock size={16} />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-12 py-3 rounded-xl border border-border bg-surface text-[14px] text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy/30 transition-all"
                  placeholder={t('login.enterPassword')}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors p-0.5"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full py-3.5 bg-navy text-white rounded-xl font-semibold text-[14px] hover:bg-navy-light disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2.5 group shadow-sm"
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  {t('login.signingIn')}
                </>
              ) : (
                <>
                  {t('login.signIn')}
                  <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>
          </form>
          {}
          <div className="mt-10 pt-6 border-t border-border-light">
            <p className="text-[11.5px] text-text-muted text-center">
              {t('login.footerHint')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

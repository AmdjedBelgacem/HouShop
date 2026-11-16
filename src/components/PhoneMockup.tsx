import React from 'react';
import type { DeviceInfo, TransferCategory, TransferProgressEvent } from '../lib/types';
import { useI18n } from '../i18n';
import {
  Battery,
  BatteryCharging,
  Wifi,
  HardDrive,
  CheckCircle,
  AlertTriangle,
  Lock,
  ArrowUpRight,
  ArrowDownLeft,
  Image as ImageIcon,
  Users,
  MessageSquare,
  PhoneCall,
  Calendar,
  Video,
  Music,
  FileText,
  Sparkles,
  Zap,
} from 'lucide-react';

interface PhoneMockupProps {
  device: DeviceInfo | null;
  role: 'source' | 'target';
  isTransferring?: boolean;
  isCompleted?: boolean;
  progress?: TransferProgressEvent | null;
  selectedCategories?: TransferCategory[];
  onSelect?: () => void;
}

const CATEGORY_ICONS: Record<TransferCategory, React.ReactNode> = {
  contacts: <Users size={16} className="text-accent-blue" />,
  messages: <MessageSquare size={16} className="text-accent-green" />,
  calls: <PhoneCall size={16} className="text-accent-blue" />,
  calendars: <Calendar size={16} className="text-purple-400" />,
  photos: <ImageIcon size={16} className="text-accent-orange" />,
  videos: <Video size={16} className="text-accent-red" />,
  audio: <Music size={16} className="text-cyan-400" />,
  documents: <FileText size={16} className="text-accent-orange" />,
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i > 1 ? 1 : 0)} ${sizes[i]}`;
}

export default function PhoneMockup({
  device,
  role,
  isTransferring = false,
  isCompleted = false,
  progress,
  selectedCategories = [],
  onSelect,
}: PhoneMockupProps) {
  const isApple = device?.platform === 'ios';
  const isSamsung = device?.brand.toLowerCase().includes('samsung');
  const isReady = device?.connection_state === 'connected';
  const isSource = role === 'source';
  const { t } = useI18n();
  const categoryLabel: Record<TransferCategory, string> = {
    contacts: t('transfer.cat.contacts'),
    messages: t('diag.phone.cat.messages'),
    calls: t('diag.phone.cat.calls'),
    calendars: t('transfer.cat.calendars'),
    photos: t('diag.phone.cat.photos'),
    videos: t('diag.phone.cat.videos'),
    audio: t('diag.phone.cat.audio'),
    documents: t('diag.phone.cat.documents'),
  };

  const usedBytes = device ? device.storage_total_bytes - device.storage_free_bytes : 0;
  const storagePct = device && device.storage_total_bytes > 0
    ? Math.min(100, Math.round((usedBytes / device.storage_total_bytes) * 100))
    : 45;

  // Frame corner radius: iPhone is rounder, Samsung Ultra is boxier
  const cornerClass = isApple
    ? 'rounded-[46px]'
    : isSamsung
    ? 'rounded-[32px]'
    : 'rounded-[38px]';

  const glowClass = isTransferring
    ? isSource
      ? 'animate-glow-source border-cyan-500/60'
      : 'animate-glow-target border-accent-green/60'
    : isCompleted
    ? 'border-accent-green/70 shadow-accent-green/20'
    : isSource
    ? 'border-zinc-700/80 hover:border-accent-blue/40'
    : 'border-zinc-700/80 hover:border-accent-green/40';

  return (
    <div className="flex flex-col items-center">
      {/* Role Header Badge */}
      <div className="mb-3 flex items-center gap-2">
        <span
          className={`badge px-3 py-1 text-[13px] font-semibold border ${
            isSource
              ? 'bg-accent-blue/10 text-accent-blue border-accent-blue/25'
              : 'bg-accent-green/10 text-accent-green border-accent-green/25'
          }`}
        >
          {isSource ? <ArrowUpRight size={13} strokeWidth={2.5} /> : <ArrowDownLeft size={13} strokeWidth={2.5} />}
          <span>{isSource ? t('diag.phone.source') : t('diag.phone.destination')}</span>
        </span>
      </div>

      {/* Physical Phone Chassis Container */}
      <div
        onClick={onSelect}
        className={`relative w-[280px] h-[540px] bg-zinc-900 border-[7px] ${glowClass} ${cornerClass} p-2 shadow-2xl transition-all duration-300 cursor-pointer select-none`}
        style={{
          boxShadow: isTransferring
            ? isSource
              ? '0 0 25px rgba(6, 182, 212, 0.3), 0 20px 40px rgba(0,0,0,0.4)'
              : '0 0 25px rgba(16, 185, 129, 0.3), 0 20px 40px rgba(0,0,0,0.4)'
            : '0 15px 35px rgba(0,0,0,0.35)',
        }}
      >
        {/* Hardware Buttons - Left side (Volume / Action) */}
        <div className="absolute -left-[10px] top-24 w-[3px] h-10 bg-zinc-600 rounded-l-sm" />
        <div className="absolute -left-[10px] top-38 w-[3px] h-12 bg-zinc-600 rounded-l-sm" />
        <div className="absolute -left-[10px] top-54 w-[3px] h-12 bg-zinc-600 rounded-l-sm" />

        {/* Hardware Buttons - Right side (Power) */}
        <div className="absolute -right-[10px] top-32 w-[3px] h-16 bg-zinc-600 rounded-r-sm" />

        {/* Internal Screen Area */}
        <div
          className={`w-full h-full rounded-[38px] overflow-hidden flex flex-col justify-between relative text-white ${
            isApple
              ? 'bg-gradient-to-b from-slate-900 via-indigo-950/70 to-slate-950'
              : isSamsung
              ? 'bg-gradient-to-b from-zinc-950 via-sky-950/60 to-black'
              : 'bg-gradient-to-b from-gray-950 via-slate-900 to-black'
          }`}
        >
          {/* Top Camera Hardware Notch / Cutout */}
          <div className="relative pt-2 pb-1 px-4 z-20 flex items-center justify-between text-[13px] font-medium text-white/80">
            {/* Clock */}
            <span>{isApple ? '09:41' : '12:30'}</span>

            {/* Apple Dynamic Island or Android Hole Punch */}
            {isApple ? (
              <div className="w-20 h-5 bg-black rounded-full flex items-center justify-between px-2 shadow-inner">
                <div className="w-2.5 h-2.5 rounded-full bg-zinc-900 ring-1 ring-zinc-800" />
                <div className="w-2 h-2 rounded-full bg-blue-900/60" />
              </div>
            ) : (
              <div className="w-3.5 h-3.5 bg-black rounded-full ring-1 ring-zinc-700 shadow-inner" />
            )}

            {/* Signal & Battery */}
            <div className="flex items-center gap-1.5 text-white/80">
              <span className="text-[13px] font-bold tracking-tight">5G</span>
              <Wifi size={11} />
              <div className="flex items-center gap-0.5">
                <span className="text-[13px] font-bold">{device?.battery_level ?? 88}%</span>
                {device?.is_charging ? (
                  <BatteryCharging size={13} className="text-accent-green" />
                ) : (
                  <Battery size={13} />
                )}
              </div>
            </div>
          </div>

          {/* SCREEN CONTENT BY STATE */}
          <div className="flex-1 flex flex-col justify-between px-4 py-3 relative z-10 overflow-hidden">
            {/* NO DEVICE CONNECTED */}
            {!device ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center space-y-3 opacity-60">
                <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                  <Zap size={24} className="text-white/40 animate-pulse" />
                </div>
                <p className="text-[13px] font-semibold text-white/70">{t('diag.phone.noPhone')}</p>
                <p className="text-[13px] text-white/40">{t('diag.phone.noPhoneDesc')}</p>
              </div>
            ) : isCompleted ? (
              /* COMPLETED SUCCESS STATE */
              <div className="flex-1 flex flex-col items-center justify-center text-center space-y-3 animate-in fade-in zoom-in-95">
                <div className="w-16 h-16 rounded-full bg-accent-green/20 border-2 border-accent-green text-accent-green flex items-center justify-center shadow-lg shadow-accent-green/30">
                  <CheckCircle size={32} strokeWidth={2.5} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-accent-green tracking-tight">{t('diag.phone.complete')}</h4>
                  <p className="text-[13px] text-white/70 mt-0.5">{t('diag.phone.completeDesc')}</p>
                </div>
                <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-[13px] text-white/80 space-y-1 w-full text-left font-mono">
                  <div className="flex justify-between">
                    <span>{t('diag.phone.transferred')}</span>
                    <span className="font-bold text-accent-green">{progress?.current_item_index ?? t('common.all')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('diag.phone.integrity')}</span>
                    <span className="font-bold text-white">{t('diag.phone.sha')}</span>
                  </div>
                </div>
              </div>
            ) : isTransferring ? (
              /* LIVE STREAMING TRANSFER STATE */
              <div className="flex-1 flex flex-col justify-between py-2 text-center space-y-3">
                <div className="space-y-1">
                  <span className="text-[13px] font-bold uppercase tracking-wider text-cyan-400 animate-pulse">
                    {isSource ? t('diag.phone.outbound') : t('diag.phone.inbound')}
                  </span>
                  <div className="text-2xl font-bold text-white tracking-tight">
                    {progress?.progress_percentage.toFixed(0) ?? 0}%
                  </div>
                </div>

                {/* Center Floating Active Item Card */}
                <div className="p-3.5 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 shadow-xl space-y-2 relative overflow-hidden">
                  <div className="w-10 h-10 rounded-xl bg-white/15 mx-auto flex items-center justify-center shadow-inner">
                    {progress?.current_category ? (
                      CATEGORY_ICONS[progress.current_category]
                    ) : (
                      <Sparkles size={20} className="text-accent-orange animate-spin" />
                    )}
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[13px] font-bold text-white truncate max-w-[200px] mx-auto">
                      {progress?.current_item_name ?? t('diag.phone.preparing')}
                    </p>
                    <p className="text-[13px] text-white/60">
                      {formatBytes(progress?.transferred_bytes ?? 0)} / {formatBytes(progress?.total_bytes ?? 1)}
                    </p>
                  </div>
                </div>

                {/* Mini Storage Fill Simulation */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[13px] text-white/70">
                    <span>{isSource ? t('diag.phone.dataRead') : t('diag.phone.writing')}</span>
                    <span>{formatBytes(progress?.transferred_bytes ?? 0)}</span>
                  </div>
                  <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        isSource ? 'bg-cyan-400' : 'bg-accent-green'
                      }`}
                      style={{ width: `${progress?.progress_percentage ?? 5}%` }}
                    />
                  </div>
                </div>
              </div>
            ) : device.connection_state === 'need_trust' ? (
              /* IPHONE "TRUST THIS COMPUTER" PROMPT MOCKUP */
              <div className="flex-1 flex flex-col items-center justify-center text-center space-y-3">
                <div className="p-4 rounded-2xl bg-white/15 backdrop-blur-md border border-white/25 shadow-2xl text-center space-y-2">
                  <div className="w-10 h-10 rounded-full bg-accent-orange/20 text-amber-300 mx-auto flex items-center justify-center">
                    <Lock size={20} />
                  </div>
                  <h4 className="text-[13px] font-bold text-white">{t('diag.phone.trustTitle')}</h4>
                  <p className="text-[13px] text-white/80 leading-snug">
                    {t('diag.phone.trustDesc')}
                  </p>
                  <div className="pt-2 border-t border-white/20 grid grid-cols-2 gap-2 text-[13px] font-bold">
                    <span className="text-white/50">{t('diag.phone.dontTrust')}</span>
                    <span className="text-accent-blue font-bold animate-pulse">{t('diag.phone.trust')}</span>
                  </div>
                </div>
              </div>
            ) : device.connection_state === 'unauthorized' ? (
              /* ANDROID USB DEBUGGING PROMPT MOCKUP */
              <div className="flex-1 flex flex-col items-center justify-center text-center space-y-3">
                <div className="p-4 rounded-2xl bg-white/15 backdrop-blur-md border border-white/25 shadow-2xl text-center space-y-2">
                  <div className="w-10 h-10 rounded-full bg-accent-orange/20 text-amber-300 mx-auto flex items-center justify-center">
                    <AlertTriangle size={20} />
                  </div>
                  <h4 className="text-[13px] font-bold text-white">{t('diag.phone.usbDebugTitle')}</h4>
                  <p className="text-[13px] text-white/80 leading-snug">
                    {t('diag.phone.usbDebugDesc')}
                  </p>
                  <div className="p-1 rounded bg-white/10 text-[13px] font-mono text-accent-green">
                    {t('diag.phone.alwaysAllow')}
                  </div>
                </div>
              </div>
            ) : (
              /* IDLE READY PHONE DASHBOARD */
              <div className="flex-1 flex flex-col justify-between py-1 space-y-3">
                {/* Brand & Model Identity */}
                <div className="text-center space-y-1 mt-1">
                  <span className="px-2 py-0.5 rounded-full text-[13px] font-bold tracking-wider uppercase bg-white/10 text-white/90 border border-white/15">
                    {device.brand.toUpperCase()}
                  </span>
                  <h3 className="text-base font-bold text-white tracking-tight leading-snug truncate">
                    {device.model}
                  </h3>
                  <p className="text-[13px] text-white/60 font-mono truncate">{device.os_version}</p>
                </div>

                {/* Storage Disk Meter */}
                <div className="p-3 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 space-y-2">
                  <div className="flex items-center justify-between text-[13px] text-white/80">
                    <div className="flex items-center gap-1.5 font-medium">
                      <HardDrive size={13} className="text-white/60" />
                      <span>{t('diag.phone.internalStorage')}</span>
                    </div>
                    <span className="font-bold">{storagePct}%</span>
                  </div>

                  <div className="w-full bg-white/15 h-2 rounded-full overflow-hidden flex">
                    <div className="bg-accent-blue h-full" style={{ width: `${storagePct * 0.4}%` }} title={t('diag.phone.legendApps')} />
                    <div className="bg-accent-orange h-full" style={{ width: `${storagePct * 0.4}%` }} title={t('diag.phone.legendMedia')} />
                    <div className="bg-accent-green h-full" style={{ width: `${storagePct * 0.2}%` }} title={t('diag.phone.legendDocs')} />
                  </div>

                  <div className="flex justify-between text-[13px] text-white/60 font-medium">
                    <span>{t('diag.phone.used', { size: formatBytes(usedBytes) })}</span>
                    <span className="text-white/90 font-bold">{t('diag.phone.free', { size: formatBytes(device.storage_free_bytes) })}</span>
                  </div>
                </div>

                {/* Category Availability Badges */}
                <div className="grid grid-cols-2 gap-1.5">
                  {(['contacts', 'photos', 'videos', 'messages', 'calls', 'audio', 'documents', 'calendars'] as TransferCategory[]).map((cat) => {
                    const isSelected = selectedCategories.includes(cat);
                    return (
                      <div
                        key={cat}
                        className={`flex min-w-0 items-center gap-1 rounded-xl border px-1.5 py-1.5 transition-all ${
                          isSelected
                            ? 'border-white/30 bg-white/15 text-white'
                            : 'border-white/5 bg-white/5 text-white/50'
                        }`}
                        title={categoryLabel[cat]}
                      >
                        <span className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center overflow-hidden [&>svg]:h-3 [&>svg]:w-3">{CATEGORY_ICONS[cat]}</span>
                        <span className="min-w-0 truncate text-[13px] font-medium">{categoryLabel[cat]}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Bottom Home Indicator Bar */}
          <div className="pb-2 pt-1 flex justify-center z-20">
            <div className={`h-1 bg-white/50 rounded-full ${isApple ? 'w-28' : 'w-24'}`} />
          </div>
        </div>
      </div>

      {/* Device Connection Footer Badge */}
      <div className="mt-3 text-center space-y-0.5">
        <p className="text-sm font-semibold text-text-primary truncate max-w-[240px]">
          {device?.name ?? t('diag.phone.selectDevice')}
        </p>
        {device && (
          <div className="flex items-center justify-center gap-1.5 text-[13px] text-text-muted">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                isReady ? 'bg-accent-green' : 'bg-accent-orange animate-pulse'
              }`}
            />
            <span className="font-mono">{device.connection_type.toUpperCase()}</span>
            <span>•</span>
            <span className="truncate max-w-[120px]">{device.id}</span>
          </div>
        )}
      </div>
    </div>
  );
}

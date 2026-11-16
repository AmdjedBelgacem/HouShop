import React from 'react';
import type { TransferProgressEvent } from '../lib/types';
import { useI18n } from '../i18n';
import {
  ArrowLeftRight,
  Gauge,
  Pause,
  Play,
  XCircle,
  Zap,
  ShieldCheck,
} from 'lucide-react';

interface TransferDataBridgeProps {
  isTransferring: boolean;
  isCompleted: boolean;
  /** Tracked by the page from pause/resume command results — the backend keeps
   *  streaming `in_progress` progress events even while the pipeline is halted. */
  isPaused?: boolean;
  progress?: TransferProgressEvent | null;
  onSwapRoles: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export default function TransferDataBridge({
  isTransferring,
  isCompleted,
  isPaused = false,
  progress,
  onSwapRoles,
  onPause,
  onResume,
  onCancel,
}: TransferDataBridgeProps) {
  const { t } = useI18n();
  const speedMbps = progress?.speed_mbps ?? 0;
  const progressPct = Math.min(100, Math.max(0, progress?.progress_percentage ?? 0));

  return (
    <div className="flex flex-col items-center justify-center px-2 w-full max-w-sm mx-auto select-none space-y-5">
      {/* Top Swap Control (active when idle) */}
      {!isTransferring && !isCompleted && (
        <button
          type="button"
          onClick={onSwapRoles}
          title={t('xfer.swapTitle')}
          className="btn-secondary px-4 py-2.5 text-[13px] text-text-primary group"
        >
          <ArrowLeftRight size={16} className="text-navy group-hover:rotate-180 transition-transform duration-500" />
          <span className="font-medium">{t('xfer.swapPhones')}</span>
        </button>
      )}

      {/* Data conduit: a thin cable that carries a flowing beam while transferring */}
      <div className="w-full relative flex items-center justify-center py-2">
        <svg className="w-full h-12 overflow-visible" preserveAspectRatio="none" viewBox="0 0 200 40">
          <defs>
            <linearGradient id="laserGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.8" />
              <stop offset="50%" stopColor="#3b82f6" stopOpacity="1" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.8" />
            </linearGradient>
            <filter id="laserGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="glow" />
              <feMerge>
                <feMergeNode in="glow" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Background Track Cable */}
          <path
            d="M 10 20 L 190 20"
            stroke="currentColor"
            strokeWidth="4"
            className="text-border"
            strokeLinecap="round"
          />

          {/* Active Flowing Beam */}
          {isTransferring && !isPaused && (
            <path
              d="M 10 20 L 190 20"
              stroke="url(#laserGradient)"
              strokeWidth="5"
              fill="none"
              strokeLinecap="round"
              filter="url(#laserGlow)"
              className="animate-beam-flow"
            />
          )}

          {/* Flow Direction Pulses */}
          {isTransferring && !isPaused && (
            <>
              <circle cx="50" cy="20" r="3" fill="#06b6d4" className="animate-ping" />
              <circle cx="100" cy="20" r="3.5" fill="#3b82f6" className="animate-ping" style={{ animationDelay: '0.4s' }} />
              <circle cx="150" cy="20" r="3" fill="#10b981" className="animate-ping" style={{ animationDelay: '0.8s' }} />
            </>
          )}
        </svg>

        {/* Center node */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
          <div
            className={`w-11 h-11 rounded-2xl flex items-center justify-center border shadow-sm transition-colors ${
              isTransferring
                ? isPaused
                  ? 'bg-accent-orange/10 border-accent-orange/40 text-accent-orange'
                  : 'bg-navy/10 border-navy/40 text-navy'
                : isCompleted
                ? 'bg-accent-green/10 border-accent-green/40 text-accent-green'
                : 'bg-card border-border text-text-muted'
            }`}
          >
            <Zap
              size={isTransferring ? 20 : 18}
              className={isTransferring && !isPaused ? 'animate-bounce' : ''}
            />
          </div>
        </div>
      </div>

      {/* Live transfer card (shown while transferring) */}
      {isTransferring && (
        <div className="card w-full p-5 space-y-4 animate-fade-up">
          {/* Throughput */}
          <div className="flex items-end justify-between gap-3">
            <div className="flex items-center gap-1.5 text-[13px] text-text-secondary font-medium">
              <Gauge size={15} className="text-accent-blue" />
              <span>{t('xfer.throughput')}</span>
            </div>
            <div className="text-right">
              <span className="text-[24px] font-semibold text-text-primary tracking-tight tabular-nums">
                {speedMbps.toFixed(1)}
              </span>
              <span className="text-[13px] font-medium text-text-muted ml-1">MB/s</span>
            </div>
          </div>

          {/* Slim progress bar */}
          <div className="space-y-1.5">
            <div
              className="h-1.5 w-full rounded-full bg-surface overflow-hidden"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progressPct)}
            >
              <div
                className="h-full rounded-full bg-navy transition-[width] duration-500 ease-out"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex justify-end text-[13px] text-text-muted tabular-nums">{Math.round(progressPct)}%</div>
          </div>

          {/* Time metrics */}
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl bg-surface p-3">
              <span className="block text-[13px] text-text-muted font-medium">{t('xfer.remaining')}</span>
              <span className="block mt-0.5 text-[15px] font-semibold text-text-primary tabular-nums">
                {formatDuration(progress?.eta_seconds ?? 45)}
              </span>
            </div>
            <div className="rounded-xl bg-surface p-3">
              <span className="block text-[13px] text-text-muted font-medium">{t('xfer.elapsed')}</span>
              <span className="block mt-0.5 text-[15px] font-semibold text-text-primary tabular-nums">
                {formatDuration(progress?.elapsed_seconds ?? 12)}
              </span>
            </div>
          </div>

          {/* In-flight controls */}
          <div className="flex items-center gap-2 pt-1">
            {isPaused ? (
              <button
                type="button"
                onClick={onResume}
                className="btn-primary flex-1 py-2.5 px-3 text-[13px] bg-accent-green hover:bg-accent-green hover:brightness-110"
              >
                <Play size={14} />
                <span>{t('transfer.resume')}</span>
              </button>
            ) : (
              <button type="button" onClick={onPause} className="btn-secondary flex-1 py-2.5 px-3 text-[13px]">
                <Pause size={14} />
                <span>{t('transfer.pause')}</span>
              </button>
            )}

            <button
              type="button"
              onClick={onCancel}
              title={t('transfer.cancel')}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-accent-red/30 bg-accent-red/10 px-3 py-2.5 text-[13px] font-medium text-accent-red hover:bg-accent-red/15 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-red/30"
            >
              <XCircle size={14} />
              <span>{t('common.cancel')}</span>
            </button>
          </div>
        </div>
      )}

      {/* Safety guarantee */}
      <div className="flex items-center justify-center gap-1.5 text-[13px] text-text-muted">
        <ShieldCheck size={14} className="text-accent-green" />
        <span>{t('xfer.safetyLine')}</span>
      </div>
    </div>
  );
}

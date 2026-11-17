import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { Wrench, RefreshCw, Stethoscope, X } from 'lucide-react';
import { useI18n } from '../i18n';

interface PhoneToolStatus {
  adb: boolean;
  ios: boolean;
}

interface ConnectionReport {
  adb_devices: [string, string][];
  ios_devices: string[];
  usb: { name: string; vendor_id: string; driver_ok: boolean; phone_like: boolean }[];
  hints: { code: string; detail: string }[];
}

/**
 * Explains why a phone may never show up: the helper tools that read phones
 * over USB (adb for Android, libimobiledevice for iPhone) aren't installed.
 * Renders nothing when both are present.
 */
export default function PhoneToolsNotice() {
  const { t } = useI18n();
  const { data, refetch, isFetching } = useQuery({
    queryKey: ['phone-tool-status'],
    queryFn: () => invoke<PhoneToolStatus>('get_phone_tool_status'),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });

  const [report, setReport] = useState<ConnectionReport | null>(null);
  const [checking, setChecking] = useState(false);
  const runCheck = async () => {
    setChecking(true);
    try {
      setReport(await invoke<ConnectionReport>('get_phone_connection_report'));
    } catch {
      setReport({ adb_devices: [], ios_devices: [], usb: [], hints: [] });
    } finally {
      setChecking(false);
    }
  };
  const onWindows = /win/i.test(navigator.platform);
  const toolsMissing = !!data && !(data.adb && data.ios);

  const checkBlock = (
    <div className="space-y-2">
      {!report ? (
        <button type="button" onClick={runCheck} disabled={checking} className="btn-ghost px-2 py-1 text-[13px] font-semibold text-navy">
          <Stethoscope size={13} className={checking ? 'animate-pulse' : ''} /> {checking ? t('diag.check.running') : t('diag.check.button')}
        </button>
      ) : (
        <div role="status" className="rounded-2xl border border-border bg-surface px-4 py-3.5 text-[13px] text-text-secondary space-y-2">
          <div className="flex items-start justify-between gap-3">
            <p className="font-semibold text-text-primary">{t('diag.check.title')}</p>
            <button type="button" onClick={() => setReport(null)} aria-label={t('diag.check.close')} className="btn-ghost p-1">
              <X size={13} />
            </button>
          </div>
          <p>
            {t('diag.check.seen', {
              n: report.adb_devices.filter(([, st]) => st === 'device').length,
              m: report.ios_devices.length,
            })}
          </p>
          {report.usb.some((u) => u.phone_like) && (
            <p className="text-text-muted">
              {t('diag.check.usbSeen', { list: report.usb.filter((u) => u.phone_like).map((u) => u.name).join(', ') })}
            </p>
          )}
          {report.hints.length === 0 ? (
            <p>{t('diag.check.allGood')}</p>
          ) : (
            <ul className="list-disc space-y-1 ps-5">
              {report.hints.map((h, i) => (
                <li key={i}>{t(`diag.hint.${h.code}`, { detail: h.detail })}</li>
              ))}
            </ul>
          )}
          <button type="button" onClick={runCheck} disabled={checking} className="btn-ghost px-2 py-1 text-[13px] font-semibold text-navy">
            <RefreshCw size={13} className={checking ? 'animate-spin' : ''} /> {t('diag.tools.recheck')}
          </button>
        </div>
      )}
    </div>
  );

  if (!toolsMissing) return checkBlock;

  return (
    <>
    <div
      role="status"
      className="rounded-2xl border border-accent-orange/30 bg-accent-orange/10 px-4 py-3.5 text-[13px] text-text-secondary"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <Wrench size={15} className="mt-0.5 flex-shrink-0 text-accent-orange" />
          <div className="min-w-0 space-y-2">
            <p className="font-semibold text-text-primary">{t('diag.tools.title')}</p>
            {!data.adb && (
              <div className="space-y-1">
                <p>{t('diag.tools.adb')}</p>
                <p className="text-text-muted">
                  {onWindows ? (
                    t('diag.tools.installWin')
                  ) : (
                    <>
                      {t('diag.tools.installMac')}{' '}
                      <code dir="ltr" className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[12px] text-text-primary">
                        brew install android-platform-tools
                      </code>
                    </>
                  )}
                </p>
              </div>
            )}
            {!data.ios && (
              <div className="space-y-1">
                <p>{t('diag.tools.ios')}</p>
                {!onWindows && (
                  <p className="text-text-muted">
                    {t('diag.tools.installMac')}{' '}
                    <code dir="ltr" className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[12px] text-text-primary">
                      brew install libimobiledevice
                    </code>
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="btn-ghost flex-shrink-0 px-2 py-1 text-[13px] font-semibold text-navy"
        >
          <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} /> {t('diag.tools.recheck')}
        </button>
      </div>
    </div>
    {checkBlock}
    </>
  );
}

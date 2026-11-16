import { useQuery } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { Wrench, RefreshCw } from 'lucide-react';
import { useI18n } from '../i18n';

interface PhoneToolStatus {
  adb: boolean;
  ios: boolean;
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

  if (!data || (data.adb && data.ios)) return null;
  const onWindows = /win/i.test(navigator.platform);

  return (
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
  );
}

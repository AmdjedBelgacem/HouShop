import { useI18n } from '../i18n';
import { useUpdateCheck } from '../hooks/useUpdateCheck';
import { open } from '@tauri-apps/plugin-shell';
import { Download, X, RefreshCw } from 'lucide-react';

export default function UpdateBanner() {
  const { t } = useI18n();
  const { updateAvailable, latestVersion, releaseUrl, dismiss } = useUpdateCheck();

  if (!updateAvailable || !latestVersion || !releaseUrl) return null;

  const handleDownload = () => {
    open(releaseUrl);
  };

  return (
    <div
      role="status"
      className="animate-fade-up flex items-center justify-between gap-3 pl-3 pr-2 py-2 mb-4 rounded-2xl bg-navy/5 border border-navy/15"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-xl bg-navy/10 flex items-center justify-center flex-shrink-0">
          <RefreshCw size={14} className="text-navy" />
        </div>
        <p className="text-[13px] font-medium text-text-primary truncate">
          {t('update.available', { version: latestVersion })}
        </p>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          type="button"
          onClick={handleDownload}
          className="btn-primary px-3 py-1.5 text-[13px] rounded-lg shadow-none gap-1.5"
        >
          <Download size={12} />
          {t('update.download')}
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('update.dismiss')}
          title={t('update.dismiss')}
          className="p-1.5 rounded-lg text-text-muted hover:bg-surface hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

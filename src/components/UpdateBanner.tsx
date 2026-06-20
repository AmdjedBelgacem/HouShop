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
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-navy/5 border border-navy/15 rounded-xl mb-4">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-7 h-7 rounded-lg bg-navy/10 flex items-center justify-center flex-shrink-0">
          <RefreshCw size={14} className="text-navy" />
        </div>
        <p className="text-[12.5px] font-medium text-text-primary truncate">
          {t('update.available', { version: latestVersion })}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-navy text-white text-[11.5px] font-medium hover:bg-navy-light transition-colors"
        >
          <Download size={12} />
          {t('update.download')}
        </button>
        <button
          onClick={dismiss}
          className="p-1 rounded-lg hover:bg-surface text-text-muted transition-colors"
          title={t('update.dismiss')}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

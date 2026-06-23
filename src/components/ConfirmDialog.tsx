import { type ReactNode, useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useI18n } from '../i18n';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' renders a red confirm button + warning footnote, 'default' is neutral. */
  variant?: 'danger' | 'default';
  /** Optional lucide icon shown in the badge. Defaults to an alert triangle for danger. */
  icon?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  /** Disables the confirm button and shows a pending state while the action runs. */
  loading?: boolean;
}

/**
 * A self-contained confirmation modal. Reuses the same overlay + card styling as
 * the rest of the app (SaleCompletionModal, the per-page ModalOverlay helpers)
 * so it looks right in both light and dark themes with no extra work.
 *
 * State is owned by the caller — render it with `open` and let it call back.
 */
export default function ConfirmDialog({
  open, title, description, confirmLabel, cancelLabel, variant = 'danger',
  icon, onConfirm, onCancel, loading = false,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  // Close on Escape — matches the dismiss affordance every other modal has.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, loading, onCancel]);
  if (!open) return null;
  const isDanger = variant === 'danger';
  const badge = icon ?? <AlertTriangle size={20} />;
  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center z-[110] p-4"
      onClick={() => { if (!loading) onCancel(); }}
    >
      <div
        className="bg-card rounded-2xl w-full max-w-[400px] shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-5 text-center">
          <button
            onClick={onCancel}
            disabled={loading}
            className="absolute top-3.5 right-3.5 p-1.5 rounded-lg hover:bg-surface transition-colors text-text-muted disabled:opacity-40"
            aria-label={t('common.close')}
          >
            <X size={16} />
          </button>
          <div className={`w-12 h-12 mx-auto rounded-full flex items-center justify-center mb-3.5 ${
            isDanger ? 'bg-red-50 text-accent-red' : 'bg-navy/10 text-navy'
          }`}>
            {badge}
          </div>
          <h3 className="text-[16px] font-bold text-text-primary">{title}</h3>
          <div className="text-[13px] text-text-secondary mt-1.5 leading-relaxed">{description}</div>
          {isDanger && (
            <p className="text-[11.5px] text-text-muted mt-3">{t('confirm.undone')}</p>
          )}
        </div>
        <div className="px-6 pb-6 flex items-center gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl border border-border text-[13px] font-medium text-text-secondary hover:bg-surface transition-colors disabled:opacity-50"
          >
            {cancelLabel ?? t('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 py-2.5 rounded-xl text-white text-[13px] font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-2 ${
              isDanger ? 'bg-accent-red hover:bg-red-600' : 'bg-navy hover:bg-navy-light'
            }`}
          >
            {loading ? t('common.loading') : (confirmLabel ?? t('common.confirm'))}
          </button>
        </div>
      </div>
    </div>
  );
}

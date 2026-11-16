import { type ReactNode, useEffect, useId } from 'react';
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
  const titleId = useId();
  const descriptionId = useId();
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
      className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[110] p-4"
      onClick={() => { if (!loading) onCancel(); }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative bg-card rounded-2xl w-full max-w-[400px] shadow-raised overflow-hidden animate-fade-up"
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-text-muted hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/30"
          aria-label={t('common.close')}
        >
          <X size={16} />
        </button>
        <div className="px-6 pt-7 pb-6 text-center">
          <div className={`w-12 h-12 mx-auto rounded-full flex items-center justify-center mb-4 ${
            isDanger ? 'bg-accent-red/10 text-accent-red' : 'bg-navy/10 text-navy'
          }`}>
            {badge}
          </div>
          <h3 id={titleId} className="text-[17px] font-semibold text-text-primary">{title}</h3>
          <div id={descriptionId} className="text-[13px] text-text-secondary mt-1.5 leading-relaxed">{description}</div>
          {isDanger && (
            <p className="text-[13px] text-text-muted mt-3">{t('confirm.undone')}</p>
          )}
        </div>
        <div className="px-6 pb-6 flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="btn-secondary flex-1"
          >
            {cancelLabel ?? t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 ${isDanger ? 'btn-danger' : 'btn-primary'}`}
          >
            {loading ? t('common.loading') : (confirmLabel ?? t('common.confirm'))}
          </button>
        </div>
      </div>
    </div>
  );
}

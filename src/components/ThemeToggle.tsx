import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../theme';
import { useI18n } from '../i18n';

/** One-click light/dark switch: the icon shows the theme you will get. */
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const { isDark, toggleTheme } = useTheme();
  const { t } = useI18n();
  const label = isDark ? t('theme.switchToLight') : t('theme.switchToDark');
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full border border-border-light text-text-secondary transition-colors hover:bg-[rgb(var(--ink)/0.06)] hover:text-text-primary ${className}`}
    >
      {isDark ? <Sun size={16} strokeWidth={1.8} /> : <Moon size={16} strokeWidth={1.8} />}
    </button>
  );
}

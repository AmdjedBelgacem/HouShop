import { useState, useRef, useEffect, type ReactNode } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { useI18n } from '../i18n';
interface SelectOption {
  value: string;
  label: string;
}
interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  icon?: ReactNode;
  className?: string;
  size?: 'sm' | 'md';
}
export default function CustomSelect({
  value, onChange, options, placeholder, icon, className = '', size = 'md',
}: CustomSelectProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.value === value);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  const isSm = size === 'sm';
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full flex items-center gap-2 rounded-xl border bg-surface text-left
          transition-[background-color,border-color,box-shadow] duration-150
          focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-navy/20 focus-visible:border-navy
          ${open ? 'ring-[3px] ring-navy/20 border-navy' : 'border-border hover:border-navy/30'}
          ${isSm ? 'py-2 px-3 text-[13px]' : 'py-2.5 px-3.5 text-[13px]'}
          ${selected ? 'text-text-primary' : 'text-text-muted'}
        `}
      >
        {icon && <span className="text-text-muted flex-shrink-0">{icon}</span>}
        <span className="flex-1 text-left truncate">{selected?.label ?? placeholder ?? t('common.selectPlaceholder')}</span>
        <ChevronDown size={isSm ? 13 : 14}
          className={`text-text-muted flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-card rounded-xl border border-border shadow-raised z-30 overflow-hidden animate-fade-up">
          <div className="max-h-[220px] overflow-y-auto py-1">
            {options.map(o => {
              const isSelected = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  className={`w-full text-left flex items-center gap-2.5 px-3.5 py-2 text-[13px] transition-colors
                    ${isSelected
                      ? 'bg-navy/5 text-navy font-medium'
                      : 'text-text-secondary hover:bg-surface hover:text-text-primary'
                    }`}
                >
                  <span className="flex-1 truncate">{o.label}</span>
                  {isSelected && <Check size={14} className="text-navy flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

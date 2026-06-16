import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
interface SelectOption {
  value: string;
  label: string;
}
interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  icon?: React.ReactNode;
  className?: string;
  size?: 'sm' | 'md';
}
export default function CustomSelect({
  value, onChange, options, placeholder = 'Select...', icon, className = '', size = 'md',
}: CustomSelectProps) {
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
        className={`w-full flex items-center gap-2 rounded-lg border border-border bg-card transition-all
          focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy/30
          ${open ? 'ring-2 ring-navy/15 border-navy/30' : 'hover:bg-surface'}
          ${isSm ? 'py-2 px-3 text-[12.5px]' : 'py-2.5 px-3.5 text-[13px]'}
          ${selected ? 'text-text-primary' : 'text-text-muted'}
        `}
      >
        {icon && <span className="text-text-muted flex-shrink-0">{icon}</span>}
        <span className="flex-1 text-left truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown size={isSm ? 13 : 14}
          className={`text-text-muted flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-card rounded-xl border border-border shadow-lg z-30 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
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
                      ? 'bg-navy/5 text-navy font-semibold'
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

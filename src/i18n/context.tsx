import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
export type Language = 'en' | 'ar' | 'fr';
interface I18nContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  isRTL: boolean;
}
const I18nContext = createContext<I18nContextType | undefined>(undefined);
import { translations } from './translations';
export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    const saved = localStorage.getItem('shop_language');
    return (saved === 'ar' || saved === 'fr') ? saved : 'en';
  });
  const setLang = (newLang: Language) => {
    setLangState(newLang);
    localStorage.setItem('shop_language', newLang);
  };
  const isRTL = lang === 'ar';
  useEffect(() => {
    document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [lang, isRTL]);
  const t = (key: string, params?: Record<string, string | number>): string => {
    const dict = translations[lang] || translations.en;
    let text = dict[key] || translations.en[key] || key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, String(v));
      });
    }
    return text;
  };
  return (
    <I18nContext.Provider value={{ lang, setLang, t, isRTL }}>
      {children}
    </I18nContext.Provider>
  );
}
export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}

import { useState, useEffect, type ReactNode } from 'react';
import { I18nContext, type Language } from './i18nContext';
import { translations } from './translations';

export type { Language };

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    const saved = localStorage.getItem('shop_language');
    const initial: Language = (saved === 'ar' || saved === 'fr') ? saved : 'en';
    // Set synchronously so uiLocale() is right during the very first render.
    document.documentElement.lang = initial;
    return initial;
  });
  const setLang = (newLang: Language) => {
    document.documentElement.lang = newLang;
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
    // Plural forms: `key_one`, `key_few`, … chosen by Intl.PluralRules,
    // falling back to the plain key when a form isn't defined.
    const count = params?.count;
    const form = typeof count === 'number' ? `${key}_${new Intl.PluralRules(lang).select(count)}` : null;
    let text = (form && dict[form]) || dict[key] || translations.en[key] || key;
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

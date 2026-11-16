import { useState, useEffect, type ReactNode } from 'react';
import { ThemeContext, type Theme } from './themeContext';

export type { Theme };

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('shop_theme');
    return saved === 'dark' ? 'dark' : 'light';
  });
  const isDark = theme === 'dark';
  const toggleTheme = () => {
    setTheme(prev => {
      const next = prev === 'light' ? 'dark' : 'light';
      localStorage.setItem('shop_theme', next);
      return next;
    });
  };
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);
  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

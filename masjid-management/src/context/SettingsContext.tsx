import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export type ThemeMode = 'light' | 'dark';
export type CurrencyCode = 'INR' | 'USD' | 'GBP' | 'EUR' | 'CAD' | 'AUD';

export const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  INR: '₹',
  USD: '$',
  GBP: '£',
  EUR: '€',
  CAD: 'CA$',
  AUD: 'A$',
};

const THEME_KEY = 'masjid_theme';
const CURRENCY_KEY = 'masjid_currency';

interface SettingsContextValue {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  currency: CurrencyCode;
  setCurrency: (currency: CurrencyCode) => void;
  currencySymbol: string;
}

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>(
    () => (localStorage.getItem(THEME_KEY) as ThemeMode) || 'light'
  );
  const [currency, setCurrency] = useState<CurrencyCode>(
    () => (localStorage.getItem(CURRENCY_KEY) as CurrencyCode) || 'INR'
  );

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(CURRENCY_KEY, currency);
  }, [currency]);

  return (
    <SettingsContext.Provider
      value={{ theme, setTheme, currency, setCurrency, currencySymbol: CURRENCY_SYMBOLS[currency] }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider');
  return ctx;
}

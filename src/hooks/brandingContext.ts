import { createContext, useContext } from 'react';

export interface BrandingContextValue {
  /** URL suitable for <img src> (bundled default or convertFileSrc of custom logo). */
  logoUrl: string;
  /** Absolute filesystem path of the custom logo, or null when using the default. */
  logoPath: string | null;
  /** True while the initial logo is loading from disk. */
  loading: boolean;
  /** The shop name displayed across the UI and OS window title. */
  shopName: string;
  /** Persist a logo from a data URL (or raw base64) and refresh UI + window icon. */
  saveLogo: (dataUrl: string, filename?: string) => Promise<void>;
  /** Remove the custom logo and restore the bundled default. */
  resetLogo: () => Promise<void>;
  /** Persist the shop name and refresh the UI + OS window title. */
  saveShopName: (name: string) => Promise<void>;
  /** Remove the custom shop name and restore the default. */
  resetShopName: () => Promise<void>;
}

export const BrandingContext = createContext<BrandingContextValue | null>(null);

export function useBranding(): BrandingContextValue {
  const ctx = useContext(BrandingContext);
  if (!ctx) {
    throw new Error('useBranding must be used within BrandingProvider');
  }
  return ctx;
}

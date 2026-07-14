import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Image as TauriImage } from '@tauri-apps/api/image';
import { defaultWindowIcon } from '@tauri-apps/api/app';
import defaultLogo from '../assets/logo.png';

/**
 * Cached data-URL of the custom logo for the HTML splash screen.
 * The splash runs before React/Tauri IPC, so it can only read localStorage.
 */
export const SHOP_LOGO_CACHE_KEY = 'shop_logo_data_url';
export const SHOP_NAME_CACHE_KEY = 'shop_name';
export const DEFAULT_SHOP_NAME = 'HouPhone Shop';

interface BrandingContextValue {
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

const BrandingContext = createContext<BrandingContextValue | null>(null);

/** Update the browser/tab favicon so it matches the active logo. */
function setDocumentFavicon(href: string) {
  try {
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    // Prefer PNG for custom logos; svg only for the baked-in default.
    link.type = href.startsWith('data:image/svg') || href.endsWith('.svg')
      ? 'image/svg+xml'
      : 'image/png';
    link.href = href.includes('?') || href.startsWith('data:')
      ? href
      : `${href}?t=${Date.now()}`;
  } catch {
    // Non-fatal
  }
}

/** Write (or clear) the splash-screen logo cache used by index.html. */
function setSplashLogoCache(dataUrl: string | null) {
  try {
    if (dataUrl) localStorage.setItem(SHOP_LOGO_CACHE_KEY, dataUrl);
    else localStorage.removeItem(SHOP_LOGO_CACHE_KEY);
  } catch {
    // quota / private mode — splash will fall back to /logo.png
  }
}

/**
 * Load an image URL and produce a compact PNG data-URL for splash + icon cache.
 * Resized to max 256px so localStorage stays small.
 */
async function imageSrcToPngDataUrl(src: string, maxSize = 256): Promise<string> {
  const img = new window.Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load logo image'));
    img.src = src;
  });
  const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight, 1));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/png');
}

/**
 * Normalize any uploaded image to a full-size PNG data-URL for disk storage
 * (native icon path requires PNG with the image-png Tauri feature).
 */
async function normalizeUploadToPng(dataUrl: string): Promise<string> {
  // Already a reasonable PNG — keep as-is if under ~2MB of base64.
  if (dataUrl.startsWith('data:image/png') && dataUrl.length < 2_500_000) {
    return dataUrl;
  }
  return imageSrcToPngDataUrl(dataUrl, 1024);
}

/**
 * Apply the logo as the native window / dock / taskbar icon from the JS side.
 * Rust also applies it on save + startup; this keeps the frontend path in sync.
 */
async function applyWindowIconFromSrc(src: string): Promise<void> {
  try {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load logo for window icon'));
      img.src = src;
    });
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const x = Math.floor((size - w) / 2);
    const y = Math.floor((size - h) / 2);
    ctx.drawImage(img, x, y, w, h);
    const { data } = ctx.getImageData(0, 0, size, size);
    const rgba = new Uint8Array(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    );
    const icon = await TauriImage.new(rgba, size, size);
    await getCurrentWindow().setIcon(icon);
  } catch {
    // Rust path may still succeed; UI logo still works.
  }
}

/** Restore the icon baked into the Tauri binary. */
async function restoreDefaultWindowIcon(): Promise<void> {
  try {
    const icon = await defaultWindowIcon();
    if (icon) await getCurrentWindow().setIcon(icon);
  } catch {
    // ignore
  }
}

function pathToDisplayUrl(path: string | null): string {
  if (!path) return defaultLogo;
  try {
    return `${convertFileSrc(path)}?t=${Date.now()}`;
  } catch {
    return defaultLogo;
  }
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  // Prefer splash cache immediately so React's first paint already shows the custom logo.
  const cachedSplash =
    typeof localStorage !== 'undefined'
      ? localStorage.getItem(SHOP_LOGO_CACHE_KEY)
      : null;
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string>(cachedSplash || defaultLogo);
  const [loading, setLoading] = useState(true);
  const cachedName =
    typeof localStorage !== 'undefined'
      ? localStorage.getItem(SHOP_NAME_CACHE_KEY)
      : null;
  const [shopName, setShopName] = useState<string>(cachedName || DEFAULT_SHOP_NAME);

  const applyLogo = useCallback(async (path: string | null, splashDataUrl?: string | null) => {
    setLogoPath(path);

    if (!path) {
      setLogoUrl(defaultLogo);
      setSplashLogoCache(null);
      setDocumentFavicon('/favicon.svg');
      await restoreDefaultWindowIcon();
      return;
    }

    const url = pathToDisplayUrl(path);
    setLogoUrl(url);

    let cache = splashDataUrl ?? null;
    if (!cache) {
      try {
        cache = await imageSrcToPngDataUrl(url, 256);
      } catch {
        cache = null;
      }
    }
    if (cache) setSplashLogoCache(cache);
    setDocumentFavicon(cache || url);
    await applyWindowIconFromSrc(cache || url);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const path = await invoke<string | null>('get_app_logo');
        if (cancelled) return;
        if (path) {
          await applyLogo(path);
        } else {
          // No custom logo on disk — clear any stale splash cache.
          await applyLogo(null);
        }
      } catch {
        if (!cancelled) await applyLogo(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
      try {
        const name = await invoke<string | null>('get_app_shop_name');
        if (cancelled) return;
        if (name) {
          setShopName(name);
          try { localStorage.setItem(SHOP_NAME_CACHE_KEY, name); } catch {}
        } else {
          setShopName(DEFAULT_SHOP_NAME);
          try { localStorage.removeItem(SHOP_NAME_CACHE_KEY); } catch {}
        }
      } catch {
        // Keep default on error.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyLogo]);

  const saveLogo = useCallback(
    async (dataUrl: string, filename?: string) => {
      // Normalize to PNG for reliable native icon loading (image-png feature).
      const pngDataUrl = await normalizeUploadToPng(dataUrl);
      const splashCache = await imageSrcToPngDataUrl(pngDataUrl, 256);
      const path = await invoke<string>('save_app_logo', {
        data: pngDataUrl,
        filename: filename ?? 'logo.png',
      });
      // Cache splash before apply so the next cold start is correct even if apply fails mid-way.
      setSplashLogoCache(splashCache);
      await applyLogo(path, splashCache);
    },
    [applyLogo],
  );

  const resetLogo = useCallback(async () => {
    await invoke('clear_app_logo');
    setSplashLogoCache(null);
    await applyLogo(null);
  }, [applyLogo]);

  const saveShopName = useCallback(async (name: string) => {
    const trimmed = name.trim();
    await invoke('save_app_shop_name', { name: trimmed });
    if (trimmed) {
      setShopName(trimmed);
      try { localStorage.setItem(SHOP_NAME_CACHE_KEY, trimmed); } catch {}
    } else {
      setShopName(DEFAULT_SHOP_NAME);
      try { localStorage.removeItem(SHOP_NAME_CACHE_KEY); } catch {}
    }
    // Keep the OS window + browser tab title in sync.
    try {
      await getCurrentWindow().setTitle(
        trimmed ? `${trimmed} - POS & Inventory` : 'Shop Management - POS & Inventory',
      );
    } catch {}
    document.title = trimmed || DEFAULT_SHOP_NAME;
  }, []);

  const resetShopName = useCallback(async () => {
    await invoke('clear_app_shop_name');
    setShopName(DEFAULT_SHOP_NAME);
    try { localStorage.removeItem(SHOP_NAME_CACHE_KEY); } catch {}
    try {
      await getCurrentWindow().setTitle('Shop Management - POS & Inventory');
    } catch {}
    document.title = DEFAULT_SHOP_NAME;
  }, []);

  const value = useMemo(
    () => ({ logoUrl, logoPath, loading, shopName, saveLogo, resetLogo, saveShopName, resetShopName }),
    [logoUrl, logoPath, loading, shopName, saveLogo, resetLogo, saveShopName, resetShopName],
  );

  return (
    <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>
  );
}

export function useBranding(): BrandingContextValue {
  const ctx = useContext(BrandingContext);
  if (!ctx) {
    throw new Error('useBranding must be used within BrandingProvider');
  }
  return ctx;
}

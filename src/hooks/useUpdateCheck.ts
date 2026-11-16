import { useState, useEffect } from 'react';

const CURRENT_VERSION = '1.0.0';
const REPO = 'AmdjedBelgacem/HouShop';
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const CACHE_KEY = 'houshop_update_check';
const CHECK_INTERVAL = 4 * 60 * 60 * 1000;

interface UpdateInfo {
  updateAvailable: boolean;
  latestVersion: string | null;
  releaseUrl: string | null;
  dismiss: () => void;
}

function compareVersions(current: string, latest: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [cMajor, cMinor, cPatch] = parse(current);
  const [lMajor, lMinor, lPatch] = parse(latest);
  if (lMajor !== cMajor) return lMajor > cMajor;
  if (lMinor !== cMinor) return lMinor > cMinor;
  return (lPatch ?? 0) > (cPatch ?? 0);
}

interface CachedCheck {
  updateAvailable: boolean;
  latestVersion: string | null;
  releaseUrl: string | null;
  checkedAt: number;
}

// Returns the cached check only while it is still fresh; null means a new fetch is needed.
function readFreshCache(): CachedCheck | null {
  const cached = sessionStorage.getItem(CACHE_KEY);
  if (!cached) return null;
  try {
    const data: CachedCheck = JSON.parse(cached);
    return Date.now() - data.checkedAt < CHECK_INTERVAL ? data : null;
  } catch {
    // Unreadable cache entry: ignore it and fetch fresh data
    return null;
  }
}

export function useUpdateCheck(): UpdateInfo {
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem('houshop_update_dismissed') === '1');
  // A fresh cached result is applied on the first render, so the effect only fetches when needed
  const [cached] = useState<CachedCheck | null>(() => (dismissed ? null : readFreshCache()));
  const [updateAvailable, setUpdateAvailable] = useState(() => cached?.updateAvailable === true);
  const [latestVersion, setLatestVersion] = useState<string | null>(() =>
    cached?.updateAvailable ? cached.latestVersion : null,
  );
  const [releaseUrl, setReleaseUrl] = useState<string | null>(() =>
    cached?.updateAvailable ? cached.releaseUrl : null,
  );

  useEffect(() => {
    if (dismissed || cached) return;

    fetch(API_URL)
      .then(res => {
        if (!res.ok) return null;
        return res.json();
      })
      .then(data => {
        if (!data?.tag_name) return;
        const version = data.tag_name.replace(/^v/, '');
        const hasUpdate = compareVersions(CURRENT_VERSION, version);
        const result = {
          updateAvailable: hasUpdate,
          latestVersion: version,
          releaseUrl: data.html_url,
          checkedAt: Date.now(),
        };
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(result));
        if (hasUpdate) {
          setUpdateAvailable(true);
          setLatestVersion(version);
          setReleaseUrl(data.html_url);
        }
      })
      .catch(() => { /* offline or API error, silently ignore */ });
  }, [dismissed, cached]);

  const dismiss = () => {
    setDismissed(true);
    sessionStorage.setItem('houshop_update_dismissed', '1');
  };

  return { updateAvailable: updateAvailable && !dismissed, latestVersion, releaseUrl, dismiss };
}

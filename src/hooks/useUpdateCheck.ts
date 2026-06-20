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

export function useUpdateCheck(): UpdateInfo {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [releaseUrl, setReleaseUrl] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem('houshop_update_dismissed') === '1');

  useEffect(() => {
    if (dismissed) return;

    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        const data = JSON.parse(cached);
        if (Date.now() - data.checkedAt < CHECK_INTERVAL) {
          if (data.updateAvailable) {
            setUpdateAvailable(true);
            setLatestVersion(data.latestVersion);
            setReleaseUrl(data.releaseUrl);
          }
          return;
        }
      } catch { /* ignore */ }
    }

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
  }, [dismissed]);

  const dismiss = () => {
    setDismissed(true);
    sessionStorage.setItem('houshop_update_dismissed', '1');
  };

  return { updateAvailable: updateAvailable && !dismissed, latestVersion, releaseUrl, dismiss };
}

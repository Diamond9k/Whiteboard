import type { DashboardData, Prefs } from '../types';
import { bbx } from './course';

export const hasChromeStorage = () =>
  typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;

export async function loadData(): Promise<DashboardData> {
  const api = bbx();
  const storage = typeof chrome !== 'undefined' ? chrome.storage : undefined;
  if (!storage?.local) {
    const d = api.emptyState();
    d._noStorage = true;
    return d;
  }
  try {
    const store = await storage.local.get(Object.values(api.STORAGE_KEYS));
    const data = api.mergeForDashboard(store);
    const prefs = store[api.STORAGE_KEYS.prefs];
    data.prefs = (prefs && typeof prefs === 'object' ? prefs : {}) as Prefs;
    return data;
  } catch (err) {
    console.error('[BBX] storage read failed', err);
    const d = api.emptyState();
    d._storageError = String(err && (err as Error).message ? (err as Error).message : err);
    return d;
  }
}

export function onDataChanged(cb: () => void): void {
  const storage = typeof chrome !== 'undefined' ? chrome.storage : undefined;
  if (!storage?.onChanged) return;
  storage.onChanged.addListener((_changes, area) => { if (area === 'local') cb(); });
}

function send<T>(msg: unknown): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      if (!chrome?.runtime?.sendMessage) { resolve(null); return; }
      chrome.runtime.sendMessage(msg, (r) => resolve(chrome.runtime?.lastError ? null : (r as T)));
    } catch { resolve(null); }
  });
}

/** UI prefs go through the background worker, the only storage writer. */
export function savePrefs(patch: Partial<Prefs>) {
  return send<{ ok?: boolean }>({ type: 'bbx:setPrefs', patch });
}

export function requestSync() {
  return send<{ ok?: boolean; blackboardTabs?: number; pearsonTabs?: number }>({ type: 'bbx:requestSync' });
}

export function clearCache() {
  return send<{ ok?: boolean }>({ type: 'bbx:clearCache' });
}

export function applyTheme(t?: string) {
  const mode = t === 'dark' || t === 'system' ? t : 'light';
  const r = document.documentElement;
  if (mode === 'light' || mode === 'dark') r.dataset.theme = mode;
  else delete r.dataset.theme;
  try { localStorage.setItem('bbx-theme', mode); } catch { /* storage unavailable */ }
}

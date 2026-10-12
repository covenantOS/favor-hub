// Small, guarded reads and writes of localStorage and sessionStorage. Private mode and a full disk must never break a page.
export const KEYS = {
  nav: 'favor.hub.nav.v1',
  navPrefs: 'favor.hub.nav.prefs.v1',
  firstName: 'favor.hub.first.v1',
  cardCount: 'favor.hub.cards.v1',
  tours: 'favor.hub.tours.pending',
  gate: 'favor.hub.gate.v1',
} as const;

export function readJson<T>(store: 'local' | 'session', key: string, fallback: T): T {
  try {
    const raw = (store === 'local' ? localStorage : sessionStorage).getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeJson(store: 'local' | 'session', key: string, value: unknown): void {
  try {
    (store === 'local' ? localStorage : sessionStorage).setItem(key, JSON.stringify(value));
  } catch {
    // refused or full; the page works without the saved copy
  }
}

export function readString(key: string, fallback = ''): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeString(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // refused or full
  }
}

export interface NavPrefs {
  wide?: boolean;
  open?: Record<string, boolean>;
  pins?: string[];
  last?: Record<string, string>;
}

/** Per-person menu choices, keyed by email (the classic menu keeps the same record, so a choice made on either side shows on both). */
export function readPrefs(email: string): NavPrefs {
  const all = readJson<Record<string, NavPrefs>>('local', KEYS.navPrefs, {});
  return all[email || '_'] || all._ || {};
}

export function savePrefs(email: string, fn: (p: NavPrefs) => void): NavPrefs {
  const all = readJson<Record<string, NavPrefs>>('local', KEYS.navPrefs, {});
  const k = email || '_';
  const p = all[k] || {};
  fn(p);
  all[k] = p;
  writeJson('local', KEYS.navPrefs, all);
  return p;
}

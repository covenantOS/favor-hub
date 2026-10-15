// Today's last answers, kept on this device for the next visit (stale-while-revalidate). A warm visit draws the list and the schedule from them
// as soon as the page is alive, and the server's fresh answers (already streaming in) replace them. They are kept only for the person
// signed in on this browser (the saved menu names them) and are dropped when it names someone else or nobody. Nothing leaves the device.
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { briefQ, dayQ, giftsQ, homeQ, inboxQ, todayQ, waitingQ } from './queries';

const KEY = 'favor.td.swr.v1';
const MAX_AGE = 12 * 3600 * 1000;
const core = () => [todayQ, inboxQ('fast'), waitingQ('fast'), briefQ(''), dayQ];
const kept = () => [...core(), homeQ, giftsQ];
const id = (k: QueryKey) => JSON.stringify(k);

function who(): string {
  try {
    const nv = JSON.parse(localStorage.getItem('favor.hub.nav.v1') || 'null');
    return String((nv && nv.user && nv.user.email) || '').toLowerCase();
  } catch {
    return '';
  }
}

/** Fill every core answer the page does not have yet from the saved copy. Returns true when the list and the schedule can draw from it. */
export function restore(qc: QueryClient): boolean {
  try {
    const me = who();
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const s = JSON.parse(raw) as { who: string; at: number; d: Record<string, unknown> };
    if (!me || s.who !== me || !(Date.now() - s.at < MAX_AGE)) {
      localStorage.removeItem(KEY);
      return false;
    }
    let filled = false;
    for (const q of kept()) {
      const d = s.d[id(q.queryKey)];
      if (d !== undefined && d !== null && qc.getQueryData(q.queryKey) === undefined) {
        qc.setQueryData(q.queryKey, d, { updatedAt: s.at });
        filled = true;
      }
    }
    return filled && core().every((q) => qc.getQueryData(q.queryKey) !== undefined);
  } catch {
    return false;
  }
}

/** Keep the answers on the page now, once the core ones are in. */
export function save(qc: QueryClient) {
  try {
    const me = who();
    if (!me || !core().every((q) => qc.getQueryData(q.queryKey) !== undefined)) return;
    const d: Record<string, unknown> = {};
    for (const q of kept()) {
      const v = qc.getQueryData(q.queryKey);
      if (v !== undefined && v !== null) d[id(q.queryKey)] = v;
    }
    localStorage.setItem(KEY, JSON.stringify({ who: me, at: Date.now(), d }));
  } catch {
    // storage full or refused
  }
}

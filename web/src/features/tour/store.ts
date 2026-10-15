// Each person's tour progress. It lives in two places and the newer copy wins: this browser (so the card appears at once and
// a tab with no network still works) and the server table hub_tours (so a phone and a computer agree, and admins see who has
// finished). The server pattern is the one the tour has always used: GET /api/hub/tours, POST the browser's copy, take the merge
// back. A write sends X-Hub-Request: 1. The rules for skipping and coming back are in src/scripts/tour-state.ts.
import { cleanProgress, merge, type Progress } from '@hub/scripts/tour-state';

const key = (email: string) => `favor.hub.tours.v3:${email || '_'}`;

const sameRow = (a: Progress[string] | undefined, b: Progress[string] | undefined) =>
  !!a && !!b && a.s === b.s && a.n === b.n && (a.until || '') === (b.until || '') && (a.i || 0) === (b.i || 0) && a.at === b.at;
const sameAll = (a: Progress, b: Progress) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => sameRow(a[k], b[k]));
};

export type ProgressStore = {
  get: () => Progress;
  /** Replace the progress, keep it in this browser at once and send it to the server soon. */
  set: (next: Progress, now?: boolean) => void;
  /** Send anything waiting. Safe to call as the page is leaving. */
  flush: () => void;
  /** True once the server has answered with a table behind it. */
  ready: () => boolean;
};

export async function openStore(email: string, onChange: (p: Progress) => void): Promise<ProgressStore> {
  let progress: Progress = {};
  try {
    progress = cleanProgress(JSON.parse(localStorage.getItem(key(email)) || '{}'));
  } catch {
    progress = {};
  }
  let serverReady = false;
  let timer = 0;
  let dirty = false;

  const saveLocal = () => {
    try {
      localStorage.setItem(key(email), JSON.stringify(progress));
    } catch {
      // Storage refused: progress lasts for this page.
    }
  };

  const push = async (keepalive = false): Promise<void> => {
    if (!dirty) return;
    dirty = false;
    try {
      const r = await fetch('/api/hub/tours', {
        method: 'POST',
        credentials: 'same-origin',
        keepalive,
        headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' },
        body: JSON.stringify({ items: progress }),
      });
      const d = r.ok ? ((await r.json()) as { ready?: boolean; items?: unknown }) : null;
      if (d && d.ready) {
        serverReady = true;
        const merged = merge(progress, cleanProgress(d.items));
        if (!sameAll(merged, progress)) {
          progress = merged;
          saveLocal();
          onChange(progress);
        }
      }
    } catch {
      // Offline: this browser keeps the progress and sends it on a later page.
      dirty = true;
    }
  };

  try {
    const r = await fetch('/api/hub/tours', { credentials: 'same-origin' });
    const s = r.ok ? ((await r.json()) as { ready?: boolean; items?: unknown }) : null;
    if (s && s.ready) {
      serverReady = true;
      const theirs = cleanProgress(s.items);
      progress = merge(progress, theirs);
      saveLocal();
      if (!sameAll(progress, theirs)) {
        dirty = true;
        void push();
      }
    }
  } catch {
    // The browser's own copy stands.
  }

  return {
    get: () => progress,
    ready: () => serverReady,
    set(next, now = false) {
      progress = next;
      dirty = true;
      saveLocal();
      onChange(progress);
      window.clearTimeout(timer);
      if (now) void push();
      else timer = window.setTimeout(() => void push(), 700);
    },
    flush() {
      window.clearTimeout(timer);
      void push(true);
    },
  };
}

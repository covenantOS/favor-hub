// Two minutes before a meeting on the signed-in person's calendar, a toast with Join appears on any hub page.
// With browser notifications allowed, a system notification shows too. The permission question is a quiet link on
// the Meetings pages, never a pop-up. Lists come from the same routes as the Meetings home page.
import { dueNow, minutesLeft, toNudgeList, type NudgeMeeting } from './nudge-core';

const CACHE = 'meet.nudge.v1';
const SHOWN = 'meet.nudge.shown';
const OFF = 'meet.nudge.off';
const ASKED = 'meet.nudge.asked';
const TTL = 30000;
const REFRESH = 120000;
const TICK = 10000;

let list: NudgeMeeting[] = [];
let loading = false;
let toastEl: HTMLElement | null = null;

const store = (fn: () => void) => {
  try { fn(); } catch { /* storage full or off */ }
};
const shownSet = (): Set<string> => {
  try { return new Set<string>(JSON.parse(sessionStorage.getItem(SHOWN) || '[]')); } catch { return new Set<string>(); }
};
const markShown = (key: string) => store(() => sessionStorage.setItem(SHOWN, JSON.stringify([...shownSet(), key])));
const hasNotifications = () => typeof window !== 'undefined' && 'Notification' in window;

async function getJSON(path: string): Promise<{ ok: boolean; status: number; body: any }> {
  const r = await fetch(path, { credentials: 'same-origin' });
  let body: any = null;
  try { body = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, body };
}

/** Reads the two lists. Anyone without Meetings access gets one refused call per session and nothing after. */
async function refresh(force = false): Promise<void> {
  if (loading || sessionStorage.getItem(OFF)) return;
  if (!force) {
    try {
      const c = JSON.parse(sessionStorage.getItem(CACHE) || 'null');
      if (c && Date.now() - c.at < TTL) { list = c.list; return; }
    } catch { /* no cache */ }
  }
  loading = true;
  try {
    const up = await getJSON('/api/meet/meetings?scope=upcoming');
    if (!up.ok) { if (up.status === 401 || up.status === 403) store(() => sessionStorage.setItem(OFF, '1')); return; }
    const cal = await getJSON('/api/meet/meetings/calendar').catch(() => null);
    const calList = cal && cal.ok && cal.body && cal.body.connected ? cal.body.meetings || [] : [];
    list = toNudgeList(up.body.meetings || [], calList);
    store(() => sessionStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), list })));
  } catch { /* offline: keep the last list */ } finally {
    loading = false;
  }
}

function notify(m: NudgeMeeting, mins: number) {
  if (!hasNotifications() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(`${m.title}: starts in ${mins} ${mins === 1 ? 'minute' : 'minutes'}`, { body: 'Join from Favor Hub', tag: m.key });
    n.onclick = () => { window.focus(); window.open(m.join, '_blank', 'noopener'); n.close(); };
  } catch { /* some browsers refuse notifications outside a page context */ }
}

function closeToast() {
  toastEl?.remove();
  toastEl = null;
}

function show(m: NudgeMeeting, mins: number) {
  closeToast();
  const el = document.createElement('div');
  el.id = 'nudge-toast';
  el.className = 'nudge';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  const body = document.createElement('div');
  body.className = 'nudge__body';
  const title = document.createElement('b');
  title.textContent = m.title;
  const sub = document.createElement('span');
  sub.textContent = `Starts in ${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
  body.append(title, sub);
  const join = document.createElement('a');
  join.className = 'nudge__join';
  join.href = m.join;
  join.target = '_blank';
  join.rel = 'noopener';
  join.textContent = 'Join';
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'nudge__x';
  x.setAttribute('aria-label', 'Close');
  x.textContent = 'Close';
  x.addEventListener('click', closeToast);
  el.append(body, join, x);
  document.body.appendChild(el);
  toastEl = el;
  markShown(m.key);
  notify(m, mins);
  // The toast leaves on its own a minute after the meeting starts.
  setTimeout(() => { if (toastEl === el) closeToast(); }, Math.max(0, m.startMs - Date.now()) + 60000);
}

function check() {
  const now = Date.now();
  const due = dueNow(list, now, shownSet());
  if (due.length && !toastEl) show(due[0], minutesLeft(due[0].startMs, now));
}

/** On the Meetings pages only: one quiet link that asks for system notifications. It sits inside the page's first card, or in the header when the page has none, and goes away after any answer. */
const CARD = '#h-content .mt-card, #h-content .h-card:not(.h-skel), #h-content .dv-card:not(.dv-skel)';
function place(link: HTMLElement): void {
  const host = document.querySelector<HTMLElement>(CARD) || document.querySelector<HTMLElement>('.h-top');
  if (!host) return;
  if (link.parentElement === host && (host.matches('.h-top') || host.firstElementChild === link)) return;
  // At the top of the first card, so it shows without scrolling; in the header when the page has no card.
  if (host.matches('.h-top')) host.appendChild(link); else host.prepend(link);
}

function askLink() {
  if (!hasNotifications() || Notification.permission !== 'default') return;
  const path = location.pathname;
  if (!path.startsWith('/meet') || path.startsWith('/meet/room') || path.startsWith('/meet/g')) return;
  if (localStorage.getItem(ASKED)) return;
  if (document.getElementById('nudge-ask')) return;
  const p = document.createElement('p');
  p.id = 'nudge-ask';
  p.className = 'nudge-ask';
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = 'Turn on system alerts 2 minutes before meetings';
  b.addEventListener('click', () => {
    store(() => localStorage.setItem(ASKED, '1'));
    p.remove();
    obs?.disconnect();
    Notification.requestPermission().catch(() => undefined);
  });
  p.appendChild(b);
  place(p);
  // The pages draw themselves after load and redraw on every change, so the link follows the first card.
  let queued = false;
  const obs: MutationObserver | null = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (!document.body.contains(p) || !(document.querySelector(CARD) || document.querySelector('.h-top'))?.contains(p)) place(p);
    });
  });
  const root = document.getElementById('h-content');
  if (obs && root) obs.observe(root, { childList: true, subtree: true });
}

export function initNudge(): void {
  if ((window as any).__favorNudge) return;
  (window as any).__favorNudge = true;
  refresh().then(check);
  setInterval(() => { refresh(true).then(check); }, REFRESH);
  setInterval(check, TICK);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh().then(check); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', askLink);
  else askLink();
}

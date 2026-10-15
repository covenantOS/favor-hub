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

/** Reads the two lists. Anyone without Meetings access gets one refused call per session and nothing after (the server answers 404
 *  while Meetings is not released to staff, so that counts as refused too). */
async function refresh(force = false): Promise<void> {
  if (loading || sessionStorage.getItem(OFF)) return;
  if (!force) {
    try {
      const c = JSON.parse(sessionStorage.getItem(CACHE) || 'null');
      if (c && Date.now() - c.at < TTL) { list = c.list; return; }
    } catch { /* no cache */ }
  }
  try { const nv = JSON.parse(localStorage.getItem('favor.hub.nav.v1') || 'null'); if (!nv || !nv.access || nv.access.meetings !== true) return; } catch { return; }
  loading = true;
  try {
    const up = await getJSON('/api/meet/meetings?scope=upcoming');
    if (!up.ok) { if (up.status === 401 || up.status === 403 || up.status === 404) store(() => sessionStorage.setItem(OFF, '1')); return; }
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
    const n = new Notification(`${m.title}: starts in ${mins} ${mins === 1 ? 'minute' : 'minutes'}`, { body: 'Join from FavorOS', tag: m.key });
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

/** On the Meetings pages only: one quiet link that asks for system notifications. It sits above the page content, outside every card, once the page has drawn one, and goes away after any answer. */
const CARD = '#h-content .mt-card, #h-content .h-card:not(.h-skel), #h-content .dv-card:not(.dv-skel)';
function anchorOf(): HTMLElement | null {
  const card = document.querySelector<HTMLElement>(CARD);
  if (!card) return null;
  return card.closest<HTMLElement>('#h-content > *') || card;
}
function place(link: HTMLElement): void {
  const anchor = anchorOf();
  if (anchor) {
    if (anchor.previousElementSibling === link) return;
    anchor.before(link);
    // The room held for the link (html.meet-ask, set by the Meetings page before its first frame) is handed to the link itself.
    document.documentElement.classList.add('meet-ask-on');
    return;
  }
  // Until the page has drawn a card the link waits off screen: placed in the header first, it squeezed the title and tabs for
  // half a second and then jumped into the page. The observer below places it when the first card arrives.
}

function dropAskRoom(): void {
  document.documentElement.classList.remove('meet-ask', 'meet-ask-on');
}
function askLink() {
  if (!hasNotifications() || Notification.permission !== 'default') { dropAskRoom(); return; }
  const path = location.pathname;
  // Only on the Meetings day page. On Book and Notes it sat above work it has nothing to do with.
  if (path !== '/meet/' && path !== '/meet') { dropAskRoom(); return; }
  if (localStorage.getItem(ASKED)) { dropAskRoom(); return; }
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
    dropAskRoom();
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
    // A microtask runs before the next paint, so the link never appears a frame after the card it sits above.
    queueMicrotask(() => {
      queued = false;
      // The page changed in place away from the Meetings day page: the link goes with it.
      if (location.pathname !== '/meet/' && location.pathname !== '/meet') { p.remove(); dropAskRoom(); obs?.disconnect(); return; }
      if (!document.body.contains(p) || (anchorOf() ? anchorOf()!.previousElementSibling !== p : p.parentElement?.id !== 'h-content')) place(p);
    });
  });
  const root = document.getElementById('h-content');
  if (obs && root) obs.observe(root, { childList: true, subtree: true });
}

export function initNudge(): void {
  if ((window as any).__favorNudge) return;
  (window as any).__favorNudge = true;
  // In a meeting room the first read waits 20 seconds, so joining the call never shares the network or the phone's CPU with it.
  if (/^\/meet\/(room|g)\//.test(location.pathname)) setTimeout(() => refresh().then(check), 20_000);
  else refresh().then(check);
  setInterval(() => { refresh(true).then(check); }, REFRESH);
  setInterval(check, TICK);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh().then(check); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', askLink);
  else askLink();
  // Meetings pages change in place: the day page arriving that way asks again (and gives back the room it held when it should not).
  document.addEventListener('hub-swapped', askLink);
}

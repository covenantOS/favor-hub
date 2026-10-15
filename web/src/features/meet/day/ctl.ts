// The Meetings Day page's model and behaviors (port of public/js/meet/day.js): the loaded lists, the Google Calendar windows, the open panel,
// edits in place (drag, resize, create), the timers and the listeners. It holds one mutable state object (S, like the classic page) and asks
// React to draw after every change. Nothing here runs on the server; the component creates it after the page is live.
import { flushSync } from 'react-dom';
import type { QueryClient } from '@tanstack/react-query';
import * as MV from '../views';
import { loadSend, meetApi, pump, toast } from '../ui';
import { dayQueries } from './queries';
import {
  CAL_KEY, KEY, PXH, SNAP, STALE, TTL, VIEW_KEY, atDay, dayKey, fromUrlId, hhmm, hm, invited, minOfDay, normalize, shortMsg, sigOf, snapMin, toMin, urlId, whenLine,
  type Ev, type Hub,
} from './logic';

export interface Draft {
  key: string;
  start: number;
  end: number;
  editing: boolean;
  busy?: boolean;
  title?: string;
}
export interface ScrollInfo {
  list: Ev[];
  t0: number;
  inRange: boolean;
  now: number;
}
export interface State {
  day: string;
  view: MV.View;
  winStart: string | null;
  sel: string | null;
  confirm: string | null;
  data: Hub | null;
  people: Record<string, string>;
  now: Date;
  open: string;
  panel: 'detail' | 'move' | 'moved';
  pick: string;
  extra: any[];
  info: Record<string, { guests: boolean }>;
  prep: Record<string, any>;
  move: Ev | null;
  moveWrite: boolean;
  moveMail: boolean;
  moveSeries: boolean;
  moveBusy: boolean;
  moveErr: string;
  rev: number;
  calMap: Record<string, any>;
  calInfo: any;
  covered: { from: number; to: number; at: number }[];
  calBusy: boolean;
  ov: Record<string, any>;
  pend: Record<string, number>;
  draft: Draft | null;
  t0: number;
  wkH0: number;
  moved: any;
  missing: string;
  busy: boolean;
  err: string;
  resetScroll: boolean;
  focusOnce: boolean;
  scroll: ScrollInfo | null;
  sendReady: boolean;
}

export interface Env {
  qc: QueryClient;
  bump: () => void;
  root: () => HTMLElement | null;
  layer: () => HTMLElement | null;
}

/** Google Calendar and the hub lists are told apart from a plain error by the code the server sends. */
type Err = Error & { code?: string };

export const mobile = (): boolean => !!window.matchMedia?.('(max-width: 860px)').matches;

/** The toast: the hub's own when the classic helpers are loaded, otherwise the page's #toast. */
export function say(msg: string): void {
  const w = window as unknown as { hubToast?: (m: string) => void };
  if (w.hubToast) {
    w.hubToast(msg);
    return;
  }
  toast(msg);
}

/** Join opens the room's own lobby (who is in the room, camera preview, microphone, Join now): the one join screen, the same one a link in an email or a calendar opens. */
export function prejoin(id: string): void {
  location.href = '/meet/room/?m=' + encodeURIComponent(id) + '&back=' + encodeURIComponent(location.pathname + location.search);
}

export function createCtl(env: Env) {
  const savedView = ((): MV.View => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      return v === 'week' || v === 'month' ? v : 'day';
    } catch {
      return 'day';
    }
  })();
  const S: State = {
    day: MV.etKey(Date.now()),
    view: savedView,
    winStart: null,
    sel: null,
    confirm: null,
    data: null,
    people: {},
    now: new Date(),
    open: '',
    panel: 'detail',
    pick: '',
    extra: [],
    info: {},
    prep: {},
    move: null,
    moveWrite: false,
    moveMail: true,
    moveSeries: false,
    moveBusy: false,
    moveErr: '',
    rev: 0,
    calMap: {},
    calInfo: null,
    covered: [],
    calBusy: false,
    ov: {},
    pend: {},
    draft: null,
    t0: 0,
    wkH0: 8,
    moved: null,
    missing: '',
    busy: true,
    err: '',
    resetScroll: false,
    focusOnce: false,
    scroll: null,
    sendReady: false,
  };
  const memo: { k: string; all: Ev[]; by: Record<string, Ev[]> } = { k: '', all: [], by: {} };
  const timers: ReturnType<typeof setInterval>[] = [];
  let stopped = true;
  let pumping = false;
  let drag: any = null;
  let noClickUntil = 0;
  let tipEl: HTMLElement | null = null;
  let lastSc: Element | null = null;
  let saveT: ReturnType<typeof setTimeout> | undefined;
  const root = () => env.root() as HTMLElement;
  const layer = () => env.layer() as HTMLElement;
  const api = meetApi;

  /** Draw. While an event is being dragged the grid is left alone and drawn once the drag ends. */
  function draw() {
    if (drag && drag.on && drag.kind !== 'create') {
      drag.redraw = true;
      return;
    }
    env.bump();
  }
  /** Draw now, so the page can read the result at once. */
  function drawNow() {
    if (drag && drag.on && drag.kind !== 'create') {
      drag.redraw = true;
      return;
    }
    flushSync(() => env.bump());
  }

  // normalize and bucket run once per data change or clock tick, not on every switch of view.
  function derived() {
    const k = S.rev + ':' + S.now.getTime();
    if (memo.k !== k) {
      memo.all = normalize(S.data as Hub, { now: S.now.getTime(), ov: S.ov, extra: S.extra, people: S.people });
      memo.by = MV.bucket(memo.all);
      memo.k = k;
    }
    return memo;
  }
  function findEv(id: string): Ev | null {
    const all = S.data ? derived().all : [];
    for (let i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  // ---------------------------------------------------------------- loading
  // The calendar windows already loaded survive a page change (a link out and Back, a reload), so the Google, Zoom, Meet and Teams
  // events are on screen in the first paint and only replaced by a newer successful load.
  function saveCalNow() {
    try {
      const j = JSON.stringify({ at: Date.now(), calMap: S.calMap, covered: S.covered, calInfo: S.calInfo });
      if (j.length < 2500000) sessionStorage.setItem(CAL_KEY, j);
    } catch {
      // storage full or off
    }
  }
  function saveCal() {
    clearTimeout(saveT);
    saveT = setTimeout(saveCalNow, 900);
  }
  function saveHub() {
    try {
      const v = S.data as Hub;
      sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), up: v.up, recent: v.recent, notes: v.notes, people: v.people }));
    } catch {
      // storage full or off
    }
  }
  function rebuildCal() {
    if (!S.data) return;
    const info = S.calInfo || {};
    S.data.cal =
      info.connected === false
        ? { connected: false, canWrite: false, meetings: [] }
        : { connected: true, canWrite: !!info.canWrite, meetings: Object.keys(S.calMap).map((k) => S.calMap[k]), error: info.error };
    S.rev++;
  }
  function hydrate() {
    try {
      const c = JSON.parse(sessionStorage.getItem(CAL_KEY) || 'null');
      const h = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      if (c && c.calInfo && c.calInfo.connected && Date.now() - c.at < 6 * 3600000) {
        S.calMap = c.calMap || {};
        S.covered = c.covered || [];
        S.calInfo = c.calInfo;
      }
      if (h && h.up) {
        S.people = {};
        (h.people || []).forEach((q: any) => {
          S.people[String(q.email).toLowerCase()] = q.name;
        });
        S.data = h;
        rebuildCal();
        S.now = new Date();
      }
    } catch {
      // unreadable copy: start empty
    }
  }
  function readCache(): Hub | null {
    try {
      const c = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      return c && Date.now() - c.at < TTL ? c : null;
    } catch {
      return null;
    }
  }
  const calWin = (from: string, to: string) => ({ from: MV.etStart(from), to: MV.etStart(MV.addDays(to, 1)) });
  function calSig() {
    return (
      Object.keys(S.calMap)
        .sort()
        .map((k) => {
          const m = S.calMap[k];
          return m.eventId + m.startsAt + m.endsAt + m.title + (m.people || []).length;
        })
        .join('|') + JSON.stringify(S.calInfo)
    );
  }
  // Google Calendar events are fetched by date window and kept by event id. A window that fails or is slow leaves what the page already has.
  function fetchCal(from: string, to: string): Promise<void> {
    const w = calWin(from, to);
    const was = calSig();
    return api('meetings/calendar?from=' + encodeURIComponent(new Date(w.from).toISOString()) + '&to=' + encodeURIComponent(new Date(w.to).toISOString()))
      .then((r) => {
        if (stopped) return;
        if (!r.connected) {
          S.calInfo = { connected: false };
          S.calMap = {};
        } else if (r.error) S.calInfo = { connected: true, canWrite: r.canWrite, error: r.error };
        else {
          S.calInfo = { connected: true, canWrite: r.canWrite };
          Object.keys(S.calMap).forEach((k) => {
            const st = Date.parse(S.calMap[k].startsAt);
            if (st >= r.from && st < r.to) delete S.calMap[k];
          });
          (r.meetings || []).forEach((m: any) => {
            S.calMap[m.eventId] = m;
          });
          S.covered.push({ from: r.from, to: r.to, at: Date.now() });
          S.covered = S.covered.filter((c) => !S.covered.some((o) => o !== c && o.at >= c.at && o.from <= c.from && o.to >= c.to)).slice(-12);
        }
        saveCal();
        rebuildCal();
        if (S.data && calSig() !== was) draw();
      })
      .catch(() => {
        if (stopped) return;
        const was2 = calSig();
        S.calInfo = Object.assign({}, S.calInfo || { connected: true }, { error: 'Google Calendar did not answer.' });
        rebuildCal();
        if (S.data && calSig() !== was2) draw();
      });
  }
  // The days on screen, plus a week either side, must sit inside a loaded window. Otherwise that stretch is fetched.
  function coverAt(lo: number, hi: number) {
    let best = 0;
    S.covered.forEach((c) => {
      if (c.from <= lo && c.to >= hi && c.at > best) best = c.at;
    });
    return best;
  }
  function ensureCal(): Promise<void> {
    if (!S.data || S.calBusy || (S.calInfo && S.calInfo.connected === false)) return Promise.resolve();
    const ks = MV.range(S.view, S.day);
    const last = ks[ks.length - 1];
    const lo = MV.etStart(MV.addDays(ks[0], -14));
    const hi = MV.etStart(MV.addDays(last, 15));
    const at = coverAt(lo, hi);
    const idle = () => {
      S.calBusy = false;
    };
    if (at && Date.now() - at < STALE) return Promise.resolve();
    S.calBusy = true;
    return (at ? fetchCal(MV.addDays(ks[0], -14), MV.addDays(last, 14)) : fetchCal(MV.addDays(ks[0], -35), MV.addDays(last, 45))).then(idle, idle);
  }
  // A refresh re-reads the windows already loaded, one call.
  function refetchCal() {
    const ks = MV.range(S.view, S.day);
    return fetchCal(MV.addDays(ks[0], -14), MV.addDays(ks[ks.length - 1], 14));
  }
  function stamp(r: any[], fresh: boolean): Hub {
    const v: Hub = { at: Date.now(), up: r[0].meetings, recent: r[1].meetings, notes: r[2].meetings, people: r[3].people || [] };
    try {
      sessionStorage.setItem(KEY, JSON.stringify(v));
    } catch {
      // storage full or off
    }
    if (fresh) dayQueries.forEach((q, i) => env.qc.setQueryData(q.queryKey as unknown as unknown[], r[i]));
    return v;
  }
  function load(fresh?: boolean): Promise<unknown> {
    const c = fresh ? null : readCache();
    let hub: Promise<Hub>;
    if (c) hub = Promise.resolve(c);
    else if (fresh) {
      hub = Promise.all([api('meetings?scope=upcoming'), api('meetings?scope=recent'), api('meetings?scope=notes'), api('meetings/directory').catch(() => ({ people: [] }))]).then((r) => stamp(r, true));
    } else {
      // The first read goes through the query cache, which the route loader has already filled.
      hub = Promise.all(dayQueries.map((q) => env.qc.fetchQuery(q as any))).then((r) => stamp(r as any[], false));
    }
    const today = dayKey(new Date());
    // The calendar goes in parallel and does not hold the page back. The window is every day on screen plus the weeks around today.
    const ks = MV.range(S.view, S.day);
    let calP: Promise<void>;
    if (S.covered.length) calP = refetchCal();
    else calP = fetchCal(MV.addDays(ks[0], -3), MV.addDays(ks[ks.length - 1], 3)).then(() => fetchCal(MV.addDays(today < ks[0] ? today : ks[0], -35), MV.addDays(today > ks[ks.length - 1] ? today : ks[ks.length - 1], 45)));
    const shown = hub
      .then((v) => {
        if (stopped) return;
        S.people = {};
        (v.people || []).forEach((q) => {
          S.people[String(q.email).toLowerCase()] = q.name;
        });
        const changed = !S.data || sigOf(S.data) !== sigOf(v);
        const wasBusy = S.busy;
        S.data = v;
        S.err = '';
        rebuildCal();
        S.now = new Date();
        S.busy = false;
        if (changed || wasBusy) draw();
        void pump();
      })
      .catch((e: Err) => {
        if (stopped) return;
        if (!S.data) S.err = e.message;
        S.busy = false;
        draw();
      });
    return Promise.all([shown, calP]);
  }
  // While a Favor room shows as live (or open), who is in it is re-read every 10 seconds, so a room everyone left stops reading Live within about 30 seconds.
  function refreshLive(): Promise<void> {
    return api('meetings?scope=upcoming')
      .then((r) => {
        if (stopped || !S.data) return;
        const before = JSON.stringify((S.data.up || []).map((m: any) => [m.id, m.status, m.inRoom]));
        const after = JSON.stringify((r.meetings || []).map((m: any) => [m.id, m.status, m.inRoom]));
        S.data.up = r.meetings || [];
        if (before !== after) {
          S.rev++;
          S.now = new Date();
          draw();
        }
      })
      .catch(() => undefined);
  }

  // ---------------------------------------------------------------- the date bar
  function setDay(k: string) {
    if (S.draft && !S.draft.busy) S.draft = null;
    S.day = k;
    S.sel = null;
    S.confirm = null;
    S.pick = '';
    S.resetScroll = true;
    draw();
    void ensureCal();
  }
  function setView(v: MV.View) {
    if (v === S.view) return;
    if (S.draft && !S.draft.busy) S.draft = null;
    S.view = v;
    S.pick = '';
    S.resetScroll = true;
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // private mode
    }
    draw();
    void ensureCal();
  }

  // ---------------------------------------------------------------- the meeting panel
  function copy(text: string, msg: string) {
    const done = () => say(msg);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => say(text));
    else say(text);
  }
  function openEv(id: string) {
    S.open = id;
    S.panel = 'detail';
    S.confirm = null;
    S.move = null;
    S.moveErr = '';
    S.moveWrite = false;
    S.moveMail = true;
    S.moveSeries = false;
    S.moveBusy = false;
    S.focusOnce = true;
    const u = '/meet/?m=' + encodeURIComponent(urlId(id));
    try {
      history.pushState({ ...(history.state || {}), mp: 1 }, '', u);
    } catch {
      // sandboxed frame
    }
    draw();
    wantInfo(id);
  }
  function closePanel(fromPop?: boolean) {
    if (!S.open) return;
    S.open = '';
    S.panel = 'detail';
    S.move = null;
    if (!fromPop && history.state && history.state.mp) history.back();
    else if (!fromPop && /[?&]m=/.test(location.search)) {
      try {
        history.replaceState(history.state, '', '/meet/');
      } catch {
        // ignore
      }
    }
    draw();
  }
  function onPop() {
    const m = new URLSearchParams(location.search).get('m') || '';
    if (!m) {
      if (S.open) closePanel(true);
      return;
    }
    const id = fromUrlId(m);
    if (id !== S.open) {
      S.open = id;
      S.panel = 'detail';
      S.focusOnce = true;
      const pe = findEv(id);
      if (pe && S.view === 'day' && dayKey(pe.start) !== S.day) {
        S.day = dayKey(pe.start);
        S.resetScroll = true;
      }
      draw();
      ensureLoaded(id);
    }
  }
  // A shared link can name a meeting that is not on the lists (an older Favor room). Ask for that one.
  function ensureLoaded(id: string) {
    if (!S.data || findEv(id) || id.indexOf('c:') === 0 || !/^[0-9a-f]{24}$/.test(id)) {
      wantInfo(id);
      return;
    }
    api('meetings/' + id)
      .then((r) => {
        if (stopped || !r.meeting) return;
        S.extra = [r.meeting];
        S.rev++;
        const e = findEv(id);
        if (e) S.day = dayKey(e.start);
        draw();
      })
      .catch(() => {
        S.missing = id;
        draw();
      });
    wantInfo(id);
  }
  // Settings and prep for a Favor room come from the room's own routes, read once per open.
  function wantInfo(id: string) {
    const e = findEv(id);
    if (!e || e.cal) return;
    if (!S.info[id]) {
      S.info[id] = { guests: false };
      api('meetings/' + id)
        .then((r) => {
          S.info[id] = { guests: !!r.guestsEnabled };
          if (S.open === id) draw();
        })
        .catch(() => undefined);
    }
    if (!S.prep[id] && !(e.hub && e.hub.status === 'ended') && e.start > Date.now() - 3600000) {
      S.prep[id] = { loading: true };
      api('meetings/' + id + '/prep')
        .then((r) => {
          S.prep[id] = { last: r.last || null, open: (r.openItems || []).length };
          if (S.open === id) draw();
        })
        .catch(() => {
          S.prep[id] = {};
        });
    }
  }
  function moveNow() {
    const e = findEv(S.open);
    if (!e || !e.cal || S.moveBusy) return;
    S.move = e;
    S.moveBusy = true;
    S.moveErr = '';
    draw();
    // Same route and fields as Today.
    const body: Record<string, unknown> = { eventId: e.cal.eventId, emailInvitees: invited(e, S.people).length > 0 && S.moveMail };
    if (e.cal.recurring && S.moveSeries) body.series = true;
    api('../hub/day-move', { method: 'POST', body })
      .then((r) => {
        S.moved = {
          id: r.id,
          title: e.title,
          when: whenLine(e),
          room: r.room || '/meet/room/?m=' + r.id,
          linked: !!r.linked,
          created: !!r.created,
          invited: r.invited || 0,
          organizer: r.organizer || null,
          linkError: r.linkError || '',
          emailed: r.emailed || 0,
          emailFailed: r.emailFailed || 0,
          series: !!r.series,
          seriesId: r.seriesId || '',
        };
        S.panel = 'moved';
        S.moveBusy = false;
        draw();
        void load(true);
      })
      .catch((x: Err) => {
        S.moveBusy = false;
        if (x.code === 'already') {
          say('This meeting is already in FavorOS.');
          S.panel = 'detail';
          closePanel();
          void load(true);
          return;
        }
        if (x.code === 'consent') {
          S.moveErr = x.message;
          draw();
          return;
        }
        S.moveErr = x.message || 'Could not move it. Try again.';
        draw();
      });
  }
  function onPanelClick(ev: MouseEvent) {
    const t = (ev.target as Element).closest('[data-mp], [data-rec], [data-yes], [data-no], [data-cancel], a') as HTMLElement | null;
    if (!t || !layer().contains(t)) return;
    const href = t.tagName === 'A' ? t.getAttribute('href') || '' : '';
    const jm = /^\/meet\/room\/\?m=([0-9a-f]{24})$/.exec(href);
    if (jm && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey) {
      ev.preventDefault();
      return prejoin(jm[1]);
    }
    const a = t.dataset.mp;
    const id = S.open;
    const e = findEv(id);
    if (a === 'close') return closePanel();
    if (a === 'move' && e) {
      S.panel = 'move';
      S.move = e;
      S.moveErr = '';
      S.moveWrite = false;
      S.moveMail = true;
      S.moveSeries = false;
      S.focusOnce = true;
      return draw();
    }
    if (a === 'back') {
      S.panel = 'detail';
      S.moveErr = '';
      return draw();
    }
    if (a === 'domove') return moveNow();
    if (a === 'tellorg' && S.moved) {
      const mv = S.moved;
      mv.telling = true;
      draw();
      api('../hub/day-move', { method: 'POST', body: { tellOrganizer: mv.id } })
        .then((r) => {
          mv.telling = false;
          mv.told = r.ok ? 'Emailed ' + (mv.organizer.name || mv.organizer.email) + '.' : r.message;
          draw();
        })
        .catch((x: Err) => {
          mv.telling = false;
          mv.told = x.message;
          draw();
        });
      return;
    }
    if (a === 'send' && e && e.hub) {
      const arg = { id: e.hub.id, self: !e.hub.mine };
      void loadSend().then((s) => s && s.open(arg));
      return;
    }
    if (a === 'copy' && e && e.hub) return copy(location.origin + '/meet/room/?m=' + e.hub.id, 'Link copied');
    if (a === 'guest' && e && e.hub) {
      api('meetings/' + e.hub.id + '/guestlink', { method: 'POST', body: {} })
        .then((r) => copy(r.url, 'Guest link copied'))
        .catch((x: Err) => say(x.message));
      return;
    }
    if (t.dataset.rec && e && e.hub) {
      const prev = e.hub.rec;
      const next = t.dataset.rec;
      e.hub.rec = next;
      e.rec = next;
      draw();
      api('meetings/' + e.hub.id + '/update', { method: 'POST', body: { rec: next } })
        .then(() => {
          say('Recording set');
          void load(true);
        })
        .catch((x: Err) => {
          e.hub.rec = prev;
          e.rec = prev;
          draw();
          say(x.message);
        });
      return;
    }
    if (t.dataset.cancel) {
      S.confirm = t.dataset.cancel;
      return draw();
    }
    if (t.dataset.no) {
      S.confirm = null;
      return draw();
    }
    if (t.dataset.yes) {
      (t as HTMLButtonElement).disabled = true;
      const cb: Record<string, string> = { status: 'cancelled' };
      if (t.dataset.scope) cb.scope = t.dataset.scope;
      api('meetings/' + t.dataset.yes + '/update', { method: 'POST', body: cb })
        .then(() => {
          say('Cancelled');
          S.confirm = null;
          closePanel();
          void load(true);
        })
        .catch((x: Err) => {
          (t as HTMLButtonElement).disabled = false;
          say(x.message);
        });
    }
  }
  function onLayerChange(ev: Event) {
    const el = ev.target as HTMLInputElement | null;
    const a = el && el.dataset && el.dataset.mp;
    if (a === 'write') {
      S.moveWrite = el!.checked;
      draw();
    }
    if (a === 'mail') {
      S.moveMail = el!.checked;
      draw();
    }
    if (a === 'series') {
      S.moveSeries = el!.checked;
      draw();
    }
  }
  function onKey(ev: KeyboardEvent) {
    if (ev.key === 'Escape' && S.open) {
      ev.preventDefault();
      if (S.panel === 'move') {
        S.panel = 'detail';
        draw();
      } else closePanel();
    }
  }

  // ---------------------------------------------------------------- editing in place: drag, resize, create, save
  // Every change is shown at once (an override on top of the loaded data) and sent to Google Calendar or the meeting route.
  // When the save fails the override is dropped and the event is drawn where it was.
  // The saved values go into the loaded data, then the override is dropped.
  function commitLocal(e: Ev, o: any) {
    if (e.cal) {
      const c = e.cal;
      if (o.start) {
        c.startsAt = new Date(o.start).toISOString();
        c.endsAt = new Date(o.end).toISOString();
      }
      if (o.title != null) c.title = o.title;
      if (o.desc != null) c.description = o.desc;
      saveCal();
    } else {
      const m = e.hub;
      if (o.start) {
        m.startsAt = new Date(o.start).toISOString();
        m.endsAt = new Date(o.end).toISOString();
        m.durationMin = Math.round((o.end - o.start) / 60000);
      }
      if (o.title != null) m.title = o.title;
      if (o.desc != null) m.agenda = o.desc;
      saveHub();
    }
  }
  function applyEdit(e: Ev, patch: { start?: number; end?: number; title?: string; desc?: string }): boolean {
    if (S.pend[e.id]) {
      say('Still saving the last change.');
      return false;
    }
    const next: any = {};
    if (patch.start != null) {
      next.start = patch.start;
      next.end = patch.end;
    }
    if (patch.title != null) next.title = patch.title;
    if (patch.desc != null) next.desc = patch.desc;
    S.ov[e.id] = next;
    S.pend[e.id] = 1;
    S.rev++;
    draw();
    let path: string;
    let body: Record<string, unknown>;
    if (e.cal) {
      path = 'meetings/calendar/update';
      body = { eventId: e.cal.eventId };
      if (next.start) {
        body.startsAt = new Date(next.start).toISOString();
        body.endsAt = new Date(next.end).toISOString();
      }
      if (next.title != null) body.title = next.title;
      if (next.desc != null) body.description = next.desc;
    } else {
      path = 'meetings/' + e.hub.id + '/update';
      body = {};
      if (next.start) {
        body.startsAt = new Date(next.start).toISOString();
        body.endsAt = new Date(next.end).toISOString();
      }
      if (next.title != null) body.title = next.title;
      if (next.desc != null) body.agenda = next.desc;
    }
    api(path, { method: 'POST', body })
      .then(() => {
        if (stopped) return;
        commitLocal(e, next);
        delete S.ov[e.id];
        delete S.pend[e.id];
        S.rev++;
        draw();
        say(next.start ? 'Moved' : 'Saved');
      })
      .catch((x: Err) => {
        if (stopped) return;
        delete S.ov[e.id];
        delete S.pend[e.id];
        S.rev++;
        draw();
        say(shortMsg(x && x.message));
      });
    return true;
  }

  function colsInfo() {
    const out: { key: string; left: number; right: number }[] = [];
    const cs = root().querySelectorAll('.wk-col');
    for (let i = 0; i < cs.length; i++) {
      const r = cs[i].getBoundingClientRect();
      out.push({ key: cs[i].getAttribute('data-col') as string, left: r.left, right: r.right });
    }
    return out;
  }
  function tip(text: string, x: number, y: number) {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'dv-tip';
      tipEl.setAttribute('aria-hidden', 'true');
      document.body.appendChild(tipEl);
    }
    if (tipEl.textContent !== text) tipEl.textContent = text;
    tipEl.style.transform = 'translate(' + Math.round(x + 14) + 'px,' + Math.round(y + 14) + 'px)';
  }
  function dropTip() {
    if (tipEl && tipEl.parentNode) tipEl.parentNode.removeChild(tipEl);
    tipEl = null;
  }

  function onDown(ev: PointerEvent) {
    if (drag || stopped || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    const target = ev.target as Element;
    let b = target.closest('.dv-ev, .mo-chip') as HTMLElement | null;
    if (b && !root().contains(b)) b = null;
    if (b && b.classList.contains('dv-new')) return;
    if (!b) return startCreate(ev);
    const e = findEv(b.getAttribute('data-ev') as string);
    if (!e || !e.edit || S.pend[e.id] || S.draft) return;
    const month = b.classList.contains('mo-chip');
    const touch = ev.pointerType !== 'mouse';
    const sc = root().querySelector('.dv-tl__scroll') as HTMLElement | null;
    drag = {
      kind: month ? 'month' : target.closest('.dv-rs') ? 'resize' : 'move', e, el: b, x0: ev.clientX, y0: ev.clientY, lx: ev.clientX, ly: ev.clientY, sc, st0: sc ? sc.scrollTop : 0, pid: ev.pointerId, touch,
      armed: !touch, on: false, s0: e.start, e0: e.end, style0: b.getAttribute('style'), cols: null, idx0: 0, key0: dayKey(e.start), ns: null, ne: null, target: '', vel: 0, raf: 0, timer: 0,
    };
    if (S.view === 'week' && !month) {
      drag.cols = colsInfo();
      const col = b.closest('.wk-col');
      const k0 = col ? (col.getAttribute('data-col') as string) : drag.key0;
      drag.key0 = k0;
      for (let i = 0; i < drag.cols.length; i++) if (drag.cols[i].key === k0) drag.idx0 = i;
    }
    if (touch) {
      const el = b;
      drag.timer = setTimeout(() => {
        if (drag && !drag.on) {
          drag.armed = true;
          el.classList.add('is-arm');
          try {
            if (navigator.vibrate) navigator.vibrate(8);
          } catch {
            // none
          }
        }
      }, 320);
    }
    listen(true);
  }
  function listen(on: boolean) {
    const f = on ? 'addEventListener' : 'removeEventListener';
    document[f]('pointermove', onMove as EventListener);
    document[f]('pointerup', onUp as EventListener);
    document[f]('pointercancel', onCancel);
    document[f]('keydown', onDragKey as EventListener, true);
    document[f]('touchmove', onTouchMove as EventListener, { passive: false } as AddEventListenerOptions);
  }
  function onTouchMove(ev: TouchEvent) {
    if (drag && (drag.on || drag.armed) && ev.cancelable) ev.preventDefault();
  }
  function onDragKey(ev: KeyboardEvent) {
    if (ev.key === 'Escape' && drag) {
      ev.preventDefault();
      ev.stopPropagation();
      endDrag(false);
    }
  }
  function onCancel() {
    endDrag(false);
  }
  function onUp(ev: PointerEvent) {
    if (drag && ev.pointerId === drag.pid) endDrag(true);
  }
  function onMove(ev: PointerEvent) {
    const d = drag;
    if (!d || ev.pointerId !== d.pid) return;
    const dx = ev.clientX - d.x0;
    const dy = ev.clientY - d.y0;
    d.lx = ev.clientX;
    d.ly = ev.clientY;
    if (!d.on) {
      if (d.touch && !d.armed) {
        if (Math.abs(dx) + Math.abs(dy) > 8) endDrag(false);
        return;
      }
      if (Math.abs(dx) + Math.abs(dy) < 5) return;
      begin(d);
    }
    if (d.kind === 'create') return moveCreate(d);
    updateDrag();
  }
  function begin(d: any) {
    d.on = true;
    root().classList.add('is-dragging');
    if (d.kind === 'create') {
      S.draft = { key: d.key, start: d.a, end: d.a + SNAP * 60000, editing: false };
      drawNow();
      return;
    }
    d.el.classList.add('is-drag');
    d.el.classList.remove('is-arm');
    try {
      d.el.setPointerCapture(d.pid);
    } catch {
      // none
    }
    if (d.kind === 'month') {
      d.ghost = d.el.cloneNode(true);
      d.ghost.className += ' mo-ghost';
      d.ghost.style.width = d.el.offsetWidth + 'px';
      document.body.appendChild(d.ghost);
    }
  }
  function updateDrag() {
    const d = drag;
    const el = d.el as HTMLElement;
    if (d.kind === 'month') {
      d.ghost.style.transform = 'translate(' + Math.round(d.lx - 20) + 'px,' + Math.round(d.ly - 11) + 'px)';
      const under = document.elementsFromPoint(d.lx, d.ly);
      let cell: Element | null = null;
      for (let i = 0; i < under.length; i++) {
        const c = under[i].closest && under[i].closest('.mo-cell[data-cell]');
        if (c && root().contains(c)) {
          cell = c;
          break;
        }
      }
      const key = cell ? (cell.getAttribute('data-cell') as string) : '';
      if (key !== d.target) {
        const old = root().querySelector('.mo-cell.is-drop');
        if (old) old.classList.remove('is-drop');
        if (cell) cell.classList.add('is-drop');
        d.target = key;
      }
      d.ns = key ? atDay(key, minOfDay(d.s0)) : null;
      d.ne = key ? d.ns + (d.e0 - d.s0) : null;
      if (d.ns != null) tip(new Date(d.ns).toLocaleDateString('en-US', { timeZone: MV.TZ, weekday: 'short', month: 'short', day: 'numeric' }), d.lx, d.ly);
      else dropTip();
      return;
    }
    const dyy = d.ly - d.y0 + (d.sc ? d.sc.scrollTop - d.st0 : 0);
    const dMin = snapMin((dyy / PXH) * 60);
    let label: string;
    if (d.kind === 'resize') {
      const end = Math.max(d.e0 + dMin * 60000, d.s0 + SNAP * 60000);
      d.ns = d.s0;
      d.ne = end;
      el.style.height = Math.max(20, ((end - d.s0) / 3600000) * PXH - 3) + 'px';
      label = hm(d.s0) + ' to ' + hm(end);
    } else {
      let k = d.key0;
      let shift = 0;
      if (d.cols && d.cols.length) {
        let idx = d.idx0;
        for (let j = 0; j < d.cols.length; j++) if (d.lx >= d.cols[j].left && d.lx < d.cols[j].right) idx = j;
        if (d.lx < d.cols[0].left) idx = 0;
        if (d.lx >= d.cols[d.cols.length - 1].right) idx = d.cols.length - 1;
        k = d.cols[idx].key;
        shift = d.cols[idx].left - d.cols[d.idx0].left;
      }
      d.ns = atDay(k, minOfDay(d.s0) + dMin);
      d.ne = d.ns + (d.e0 - d.s0);
      el.style.transform = 'translate(' + Math.round(shift) + 'px,' + (dMin / 60) * PXH + 'px)';
      label = (dayKey(d.ns) !== dayKey(d.s0) ? MV.dayName(dayKey(d.ns), false) + ' ' : '') + hm(d.ns) + ' to ' + hm(d.ne);
    }
    tip(label, d.lx, d.ly);
    // Near the top or bottom of the grid the grid scrolls.
    if (d.sc) {
      const r = d.sc.getBoundingClientRect();
      d.vel = d.ly < r.top + 36 ? -10 : d.ly > r.bottom - 36 ? 10 : 0;
      if (d.vel && !d.raf) d.raf = requestAnimationFrame(autoScroll);
    }
  }
  function autoScroll() {
    const d = drag;
    if (!d || !d.on || !d.vel) {
      if (d) d.raf = 0;
      return;
    }
    d.sc.scrollTop += d.vel;
    updateDrag();
    d.raf = requestAnimationFrame(autoScroll);
  }
  function endDrag(commit: boolean) {
    const d = drag;
    if (!d) return;
    drag = null;
    listen(false);
    clearTimeout(d.timer);
    if (d.raf) cancelAnimationFrame(d.raf);
    dropTip();
    root().classList.remove('is-dragging');
    if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
    const hot = root().querySelector('.mo-cell.is-drop');
    if (hot) hot.classList.remove('is-drop');
    if (d.kind === 'create') return endCreate(d, commit);
    if (d.el) {
      d.el.classList.remove('is-drag');
      d.el.classList.remove('is-arm');
      try {
        d.el.releasePointerCapture(d.pid);
      } catch {
        // none
      }
    }
    if (!d.on) return;
    noClickUntil = Date.now() + 400;
    const changed = commit && d.ns != null && (d.ns !== d.s0 || d.ne !== d.e0);
    // The moved or resized event goes back to the style the page drew, so the next draw starts from what React last wrote.
    if (d.el) {
      if (d.style0 == null) d.el.removeAttribute('style');
      else d.el.setAttribute('style', d.style0);
    }
    if (!changed) {
      if (d.redraw) draw();
      return;
    }
    applyEdit(d.e, { start: d.ns, end: d.ne });
  }
  // A click right after a drag is the drag ending, not a request to open the meeting.
  function clickGuard(ev: MouseEvent) {
    if (Date.now() < noClickUntil) {
      ev.stopPropagation();
      ev.preventDefault();
    }
  }

  // ---- a new meeting: drag over empty space in Day or Week, then type the title
  function startCreate(ev: PointerEvent) {
    if (ev.pointerType !== 'mouse' || mobile() || (S.view !== 'day' && S.view !== 'week')) return;
    const target = ev.target as Element;
    if (S.draft) {
      if (S.draft.busy) return;
      if (target.closest('.dv-new')) return;
      cancelDraft();
    }
    const grid = target.closest('.dv-tl__grid') as HTMLElement | null;
    if (!grid || !root().contains(grid)) return;
    let key: string;
    let t0: number;
    let top: number;
    if (S.view === 'week') {
      const col = target.closest('.wk-col');
      if (!col) return;
      key = col.getAttribute('data-col') as string;
      t0 = MV.etStart(key) + S.wkH0 * 3600000;
      top = col.getBoundingClientRect().top;
    } else {
      key = S.day;
      t0 = S.t0;
      top = grid.getBoundingClientRect().top;
    }
    const step = SNAP * 60000;
    const at = (y: number) => t0 + ((y - top) / PXH) * 3600000;
    drag = { kind: 'create', pid: ev.pointerId, x0: ev.clientX, y0: ev.clientY, lx: ev.clientX, ly: ev.clientY, on: false, touch: false, armed: true, key, at, a: Math.floor(at(ev.clientY) / step) * step, el: null, ns: null, ne: null, timer: 0, raf: 0 };
    listen(true);
  }
  function moveCreate(d: any) {
    const step = SNAP * 60000;
    const cur = d.at(d.ly);
    let s: number;
    let e: number;
    if (cur >= d.a) {
      s = d.a;
      e = Math.max(d.a + step, Math.ceil(cur / step) * step);
    } else {
      s = Math.floor(cur / step) * step;
      e = d.a + step;
    }
    const dr = S.draft;
    if (!dr) return;
    dr.start = s;
    dr.end = e;
    d.ns = s;
    d.ne = e;
    draw();
    tip(hm(s) + ' to ' + hm(e), d.lx, d.ly);
  }
  function endCreate(d: any, commit: boolean) {
    if (!d.on) return;
    noClickUntil = Date.now() + 400;
    const dr = S.draft;
    if (!dr) return;
    if (!commit) {
      S.draft = null;
      draw();
      return;
    }
    if (dr.start < Date.now() - 4 * 60000) {
      S.draft = null;
      draw();
      say('That time has passed. Pick a later time.');
      return;
    }
    dr.editing = true;
    drawNow();
    const inp = root().querySelector('.dv-new__in') as HTMLInputElement | null;
    if (inp) inp.focus({ preventScroll: true });
  }
  function cancelDraft() {
    if (!S.draft || S.draft.busy) return;
    S.draft = null;
    draw();
  }
  function submitDraft() {
    const dr = S.draft;
    if (!dr || dr.busy) return;
    const inp = root().querySelector('.dv-new__in') as HTMLInputElement | null;
    const title = ((inp && inp.value) || '').replace(/\s+/g, ' ').trim();
    if (!title) return cancelDraft();
    dr.busy = true;
    dr.title = title;
    if (inp) inp.value = title;
    draw();
    // A new meeting is a FavorOS room with a Google Calendar event. The event has no Meet link and no guests; recording is off until the host changes it.
    api('meetings', { method: 'POST', body: { title, startsAt: new Date(dr.start).toISOString(), durationMin: Math.round((dr.end - dr.start) / 60000), rec: 'video', invitees: [] } })
      .then((r) => {
        if (stopped) return;
        S.draft = null;
        if (r.meeting && S.data) {
          S.data.up = (S.data.up || []).filter((m: any) => m.id !== r.meeting.id).concat([r.meeting]);
          saveHub();
        }
        S.rev++;
        draw();
        say('Meeting added');
      })
      .catch((x: Err) => {
        if (stopped) return;
        S.draft = null;
        draw();
        say(shortMsg(x && x.message));
      });
  }
  function onRootKey(ev: KeyboardEvent) {
    const t = ev.target as HTMLElement | null;
    if (!t || !t.classList || !t.classList.contains('dv-new__in')) return;
    if (ev.key === 'Enter') {
      ev.preventDefault();
      submitDraft();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      cancelDraft();
    }
  }
  function onRootFocusOut(ev: FocusEvent) {
    const t = ev.target as HTMLInputElement | null;
    if (!t || !t.classList || !t.classList.contains('dv-new__in') || !S.draft || S.draft.busy) return;
    if (t.value.trim()) submitDraft();
    else cancelDraft();
  }

  // ---- the panel's own fields: title, date, times, agenda. They save when the field loses focus or on Enter.
  function syncFields(e: Ev) {
    if (!e || !e.edit) return;
    const set = (n: string, v: string) => {
      const el = layer().querySelector('[data-f="' + n + '"]') as HTMLInputElement | null;
      if (el && el !== document.activeElement && el.value !== v) el.value = v;
    };
    set('title', e.title);
    set('date', dayKey(e.start));
    set('start', hhmm(e.start));
    set('end', hhmm(e.end));
    set('desc', e.desc || '');
  }
  function saveField(f: string) {
    const e = S.open ? findEv(S.open) : null;
    if (!e || !e.edit) return;
    const q = (n: string) => layer().querySelector('[data-f="' + n + '"]') as HTMLInputElement | null;
    const el = q(f);
    if (!el) return;
    if (f === 'title') {
      const v = el.value.replace(/\s+/g, ' ').trim();
      if (!v) {
        el.value = e.title;
        return;
      }
      if (v !== e.title) applyEdit(e, { title: v });
      return;
    }
    if (f === 'desc') {
      const dv = el.value.trim();
      if (dv !== String(e.desc || '').trim()) applyEdit(e, { desc: dv });
      return;
    }
    const dur = e.end - e.start;
    let ns = e.start;
    let ne = e.end;
    const day = dayKey(e.start);
    if (!el.value) {
      syncFields(e);
      return;
    }
    if (f === 'date') {
      ns = atDay(el.value, minOfDay(e.start));
      ne = ns + dur;
    } else if (f === 'start') {
      ns = atDay(day, toMin(el.value));
      ne = ns + dur;
    } else if (f === 'end') {
      ne = atDay(day, toMin(el.value));
      if (ne <= ns) {
        say('The end must be after the start.');
        el.value = hhmm(e.end);
        return;
      }
    }
    if (ns === e.start && ne === e.end) return;
    applyEdit(e, { start: ns, end: ne });
  }
  function onLayerFocusOut(ev: FocusEvent) {
    const t = ev.target as HTMLElement | null;
    const f = t && t.dataset && t.dataset.f;
    if (f && f !== 'date') saveField(f);
  }
  function onLayerFieldChange(ev: Event) {
    const t = ev.target as HTMLElement | null;
    const f = t && t.dataset && t.dataset.f;
    if (f === 'date') saveField(f);
  }
  function onLayerKey(ev: KeyboardEvent) {
    const t = ev.target as HTMLInputElement | null;
    if (!t || !t.dataset || !t.dataset.f) return;
    if (ev.key === 'Enter' && (t.tagName === 'INPUT' || ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      t.blur();
    } else if (ev.key === 'Escape') {
      ev.stopPropagation();
      ev.preventDefault();
      const keep = findEv(S.open);
      t.blur();
      if (keep) {
        const vals: Record<string, string> = { title: keep.title, date: dayKey(keep.start), start: hhmm(keep.start), end: hhmm(keep.end), desc: keep.desc || '' };
        t.value = vals[t.dataset.f as string];
      }
    }
  }

  // ---------------------------------------------------------------- the day, week and month surface
  function onClick(ev: MouseEvent) {
    const t = (ev.target as Element).closest('button, a') as HTMLElement | null;
    if (!t || !root().contains(t)) return;
    const href = t.tagName === 'A' ? t.getAttribute('href') || '' : '';
    const jm = /^\/meet\/room\/\?m=([0-9a-f]{24})$/.exec(href);
    if (jm && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey) {
      ev.preventDefault();
      return prejoin(jm[1]);
    }
    const ds = t.dataset;
    if (ds.view) return setView(ds.view as MV.View);
    if (ds.day) return setDay(ds.day);
    if (ds.goday) {
      S.view = 'day';
      try {
        localStorage.setItem(VIEW_KEY, 'day');
      } catch {
        // private mode
      }
      return setDay(ds.goday);
    }
    if (ds.pick) {
      S.pick = ds.pick;
      return draw();
    }
    if (ds.step) {
      S.pick = '';
      return setDay(MV.step(S.view, S.day, +ds.step));
    }
    if (ds.today) {
      S.winStart = dayKey(new Date());
      return setDay(S.winStart);
    }
    if (ds.ev) return openEv(ds.ev);
  }

  /** The things the page must do right after React has put the new tree in the document: scroll, the panel fields, focus. */
  function afterRender() {
    const r = env.root();
    const l = env.layer();
    if (r && S.data && S.scroll) {
      const sc = S.view === 'month' ? null : (r.querySelector('.dv-tl__scroll') as HTMLElement | null);
      if (sc && (S.resetScroll || sc !== lastSc)) {
        const si = S.scroll;
        // Hours from the top of the grid: the day view counts from its first hour, the week view from the week's first hour.
        const off = S.view === 'week' ? (ms: number) => (ms - MV.etStart(dayKey(ms))) / 3600000 - S.wkH0 : (ms: number) => (ms - si.t0) / 3600000;
        const list = si.list;
        if (si.inRange) {
          // Open on the present. Once the last meeting is over, open on that meeting instead of an empty evening.
          const ahead = list.some((e) => e.end >= si.now);
          const lastTop = list.length ? Math.max.apply(null, list.map((e) => off(e.start) * PXH)) - 160 : 0;
          const nowTop = off(si.now) * PXH - 240;
          sc.scrollTop = Math.max(0, ahead ? nowTop : Math.min(nowTop, lastTop));
        } else if (list.length) sc.scrollTop = Math.max(0, Math.min.apply(null, list.map((e) => off(e.start))) * PXH - 40);
      }
      lastSc = sc;
      S.resetScroll = false;
    }
    document.documentElement.classList.toggle('mp-lock', !!S.open);
    if (S.open && l) {
      const e = S.data ? findEv(S.open) : null;
      if (e && e.edit) syncFields(e);
      if (S.focusOnce) {
        S.focusOnce = false;
        const f = (l.querySelector('.mp-first') || l.querySelector('.mp-x')) as HTMLElement | null;
        if (f) f.focus({ preventScroll: true });
      }
    }
  }

  /** Hands the page's own elements their listeners. Returns the way to take them off. */
  function attach(rootEl: HTMLElement, layerEl: HTMLElement): () => void {
    const prevent = (ev: Event) => ev.preventDefault();
    rootEl.addEventListener('click', clickGuard, true);
    rootEl.addEventListener('click', onClick);
    rootEl.addEventListener('pointerdown', onDown);
    rootEl.addEventListener('dragstart', prevent);
    rootEl.addEventListener('keydown', onRootKey);
    rootEl.addEventListener('focusout', onRootFocusOut);
    layerEl.addEventListener('click', onPanelClick);
    layerEl.addEventListener('change', onLayerChange);
    layerEl.addEventListener('focusout', onLayerFocusOut);
    layerEl.addEventListener('change', onLayerFieldChange);
    layerEl.addEventListener('keydown', onLayerKey);
    return () => {
      rootEl.removeEventListener('click', clickGuard, true);
      rootEl.removeEventListener('click', onClick);
      rootEl.removeEventListener('pointerdown', onDown);
      rootEl.removeEventListener('dragstart', prevent);
      rootEl.removeEventListener('keydown', onRootKey);
      rootEl.removeEventListener('focusout', onRootFocusOut);
      layerEl.removeEventListener('click', onPanelClick);
      layerEl.removeEventListener('change', onLayerChange);
      layerEl.removeEventListener('focusout', onLayerFocusOut);
      layerEl.removeEventListener('change', onLayerFieldChange);
      layerEl.removeEventListener('keydown', onLayerKey);
    };
  }

  const onVisible = () => {
    if (!stopped && !document.hidden && S.data) void refreshLive();
  };
  const onResize = (() => {
    let was = mobile();
    return () => {
      const now = mobile();
      if (now !== was) {
        was = now;
        if (S.data && !stopped) draw();
      }
    };
  })();

  /** Starts the timers, the document listeners and the first load. */
  function start() {
    stopped = false;
    // The now line and the lists refresh on their own.
    timers.push(
      setInterval(() => {
        if (!stopped && S.data && !document.hidden && !S.draft && !(drag && drag.on)) {
          S.now = new Date();
          draw();
        }
      }, 30000)
    );
    timers.push(
      setInterval(() => {
        if (!stopped && !document.hidden) void load(true);
      }, 60000)
    );
    // While a Favor room shows as live (or open), who is in it is re-read every 10 seconds.
    timers.push(
      setInterval(() => {
        if (stopped || document.hidden || !S.data) return;
        if ((S.data.up || []).some((m: any) => m.status === 'live')) void refreshLive();
      }, 10000)
    );
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('keydown', onKey);
    window.addEventListener('popstate', onPop);
    window.addEventListener('resize', onResize);
    // The shell reloads the page on a popstate it does not know. Opening and closing the panel is this page's own history.
    (window as unknown as { __hubPopOwn?: (() => boolean) | null }).__hubPopOwn = () => !stopped && location.pathname.replace(/\/?$/, '/') === '/meet/';
    // The Send the link sheet is a classic script; the button shows once it is loaded.
    void loadSend().then((s) => {
      if (s && !stopped) {
        S.sendReady = true;
        if (S.open) draw();
      }
    });
    // A page drawn from the 20 second cache checks who is in each room right away.
    void load().then(() => {
      if (stopped) return;
      if (S.data && S.open) {
        const e0 = findEv(S.open);
        if (e0) {
          S.day = dayKey(e0.start);
          draw();
          wantInfo(S.open);
        } else ensureLoaded(S.open);
      }
      if (S.data && Date.now() - (S.data.at || 0) > 3000) void refreshLive();
    });
  }
  function stop() {
    stopped = true;
    timers.splice(0).forEach(clearInterval);
    document.removeEventListener('visibilitychange', onVisible);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('popstate', onPop);
    window.removeEventListener('resize', onResize);
    (window as unknown as { __hubPopOwn?: unknown }).__hubPopOwn = null;
    listen(false);
    dropTip();
    document.documentElement.classList.remove('mp-lock');
    if (drag) {
      if (drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
      clearTimeout(drag.timer);
      if (drag.raf) cancelAnimationFrame(drag.raf);
      drag = null;
    }
  }

  // The page opens on the meeting named in the address (?m=), and on the copy of the lists and calendar the last visit kept.
  const m0 = new URLSearchParams(location.search).get('m');
  if (m0) {
    S.open = fromUrlId(m0);
    S.focusOnce = true;
  }
  hydrate();
  if (S.data) S.busy = false;

  return { S, derived, findEv, draw, attach, start, stop, afterRender, setDay, setView };
}

export type Ctl = ReturnType<typeof createCtl>;

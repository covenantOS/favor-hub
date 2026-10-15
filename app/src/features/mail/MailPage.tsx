/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import './styles';
import { Compose, type ComposeInit, type Outgoing } from './Compose';
import { Reader, replyAllList, toolsOf } from './Reader';
import { Sheet, Toast, type ToastState } from './Sheet';
import { AssistPanel, BriefCards, SuggestedReplies, shortDay, type AssistState } from './Assist';
import { TeamChatLine, teamOf, type TeamState } from './TeamChat';
import { SmartSheets, type SmartCtx } from './SmartSheets';
import { BASE_VIEWS, CAT_NAMES, FLAG_NAMES, MI, SYS_ICON, hue, initials, isPhone, isPrimary, when, who } from './util';
import { installTips } from './tips';
import { MailError, PRE, boxOf, device, getApi, mailApi, mbOf, setMe, sigOf } from './mailApi';
import { COMPOSE_JS, loadScript } from '@/lib/legacy';

const HOLD_MS = 15000;
const PRIMARY_DOT = '#7b8a76';

interface State {
  me: string;
  name: string;
  level: { read: boolean; write: boolean; headers: boolean; contacts: boolean };
  write: boolean;
  connected: boolean;
  signature: string;
  ready: boolean;
  error: string;
  label: string;
  q: string;
  v: string;
  threads: any[];
  nexts: Record<string, string>;
  loading: boolean;
  labels: any[];
  sel: number;
  open: string;
  thread: any;
  threadLoading: boolean;
  partners: Record<string, any>;
  drafts: Record<string, string>;
  headersOnly: boolean;
  exp: Record<string, boolean>;
  flags: Record<string, boolean>;
  sort: string;
  picked: Record<string, 1>;
  anchor: string;
  boxes: any[];
  box: string;
  counts: Record<string, number>;
  customs: any[];
  ov: any;
  fromOpts: any[] | null;
  view: 'list' | 'thread';
  scanned: number;
  loadError: string;
  assist: AssistState | null;
  team: TeamState | null;
  tl: null | { open: boolean; items?: any[]; error?: string };
  brief: any;
  briefFailed: boolean;
  briefGone: number;
  names: string[] | null;
  sheet: null | { kind: string; anchor?: HTMLElement | null; data?: any };
}

const initial = (): State => ({
  me: '', name: '', level: { read: false, write: false, headers: false, contacts: false }, write: true, connected: false, signature: '', ready: false, error: '',
  label: 'INBOX', q: '', v: '', threads: [], nexts: {}, loading: false, labels: [], sel: -1, open: '', thread: null, threadLoading: false, partners: {}, drafts: {}, headersOnly: false,
  exp: {}, flags: {}, sort: '', picked: {}, anchor: '', boxes: [], box: '', counts: {}, customs: [], ov: null, fromOpts: null, view: 'list', scanned: 0, loadError: '', assist: null, team: null, tl: null, brief: null, briefFailed: false, briefGone: 0, names: null, sheet: null,
});

/* ------------------------------------------------------------------ routing (#/LABEL[/thread], #/search/words[/thread]) */
const slugOf = (v: string) => (v === 'needs' || v === 'waiting' || v === 'unlogged' ? v : v ? v.slice(4) : '');
function unslug(x: string, customs: any[]): string | null {
  if (x === 'needs' || x === 'waiting' || x === 'unlogged') return x;
  if (CAT_NAMES[x] || customs.some((c) => c.id === x) || /^c_[a-z0-9]{4,12}$/.test(x)) return 'cat:' + x;
  return null;
}
function parseHash(customs: any[]) {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map((x) => {
    try {
      return decodeURIComponent(x);
    } catch {
      return x;
    }
  });
  const tk = (x: string) => {
    const i = String(x || '').indexOf('~');
    return i < 0 ? { id: x || '', box: '' } : { id: x.slice(0, i), box: x.slice(i + 1) };
  };
  if (parts[0] === 'search') {
    const t0 = tk(parts[2]);
    return { label: 'ALL', q: parts[1] || '', thread: t0.id, box: t0.box, v: '' };
  }
  const v = unslug(parts[0], customs);
  const t1 = tk(parts[1]);
  if (v) return { label: 'INBOX', q: '', thread: t1.id, box: t1.box, v };
  return { label: parts[0] || 'INBOX', q: '', thread: t1.id, box: t1.box, v: '' };
}

const snoozeTimes = (): Array<[string, Date]> => {
  const now = new Date();
  const at = (d: Date | number, h: number) => {
    const x = new Date(d);
    x.setHours(h, 0, 0, 0);
    return x;
  };
  let later = new Date(now.getTime() + 3 * 36e5);
  later.setMinutes(0, 0, 0);
  if (now.getHours() < 15) later = at(now, 18);
  const tom = at(now.getTime() + 864e5, 8);
  const sat = new Date(now);
  sat.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7 || 7));
  const mon = new Date(now);
  mon.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
  const list: Array<[string, Date]> = [['Later today', later], ['Tomorrow', tom], ['This weekend', at(sat, 8)], ['Next week', at(mon, 8)]];
  if (later.toDateString() !== now.toDateString()) list.shift();
  return list;
};
const stamp = (d: Date) => d.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });

const gmailLink = (me: string, tid?: string) => 'https://mail.google.com/mail/?authuser=' + encodeURIComponent(me) + (tid ? '#all/' + encodeURIComponent(tid) : '');
const allowUrl = (kind: string) => '/api/google/connect?add=' + kind + '&next=' + encodeURIComponent('/mail/' + location.hash);
const reSubject = (s: string, pre: string) => (new RegExp('^' + pre + ':', 'i').test(s || '') ? s : pre + ': ' + (s || ''));
const escH = (s: unknown) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export function MailPage() {
  const S = useRef<State>(initial());
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [compose, setCompose] = useState<ComposeInit | null>(null);
  const lastUndo = useRef<{ fn: () => void; at: number; ms: number } | null>(null);
  const listSeq = useRef(0);
  const threadSeq = useRef(0);
  const ovSeq = useRef(0);
  const syncT = useRef(0);
  const pendingReply = useRef<null | { id: string; text: string }>(null);
  const batching = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const s = S.current;
  const api = () => getApi();
  const set = (p: Partial<State>) => {
    Object.assign(S.current, p);
    bump();
  };

  const say = useCallback((msg: string, undo?: () => void, ms?: number) => {
    const m = ms || (undo ? 6000 : 3200);
    if (undo) lastUndo.current = { fn: undo, at: Date.now(), ms: m };
    setToast({ msg, undo, ms: m, key: Date.now() + Math.random() });
  }, []);
  const canWrite = () => S.current.write && S.current.level.write;
  const askWrite = (what: string) => {
    void what;
    set({ sheet: { kind: 'allow' } });
  };
  const failed = (e: any, what?: string) => {
    if (e && e.code === 'mail_scope' && e.need === 'write') return askWrite(what || '');
    if (e && e.code === 'mail_scope') return set({ level: { ...S.current.level, read: false } });
    if (e && e.code === 'mail_readonly') {
      S.current.write = false;
      return askWrite(what || '');
    }
    say(e && e.message ? e.message : 'That did not work. Try again.');
  };

  /* ------------------------------------------------------------------ mailboxes and labels */
  const accts = (): string[] => {
    const x = S.current;
    if (!x.boxes.length) return [''];
    if (x.box === '') return [''].concat(x.boxes.map((b) => b.email));
    return [x.box === x.me ? '' : x.box];
  };
  const labelsAcct = () => (S.current.box === '' || S.current.box === S.current.me ? '' : S.current.box);
  const boxTotal = () => Object.keys(S.current.counts).reduce((n, k) => n + Math.max(0, S.current.counts[k]), 0);

  const setRailCount = (n: number) => {
    document.querySelectorAll<HTMLElement>('[data-count="mailUnread"]').forEach((el) => {
      el.hidden = !n;
      el.textContent = Number(n || 0).toLocaleString('en-US');
    });
    try {
      const nav = JSON.parse(localStorage.getItem('favor.hub.nav.v1') || 'null');
      if (nav && nav.counts) {
        nav.counts.mailUnread = n;
        localStorage.setItem('favor.hub.nav.v1', JSON.stringify(nav));
      }
    } catch {
      // storage full
    }
    if (document.body.dataset.nav === 'mail') document.title = (n ? '(' + n + ') ' : '') + 'Mail - FavorOS';
  };
  const loadLabels = () => {
    const x = S.current;
    if (!x.level.headers && !x.level.read) return Promise.resolve();
    return api()
      .labels(labelsAcct())
      .then((d: any) => {
        set({ labels: d.labels || [] });
        const inbox = (d.labels || []).find((l: any) => l.id === 'INBOX');
        if (inbox && !S.current.boxes.length) setRailCount(inbox.unread);
      })
      .catch(() => undefined);
  };
  const loadBoxes = () => {
    if (!S.current.boxes.length) return Promise.resolve();
    return api()
      .boxes()
      .then((d: any) => {
        const counts: Record<string, number> = {};
        (d.boxes || []).forEach((b: any) => (counts[b.email] = b.unread));
        set({ counts });
        setRailCount(boxTotal());
      })
      .catch(() => undefined);
  };
  const loadOverview = () => {
    const x = S.current;
    if (!x.level.read || !x.connected) return;
    const seq = ++ovSeq.current;
    const list = accts();
    void Promise.all(list.map((a) => api().overview(a).catch(() => null))).then((rs0: any[]) => {
      if (seq !== ovSeq.current) return;
      const rs = rs0.filter(Boolean);
      if (!rs.length) return;
      let d = rs[0];
      if (rs.length > 1) {
        d = { counts: {}, customs: rs[0].customs, unlogged: 0, major: 0, needs: 0, unread: 0, waiting: 0, marks: {}, scanned: 0, pending: 0 };
        rs.forEach((r: any) => {
          Object.keys(r.counts).forEach((c) => {
            const y = d.counts[c] || (d.counts[c] = { n: 0, unread: 0 });
            y.n += r.counts[c].n;
            y.unread += r.counts[c].unread;
          });
          d.unlogged += r.unlogged || 0;
          d.major += r.major || 0;
          d.needs += r.needs;
          d.unread += r.unread;
          d.waiting += r.waiting;
          Object.assign(d.marks, r.marks);
        });
      }
      set({ ov: d, customs: d.customs || S.current.customs });
      if (d.pending) setTimeout(() => S.current.label === 'INBOX' && loadOverview(), 2500);
    });
  };
  const syncSoon = (ms?: number) => {
    clearTimeout(syncT.current);
    syncT.current = window.setTimeout(() => {
      void loadLabels();
      void loadBoxes();
      if (S.current.label === 'INBOX') loadOverview();
    }, ms || 1500);
  };
  const syncFrom = (d: any) => {
    if (d && d.unread != null) {
      const labels = S.current.labels.map((l) => (l.id === 'INBOX' ? { ...l, unread: d.unread, unreadAll: d.all != null ? d.all : l.unreadAll } : l));
      set({ labels });
    }
    void loadBoxes();
    syncSoon();
  };
  const bumpInbox = (d: number) => {
    if (!d) return;
    const labels = S.current.labels.map((l) => (l.id === 'INBOX' ? { ...l, unread: Math.max(0, (l.unread || 0) + d) } : l));
    set({ labels });
    const inbox = labels.find((l) => l.id === 'INBOX');
    if (inbox && !S.current.boxes.length) setRailCount(inbox.unread);
  };

  /* ------------------------------------------------------------------ list */
  const inboxPlain = () => S.current.label === 'INBOX' && !S.current.q;
  const activeFlags = () => ['unread', 'starred', 'files', 'partner'].filter((f) => S.current.flags[f]);
  const effSort = () => S.current.sort || ((S.current.v === 'needs' || S.current.v === 'waiting') && inboxPlain() ? 'old' : 'new');
  const listOpts = () => ({ view: inboxPlain() ? S.current.v : '', flags: activeFlags().filter((f) => f !== 'partner' || inboxPlain()), sort: S.current.sort === 'prio' ? '' : S.current.sort || (effSort() === 'old' ? 'old' : '') } as any);
  const allViews = (): Array<[string, string]> => BASE_VIEWS.concat(S.current.customs.map((c) => ['cat:' + c.id, c.name] as [string, string]), [['waiting', 'Waiting on reply'], ['unlogged', 'Not logged']]);
  const viewCount = (v: string): number | null => {
    const ov = S.current.ov;
    if (!ov) return null;
    if (v === 'needs') return ov.needs;
    if (v === 'waiting') return ov.waiting;
    if (v === 'unlogged') return ov.unlogged || 0;
    if (v.indexOf('cat:') === 0) return (ov.counts[v.slice(4)] || {}).n || 0;
    return null;
  };
  const liveViews = () => allViews().filter((x) => x[0] === '' || S.current.v === x[0] || (viewCount(x[0]) ?? 0) > 0);
  const labelName = (id: string) => (S.current.labels.find((x) => x.id === id) || {}).name || id;
  const viewName = (v: string) => (allViews().find((x) => x[0] === v) || [0, 'Inbox'])[1] as string;
  const listTitle = () => (S.current.q ? 'Search' : inboxPlain() && S.current.v ? viewName(S.current.v) : labelName(S.current.label));
  const findThread = (id: string) => S.current.threads.find((t) => t.id === id) || null;

  const warm = (ids: string[]) => {
    const x = S.current;
    const want = ids.filter((id) => id && !(PRE[id] && Date.now() - PRE[id].at < 90000));
    if (!want.length || !x.level.read || batching.current) return;
    batching.current = true;
    const groups: Record<string, string[]> = {};
    want.forEach((id) => (groups[boxOf(id)] = groups[boxOf(id)] || []).push(id));
    void Promise.all(
      Object.keys(groups).map((a) =>
        api()
          .batch(groups[a].slice(0, 5), a)
          .then((d: any) =>
            (d.threads || []).forEach((t: any) => {
              const data = { thread: t.thread, partners: t.partners, drafts: t.drafts, teamChat: t.teamChat };
              PRE[t.id] = { at: Date.now(), p: Promise.resolve(data) };
              void device.put(t.id, data);
            })
          )
          .catch(() => undefined)
      )
    ).then(() => (batching.current = false));
  };
  const idleFirst = () => {
    const ids = S.current.threads.slice(0, 20).map((t) => t.id);
    let at = 0;
    const seq = listSeq.current;
    const next = () => {
      if (seq !== listSeq.current || document.hidden || at >= ids.length) return;
      batching.current = false;
      warm(ids.slice(at, at + 5));
      at += 5;
      setTimeout(next, 700);
    };
    (window.requestIdleCallback || ((f: () => void) => setTimeout(f, 400)))(next);
  };

  const loadList = (opts: { more?: boolean; quiet?: boolean; noStale?: boolean } = {}) => {
    const seq = ++listSeq.current;
    const x = S.current;
    const asked = x.q && x.q.charAt(0) === '?' ? x.q.slice(1).trim() : '';
    if (!opts.more) {
      x.nexts = {};
      if (!opts.quiet) {
        x.picked = {};
        x.anchor = '';
      }
      if (!opts.quiet || !x.threads.length) x.threads = [];
    }
    set({ loading: true, loadError: '', scanned: 0 });
    const list = accts();
    if (asked) {
      return api()
        .smartSearch(asked, list[0] || '')
        .then((d: any) => {
          if (seq !== listSeq.current) return;
          (d.threads || []).forEach((t: any) => {
            t.mb = list[0] || '';
            mbOf[t.id] = t.mb;
          });
          set({ loading: false, threads: d.threads || [], nexts: {} });
        })
        .catch((e: any) => seq === listSeq.current && set({ loading: false, loadError: e.message }));
    }
    const jobs = list
      .filter((a) => !opts.more || S.current.nexts[a])
      .map((a) => {
        const o = listOpts();
        o.mb = a;
        const p = api().threads(S.current.label, S.current.q, opts.more ? S.current.nexts[a] : '', o).then((d: any) => ({ a, d }));
        return a ? p.catch(() => ({ a, d: { threads: [], next: '' } as any })) : p;
      });
    return Promise.all(jobs)
      .then((rs: any[]) => {
        if (seq !== listSeq.current) return;
        const d = rs[0].d;
        let merged: any[] = [];
        let scanned = 0;
        const nexts: Record<string, string> = opts.more ? { ...S.current.nexts } : {};
        rs.forEach((r) => {
          (r.d.threads || []).forEach((t: any) => {
            t.mb = r.a;
            mbOf[t.id] = r.a;
          });
          merged = merged.concat(r.d.threads || []);
          if (r.d.next) nexts[r.a] = r.d.next;
          else delete nexts[r.a];
          scanned += r.d.scanned || 0;
        });
        const cur = S.current;
        let all = opts.more ? cur.threads.concat(merged) : merged;
        if (list.length > 1 && cur.sort !== 'prio') {
          const asc = effSort() === 'old';
          all.sort((p, q) => (asc ? String(p.date).localeCompare(String(q.date)) : String(q.date).localeCompare(String(p.date))));
        }
        if (cur.sort === 'prio') all = all.slice().sort((p, q) => (q.prio || 0) - (p.prio || 0) || String(q.date).localeCompare(String(p.date)));
        const picked: Record<string, 1> = {};
        Object.keys(cur.picked).forEach((id) => all.some((t) => t.id === id) && (picked[id] = 1));
        set({ loading: false, level: d.level ? { ...cur.level, ...d.level } : cur.level, threads: all, nexts, scanned, picked, sel: Math.min(cur.sel, all.length - 1) });
        if (rs.some((r) => r.d.stale) && !opts.noStale)
          setTimeout(() => seq === listSeq.current && loadList({ quiet: true, noStale: true }), 1500);
        if (inboxPlain() && !opts.more) {
          loadOverview();
          setTimeout(() => loadBrief(), 1200);
        }
        if (!opts.more && S.current.level.read && !S.current.q) idleFirst();
      })
      .catch((e: any) => {
        if (seq !== listSeq.current) return;
        if (e.code === 'mail_scope' || e.code === 'mail_connect') return set({ loading: false, level: { ...S.current.level, read: false } });
        set({ loading: false, loadError: e.message || 'Mail did not load' });
      });
  };

  /* ------------------------------------------------------------------ thread */
  const go = (label: string, q: string, tid: string, replace?: boolean) => {
    let id = tid;
    if (id && id.indexOf('~') < 0 && mbOf[id]) id = id + '~' + mbOf[id];
    const x = S.current;
    const v = label === 'INBOX' && x.label === 'INBOX' && !q ? x.v : '';
    const h = '#/' + (q ? 'search/' + encodeURIComponent(q) : label === 'INBOX' && v ? slugOf(v) : encodeURIComponent(label || 'INBOX')) + (id ? '/' + encodeURIComponent(id) : '');
    if (location.hash === h) return route();
    if (replace) {
      history.replaceState(history.state, '', h);
      route();
    } else location.hash = h;
  };
  const goView = (label: string, v: string) => {
    const h = '#/' + (label === 'INBOX' && v ? slugOf(v) : encodeURIComponent(label));
    if (location.hash === h) return route();
    location.hash = h;
  };

  const openThread = (id: string, focus?: boolean) => {
    const seq = ++threadSeq.current;
    const x = S.current;
    if (x.open !== id) x.exp = {};
    x.open = id;
    const t = findThread(id);
    const sel = t ? x.threads.indexOf(t) : x.sel;
    set({ open: id, sel, view: 'thread', thread: { id, subject: t ? t.subject : '', messages: [] }, threadLoading: true, partners: {}, drafts: {}, headersOnly: false, team: null });
    let shown = '';
    if (!(PRE[id] && Date.now() - PRE[id].at < 90000))
      void device.get(id).then((c) => {
        if (!c || seq !== threadSeq.current || shown) return;
        shown = sigOf(c.data);
        set({ thread: c.data.thread, partners: c.data.partners || {}, drafts: c.data.drafts || {}, headersOnly: false, threadLoading: false, team: null });
      });
    setTimeout(() => {
      const i = S.current.threads.findIndex((r) => r.id === id);
      if (i >= 0) warm([S.current.threads[i + 1], S.current.threads[i - 1], S.current.threads[i + 2]].filter(Boolean).map((r) => r.id));
    }, 120);
    return api()
      .thread(id)
      .then((d: any) => {
        if (seq !== threadSeq.current) return;
        if (!shown || shown !== sigOf(d) || d.headersOnly) set({ thread: d.thread, partners: d.partners || {}, drafts: d.drafts || {}, headersOnly: !!d.headersOnly, threadLoading: false, team: teamOf(d) });
        else set({ threadLoading: false, headersOnly: !!d.headersOnly, team: teamOf(d) });
        if (focus) document.querySelector<HTMLElement>('.ml-thread__h')?.focus({ preventScroll: true });
        const lt = findThread(id);
        const msgs: any[] = d.thread.messages || [];
        const unread = msgs.some((m) => m.unread);
        const counted = msgs.some((m) => m.unread && isPrimary(m.labelIds));
        // Opening marks it read, as Gmail does (only with the person's permission to change mail).
        if (unread && S.current.level.write && canWrite()) {
          void api()
            .modify(id, [], ['UNREAD'])
            .then(() => {
              if (lt) lt.unread = false;
              bumpInbox(counted ? -1 : 0);
              bump();
              syncSoon(1200);
            })
            .catch(() => undefined);
        }
        if (!d.headersOnly && S.current.level.read) loadAssist(id, seq);
        if (pendingReply.current && pendingReply.current.id === id) {
          const pr = pendingReply.current;
          pendingReply.current = null;
          startReply('reply', undefined, pr.text);
        }
      })
      .catch((e: any) => {
        if (seq !== threadSeq.current) return;
        if (e.code === 'mail_scope' || e.code === 'mail_connect') return set({ threadLoading: false, level: { ...S.current.level, read: false } });
        set({ threadLoading: false, loadError: 'This conversation did not open: ' + e.message });
      });
  };

  const route = () => {
    const x = S.current;
    const r = parseHash(x.customs);
    const listChanged = r.label !== x.label || r.q !== x.q || r.v !== x.v || (!x.threads.length && !x.loading);
    x.label = r.label;
    x.q = r.q;
    x.v = r.v;
    if (listChanged) {
      x.sel = -1;
      bump();
      void loadList();
    }
    if (r.thread && (r.box || mbOf[r.thread] == null)) mbOf[r.thread] = r.box || '';
    if (r.thread) {
      if (r.thread !== x.open || x.view !== 'thread') void openThread(r.thread);
    } else set({ open: '', thread: null, view: 'list' });
  };
  const routeRef = useRef(route);
  routeRef.current = route;

  /* ------------------------------------------------------------------ actions */
  const removeFromList = (id: string) => {
    const x = S.current;
    const i = x.threads.findIndex((t) => t.id === id);
    if (i < 0) return null;
    const gone = { t: x.threads[i], i };
    x.threads = x.threads.filter((t) => t.id !== id);
    delete x.picked[id];
    bump();
    return gone;
  };
  const putBack = (gone: { t: any; i: number } | null) => {
    if (!gone) return;
    S.current.threads.splice(Math.min(gone.i, S.current.threads.length), 0, gone.t);
    bump();
  };
  const afterLeave = (id: string) => {
    const x = S.current;
    if (x.open !== id) return;
    const n = x.threads[Math.min(x.sel < 0 ? 0 : x.sel, x.threads.length - 1)];
    if (isPhone() || !n) go(x.label, x.q, '', true);
    else go(x.label, x.q, n.id, true);
  };
  const curId = (id?: string) => id || S.current.open || (S.current.threads[S.current.sel] && S.current.threads[S.current.sel].id) || '';

  const act = (kind: string, idIn?: string, anchor?: HTMLElement) => {
    const x = S.current;
    if (kind === 'back') return go(x.label, x.q, '');
    if (kind === 'prev' || kind === 'next') return stepThread(kind === 'next' ? 1 : -1);
    if (kind === 'compose') return openCompose();
    if (kind === 'thread-more') return openSmart('more', undefined, anchor);
    const id = curId(idIn);
    if (!id) return;
    if (!x.level.write || !canWrite()) return askWrite(kind);
    const t = findThread(id);
    if (kind === 'archive' || kind === 'delete') {
      const wasUnread = !!(t && t.unread && isPrimary(t.labelIds));
      const gone = x.label === 'INBOX' || kind === 'delete' || x.label === 'SNOOZED' ? removeFromList(id) : null;
      afterLeave(id);
      if (wasUnread) bumpInbox(-1);
      const p = kind === 'archive' ? api().modify(id, [], ['INBOX']) : api().trash(id);
      p.then(() => {
        say(kind === 'archive' ? 'Archived' : 'Moved to Trash', () => {
          (kind === 'archive' ? api().modify(id, ['INBOX'], []) : api().untrash(id))
            .then(() => {
              putBack(gone);
              if (wasUnread) bumpInbox(1);
              say(kind === 'archive' ? 'Back in Inbox' : 'Back from Trash');
            })
            .catch((e: any) => failed(e));
        });
      }).catch((e: any) => {
        putBack(gone);
        if (wasUnread) bumpInbox(1);
        failed(e, kind);
      });
      return;
    }
    if (kind === 'to-inbox' || kind === 'untrash') {
      (kind === 'untrash' ? api().untrash(id) : api().modify(id, ['INBOX'], []))
        .then(() => {
          say('Moved to Inbox');
          if (S.current.label === 'TRASH' || S.current.label === 'SPAM') {
            removeFromList(id);
            afterLeave(id);
          } else if (S.current.open === id) void openThread(id);
        })
        .catch((e: any) => failed(e));
      return;
    }
    if (kind === 'star') {
      const on = t ? !t.starred : !toolsOf(x.thread).starred;
      if (t) t.starred = on;
      if (x.thread && x.thread.id === id)
        x.thread.messages.forEach((m: any) => {
          m.starred = on;
          m.labelIds = on ? m.labelIds.concat(['STARRED']) : m.labelIds.filter((l: string) => l !== 'STARRED');
        });
      bump();
      api()
        .modify(id, on ? ['STARRED'] : [], on ? [] : ['STARRED'])
        .catch((e: any) => {
          if (t) t.starred = !on;
          bump();
          failed(e);
        });
      return;
    }
    if (kind === 'unread' || kind === 'read' || kind === 'toggle-read') {
      const makeUnread = kind === 'unread' || (kind === 'toggle-read' && (x.open === id || !(t && t.unread)));
      if (t) t.unread = makeUnread;
      bump();
      api()
        .modify(id, makeUnread ? ['UNREAD'] : [], makeUnread ? [] : ['UNREAD'])
        .then(() => {
          if (t ? isPrimary(t.labelIds) : toolsOf(S.current.thread).inInbox) bumpInbox(makeUnread ? 1 : -1);
          if (makeUnread && S.current.open === id) go(S.current.label, S.current.q, '', false);
          say(makeUnread ? 'Marked as unread' : 'Marked as read');
        })
        .catch((e: any) => {
          if (t) t.unread = !makeUnread;
          bump();
          failed(e);
        });
      return;
    }
    if (kind === 'snooze') return set({ sheet: { kind: 'snooze', anchor, data: { ids: [id] } } });
    if (kind === 'labels') return set({ sheet: { kind: 'labels', anchor, data: { ids: [id] } } });
  };

  const stepThread = (d: number) => {
    const x = S.current;
    if (!x.threads.length) return;
    const i = x.open ? x.threads.findIndex((t) => t.id === x.open) : x.sel;
    const n = Math.max(0, Math.min(x.threads.length - 1, (i < 0 ? -1 : i) + d));
    if (x.open) go(x.label, x.q, x.threads[n].id, true);
    else set({ sel: n });
  };

  const followUp = (id: string) => {
    const t = findThread(id);
    const p = t && t.people && t.people[0];
    const first = ((p && p.name) || '').replace(/^To: /, '').split(/\s+/)[0] || 'there';
    pendingReply.current = { id, text: 'Hi ' + first + ',' + String.fromCharCode(10, 10) + 'I am following up on my last note. Where does this stand on your side?' };
    go(S.current.label, S.current.q, id);
  };
  const pickedIds = () => Object.keys(S.current.picked);
  const setPick = (id: string, on: boolean) => {
    if (on) S.current.picked[id] = 1;
    else delete S.current.picked[id];
    bump();
  };
  const pick = (id: string, range: boolean) => {
    const x = S.current;
    if (range && x.anchor) {
      const a = x.threads.findIndex((t) => t.id === x.anchor);
      const b = x.threads.findIndex((t) => t.id === id);
      if (a >= 0 && b >= 0) {
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) x.picked[x.threads[i].id] = 1;
        bump();
        return;
      }
    }
    x.anchor = id;
    setPick(id, !x.picked[id]);
  };
  const clearPicks = () => set({ picked: {}, anchor: '' });
  const bulk = (body: any) => {
    const first = (body.ids || [])[0];
    const mb = first ? boxOf(first) : '';
    return api().bulk(body, mb);
  };
  const selAct = (kind: string, anchor?: HTMLElement) => {
    const x = S.current;
    const ids = pickedIds();
    if (!ids.length) return;
    if (!x.level.write || !canWrite()) return askWrite(kind);
    const rows = ids.map(findThread).filter(Boolean) as any[];
    const plural = ids.length === 1 ? '1 conversation' : ids.length + ' conversations';
    const unreadPrimary = rows.filter((t) => t.unread && isPrimary(t.labelIds)).length;
    if (kind === 'archive' || kind === 'trash') {
      const leaves = kind === 'trash' || x.label === 'INBOX' || x.label === 'SNOOZED';
      const gone: Array<{ t: any; i: number }> = [];
      if (leaves) {
        ids.forEach((id) => {
          const i = x.threads.findIndex((t) => t.id === id);
          if (i >= 0) gone.push({ t: x.threads[i], i });
        });
        x.threads = x.threads.filter((t) => ids.indexOf(t.id) < 0);
        if (x.open && ids.indexOf(x.open) >= 0) go(x.label, x.q, '', true);
      } else rows.forEach((t) => (t.labelIds = (t.labelIds || []).filter((l: string) => l !== 'INBOX')));
      set({ picked: {}, anchor: '' });
      bumpInbox(-unreadPrimary);
      const back = () => {
        gone.sort((a, b) => a.i - b.i).forEach((g) => S.current.threads.splice(Math.min(g.i, S.current.threads.length), 0, g.t));
        bump();
      };
      bulk({ ids, action: kind })
        .then((d: any) => {
          syncFrom(d);
          if (d.failed) {
            say(d.failed + ' did not change. Try those again.');
            loadList({ quiet: true });
            return;
          }
          say((kind === 'archive' ? 'Archived ' : 'Moved to Trash: ') + plural, () =>
            bulk({ ids, action: kind === 'archive' ? 'inbox' : 'untrash' })
              .then((d2: any) => {
                back();
                bumpInbox(unreadPrimary);
                syncFrom(d2);
                say('Back where they were');
              })
              .catch((e: any) => failed(e))
          );
        })
        .catch((e: any) => {
          back();
          bumpInbox(unreadPrimary);
          failed(e, kind);
        });
      return;
    }
    if (kind === 'read' || kind === 'unread') {
      const on = kind === 'unread';
      let delta = 0;
      rows.forEach((t) => {
        if (!!t.unread !== on) {
          if (isPrimary(t.labelIds)) delta += on ? 1 : -1;
          t.unread = on;
        }
      });
      bump();
      bumpInbox(delta);
      bulk({ ids, action: kind })
        .then((d: any) => {
          syncFrom(d);
          say(on ? 'Marked as unread' : 'Marked as read');
        })
        .catch((e: any) => {
          rows.forEach((t) => (t.unread = !on));
          bumpInbox(-delta);
          failed(e, kind);
        });
      return;
    }
    if (kind === 'star') {
      const all = rows.every((t) => t.starred);
      rows.forEach((t) => (t.starred = !all));
      bump();
      bulk({ ids, action: all ? 'unstar' : 'star' }).catch((e: any) => {
        rows.forEach((t) => (t.starred = all));
        bump();
        failed(e, kind);
      });
      return;
    }
    if (kind === 'label') return set({ sheet: { kind: 'labels', anchor, data: { ids } } });
    if (kind === 'snooze') return set({ sheet: { kind: 'snooze', anchor, data: { ids } } });
  };

  /* ------------------------------------------------------------------ compose and send */
  // Replies open inline under the conversation and new mail in a window, both in the shared composer (public/js/compose/compose.js),
  // which stays open across routes. The older Compose window below is the fallback when that script cannot load.
  const openCompose = (o: ComposeInit = {}, where: { inline?: boolean; kind?: string; items?: any[] } = {}) => {
    if (!S.current.level.write || !canWrite()) return askWrite('compose');
    if (S.current.fromOpts == null && S.current.boxes.length) void api().from().then((d: any) => set({ fromOpts: d.from || [] })).catch(() => undefined);
    const x = S.current;
    void loadScript(COMPOSE_JS)
      .then(() => {
        const fc = window.FavorCompose;
        if (!fc) throw new Error('no composer');
        const host = where.inline && x.thread && o.threadId === x.thread.id ? document.querySelector<HTMLElement>('.ml-thread[data-thread] [data-inline-host]') : null;
        void fc.open({ ...o, mode: host ? 'inline' : 'float', host, kind: where.kind || '', items: where.items, ctx: { me: x.me, name: x.name, signature: x.signature, fromOpts: x.fromOpts, write: !!(x.level.write && canWrite()), read: !!x.level.read, box: x.box } });
      })
      .catch(() => {
        setCompose(o);
        if (isPhone()) history.pushState({ mlCompose: 1 }, '');
      });
  };
  const startReply = (kind: 'reply' | 'replyall' | 'forward', mIn?: any, text?: string, pop?: boolean, items?: any[]) => {
    const x = S.current;
    if (!x.level.write || !canWrite()) return askWrite('reply');
    const t = x.thread;
    const msgs: any[] = (t && t.messages) || [];
    const m = mIn || msgs.filter((q) => !q.draft).slice(-1)[0];
    if (!m) return;
    const line = (k: string, v: string) => (v ? '<div>' + k + ': ' + v + '</div>' : '');
    const list = (l: any[]) => (l || []).map((a) => escH(who(a)) + ' &lt;' + escH(a.email) + '&gt;').join(', ');
    if (kind === 'forward') {
      return openCompose({
        title: 'Forward',
        subject: reSubject(m.subject || t.subject, 'Fwd'),
        quote:
          '<br><div class="gmail_quote"><div>---------- Forwarded message ---------</div>' + line('From', escH(who(m.from)) + ' &lt;' + escH(m.from.email) + '&gt;') + line('Date', escH(when(m.date, true))) + line('Subject', escH(m.subject)) + line('To', list(m.to)) + line('Cc', list(m.cc)) + '<br>' + (m.html || escH(m.text || '')) + '</div>',
        forward: (m.attachments || []).filter((f: any) => !f.inline).map((f: any) => ({ messageId: m.id, attachmentId: f.id, name: f.name, mime: f.mime, size: f.size })),
        mb: boxOf(t.id),
        threadId: t.id,
      }, { inline: !pop, kind: 'fwd', items });
    }
    const all = replyAllList(m, x.me);
    let to: any[] = kind === 'replyall' ? all : [(m.replyTo && m.replyTo[0]) || (m.from.email === x.me ? (m.to || [])[0] : m.from)];
    let cc: any[] = [];
    if (kind === 'replyall' && all.length > 1) {
      to = [all[0]];
      cc = all.slice(1);
    }
    openCompose({
      title: kind === 'replyall' ? 'Reply all' : 'Reply',
      to: to.filter(Boolean),
      cc,
      subject: reSubject(m.subject || t.subject, 'Re'),
      quote:
        '<br><div class="gmail_quote"><div>On ' + escH(when(m.date, true)) + ', ' + escH(who(m.from)) + ' &lt;' + escH(m.from.email) + '&gt; wrote:</div><blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">' + (m.html || escH(m.text || '')) + '</blockquote></div>',
      threadId: t.id,
      replyTo: m.id,
      mb: boxOf(t.id),
      body: text ? '<div>' + escH(text).split(String.fromCharCode(10)).join('<br>') + '</div><div><br></div>' + (x.signature ? '<br><div class="gmail_signature">' + x.signature + '</div>' : '') : undefined,
    }, { inline: !pop, kind: 'reply', items });
  };
  const editDraft = (mid: string) => {
    const x = S.current;
    const m = ((x.thread && x.thread.messages) || []).find((q: any) => q.id === mid);
    if (!m) return;
    const real = x.thread.messages.filter((q: any) => !q.draft);
    openCompose({ title: real.length ? 'Reply' : 'Draft', to: m.to, cc: m.cc, bcc: m.bcc, subject: m.subject, body: m.html || '', draftId: x.drafts[m.id] || '', threadId: real.length ? x.thread.id : '', replyTo: real.length ? real[real.length - 1].id : '', mb: boxOf(x.thread.id), noSig: true }, { inline: !!real.length, kind: 'reply' });
  };
  const dropDraft = (mid: string) => {
    const x = S.current;
    const did = x.drafts[mid];
    if (!did) return;
    api()
      .dropDraft(did, boxOf(x.open))
      .then(() => {
        say('Draft discarded');
        if (x.open) void openThread(x.open);
      })
      .catch((e: any) => failed(e));
  };
  const closeCompose = (quiet?: boolean) => {
    setCompose(null);
    if (isPhone() && !quiet && history.state && history.state.mlCompose) history.back();
  };

  const [warnings, setWarnings] = useState<null | { list: any[]; go: () => void }>(null);
  const countdownOn = () => {
    try {
      return localStorage.getItem('favor.mail.countdown') !== 'off';
    } catch {
      return true;
    }
  };
  const doSend = (b: Outgoing) => {
    const files = b.files.map((f) => ({ name: f.name, mime: f.mime, data: f.data }));
    const payload: any = { to: b.to, cc: b.cc, bcc: b.bcc, subject: b.subject, html: b.html, threadId: b.threadId, replyTo: b.replyTo, draftId: b.draftId, mb: b.mb, from: b.from, files, forward: b.forward };
    const restore = () => {
      setCompose({ ...b.init, to: b.to, cc: b.cc, bcc: b.bcc, subject: b.subject, body: b.html, quote: '', draftId: b.draftId, mb: b.mb, noSig: true, files: b.files, forward: b.forward });
    };
    closeCompose(true);
    const hasFiles = files.length || b.forward.length;
    const held: Promise<string | null> = hasFiles ? Promise.resolve(null) : api().hold(payload).then((d: any) => d.id as string).catch(() => null);
    let undone = false;
    let released = false;
    const finish = (d: any) => {
      say('Sent');
      const x = S.current;
      if (x.open && d && d.threadId === x.open) void openThread(x.open);
      else if (x.label === 'SENT') void loadList({ quiet: true });
    };
    const fail = (e: any) => {
      say(e.message || 'Not sent. Your draft is kept.');
      if (e.code === 'mail_scope') askWrite('send');
    };
    const release = () => {
      if (undone || released) return;
      released = true;
      void held.then((id) => (id ? api().release(id, b.mb) : api().send(payload))).then(finish).catch(fail);
    };
    say(
      'Sending',
      () => {
        if (released) return;
        undone = true;
        void held
          .then((id) => (id ? api().cancelHold(id, b.mb) : null))
          .then((r: any) => {
            if (r && r.undone === false) return say('It already went');
            restore();
          })
          .catch(restore);
      },
      HOLD_MS
    );
    setTimeout(release, HOLD_MS);
    // Leaving the page ends the undo window: the server sends the held message now.
    const onHide = () => {
      window.removeEventListener('pagehide', onHide);
      if (undone || released) return;
      void held.then((id) => {
        if (id && navigator.sendBeacon) navigator.sendBeacon('/api/mail/hold/' + encodeURIComponent(id) + '/release' + (b.mb ? '?mb=' + encodeURIComponent(b.mb) : ''), new Blob(['{}'], { type: 'application/json' }));
      });
    };
    window.addEventListener('pagehide', onHide);
  };
  const onSend = (b: Outgoing) => {
    setCompose(b.init);
    api()
      .check({ to: b.to.map((x) => x.email), cc: b.cc.map((x) => x.email), bcc: b.bcc.map((x) => x.email), subject: b.subject, html: b.html, files: b.files.length + b.forward.length, threadId: b.threadId, mb: b.mb })
      .then((d: any) => {
        if (!(d.warnings || []).length) return doSend(b);
        setWarnings({ list: d.warnings, go: () => doSend(b) });
      })
      .catch(() => doSend(b));
  };

  /* ------------------------------------------------------------------ smart side: assist, briefing, entities, hand-offs */
  const ET = (iso?: string) => new Date(iso || Date.now()).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const hubAccess = (): Record<string, boolean> => {
    try {
      const nv = JSON.parse(localStorage.getItem('favor.hub.nav.v1') || 'null');
      return (nv && nv.access) || {};
    } catch {
      return {};
    }
  };
  const partnerOf = (t: any) => {
    const x = S.current;
    const msgs: any[] = (t && t.messages) || [];
    for (const m of msgs) {
      const p = x.partners[(m.from || {}).email];
      if (p) return { email: m.from.email, ...p };
    }
    const k = Object.keys(x.partners)[0];
    return k ? { email: k, ...x.partners[k] } : null;
  };
  const lastMsg = () => {
    const t = S.current.thread;
    return t ? (t.messages || []).filter((m: any) => !m.draft).slice(-1)[0] : null;
  };
  const hashFor = (id: string) => '#/' + (S.current.q ? 'search/' + encodeURIComponent(S.current.q) : encodeURIComponent(S.current.label)) + '/' + encodeURIComponent(id);

  const patchAssist = (p: Partial<AssistState>) => {
    if (!S.current.assist) return;
    S.current.assist = { ...S.current.assist, ...p };
    bump();
  };
  const loadAssist = (id: string, seq: number) => {
    const x = S.current;
    const th = findThread(id);
    x.assist = { id, summary: '', replies: [], ask: false, card: null, loading: true, gift: null, commitments: [], profile: null, files: {}, answer: '', major: !!(th && th.major) };
    x.tl = null;
    bump();
    const live = () => seq === threadSeq.current && S.current.assist && S.current.assist.id === id;
    api()
      .assist(id)
      .then((a: any) => live() && patchAssist({ summary: a.summary || '', replies: a.replies || [], ask: !!a.ask, loading: false, gift: a.gift || null, commitments: a.commitments || [] }))
      .catch(() => live() && patchAssist({ loading: false }));
    const p = partnerOf(x.thread);
    if (p && hubAccess().workCenter)
      api()
        .partner(p.id)
        .then((d: any) => live() && patchAssist({ card: d.partner }))
        .catch(() => undefined);
    const m = ((x.thread && x.thread.messages) || []).filter((q: any) => !q.draft && q.from && q.from.email !== x.me).slice(-1)[0];
    if (m)
      api()
        .sender(m.from.email, m.from.name, boxOf(id))
        .then((d: any) => live() && patchAssist({ profile: d.profile }))
        .catch(() => undefined);
    const files: Array<{ m: any; f: any }> = [];
    ((x.thread && x.thread.messages) || []).forEach((q: any) => (q.attachments || []).forEach((f: any) => (!f.inline || !/^image\//.test(f.mime)) && files.push({ m: q, f })));
    files.slice(0, 3).forEach((q) =>
      api()
        .readFile(q.m.id, q.f, x.thread.subject, id)
        .then((r: any) => live() && patchAssist({ files: { ...(S.current.assist as AssistState).files, [q.m.id + '|' + q.f.id]: r } }))
        .catch(() => undefined)
    );
  };
  const loadBrief = (fresh?: boolean) => {
    const x = S.current;
    if (!x.level.read || !inboxPlain() || x.v) return;
    api()
      .briefing(!!fresh, accts()[0] || '')
      .then((d: any) => set({ brief: d.briefing }))
      .catch(() => set({ briefFailed: true }));
  };
  const loadNames = () => {
    const x = S.current;
    if (x.names || !x.level.read) return;
    x.names = [];
    api()
      .entityNames()
      .then((d: any) => set({ names: d.funds || [] }))
      .catch(() => undefined);
  };
  const entCache = useRef<Record<string, Promise<any>>>({});
  const [tip, setTip] = useState<null | { c: any; x: number; y: number }>(null);
  const entityApi = {
    names: s.names || [],
    load: (kind: string, key: string) => {
      const k = kind + '|' + key;
      if (!entCache.current[k]) {
        const FE = (window as any).FavorEntity;
        if (kind === 'appeal' && !window.__mailMock && FE && FE.load)
          entCache.current[k] = FE.load('appeal', key)
            .then((it: any) => (!it || it.restricted ? null : { kind, key, title: it.title, sub: it.sub, lines: (it.facts || []).map((f: any) => ({ k: f.k, v: f.v })), href: it.url || '' }))
            .catch(() => null);
        else
          entCache.current[k] = api()
            .entity(kind, key)
            .then((d: any) => d.card)
            .catch(() => null);
      }
      return entCache.current[k];
    },
    open: (c: any) => set({ sheet: { kind: 'entity', data: c } }),
    tip: (c: any, rect: DOMRect | null) => setTip(c && rect ? { c, x: Math.max(8, Math.min(innerWidth - 300, rect.left)), y: Math.min(innerHeight - 170, rect.bottom + 6) } : null),
  };
  const viewFile = (m: any, f: any, files: any[]) => {
    const A = api();
    const mb = boxOf(S.current.thread.id);
    const kindOf2 = (mime: string, name: string) => (/^image\//.test(mime || '') || /\.(png|jpe?g|gif|webp)$/i.test(name || '') ? 'image' : /pdf/i.test((mime || '') + name) ? 'pdf' : /wordprocessingml|\.docx\b/i.test((mime || '') + name) ? 'docx' : /spreadsheetml|\.xlsx\b|\.csv\b/i.test((mime || '') + name) ? 'xlsx' : /^video\//.test(mime || '') ? 'video' : /^audio\//.test(mime || '') ? 'audio' : 'file');
    const kind = kindOf2(f.mime, f.name);
    const item = { kind, url: A.fileUrl(m.id, f, false, mb), name: f.name, sub: Math.round((f.size || 0) / 1024) + ' KB', download: A.fileUrl(m.id, f, true, mb) };
    const V = (window as any).FavorChatView;
    if (kind === 'video' || kind === 'audio') return set({ sheet: { kind: 'media', data: item } });
    if (!V || kind === 'file') {
      location.href = item.download;
      return;
    }
    if (kind === 'image') {
      const pics = files.filter((q) => kindOf2(q.mime, q.name) === 'image').map((q) => ({ kind: 'image', url: A.fileUrl(m.id, q, false, mb), name: q.name, download: A.fileUrl(m.id, q, true, mb) }));
      return V.open(pics.find((q: any) => q.name === f.name) || item, pics);
    }
    V.open(item);
  };
  const logOneQuick = () => {
    const p = partnerOf(S.current.thread);
    const t = S.current.thread;
    if (!p || !t || (S.current.assist && S.current.assist.logged)) return;
    api()
      .owners()
      .then((d: any) => {
        const mine = (d.owners || []).find((o: any) => o.fid === d.mine);
        if (!mine) return set({ sheet: { kind: 'log-action' } });
        const m = lastMsg();
        const date = ET(m && m.date);
        return api()
          .logAction({ owner: mine.fid, date, channel: 'email', summary: ('Email: ' + (t.subject || '')).slice(0, 255), tags: [], constituent_ids: [String(p.id)], req: 'mail-' + t.id + '-' + p.id + '-' + date })
          .then((r: any) => {
            void api().logged(t.id, p.id).catch(() => undefined);
            patchAssist({ logged: true });
            say(r.dups && !r.created ? 'Already logged' : 'Logged on ' + (p.name || 'the partner'));
            loadOverview();
          });
      })
      .catch((e: any) => say(e.message || 'That did not log. Try again.'));
  };
  const showTimeline = () => {
    const x = S.current;
    const p = partnerOf(x.thread);
    if (!p) return;
    if (x.tl && x.tl.open) return set({ tl: { open: false } });
    set({ tl: { open: true } });
    api()
      .timeline(p.id, p.email, x.open)
      .then((d: any) => set({ tl: { open: true, items: d.items || [] } }))
      .catch((e: any) => set({ tl: { open: true, error: e.message } }));
  };
  const giftNote = () => {
    const p = partnerOf(S.current.thread);
    const a = S.current.assist;
    if (!p || !a || !a.gift) return;
    if (!window.confirm('Add an action to ' + (p.name || 'the partner') + ' in Blackbaud: expected gift of $' + Math.round(a.gift.amount).toLocaleString('en-US') + '?')) return;
    api()
      .owners()
      .then((d: any) => {
        const mine = (d.owners || []).find((o: any) => o.fid === d.mine) || (d.owners || [])[0];
        if (!mine) throw new Error('Action entry is not open to you.');
        const date = ET();
        return api().logAction({ owner: mine.fid, date, channel: 'email', summary: ('Expected gift $' + Math.round(a.gift.amount).toLocaleString('en-US') + ' (email)').slice(0, 255), tags: [], constituent_ids: [String(p.id)], req: 'mail-gift-' + S.current.thread.id + '-' + p.id + '-' + date });
      })
      .then(() => say('Expected gift noted on ' + (p.name || 'the partner')))
      .catch((e: any) => say(e.message || 'That did not save.'));
  };
  const giftChat = () => {
    const p = partnerOf(S.current.thread);
    const a = S.current.assist;
    if (!p || !a || !a.gift) return;
    api()
      .chatBoot()
      .then((d: any) => {
        const ch = (d.channels || []).find((c: any) => /partner.?care/i.test(c.name || ''));
        if (!ch) return say('No Partner Care channel to post in. Use Send to Chat.');
        const amt = '$' + Math.round(a.gift.amount).toLocaleString('en-US');
        if (!window.confirm('Post in #' + ch.name + ': ' + (p.name || 'A partner') + ' mentions a ' + amt + ' gift?')) return;
        return api().chatSend(ch.id, (p.name || 'A partner') + ' emailed about a ' + amt + ' gift. Expect it. I have it from here.').then(() => say('Partner Care told'));
      })
      .catch((e: any) => say(e.message || 'That did not post.'));
  };
  const commitTask = (i: number) => {
    const a = S.current.assist;
    const c = a && a.commitments[i];
    const t = S.current.thread;
    if (!a || !c) return;
    const b: any = { title: c.text.slice(0, 200), description: 'From my email "' + (t.subject || '') + '"\n\n' + location.origin + '/mail/' + hashFor(t.id), owner_email: S.current.me };
    if (c.due) b.due_date = c.due;
    api()
      .task(b)
      .then((d: any) => {
        say('Task made' + (d.task && d.task.code ? ' ' + d.task.code : ''));
        patchAssist({ commitments: a.commitments.filter((_, k) => k !== i) });
      })
      .catch((er: any) => say(er.status === 404 || er.status === 403 ? 'Projects is not open to you yet' : er.message));
  };
  const addProspect = () => {
    const pr = S.current.assist && S.current.assist.profile;
    const t = S.current.thread;
    if (!pr) return;
    if (!window.confirm('Make a task for Support to add ' + (pr.name || pr.email) + ' as a prospect in Blackbaud?')) return;
    api()
      .task({ title: 'Add ' + (pr.name || pr.email) + ' as a prospect in Blackbaud', description: 'Email ' + pr.email + '. From my email "' + (t.subject || '') + '"\n\n' + location.origin + '/mail/' + hashFor(t.id), owner_email: S.current.me })
      .then(() => say('Task made'))
      .catch((er: any) => say(er.status === 404 || er.status === 403 ? 'Projects is not open to you yet' : er.message));
  };
  const askAbout = (q: string) => {
    const x = S.current;
    patchAssist({ answer: 'Reading the conversation' });
    api()
      .ask(x.open, q)
      .then((d: any) => patchAssist({ answer: d.answer }))
      .catch((e: any) => patchAssist({ answer: e.message }));
  };
  const askBrain = (q?: string) => {
    const t = S.current.thread;
    const m = lastMsg();
    if (!t) return;
    const text = (q || 'What should I do about this email?') + '\n\nThe email: "' + (t.subject || '') + '" from ' + who(m && m.from) + ' on ' + when(m && m.date, true) + '. ' + String((m && m.snippet) || '').slice(0, 300);
    window.open('/brain/?ask=' + encodeURIComponent(text.slice(0, 590)), '_blank', 'noopener');
  };
  const unsubscribe = () => {
    const t = S.current.thread;
    if (!t) return;
    const m = (t.messages || []).filter((x: any) => x.unsubscribe && (x.unsubscribe.url || x.unsubscribe.mailto)).slice(-1)[0];
    if (!m) return say('This sender gave no unsubscribe address');
    const u = m.unsubscribe;
    if (u.url) window.open(u.url, '_blank', 'noopener');
    else {
      const addr = u.mailto.replace(/^mailto:/i, '').split('?')[0];
      if (!window.confirm('Send an unsubscribe email to ' + addr + '?')) return;
      api()
        .send({ to: [{ email: addr, name: '' }], subject: 'unsubscribe', html: '<p>unsubscribe</p>', mb: boxOf(t.id) })
        .then(() => say('Unsubscribe sent'))
        .catch((e: any) => failed(e));
    }
    act('archive');
  };
  const nudgeKey = () => ET().slice(0, 8) + Math.floor(Number(ET().slice(8, 10)) / 7);
  const hiddenToday = (k: string) => {
    try {
      return sessionStorage.getItem(k) === ET();
    } catch {
      return false;
    }
  };
  const hideToday = (k: string) => {
    try {
      sessionStorage.setItem(k, ET());
    } catch {
      // private mode
    }
    set({ briefGone: Date.now() });
  };
  // Closing the briefing keeps the date of the newest important message (people, partners, staff) in this browser and, through the
  // server, for the person on every device. The card comes back only when something newer and important arrives.
  const briefClosedKey = (): string | null => {
    try {
      return localStorage.getItem('favor.mail.briefoff:' + (S.current.me || ''));
    } catch {
      return null;
    }
  };
  const briefHidden = (b: any): boolean => {
    const k = briefClosedKey();
    if (!b) return k !== null;
    return !!b.off || (k !== null && String(b.key || '') <= k);
  };
  const closeBrief = () => {
    const b = S.current.brief;
    const key = (b && b.key) || '';
    try {
      localStorage.setItem('favor.mail.briefoff:' + (S.current.me || ''), key);
    } catch {
      // private mode
    }
    if (b) S.current.brief = { ...b, off: true };
    api()
      .briefClose(key, accts()[0] || '')
      .catch(() => undefined);
    set({ briefGone: Date.now() });
  };
  const archiveMany = (ids: string[]) => {
    set({ sheet: null });
    const x = S.current;
    const gone: Array<{ t: any; i: number }> = [];
    ids.forEach((id) => {
      const i = x.threads.findIndex((t) => t.id === id);
      if (i >= 0) gone.push({ t: x.threads[i], i });
    });
    x.threads = x.threads.filter((t) => ids.indexOf(t.id) < 0);
    bump();
    const back = () => {
      gone.sort((a, b) => a.i - b.i).forEach((g) => S.current.threads.splice(Math.min(g.i, S.current.threads.length), 0, g.t));
      bump();
    };
    bulk({ ids, action: 'archive' })
      .then((d: any) => {
        syncFrom(d);
        say('Archived ' + ids.length + ' conversations', () =>
          bulk({ ids, action: 'inbox' })
            .then((d2: any) => {
              back();
              syncFrom(d2);
              loadOverview();
            })
            .catch((e: any) => failed(e))
        );
        loadOverview();
      })
      .catch((e: any) => {
        back();
        failed(e, 'archive');
      });
  };
  const openSmart = (kind: string, data?: any, anchor?: HTMLElement | null) => {
    if (kind === 'unsub') return unsubscribe();
    if (kind === 'ask-brain') return askBrain();
    set({ sheet: { kind, data, anchor } });
  };

  /* ------------------------------------------------------------------ boot, polling, keys */
  useEffect(() => {
    let dead = false;
    void (async () => {
      await mailApi();
      if (dead) return;
      const r = parseHash([]);
      Object.assign(S.current, { label: r.label, q: r.q, v: r.v });
      bump();
      try {
        const d: any = await getApi().state();
        if (dead) return;
        setMe(d.email);
        const level = d.level || S.current.level;
        set({ me: d.email, name: d.name, boxes: d.mailboxes || [], level, write: d.write !== false, connected: d.connected, signature: d.signature || '', ready: true, error: '' });
        if (!d.connected || (!level.headers && !level.read)) return;
        device.sweep();
        void loadBoxes();
        void loadLabels();
        loadNames();
        route();
      } catch (e: any) {
        if (!dead) set({ ready: true, error: e.status === 403 ? 'Mail is not open to you yet' : 'Mail did not load: ' + e.message });
      }
    })();
    const onHash = () => routeRef.current();
    window.addEventListener('hashchange', onHash);
    const refresh = () => {
      const x = S.current;
      if (document.hidden || !x.connected) return;
      void loadLabels();
      if (x.view === 'list' && !x.q && !x.sheet && Object.keys(x.picked).length === 0) loadList({ quiet: true });
    };
    const iv = setInterval(refresh, 60000);
    const vis = () => !document.hidden && refresh();
    document.addEventListener('visibilitychange', vis);
    return () => {
      dead = true;
      window.removeEventListener('hashchange', onHash);
      clearInterval(iv);
      document.removeEventListener('visibilitychange', vis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const typing = (t: any) => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const key = (e: KeyboardEvent) => {
      const x = S.current;
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (typing(e.target) || compose || x.sheet || warnings) return;
      if (document.querySelector('.cmdk[open], .cmdk.is-open, dialog[open]')) return;
      const cur = () => x.threads[x.sel];
      const picked = () => pickedIds().length > 0;
      const map: Record<string, () => void> = {
        j: () => stepThread(1),
        k: () => stepThread(-1),
        o: () => cur() && go(x.label, x.q, cur().id),
        Enter: () => !x.open && cur() && go(x.label, x.q, cur().id),
        u: () => x.open && go(x.label, x.q, ''),
        Escape: () => (picked() ? clearPicks() : x.open ? go(x.label, x.q, '') : undefined),
        z: () => {
          const u = lastUndo.current;
          if (u && Date.now() - u.at < u.ms + 1000) {
            lastUndo.current = null;
            u.fn();
          }
        },
        x: () => {
          if (x.open && !isPhone()) return;
          const t = x.threads[x.sel < 0 ? 0 : x.sel];
          if (t) {
            if (x.sel < 0) x.sel = 0;
            pick(t.id, false);
          }
        },
        e: () => (picked() ? selAct('archive') : act('archive')),
        '#': () => (picked() ? selAct('trash') : act('delete')),
        s: () => (picked() ? selAct('star') : act('star')),
        U: () => (picked() ? selAct('unread') : act('unread')),
        I: () => (picked() ? selAct('read') : act('read')),
        r: () => x.thread && startReply('reply'),
        a: () => x.thread && startReply('replyall'),
        f: () => x.thread && startReply('forward'),
        c: () => openCompose(),
        '/': () => {
          if (isPhone() && x.view !== 'list') go(x.label, x.q, '');
          searchRef.current?.focus();
          searchRef.current?.select();
        },
        b: () => x.open && act('snooze'),
        l: () => x.open && act('labels'),
        '?': () => set({ sheet: { kind: 'keys' } }),
      };
      const fn = map[e.key];
      if (!fn) return;
      if (e.key === 'Enter' && (e.target as HTMLElement).closest?.('a,button')) return;
      e.preventDefault();
      fn();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });

  useEffect(() => installTips(), []);

  // The shared composer sent something: the conversation or the Sent list shows it. Another part of FavorOS can ask for a reply here.
  useEffect(() => {
    const sent = (e: Event) => {
      const d = ((e as CustomEvent).detail || {}) as { threadId?: string };
      window.setTimeout(() => {
        const x = S.current;
        if (x.open && d.threadId === x.open) void openThread(x.open);
        else if (x.label === 'SENT' || x.label === 'DRAFT') void loadList({ quiet: true });
      }, 600);
    };
    const reply = (e: Event) => {
      const d = ((e as CustomEvent).detail || {}) as { threadId?: string; kind?: 'reply' | 'replyall' | 'forward'; items?: any[] };
      const x = S.current;
      if (!x.thread || (d.threadId && d.threadId !== x.thread.id)) return;
      startReply(d.kind || 'reply', undefined, undefined, false, d.items || []);
    };
    window.addEventListener('favor-compose:sent', sent);
    window.addEventListener('favor-compose:discarded', sent);
    window.addEventListener('favor-mail:reply', reply);
    return () => {
      window.removeEventListener('favor-compose:sent', sent);
      window.removeEventListener('favor-compose:discarded', sent);
      window.removeEventListener('favor-mail:reply', reply);
    };
  });

  // The phone's Back closes compose and sheets before leaving the page.
  useEffect(() => {
    const pop = () => {
      if (compose && !(history.state && history.state.mlCompose)) setCompose(null);
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, [compose]);

  // The tab bar sits under the pane on a phone.
  const [bot, setBot] = useState<string | undefined>();
  useEffect(() => {
    const measure = () => {
      if (!isPhone()) return setBot(undefined);
      const bar = document.querySelector('.h-navbar') as HTMLElement | null;
      let b = 0;
      if (bar && getComputedStyle(bar).display !== 'none') b = Math.round(window.innerHeight - bar.getBoundingClientRect().top);
      setBot(Math.max(0, b) + 'px');
    };
    measure();
    const r = () => requestAnimationFrame(measure);
    window.addEventListener('resize', r);
    return () => window.removeEventListener('resize', r);
  }, [s.view]);
  useEffect(() => {
    document.body.classList.toggle('ml-deep', s.view !== 'list');
    return () => document.body.classList.remove('ml-deep');
  }, [s.view]);

  /* ------------------------------------------------------------------ render */
  const rows = s.threads;
  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => rowsRef.current, estimateSize: () => 88, overscan: 8 });
  useEffect(() => {
    if (s.sel >= 0 && rows.length && !s.open) virt.scrollToIndex(s.sel, { align: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.sel]);
  useEffect(() => {
    const el = rowsRef.current;
    if (!el) return;
    const onScroll = () => {
      const x = S.current;
      if (el.scrollTop + el.clientHeight > el.scrollHeight - 400 && Object.keys(x.nexts).length && !x.loading) loadList({ more: true });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flagsOn = activeFlags().filter((f) => f !== 'partner' || inboxPlain());
  const nPick = pickedIds().length;
  const rowHover = useRef(0);
  const hoverWarm = (id: string) => {
    clearTimeout(rowHover.current);
    rowHover.current = window.setTimeout(() => warm([id]), 90);
  };
  const boxColor = (a: string) => (a && (s.boxes.find((b) => b.email === a) || {}).color) || PRIMARY_DOT;

  const labelsList = useMemo(() => {
    const sys = s.labels.filter((l) => l.type === 'system' && l.id !== 'IMPORTANT');
    const own = s.labels.filter((l) => l.type === 'user');
    return { sys, own };
  }, [s.labels]);

  if (s.ready && !s.connected)
    return <ConnectPane need="read" level={s.level} me={s.me} />;

  const connectNeeded = s.ready && !s.level.read && !s.level.headers;
  const threadEl =
    s.view === 'thread' && s.thread ? (
      <Reader
        thread={s.thread}
        loading={s.threadLoading && !(s.thread.messages || []).length}
        listTitle={listTitle()}
        me={s.me}
        name={s.name}
        box={boxOf(s.thread.id)}
        partners={s.partners}
        headersOnly={s.headersOnly}
        labels={s.labels}
        exp={s.exp}
        onToggle={(mid, open) => set({ exp: { ...s.exp, [mid]: open } })}
        onAct={(k, a) => act(k, undefined, a)}
        onReply={(k, m, pop) => startReply(k, m, undefined, pop)}
        drafts={s.drafts}
        onEditDraft={editDraft}
        onDropDraft={dropDraft}
        extra={
          s.headersOnly ? (
            <ConnectCard need="read" level={s.level} me={s.me} />
          ) : s.level.read && s.assist ? (
            <AssistPanel
              a={s.assist}
              partner={partnerOf(s.thread)}
              tl={s.tl}
              onLog={() => (s.assist && s.assist.logged ? undefined : openSmart('log-action'))}
              onTimeline={showTimeline}
              onGiftNote={giftNote}
              onGiftChat={giftChat}
              onCommitTask={commitTask}
              onProspect={addProspect}
              onAsk={askAbout}
              onFindTime={() => openSmart('find-time')}
              onAskBrain={(q) => askBrain(q)}
              top={<TeamChatLine key={s.assist.id} team={s.team} threadId={s.assist.id} me={s.me} api={api} say={say} failed={failed} onChange={(t) => set({ team: t })} />}
            />
          ) : null
        }
        suggested={s.assist && s.assist.replies.length ? <SuggestedReplies replies={s.assist.replies} onPick={(text) => startReply('reply', undefined, text)} /> : null}
        fileKinds={s.assist ? s.assist.files : undefined}
        ent={s.level.read ? entityApi : undefined}
        onViewFile={viewFile}
      />
    ) : null;

  return (
    <>
      <div className="ml" id="mail-root" data-view={s.view} ref={rootRef} style={bot !== undefined ? ({ ['--ml-bot' as any]: bot } as any) : undefined} data-picking={nPick > 0 || undefined}>
        <div className="ml-pnav">
          <button type="button" className="ml-pn" onClick={() => document.getElementById('h-app')?.classList.add('is-nav')} aria-label="Open the menu">
            <MI n="menu" />
          </button>
          <button type="button" className="ml-pn ml-pn--label" onClick={(e) => set({ sheet: { kind: 'labels-nav', anchor: e.currentTarget } })} aria-haspopup="dialog">
            <span>{s.q ? 'Search' : labelName(s.label)}</span>
            <MI n="chevd" />
          </button>
          <button type="button" className="ml-pn" onClick={() => openCompose()} aria-label="New message">
            <MI n="pen" />
          </button>
        </div>
        <aside className="ml-side" aria-label="Mailboxes">
          <button type="button" className="ml-compose" onClick={() => openCompose()}>
            <MI n="pen" />
            <span>Compose</span>
          </button>
          <div className="ml-boxes">
            <BoxesPane s={s} total={boxTotal()} manage={() => openSmart('boxes')} pick={(key) => {
              if (S.current.box === key) return;
              Object.assign(S.current, { box: key, ov: null, labels: [], threads: [], nexts: {}, v: '' });
              history.replaceState(history.state, '', '#/INBOX');
              bump();
              void loadLabels();
              route();
            }} />
          </div>
          <nav className="ml-labels">
            <LabelsPane s={s} sys={labelsList.sys} own={labelsList.own} views={liveViews()} viewCount={viewCount} inboxPlain={inboxPlain()} onOpen={(k) => openSmart(k)} />
          </nav>
        </aside>
        <section className="ml-list" aria-label="Conversations">
          <form
            className="ml-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              const q = (searchRef.current?.value || '').trim();
              if (q && !s.level.read) return askWrite('search');
              searchRef.current?.blur();
              go(s.label, q, '');
            }}
          >
            <label className="ml-search__box">
              <MI n="search" />
              <input ref={searchRef} type="search" name="q" key={'q' + s.q} defaultValue={s.q} placeholder="Search mail, or start with ? to ask" aria-label="Search mail" autoComplete="off" enterKeyHint="search" onInput={(e) => !(e.target as HTMLInputElement).value && S.current.q && go('INBOX', '', '')} />
              <kbd>/</kbd>
            </label>
          </form>
          {inboxPlain() && !!s.ov && (s.level.read || window.__mailMock) && (
            <div className="ml-tabs" role="navigation" aria-label="Views">
              {liveViews().map((x) => {
                const n = viewCount(x[0]);
                const on = s.v === x[0];
                return (
                  <a key={x[0]} className={'ml-tab' + (on ? ' is-on' : '') + (x[0] === 'needs' && n ? ' is-hot' : '')} href={'#/' + (slugOf(x[0]) || 'INBOX')} aria-current={on ? 'page' : undefined}>
                    {x[1]}
                    {n ? <em>{n}</em> : null}
                  </a>
                );
              })}
            </div>
          )}
          <div className="ml-list__head" hidden={nPick > 0}>
            <button type="button" className="ml-iconbtn ml-pickall" onClick={() => (rows.length && nPick === rows.length ? clearPicks() : set({ picked: Object.fromEntries(rows.map((t) => [t.id, 1])) as any }))} aria-label="Select all">
              <MI n={rows.length && nPick === rows.length ? 'boxon' : 'box'} />
            </button>
            <b>{listTitle()}</b>
            <span>{window.__mailMock ? 'Sample mail' : s.v && inboxPlain() && s.v !== 'waiting' && s.scanned ? 'From your newest ' + s.scanned : ''}</span>
            <button type="button" className="ml-fon" onClick={() => set({ flags: {} })} hidden={!flagsOn.length} aria-label={flagsOn.length ? 'Remove filters: ' + flagsOn.map((f) => FLAG_NAMES[f]).join(', ') : ''}>
              {flagsOn.map((f) => FLAG_NAMES[f]).join(', ')}
              <MI n="x" />
            </button>
            <button type="button" className={'ml-iconbtn' + (flagsOn.length ? ' is-on' : '')} hidden={s.label === 'SNOOZED' || !(s.level.read || s.level.headers)} onClick={(e) => set({ sheet: { kind: 'filter', anchor: e.currentTarget } })} aria-label="Filter" aria-haspopup="dialog">
              <MI n="filter" />
            </button>
            <button type="button" className="ml-iconbtn" onClick={(e) => set({ sheet: { kind: 'sort', anchor: e.currentTarget } })} aria-label="Sort" aria-haspopup="dialog">
              <MI n="sort" />
            </button>
            <button type="button" className="ml-iconbtn" onClick={() => { void loadLabels(); loadList({ quiet: true }); }} aria-label="Refresh" title="Refresh">
              <MI n="refresh" />
            </button>
          </div>
          {nPick > 0 && (
            <div className="ml-selbar">
              <button type="button" className="ml-iconbtn" onClick={clearPicks} aria-label="Clear selection">
                <MI n="x" />
              </button>
              <b>{nPick} selected</b>
              {nPick < rows.length && (
                <button type="button" className="ml-iconbtn" onClick={() => set({ picked: Object.fromEntries(rows.map((t) => [t.id, 1])) as any })} aria-label={'Select all ' + rows.length}>
                  <MI n="box" />
                </button>
              )}
              <span className="ml-selbar__acts">
                {s.label !== 'TRASH' && s.label !== 'SPAM' && (
                  <button type="button" className="ml-iconbtn" onClick={() => selAct('archive')} aria-label="Archive">
                    <MI n="archive" />
                  </button>
                )}
                <button type="button" className="ml-iconbtn" onClick={() => selAct('trash')} aria-label="Delete">
                  <MI n="trash" />
                </button>
                {(() => {
                  const anyUnread = pickedIds().map(findThread).some((r) => r && r.unread);
                  return (
                    <button type="button" className="ml-iconbtn" onClick={() => selAct(anyUnread ? 'read' : 'unread')} aria-label={anyUnread ? 'Mark as read' : 'Mark as unread'}>
                      <MI n={anyUnread ? 'read' : 'unread'} />
                    </button>
                  );
                })()}
                <button type="button" className="ml-iconbtn" onClick={(e) => selAct('label', e.currentTarget)} aria-label="Label">
                  <MI n="tag" />
                </button>
                <button type="button" className="ml-iconbtn" onClick={(e) => selAct('snooze', e.currentTarget)} aria-label="Snooze">
                  <MI n="clock" />
                </button>
                <button type="button" className="ml-iconbtn" onClick={() => openSmart('move', { senders: Array.from(new Set(pickedIds().map(findThread).filter(Boolean).map((r: any) => (r.from && r.from.email) || ''))).filter(Boolean) })} aria-label="Move to category">
                  <MI n="folder" />
                </button>
              </span>
            </div>
          )}
          {s.level.headers && !s.level.read && (
            <div className="ml-allow">
              <span>Senders and subjects only. Allow Mail adds the full message, files and search.</span>
              <a className="ml-btn ml-btn--primary" href={allowUrl('mail')}>
                Allow Mail
              </a>
            </div>
          )}
          <div className="ml-rows" ref={rowsRef} data-rows>
            {connectNeeded ? (
              <ConnectCard need="read" level={s.level} me={s.me} />
            ) : s.error ? (
              <div className="ml-empty">
                <b>{s.error.split(':')[0]}</b>
                <span>{s.error.split(':').slice(1).join(':')}</span>
              </div>
            ) : !s.ready || (s.loading && !rows.length) ? (
              Array.from({ length: 8 }).map((_, i) => (
                <div className="ml-row ml-row--skel" aria-hidden="true" key={i}>
                  <span className="ml-av" />
                  <span className="ml-row__t">
                    <i style={{ width: 30 + ((i * 17) % 40) + '%' }} />
                    <i style={{ width: '80%' }} />
                    <i style={{ width: '60%' }} />
                  </span>
                </div>
              ))
            ) : s.loadError && !rows.length ? (
              <div className="ml-empty">
                <b>Mail did not load</b>
                <span>{s.loadError}</span>
                <button type="button" className="ml-btn" onClick={() => loadList()}>
                  Try again
                </button>
              </div>
            ) : !rows.length ? (
              <div className="ml-empty">
                <b>
                  {s.q ? 'Nothing matches' : flagsOn.length ? 'Nothing matches the filters' : inboxPlain() && s.v === 'needs' ? 'Nothing is waiting on you' : inboxPlain() && s.v === 'waiting' ? 'No sent mail is waiting on a reply' : inboxPlain() && s.v ? 'Nothing in ' + viewName(s.v) : s.label === 'INBOX' ? 'Inbox is empty' : 'Nothing here'}
                </b>
                {s.q ? <span>Gmail search words work here, like from:, has:attachment and before:2026/10/01.</span> : flagsOn.length ? <button type="button" className="ml-btn" onClick={() => set({ flags: {} })}>Clear filters</button> : null}
              </div>
            ) : (
              <>
              <BriefCards
                b={s.brief}
                wait={!s.briefFailed}
                ov={s.ov}
                showBrief={inboxPlain() && !s.v && !!rows.length && !s.briefFailed && s.level.read && !briefHidden(s.brief)}
                showNudge={inboxPlain() && !s.v && (() => { try { return localStorage.getItem('favor.mail.nudge') !== nudgeKey(); } catch { return true; } })()}
                showClean={inboxPlain() && !s.v && !hiddenToday('favor.mail.clean')}
                onOpen={(id: string) => go(s.label, s.q, id)}
                onFresh={() => { set({ brief: null }); loadBrief(true); }}
                onHide={closeBrief}
                onNudgeHide={() => { try { localStorage.setItem('favor.mail.nudge', nudgeKey()); } catch { /* private mode */ } set({ briefGone: Date.now() }); }}
                onCleanReview={() => (!s.level.write || !canWrite() ? askWrite('archive') : openSmart('clean'))}
                onCleanDismiss={() => hideToday('favor.mail.clean')}
              />
              <div style={{ height: virt.getTotalSize(), position: 'relative', width: '100%' }}>
                {virt.getVirtualItems().map((vi) => {
                  const t = rows[vi.index];
                  const names = (t.people || []).map((p: any) => (p.name === 'me' ? 'me' : (p.name || p.email).split(/\s+/)[0]));
                  let name = (t.people || []).length === 1 ? who(t.people[0]) : names.join(', ');
                  if (t.draft && s.label === 'DRAFT') name = 'Draft';
                  const on = s.open === t.id;
                  const picked = !!s.picked[t.id];
                  const href = '#/' + (s.q ? 'search/' + encodeURIComponent(s.q) : encodeURIComponent(s.label)) + '/' + encodeURIComponent(t.id + (t.mb ? '~' + t.mb : ''));
                  return (
                    <div key={t.id} data-index={vi.index} ref={virt.measureElement} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}>
                      <div className={'ml-row' + (t.unread ? ' is-unread' : '') + (on ? ' is-open' : '') + (vi.index === s.sel ? ' is-sel' : '') + (picked ? ' is-picked' : '')} data-i={vi.index} data-id={t.id} onPointerOver={() => hoverWarm(t.id)}>
                        <a
                          className="ml-row__a"
                          href={href}
                          aria-current={on ? 'true' : undefined}
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest('[data-pick]') || e.shiftKey || nPick > 0) {
                              e.preventDefault();
                              pick(t.id, e.shiftKey);
                            }
                          }}
                        >
                          <span className={'ml-av' + (picked ? ' is-picked' : '')} data-h={hue((t.from && t.from.email) || name)} data-pick>
                            {picked ? (
                              <>
                                <MI n="check" />
                                <span className="ml-sr">Selected</span>
                              </>
                            ) : (
                              initials(t.from && t.from.email === s.me ? s.name : who(t.from) || name)
                            )}
                          </span>
                          <span className="ml-row__t">
                            <span className="ml-row__l1">
                              <b className="ml-row__who">
                                {s.boxes.length ? <i className="ml-mb" style={{ background: boxColor(t.mb) }} title={t.mb || s.me} /> : null}
                                {name || '(no sender)'}
                                {t.count > 1 ? <small> {t.count}</small> : null}
                                {t.draft && s.label !== 'DRAFT' ? <em className="ml-draft"> Draft</em> : null}
                              </b>
                              <time dateTime={t.date}>{when(t.date)}</time>
                            </span>
                            <span className="ml-row__s">{t.subject || '(no subject)'}</span>
                            <span className="ml-row__p">
                              {t.ask ? <em className="ml-chip ml-chip--sun">Needs you</em> : null}
                              {t.partner && s.v !== 'cat:partners' ? <em className="ml-chip ml-chip--leaf">Partner</em> : null}
                              {t.waitDays != null ? (
                                <em className="ml-chip ml-chip--sun">
                                  <MI n="clock" />
                                  Sent {t.waitDays === 1 ? 'yesterday' : t.waitDays + ' days ago'}
                                </em>
                              ) : null}
                              {t.files ? <MI n="clip" cls="ml-i--sm" /> : null}
                              <span className="ml-row__snip">{t.snippet}</span>
                            </span>
                          </span>
                        </a>
                        <button type="button" className={'ml-star' + (t.starred ? ' is-on' : '')} onClick={() => act('star', t.id)} aria-pressed={!!t.starred} aria-label={t.starred ? 'Remove star' : 'Star'}>
                          <MI n="star" />
                        </button>
                        <span className="ml-row__hover">
                          {t.waitDays != null ? (
                            <button type="button" className="ml-iconbtn" onClick={() => followUp(t.id)} aria-label="Follow up" title="Follow up">
                              <MI n="reply" />
                            </button>
                          ) : null}
                          <button type="button" className="ml-iconbtn" onClick={() => act('archive', t.id)} aria-label="Archive" title="Archive (e)">
                            <MI n="archive" />
                          </button>
                          <button type="button" className="ml-iconbtn" onClick={() => act('delete', t.id)} aria-label="Delete" title="Delete (#)">
                            <MI n="trash" />
                          </button>
                          <button type="button" className="ml-iconbtn" onClick={() => act('toggle-read', t.id)} aria-label={t.unread ? 'Mark as read' : 'Mark as unread'} title={t.unread ? 'Mark as read' : 'Mark as unread'}>
                            <MI n={t.unread ? 'read' : 'unread'} />
                          </button>
                          <button type="button" className="ml-iconbtn" onClick={(e) => act('snooze', t.id, e.currentTarget)} aria-label="Snooze" title="Snooze">
                            <MI n="clock" />
                          </button>
                        </span>
                      </div>
                    </div>
                  );
                })}
                {Object.keys(s.nexts).length > 0 && (
                  <div className="ml-more" style={{ position: 'absolute', top: virt.getTotalSize(), width: '100%' }}>
                    <button type="button" className="ml-btn" onClick={() => loadList({ more: true })}>
                      Show more
                    </button>
                  </div>
                )}
              </div>
              </>
            )}
          </div>
        </section>
        <section className="ml-read" aria-label="Conversation">
          {threadEl ?? (
            !isPhone() && (
              <div className="ml-read__empty">
                <MI n="unread" />
                <span>{rows.length ? 'Select a conversation to read it' : ''}</span>
              </div>
            )
          )}
          {s.loadError && s.thread && !(s.thread.messages || []).length && !s.threadLoading && (
            <div className="ml-empty">
              <b>This conversation did not open</b>
              <span>{s.loadError}</span>
            </div>
          )}
        </section>
        <Toast t={toast} onDone={() => setToast(null)} />
      </div>
      {s.sheet && <Sheets s={s} S={S} close={() => set({ sheet: null })} say={say} failed={failed} api={api} bump={bump} go={go} goView={goView} removeFromList={removeFromList} putBack={putBack} afterLeave={afterLeave} bumpInbox={bumpInbox} loadLabels={loadLabels} partnerOf={partnerOf} loadList={loadList} openThread={openThread} findThread={findThread} labelsList={labelsList} />}
      {s.sheet && !['allow', 'filter', 'sort', 'keys', 'labels-nav', 'snooze', 'labels'].includes(s.sheet.kind) && (
        <SmartSheets
          kind={s.sheet.kind}
          data={s.sheet.data}
          anchor={s.sheet.anchor}
          c={{
            me: s.me,
            thread: s.thread,
            partner: partnerOf(s.thread),
            customs: s.customs,
            ov: s.ov,
            boxes: s.boxes,
            threadBox: s.thread ? boxOf(s.thread.id) : '',
            lastHash: s.thread ? hashFor(s.thread.id) : '',
            starred: toolsOf(s.thread).starred,
            hasWorkCenter: !!hubAccess().workCenter,
            close: () => set({ sheet: null }),
            say,
            failed,
            then: (fn) => {
              set({ sheet: null });
              setTimeout(fn, 0);
            },
            open: (k, d) => openSmart(k, d),
            act: (k) => act(k),
            reply: (_k, text) => startReply('reply', undefined, text),
            setCustoms: (c) => set({ customs: c }),
            reloadOverview: loadOverview,
            markLogged: () => patchAssist({ logged: true }),
            removeBox: (email) => {
              api()
                .removeBox(email)
                .then(() => {
                  const x = S.current;
                  const counts = { ...x.counts };
                  delete counts[email];
                  Object.assign(x, { boxes: x.boxes.filter((b) => b.email !== email), counts, box: x.box === email ? '' : x.box, threads: [], labels: [], sheet: null });
                  bump();
                  void loadBoxes();
                  void loadLabels();
                  route();
                  say('Mailbox removed');
                })
                .catch((e: any) => failed(e));
            },
            archiveMany,
          } as SmartCtx}
        />
      )}
      {tip && (
        <div className="ml-ent" style={{ left: tip.x, top: tip.y }}>
          <b>{tip.c.title}</b>
          <span>{tip.c.sub || ''}</span>
          {(tip.c.lines || []).map((l: any) => (
            <div key={l.k}>
              <small>{l.k}</small> {l.v}
            </div>
          ))}
          <small className="ml-ent__more">Press for details</small>
        </div>
      )}
      {warnings && <WarnSheet list={warnings.list} go={warnings.go} close={() => setWarnings(null)} auto={countdownOn()} onSent={() => setWarnings(null)} />}
      {compose && (
        <Compose
          key={JSON.stringify([compose.threadId, compose.replyTo, compose.draftId, compose.title, compose.subject])}
          init={compose}
          me={s.me}
          signature={s.signature}
          fromOpts={s.fromOpts}
          canWrite={canWrite()}
          defaultBox={s.box}
          onSend={onSend}
          onClose={() => closeCompose()}
          onDiscard={(did, mb, pending) => {
            closeCompose();
            if (did) void api().dropDraft(did, mb).catch(() => undefined);
            else if (pending) void pending.then(() => undefined);
            say('Draft discarded');
          }}
          onAsk={askWrite}
          onToast={(m) => say(m)}
          onLater={(b, at, remindDays) => {
            const body: any = { to: b.to, cc: b.cc, bcc: b.bcc, subject: b.subject, html: b.html, threadId: b.threadId, replyTo: b.replyTo, draftId: b.draftId, mb: b.mb, from: b.from, sendAt: at.toISOString(), remindDays };
            api()
              .makeLater(body)
              .then(() => {
                closeCompose(true);
                say('Scheduled for ' + at.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }));
              })
              .catch((e: any) => {
                setCompose(b.init);
                failed(e);
              });
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ panes */
function BoxesPane({ s, total, pick, manage }: { s: State; total: number; pick: (key: string) => void; manage: () => void }) {
  if (!s.boxes.length)
    return (
      <a className="ml-addbox" href={'/api/google/connect?add=mailbox&next=' + encodeURIComponent('/mail/')}>
        <MI n="plus" />
        Add a mailbox
      </a>
    );
  const one = (key: string, name: string, color: string, n: number, tip?: string) => (
    <button type="button" key={key || 'all'} className={'ml-bx' + (s.box === key ? ' is-on' : '')} onClick={() => pick(key)} title={tip || name}>
      <i className="ml-mb" style={{ background: color }} />
      <span>{name}</span>
      {n > 0 ? <em className="ml-count">{n}</em> : null}
    </button>
  );
  const boxLabel = (email: string) => (s.boxes.find((b) => b.email === email) || {}).name || email.split('@')[0];
  return (
    <>
      <div className="ml-labels__h">Mailboxes</div>
      {one('', 'All mailboxes', '#c9cfc2', total)}
      {one(s.me, s.me.split('@')[0], PRIMARY_DOT, s.counts[s.me] || 0, s.me)}
      {s.boxes.map((b) => one(b.email, boxLabel(b.email), b.color || PRIMARY_DOT, s.counts[b.email] || 0, b.email))}
      <button type="button" className="ml-addbox" onClick={manage}>
        <MI n="plus" />
        Manage mailboxes
      </button>
    </>
  );
}

function LabelsPane({ s, sys, own, views, viewCount, inboxPlain, onOpen }: { s: State; sys: any[]; own: any[]; views: Array<[string, string]>; viewCount: (v: string) => number | null; inboxPlain: boolean; onOpen?: (kind: string) => void }) {
  const row = (l: any) => {
    const n = l.id === 'DRAFT' ? l.total : l.unread;
    const on = s.label === l.id && !s.q && !(l.id === 'INBOX' && s.v);
    return (
      <a key={l.id} className={'ml-lab' + (on ? ' is-on' : '')} href={'#/' + encodeURIComponent(l.id)} data-label={l.id} aria-current={on ? 'page' : undefined}>
        {l.color ? <i className="ml-dot" style={{ background: l.color }} /> : <MI n={SYS_ICON[l.id] || 'tag'} />}
        <span>{l.name}</span>
        {n ? <em className={'ml-count' + (l.id === 'INBOX' ? ' ml-count--strong' : '')}>{Number(n).toLocaleString('en-US')}</em> : null}
      </a>
    );
  };
  return (
    <>
      {sys.map((l) => (
        <span key={l.id} style={{ display: 'contents' }}>
          {row(l)}
          {l.id === 'INBOX' && s.ov && (s.level.read || window.__mailMock)
            ? views.filter((x) => x[0] !== '').map((x) => {
                const n = viewCount(x[0]);
                const unread = x[0] === 'needs' || x[0] === 'unlogged' ? n : x[0] === 'waiting' ? 0 : (s.ov.counts[x[0].slice(4)] || {}).unread;
                const on = inboxPlain && s.v === x[0];
                return (
                  <a key={x[0]} className={'ml-lab ml-lab--sub' + (on ? ' is-on' : '')} href={'#/' + slugOf(x[0])} data-label="INBOX" data-v={x[0]} aria-current={on ? 'page' : undefined}>
                    <span>{x[1]}</span>
                    {n ? <em className={'ml-count ml-count--sub' + (unread ? ' is-bold' : '')}>{n}</em> : null}
                  </a>
                );
              })
            : null}
          {l.id === 'INBOX' && s.ov && (s.level.read || window.__mailMock) && onOpen ? (
            <button type="button" className="ml-addbox ml-addbox--sub" onClick={() => onOpen('cats')}>
              <MI n="wand" />
              New category
            </button>
          ) : null}
          {l.id === 'DRAFT' && onOpen ? (
            <>
              <button type="button" className="ml-lab ml-lab--btn" onClick={() => onOpen('later-list')}>
                <MI n="clock" />
                <span>Scheduled</span>
              </button>
              <button type="button" className="ml-lab ml-lab--btn" onClick={() => onOpen('assigned')}>
                <MI n="person" />
                <span>Assigned</span>
              </button>
            </>
          ) : null}
        </span>
      ))}
      {own.length > 0 && <div className="ml-labels__h">Labels</div>}
      {own.map(row)}
    </>
  );
}

function ConnectCard({ need, level, me }: { need: string; level: State['level']; me: string }) {
  void need;
  return (
    <div className="ml-connect">
      <span className="ml-connect__ic">
        <MI n="unread" />
      </span>
      <b>Your mail in FavorOS</b>
      <p>{level.headers ? 'FavorOS can show who wrote and the subject today. Allow Mail adds the full message, its files and search. Google asks once.' : 'Allow Mail shows your Gmail here: messages, files and search. Google asks once.'}</p>
      <a className="ml-btn ml-btn--primary" href={allowUrl('mail')}>
        Allow Mail
      </a>
      <a className="ml-link" href={gmailLink(me)} target="_blank" rel="noopener noreferrer">
        Open Gmail instead
      </a>
    </div>
  );
}
function ConnectPane({ need, level, me }: { need: string; level: State['level']; me: string }) {
  return (
    <div className="ml" data-view="list">
      <section className="ml-list" style={{ gridColumn: '1 / -1' }}>
        <div className="ml-rows">
          <ConnectCard need={need} level={level} me={me} />
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ menus */
function Sheets(p: any) {
  const { s, S, close, say, failed, api, bump, go, goView, removeFromList, putBack, afterLeave, bumpInbox, loadLabels, loadList, openThread, findThread, labelsList } = p;
  const sh = s.sheet;
  const [newLab, setNewLab] = useState('');
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    const have: Record<string, boolean> = {};
    if (sh.kind === 'labels' && sh.data) {
      const id = sh.data.ids[0];
      if (sh.data.ids.length === 1) {
        if (s.thread && s.thread.id === id) s.thread.messages.forEach((m: any) => (m.labelIds || []).forEach((l: string) => (have[l] = true)));
        else ((findThread(id) || {}).labelIds || []).forEach((l: string) => (have[l] = true));
      }
    }
    return have;
  });
  const [pickAt, setPickAt] = useState('');
  const ids: string[] = (sh.data && sh.data.ids) || [];
  const aborted = () => {
    if (!s.level.write || !s.write) {
      close();
      return true;
    }
    return false;
  };
  void aborted;

  if (sh.kind === 'allow') {
    if (s.level.headers && !s.level.read)
      return (
        <Sheet title="Allow Mail" onClose={close}>
          <p className="ml-p">FavorOS can show who wrote and the subject today. Allow Mail adds the full message, its files and search. Google asks once. Replying and archiving ask one more time.</p>
          <div className="ml-sheet__acts">
            <a className="ml-btn ml-btn--primary" href={allowUrl('mail')}>Allow Mail</a>
            <a className="ml-btn" href={gmailLink(s.me, s.open)} target="_blank" rel="noopener noreferrer">Open in Gmail</a>
          </div>
        </Sheet>
      );
    if (!s.write)
      return (
        <Sheet title="Open in Gmail" onClose={close}>
          <p className="ml-p">Changing and sending mail from FavorOS is not available yet.</p>
          <div className="ml-sheet__acts">
            <a className="ml-btn ml-btn--primary" href={gmailLink(s.me, s.open)} target="_blank" rel="noopener noreferrer"><MI n="ext" />Open in Gmail</a>
          </div>
        </Sheet>
      );
    return (
      <Sheet title="Allow changes and sending" onClose={close}>
        <p className="ml-p">Google asks once. This lets FavorOS archive, delete, label, star, snooze, save drafts and send from your Gmail, and look up your Google contacts when you address a message.</p>
        <div className="ml-sheet__acts">
          <a className="ml-btn ml-btn--primary" href={allowUrl('mailsend')}>Allow changes</a>
          <button type="button" className="ml-btn" onClick={close}>Not now</button>
        </div>
      </Sheet>
    );
  }
  if (sh.kind === 'filter') {
    const items = ['unread', 'starred', 'files'].concat(s.label === 'INBOX' && !s.q && s.v !== 'waiting' ? ['partner'] : []);
    return (
      <Sheet title="Filter" anchor={sh.anchor} onClose={close}>
        <div className="ml-menu">
          {items.map((f) => (
            <label className="ml-menu__i ml-check" key={f}>
              <input type="checkbox" checked={!!s.flags[f]} onChange={(e) => { S.current.flags = { ...S.current.flags, [f]: e.target.checked }; bump(); loadList(); }} />
              <span>{FLAG_NAMES[f]}</span>
            </label>
          ))}
        </div>
      </Sheet>
    );
  }
  if (sh.kind === 'sort') {
    const cur = s.sort || ((s.v === 'needs' || s.v === 'waiting') && s.label === 'INBOX' && !s.q ? 'old' : 'new');
    return (
      <Sheet title="Sort" anchor={sh.anchor} onClose={close}>
        <div className="ml-menu">
          {[['new', 'Newest first'], ['old', 'Oldest first'], ['prio', 'Most important first']].map((x) => (
            <button type="button" className="ml-menu__i" key={x[0]} onClick={() => { S.current.sort = x[0]; close(); loadList(); }}>
              <span>{x[1]}</span>
              {cur === x[0] ? <MI n="check" /> : null}
            </button>
          ))}
        </div>
      </Sheet>
    );
  }
  if (sh.kind === 'keys') {
    const rows = [['j / k', 'Older / newer conversation'], ['o or Enter', 'Open'], ['u or Esc', 'Back to the list'], ['e', 'Archive'], ['#', 'Delete'], ['s', 'Star'], ['x', 'Select the highlighted conversation'], ['z', 'Undo the last archive, delete or snooze'], ['Shift click', 'Select a range'], ['Shift U / Shift I', 'Mark unread / read'], ['r / a / f', 'Reply / reply all / forward'], ['c', 'Compose'], ['b / l', 'Snooze / labels'], ['/', 'Search']];
    return (
      <Sheet title="Keyboard shortcuts" onClose={close}>
        <dl className="ml-keys">
          {rows.map((r) => (
            <span key={r[0]} style={{ display: 'contents' }}>
              <dt><kbd>{r[0]}</kbd></dt>
              <dd>{r[1]}</dd>
            </span>
          ))}
        </dl>
      </Sheet>
    );
  }
  if (sh.kind === 'labels-nav') {
    return (
      <Sheet title="Mailboxes" onClose={close}>
        <nav className="ml-labels ml-labels--sheet" onClick={(e) => (e.target as HTMLElement).closest('a') && close()}>
          <LabelsPane s={s} sys={labelsList.sys} own={labelsList.own} views={[]} viewCount={() => null} inboxPlain={false} />
        </nav>
      </Sheet>
    );
  }
  if (sh.kind === 'snooze') {
    const opts = snoozeTimes();
    const doSnooze = (until: Date) => {
      if (!until || !isFinite(until.getTime()) || until < new Date()) return say('Pick a time later than now');
      close();
      const rows = ids.map(findThread).filter(Boolean);
      const unreadN = rows.filter((t: any) => t.unread && isPrimary(t.labelIds)).length;
      const gone = ids.map((id) => (S.current.label === 'INBOX' ? removeFromList(id) : null)).filter(Boolean);
      ids.forEach(afterLeave);
      if (unreadN) bumpInbox(-unreadN);
      const back = () => gone.forEach(putBack);
      Promise.all(ids.map((id) => api().snooze(id, until.toISOString())))
        .then(() => {
          say('Snoozed until ' + stamp(until), () => {
            Promise.all(ids.map((id) => api().unsnooze(id)))
              .then(() => {
                back();
                if (unreadN) bumpInbox(unreadN);
              })
              .catch((e: any) => failed(e));
          });
          S.current.picked = {};
          bump();
        })
        .catch((e: any) => {
          back();
          if (unreadN) bumpInbox(unreadN);
          failed(e);
        });
    };
    const pp = ids.length === 1 && s.thread && s.thread.id === ids[0] ? p.partnerOf(s.thread) : null;
    const wait = (kind: string) => {
      const id = ids[0];
      close();
      const t = findThread(id);
      const wu = !!(t && t.unread && isPrimary(t.labelIds));
      const goneW = S.current.label === 'INBOX' ? removeFromList(id) : null;
      afterLeave(id);
      if (wu) bumpInbox(-1);
      api()
        .snoozeWait(id, kind, pp ? pp.id : '')
        .then(() => say(kind === 'reply' ? 'Back in your inbox when they reply' : 'Back in your inbox at their next gift', () => api().unsnooze(id).then(() => { putBack(goneW); if (wu) bumpInbox(1); }).catch((e: any) => failed(e))))
        .catch((er: any) => { putBack(goneW); if (wu) bumpInbox(1); failed(er); });
    };
    return (
      <Sheet title="Snooze until" anchor={sh.anchor} onClose={close}>
        {ids.length === 1 && (
          <>
            <button type="button" className="ml-menu__i" onClick={() => wait('reply')}>
              <MI n="reply" />
              <span>Until they reply</span>
            </button>
            {pp ? (
              <button type="button" className="ml-menu__i" onClick={() => wait('gift')}>
                <MI n="person" />
                <span>Until their next gift</span>
                <small>{pp.name}</small>
              </button>
            ) : null}
          </>
        )}
        <div className="ml-menu">
          {opts.map((o, k) => (
            <button type="button" className="ml-menu__i" key={k} onClick={() => doSnooze(o[1])}>
              <MI n="clock" />
              <span>{o[0]}</span>
              <small>{stamp(o[1])}</small>
            </button>
          ))}
          <div className="ml-menu__pick">
            <label htmlFor="ml-snz-at">Pick a date and time</label>
            <input id="ml-snz-at" type="datetime-local" className="ml-input" value={pickAt} onChange={(e) => setPickAt(e.target.value)} />
            <button type="button" className="ml-btn ml-btn--primary" onClick={() => doSnooze(new Date(pickAt))}>Snooze</button>
          </div>
        </div>
      </Sheet>
    );
  }
  if (sh.kind === 'labels') {
    const own = labelsList.own;
    const base: Record<string, boolean> = {};
    if (ids.length === 1) {
      const id = ids[0];
      if (s.thread && s.thread.id === id) s.thread.messages.forEach((m: any) => (m.labelIds || []).forEach((l: string) => (base[l] = true)));
      else ((findThread(id) || {}).labelIds || []).forEach((l: string) => (base[l] = true));
    }
    const apply = () => {
      const add: string[] = [];
      const remove: string[] = [];
      own.forEach((l: any) => {
        if (checked[l.id] && !base[l.id]) add.push(l.id);
        if (!checked[l.id] && base[l.id]) remove.push(l.id);
      });
      close();
      if (!add.length && !remove.length) return;
      Promise.all(ids.map((id) => api().modify(id, add, remove)))
        .then(() => {
          say('Labels saved');
          ids.forEach((id) => {
            const t = findThread(id);
            if (t) t.labelIds = (t.labelIds || []).filter((l: string) => remove.indexOf(l) < 0).concat(add);
            if (remove.indexOf(S.current.label) >= 0) {
              removeFromList(id);
              afterLeave(id);
            } else if (S.current.open === id) void openThread(id);
          });
          S.current.picked = {};
          bump();
          void loadLabels();
        })
        .catch((e: any) => failed(e));
    };
    return (
      <Sheet title="Labels" anchor={sh.anchor} onClose={close}>
        <div className="ml-menu">
          {own.length ? (
            own.map((l: any) => (
              <label className="ml-menu__i ml-check" key={l.id}>
                <input type="checkbox" checked={!!checked[l.id]} onChange={(e) => setChecked({ ...checked, [l.id]: e.target.checked })} />
                <span>{l.name}</span>
              </label>
            ))
          ) : (
            <p className="ml-p">No labels yet.</p>
          )}
          <div className="ml-menu__pick">
            <label htmlFor="ml-newlab">New label</label>
            <input id="ml-newlab" className="ml-input" maxLength={100} autoComplete="off" value={newLab} onChange={(e) => setNewLab(e.target.value)} />
            <button
              type="button"
              className="ml-btn"
              onClick={() => {
                const name = newLab.trim();
                if (!name) return;
                api()
                  .newLabel(name, ids[0] ? boxOf(ids[0]) : '')
                  .then((d: any) => {
                    S.current.labels = S.current.labels.concat([d.label]);
                    setChecked({ ...checked, [d.label.id]: true });
                    setNewLab('');
                    bump();
                  })
                  .catch((e: any) => failed(e));
              }}
            >
              Add
            </button>
          </div>
          <div className="ml-sheet__acts">
            <button type="button" className="ml-btn ml-btn--primary" onClick={apply}>Apply</button>
          </div>
        </div>
      </Sheet>
    );
  }
  void go;
  void goView;
  return null;
}

function WarnSheet({ list, go, close, auto: auto0 }: { list: any[]; go: () => void; close: () => void; auto: boolean; onSent: () => void }) {
  const [left, setLeft] = useState(5);
  const [auto, setAuto] = useState(auto0);
  const done = useRef(false);
  const send = useCallback(() => {
    if (done.current) return;
    done.current = true;
    close();
    go();
  }, [close, go]);
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => setLeft((n) => n - 1), 1000);
    return () => clearInterval(id);
  }, [auto]);
  useEffect(() => {
    if (auto && left <= 0) send();
  }, [auto, left, send]);
  return (
    <Sheet title="Send anyway?" onClose={close}>
      <ul className="ml-warn">
        {list.map((w, i) => (
          <li key={i}>{w.text}</li>
        ))}
      </ul>
      <label className="ml-menu__i ml-check">
        <input
          type="checkbox"
          checked={!auto}
          onChange={(e) => {
            try {
              localStorage.setItem('favor.mail.countdown', e.target.checked ? 'off' : 'on');
            } catch {
              // private mode
            }
            setAuto(!e.target.checked);
          }}
        />
        <span>Wait for me to press Send</span>
      </label>
      <div className="ml-sheet__acts">
        <button type="button" className="ml-btn ml-btn--primary" onClick={close}>
          Fix it
        </button>
        <button type="button" className="ml-btn" onClick={send}>
          {auto ? 'Send now (' + Math.max(0, left) + ')' : 'Send now'}
        </button>
      </div>
    </Sheet>
  );
}

export { MailError };

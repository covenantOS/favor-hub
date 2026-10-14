// Native Chat's state and every action, ported from public/js/chat/chat-ui.js and chat-smart.js. One engine runs the Chat page
// (with its own socket) and a second runs the floating dock's Chat tab (fed by the dock's socket), and both draw with the same
// components (MessageList, Composer). React reads it with useSyncExternalStore; a change bumps `v`.
// Messages are replaced, never edited in place, so a memoized row redraws only when its message changed.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { hubOv } from '@/lib/hubOv';
import { chatApi } from './api';
import { mentionsMe, plain, type J, type Names } from './fmt';
import { ChatSocket, type Ev } from './socket';

type Scope = 'main' | 'thread';
type Tok = ReturnType<typeof hubOv.on>;
export type Modal = J & { kind: string };
export type Pop = J & { kind: string; anchor: DOMRect };

function lsGet<T>(k: string, d: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(k) || 'null');
    return v == null ? d : (v as T);
  } catch {
    return d;
  }
}
function lsSet(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    // private mode or full
  }
}
const PAGES: Record<string, string> = { threads: 'Threads', activity: 'Mentions and reactions', drafts: 'Drafts' };
export { PAGES };
const BOOT_CACHE = 'favor.chat.boot.v1';

export interface EngineOpts {
  dock?: boolean;
}

export class ChatEngine {
  S: J = {
    me: null,
    users: {},
    channels: {},
    active: null,
    right: 'none',
    threadRoot: null,
    tab: 'about',
    msgs: {},
    threads: {},
    typing: {},
    threadTyping: {},
    view: 'list',
    lastRead: {},
    editing: null,
    pending: { main: [], thread: [] },
    mentionMap: { main: {}, thread: {} },
    hasMore: {},
    warm: {},
    connected: true,
    page: 'channel',
    threadFull: false,
    threadsUnread: 0,
    threadList: null,
    activity: null,
    features: { pins: false },
    keepUnread: null,
    threadNew: {},
    newBelow: { main: 0, thread: 0 },
    pins: {},
    drafts: lsGet('favor.chat.drafts.v1', {}),
    folded: lsGet('favor.chat.folded.v1', {}),
    lang: '',
    langs: [],
    tr: {},
    trOrig: {},
    seg: 'channels',
    huddle: {},
    catchup: {},
    booted: false,
    bootError: null,
    conn: 'ok',
  };
  /** Overlays: one menu, one dialog, the search or switcher, one notice. */
  ui: { modal: Modal | null; pop: Pop | null; toast: { text: string; link?: { href: string; label: string } } | null; search: J | null; switcher: J | null } = { modal: null, pop: null, toast: null, search: null, switcher: null };
  v = 0;
  readonly dock: boolean;
  private subs = new Set<() => void>();
  private sock: ChatSocket | null = null;
  private attached = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  private navs: { t: Tok | null }[] = [];
  private toastT: ReturnType<typeof setTimeout> | undefined;
  private typingT: ReturnType<typeof setTimeout> | undefined;
  private threadsT: ReturnType<typeof setTimeout> | undefined;
  private touchT: ReturnType<typeof setTimeout> | undefined;
  private trT: ReturnType<typeof setTimeout> | undefined;
  private connT: ReturnType<typeof setTimeout> | undefined;
  private trAsked: Record<string, 1> = {};
  private resyncing = false;
  private bootP: Promise<void> | null = null;
  private typingSent = 0;
  /** Where a message box was, so a send can put the view at the bottom. */
  toBottom: Record<Scope, number> = { main: 0, thread: 0 };
  focusReq: { id: number; thread: boolean; n: number } | null = null;
  composerFocus: { scope: Scope; n: number; prefix?: string } | null = null;
  ent: Record<string, { items: J[]; wait?: boolean }> = {};
  /** The message boxes on screen, by scope (Composer registers itself): insert, pick a mention or command, attach a file. */
  boxes: Record<string, any> = {};
  /** Called when a conversation is read here (the dock clears its own count). */
  onRead: ((id: string) => void) | null = null;
  private entT: ReturnType<typeof setTimeout> | undefined;

  constructor(opts: EngineOpts = {}) {
    this.dock = !!opts.dock;
  }

  /* ---------------------------------------------------------------- React */
  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  };
  snap = () => this.v;
  notify = () => {
    this.v++;
    this.subs.forEach((f) => f());
  };

  /* ---------------------------------------------------------------- helpers */
  phone = () => this.dock || matchMedia('(max-width: 860px)').matches;
  user = (id: string): J => {
    if (id === 'brain') return { id: 'brain', name: 'Favor Brain', brain: true };
    if (id === 'meetings') return { id: 'meetings', name: 'Favor Meetings', sys: 'video' };
    if (id === 'gifts') return { id: 'gifts', name: 'Favor Gifts', sys: 'spark' };
    return this.S.users[id] || { id, name: String(id || '').split('@')[0] || 'Someone' };
  };
  chan = (id: string | null | undefined): J | undefined => (id ? this.S.channels[id] : undefined);
  names: Names = { me: '', user: this.user, chan: this.chan };
  chName = (c: J | undefined): string => {
    if (!c) return '';
    const me = this.S.me?.id;
    if (c.kind === 'dm') return this.user((c.members || []).filter((m: string) => m !== me)[0] || me).name;
    if (c.kind === 'group') return (c.members || []).filter((m: string) => m !== me).map((m: string) => this.user(m).name.split(' ')[0]).join(', ');
    return c.name;
  };
  whereOf = (id: string) => {
    const c = this.chan(id);
    return c ? (c.kind === 'public' ? '#' : '') + this.chName(c) : 'a conversation';
  };
  sorted() {
    const all = Object.values(this.S.channels as Record<string, J>).filter((c) => c.joined !== false);
    return {
      chans: all.filter((c) => c.kind === 'public' || c.kind === 'private').sort((a, b) => a.name.localeCompare(b.name)),
      dms: all.filter((c) => c.kind === 'dm' || c.kind === 'group').sort((a, b) => String(b.last_at || '').localeCompare(String(a.last_at || ''))),
    };
  }
  findMsg = (id: number | string): J | null => {
    const sid = String(id);
    for (const k of Object.keys(this.S.msgs)) for (const m of this.S.msgs[k] || []) if (String(m.id) === sid) return m;
    for (const k of Object.keys(this.S.threads)) {
      const t = this.S.threads[k];
      if (String(t.root.id) === sid) return t.root;
      for (const m of t.replies || []) if (String(m.id) === sid) return m;
    }
    return null;
  };
  toast = (text: string, link?: { href: string; label: string }) => {
    this.ui.toast = { text, link };
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => {
      this.ui.toast = null;
      this.notify();
    }, link ? 6000 : 2600);
    this.notify();
  };
  guard = <T>(p: Promise<T>): Promise<T> =>
    p.catch((e) => {
      this.toast((e && e.message) || 'That did not work. Try again.');
      throw e;
    });
  setModal = (m: Modal | null) => {
    this.ui.modal = m;
    if (m) this.ui.pop = null;
    this.notify();
  };
  setPop = (p: Pop | null) => {
    this.ui.pop = p;
    this.notify();
  };

  /* ---------------------------------------------------------------- the back gesture (phone screens and the full-width thread) */
  private push(close: () => void) {
    if (this.dock) return;
    const rec: { t: Tok | null } = { t: null };
    rec.t = hubOv.on(() => {
      const i = this.navs.indexOf(rec);
      if (i >= 0) this.navs.splice(i, 1);
      close();
      this.syncUrl();
      this.notify();
    });
    this.navs.push(rec);
  }
  private unpush() {
    const rec = this.navs.pop();
    if (rec && rec.t) hubOv.off(rec.t);
  }
  private syncUrl() {
    if (this.dock || !this.attached || !/^\/chat\/?/.test(location.pathname)) return;
    const q = new URLSearchParams(location.search);
    ['c', 't', 'm'].forEach((k) => q.delete(k));
    if (this.S.active && (this.S.view !== 'list' || !this.phone()) && this.S.page === 'channel') q.set('c', this.S.active);
    if (this.S.right === 'thread' && this.S.threadRoot) q.set('t', String(this.S.threadRoot));
    const s = q.toString();
    const url = location.pathname + (s ? '?' + s : '') + location.hash;
    if (url !== location.pathname + location.search + location.hash) {
      try {
        history.replaceState(history.state, '', url);
      } catch {
        // fine
      }
    }
  }
  setView(v: string) {
    this.S.view = v;
    if (!this.dock) document.body.classList.toggle('ch-deep', v !== 'list' && this.phone());
  }

  /* ---------------------------------------------------------------- drafts */
  draftKey(scope: Scope): string | null {
    return scope === 'thread' ? (this.S.threadRoot && this.S.right === 'thread' ? this.S.active + '|' + this.S.threadRoot : null) : this.S.page === 'channel' ? this.S.active : null;
  }
  hasDraft = (key: string) => {
    const d = this.S.drafts[key];
    return !!(d && d.text && d.text.trim());
  };
  draftCount = () => Object.keys(this.S.drafts).filter(this.hasDraft).length;
  saveDraft(scope: Scope, text: string, key = this.draftKey(scope)) {
    if (!key) return;
    const had = this.hasDraft(key);
    if (text.trim()) this.S.drafts[key] = { text, map: this.S.mentionMap[scope], at: Date.now() };
    else delete this.S.drafts[key];
    lsSet('favor.chat.drafts.v1', this.S.drafts);
    if (had !== this.hasDraft(key)) this.notify();
  }
  draftOf(scope: Scope): string {
    const key = this.draftKey(scope);
    const d = key ? this.S.drafts[key] : null;
    this.S.mentionMap[scope] = d && d.map ? Object.assign({}, d.map) : {};
    return d && d.text ? d.text : '';
  }
  clearDraft(scope: Scope, key = this.draftKey(scope)) {
    if (!key || !this.S.drafts[key]) return;
    delete this.S.drafts[key];
    lsSet('favor.chat.drafts.v1', this.S.drafts);
    this.notify();
  }
  dropDraft(key: string) {
    delete this.S.drafts[key];
    lsSet('favor.chat.drafts.v1', this.S.drafts);
    this.notify();
  }

  /* ---------------------------------------------------------------- boot, attach, detach */
  boot(initial?: string | null): Promise<void> {
    if (this.bootP) return this.bootP;
    try {
      const cb = JSON.parse(sessionStorage.getItem(BOOT_CACHE) || 'null');
      if (cb && cb.me && Date.now() - cb.at < 30 * 60000 && !this.S.me) {
        this.S.me = cb.me;
        this.names.me = cb.me.id;
        this.S.users = cb.users || {};
        (cb.channels || []).forEach((c: J) => (this.S.channels[c.id] = c));
        this.S.features = cb.features || this.S.features;
        this.S.threadsUnread = cb.threads_unread || 0;
        this.S.cached = true;
        this.notify();
      }
    } catch {
      // no cache
    }
    let want: string | null = null;
    try {
      want = initial || localStorage.getItem('favor.chat.last');
    } catch {
      want = initial || null;
    }
    const early = want && (!this.phone() || initial) ? chatApi.history(want).then((r) => ({ id: want as string, r }), () => null) : Promise.resolve(null);
    this.bootP = Promise.all([chatApi.boot(), early])
      .then(([b, pre]) => {
        try {
          sessionStorage.setItem(BOOT_CACHE, JSON.stringify({ at: Date.now(), me: b.me, users: b.users, channels: b.channels, features: b.features, threads_unread: b.threads_unread }));
        } catch {
          // full
        }
        const S = this.S;
        S.me = b.me;
        this.names.me = b.me.id;
        S.users = b.users || {};
        S.users[S.me.id] = Object.assign({}, S.users[S.me.id] || {}, S.me);
        Object.entries((b.status || {}) as Record<string, J>).forEach(([id, st]) => S.users[id] && (S.users[id] = { ...S.users[id], status: st }));
        S.features = b.features || { pins: false };
        S.threadsUnread = b.threads_unread || 0;
        S.lang = b.lang || '';
        S.langs = b.langs || [];
        if (S.cached) S.channels = {};
        S.cached = false;
        (b.channels || []).forEach((c: J) => (S.channels[c.id] = c));
        let saved: string | null = null;
        try {
          saved = localStorage.getItem('favor.chat.last');
        } catch {
          // private mode
        }
        const s = this.sorted();
        const gen = s.chans.filter((c) => c.name === 'general')[0];
        const first = (initial && this.chan(initial) && initial) || (saved && this.chan(saved) && this.chan(saved)!.joined !== false && saved) || (gen && gen.id) || (s.chans[0] || s.dms[0] || ({} as J)).id;
        if (pre && pre.id === first && pre.r && pre.r.messages && !S.msgs[first]) {
          S.msgs[first] = pre.r.messages;
          S.hasMore[first] = !!pre.r.more;
        }
        S.booted = true;
        if (first) {
          if (this.phone() && !initial) {
            S.active = first;
            this.setView('list');
          } else this.openChannel(first, { pop: true });
        }
        if (this.phone() && initial && first === initial && S.view === 'channel') this.push(() => this.toList());
        this.unreadOut();
        this.notify();
        this.readAhead();
        this.wantTr();
      })
      .catch((e) => {
        this.S.bootError = { status: e && e.status, message: (e && e.message) || 'Reload the page to try again.' };
        this.bootP = null;
        this.notify();
      });
    return this.bootP;
  }

  /** The Chat page is on screen: open the socket and the timers. */
  attach() {
    if (this.attached) return;
    this.attached = true;
    if (!this.dock) {
      this.sock = new ChatSocket((ev) => this.onEvent(ev));
      this.sock.start();
      this.setView(this.S.view);
      if (this.S.booted) this.resync();
    }
    this.timers.push(
      setInterval(() => {
        // The huddle check: notices a person whose tab closed or phone locked without Leave.
        if (document.hidden || !this.S.active || !this.S.huddle[this.S.active]) return;
        void this.loadHuddle(this.S.active);
      }, 5000),
      setInterval(() => {
        // A Favor Brain answer still thinking after a dropped connection: re-read until it lands.
        if (document.hidden || this.resyncing || this.S.page !== 'channel') return;
        const lists = [this.S.msgs[this.S.active] || []];
        const t = this.S.right === 'thread' && this.S.threadRoot && this.S.threads[this.S.threadRoot];
        if (t) lists.push(t.replies || []);
        const now = Date.now();
        if (lists.some((l: J[]) => l.some((m) => m && m.brain && m.brain.status === 'thinking' && now - Date.parse(m.created_at || 0) > 4000 && now - Date.parse(m.created_at || 0) < 600000))) this.resync();
      }, 4000)
    );
    document.addEventListener('visibilitychange', this.onVis);
    addEventListener('focus', this.markRead);
  }
  detach() {
    if (!this.attached) return;
    this.attached = false;
    if (this.sock) this.sock.stop();
    this.sock = null;
    this.timers.forEach(clearInterval);
    this.timers = [];
    [this.toastT, this.typingT, this.threadsT, this.touchT, this.trT, this.connT, this.entT].forEach(clearTimeout);
    document.removeEventListener('visibilitychange', this.onVis);
    removeEventListener('focus', this.markRead);
    if (!this.dock) document.body.classList.remove('ch-deep', 'ch-kb');
    this.navs = [];
    this.ui = { modal: null, pop: null, toast: null, search: null, switcher: null };
  }
  private onVis = () => {
    if (document.hidden) return;
    this.markRead();
    if (this.S.active && this.S.me) void this.loadHuddle(this.S.active);
  };

  /* ---------------------------------------------------------------- unread */
  totalUnread() {
    let n = 0;
    let m = 0;
    Object.values(this.S.channels as Record<string, J>).forEach((c) => {
      if (c.joined === false || c.muted) return;
      n += c.unread > 0 ? 1 : 0;
      m += c.mentions || 0;
    });
    return { channels: n, mentions: m + (this.S.threadsUnread || 0) };
  }
  unreadOut() {
    if (this.dock) return;
    const u = this.totalUnread();
    const n = u.mentions;
    if (document.body.dataset.nav === 'chat') document.title = (n ? '(' + (n > 99 ? '99+' : n) + ') ' : '') + 'Chat - FavorOS';
    dispatchEvent(new CustomEvent('favor-chat:unread', { detail: u }));
  }
  markRead = () => {
    const S = this.S;
    const c = this.chan(S.active);
    const list = S.msgs[S.active];
    if (!c || !list || !list.length || document.hidden || S.page !== 'channel' || S.keepUnread === S.active || (this.phone() && S.view === 'list')) return;
    const last = list[list.length - 1].id;
    if (c.unread || c.mentions || Number(c.last_read || 0) < Number(last)) {
      c.unread = 0;
      c.mentions = 0;
      c.last_read = last;
      void chatApi.read(S.active, last);
      if (this.onRead) this.onRead(S.active);
      this.unreadOut();
      this.notify();
    }
  };

  /* ---------------------------------------------------------------- opening things */
  toList() {
    this.S.right = 'none';
    this.S.threadRoot = null;
    this.setView('list');
  }
  openChannel(id: string, o: { pop?: boolean } = {}) {
    const S = this.S;
    const c = this.chan(id);
    if (!c) return;
    const changed = S.active !== id || S.page !== 'channel';
    const wasList = S.view === 'list';
    S.active = id;
    S.page = 'channel';
    if (!this.dock) {
      try {
        localStorage.setItem('favor.chat.last', id);
      } catch {
        // private mode
      }
    }
    if (changed) {
      S.right = S.right === 'details' && !this.phone() ? 'details' : 'none';
      if (S.threadRoot) delete S.threadNew[S.threadRoot];
      S.threadRoot = null;
      S.threadFull = false;
      S.editing = null;
      S.newBelow.main = 0;
    }
    S.keepUnread = null;
    S.lastRead[id] = c.last_read != null ? c.last_read : S.lastRead[id];
    this.setView('channel');
    if (this.phone() && !o.pop && wasList) this.push(() => this.toList());
    this.toBottom.main = Date.now();
    this.S.unreadJump = id;
    if (!S.msgs[id]) {
      void this.guard(chatApi.history(id)).then((r) => {
        S.msgs[id] = r.messages;
        S.hasMore[id] = !!r.more;
        if (S.active === id && S.page === 'channel') {
          this.toBottom.main = Date.now();
          this.markRead();
          this.catchCheck();
          this.wantTr();
        }
        this.notify();
      });
    } else {
      this.markRead();
      this.catchCheck();
      if (S.warm[id]) {
        S.warm[id] = false;
        chatApi
          .history(id)
          .then((r) => {
            S.msgs[id] = r.messages;
            S.hasMore[id] = !!r.more;
            this.notify();
          })
          .catch(() => undefined);
      }
    }
    void this.loadHuddle(id);
    if (!this.phone()) this.composerFocus = { scope: 'main', n: Date.now() };
    this.syncUrl();
    this.unreadOut();
    this.wantTr();
    this.notify();
  }
  openPage(page: string) {
    if (!PAGES[page]) return;
    const S = this.S;
    if (S.threadRoot) delete S.threadNew[S.threadRoot];
    const wasList = S.view === 'list';
    S.page = page;
    S.right = 'none';
    S.threadRoot = null;
    S.threadFull = false;
    S.editing = null;
    this.setView('channel');
    if (this.phone() && wasList) this.push(() => this.toList());
    this.syncUrl();
    this.notify();
    if (page === 'threads') void this.guard(chatApi.threads()).then((r) => this.takeThreads(r));
    if (page === 'activity')
      void this.guard(chatApi.activity()).then((r) => {
        S.activity = r.items || [];
        this.notify();
      });
  }
  takeThreads(r: J) {
    const S = this.S;
    S.threadList = r.threads || [];
    S.threadsUnread = r.unread || 0;
    const by: Record<string, number> = {};
    S.threadList.forEach((t: J) => (by[t.root.id] = t.unread));
    Object.keys(S.msgs).forEach((k) => {
      S.msgs[k] = (S.msgs[k] || []).map((m: J) => (m.reply_count && by[m.id] != null && !(S.right === 'thread' && m.id === S.threadRoot) && m.thread_unread !== by[m.id] ? { ...m, thread_unread: by[m.id] } : m));
    });
    this.unreadOut();
    this.notify();
  }
  refreshThreads() {
    clearTimeout(this.threadsT);
    this.threadsT = setTimeout(() => {
      chatApi
        .threads()
        .then((r) => this.takeThreads(r))
        .catch(() => undefined);
    }, 500);
  }
  openThread(id0: number | string, o: { pop?: boolean; full?: boolean } = {}) {
    const S = this.S;
    const id = Number(id0);
    const was = S.right === 'thread' && S.threadRoot === id;
    if (S.right === 'thread' && S.threadRoot && !was) delete S.threadNew[S.threadRoot];
    const deeper = S.right !== 'thread';
    S.right = 'thread';
    S.threadRoot = id;
    S.editing = null;
    S.newBelow.thread = 0;
    if (o.full != null) S.threadFull = !!o.full && !this.phone();
    const found = (S.msgs[S.active] || []).filter((m: J) => String(m.id) === String(id))[0];
    if (found && !S.threads[id]) S.threads[id] = { root: found, replies: [] };
    this.setView('thread');
    if (!o.pop && deeper && (this.phone() || S.threadFull)) this.push(() => this.closeRightNow());
    S.threadPlaced = null;
    this.syncUrl();
    this.notify();
    void this.guard(chatApi.thread(id)).then((t) => {
      t.loaded = true;
      if (t.unread > 0) {
        const k = t.replies.length - t.unread;
        S.threadNew[id] = k > 0 ? t.replies[k - 1].id : t.root.id;
      }
      S.threads[id] = t;
      this.threadRead(id, t.threads_unread);
      this.wantTr();
      this.notify();
    });
    if (!this.phone()) this.composerFocus = { scope: 'thread', n: Date.now() };
  }
  openThreadIn(channelId: string, id: number | string, o: { full?: boolean } = {}) {
    if (!this.chan(channelId)) return;
    if (this.S.active !== channelId || this.S.page !== 'channel') this.openChannel(channelId, { pop: this.S.page !== 'channel' });
    this.openThread(id, o);
  }
  threadRead(id: number, total?: number) {
    const S = this.S;
    this.patchWhere(id, (m) => (m.thread_unread ? { ...m, thread_unread: 0 } : m));
    (S.threadList || []).forEach((t: J) => {
      if (t.root.id === id) t.unread = 0;
    });
    if (total != null) S.threadsUnread = total;
    this.unreadOut();
  }
  private touchThread(id: number) {
    clearTimeout(this.touchT);
    this.touchT = setTimeout(() => {
      const S = this.S;
      if (S.threadRoot !== id || S.right !== 'thread' || document.hidden) return;
      chatApi
        .thread(id)
        .then((t) => {
          t.loaded = true;
          if (S.threadRoot !== id) return;
          S.threads[id] = t;
          this.threadRead(id, t.threads_unread);
          this.notify();
        })
        .catch(() => undefined);
    }, 900);
  }
  /** Close the thread, details or pins. On a phone (and for the full-width thread) the step in the browser's history goes too. */
  closeRight() {
    if (this.navs.length && this.S.right !== 'none' && (this.phone() || this.S.threadFull)) this.unpush();
    this.closeRightNow();
    this.syncUrl();
    this.notify();
  }
  private closeRightNow() {
    const S = this.S;
    if (S.right === 'thread' && S.threadRoot) delete S.threadNew[S.threadRoot];
    S.right = 'none';
    S.threadRoot = null;
    S.threadFull = false;
    this.setView('channel');
    if (!this.phone() && S.page === 'channel') this.composerFocus = { scope: 'main', n: Date.now() };
  }
  setFull(on: boolean) {
    const S = this.S;
    if (this.phone() || S.right !== 'thread' || on === S.threadFull) return;
    if (on) {
      S.threadFull = true;
      this.push(() => {
        S.threadFull = false;
      });
    } else {
      this.unpush();
      S.threadFull = false;
    }
    this.composerFocus = { scope: 'thread', n: Date.now() };
    this.notify();
  }
  openDetails(tab?: string) {
    const S = this.S;
    if (S.right === 'details' && !this.phone() && !tab) return this.closeRight();
    const deeper = S.right === 'none';
    if (S.right === 'thread' && S.threadRoot) delete S.threadNew[S.threadRoot];
    S.right = 'details';
    S.threadRoot = null;
    S.threadFull = false;
    S.tab = tab || 'about';
    this.setView('details');
    if (this.phone() && deeper) this.push(() => this.closeRightNow());
    this.syncUrl();
    this.notify();
  }
  openPins() {
    const S = this.S;
    if (S.right === 'pins' && !this.phone()) return this.closeRight();
    const deeper = S.right === 'none';
    S.right = 'pins';
    S.threadRoot = null;
    S.threadFull = false;
    this.setView('details');
    if (this.phone() && deeper) this.push(() => this.closeRightNow());
    this.notify();
    void this.loadPins(S.active);
  }
  back() {
    const S = this.S;
    if (S.view === 'thread' || S.view === 'details') return this.closeRight();
    if (!this.phone()) {
      if (S.page !== 'channel' && S.active) this.openChannel(S.active);
      return;
    }
    if (this.navs.length) this.unpush();
    this.toList();
    this.syncUrl();
    this.notify();
  }
  loadPins(id: string) {
    return this.guard(chatApi.pins(id)).then((r) => {
      this.S.pins[id] = { pins: r.pins || [], bookmarks: r.bookmarks || [] };
      const c = this.chan(id);
      if (c) {
        c.pins = this.S.pins[id].pins.length;
        c.bookmarks = this.S.pins[id].bookmarks;
      }
      this.notify();
    });
  }

  /* ---------------------------------------------------------------- read ahead */
  private readAhead() {
    const S = this.S;
    const ids = Object.values(S.channels as Record<string, J>)
      .filter((c) => c.joined !== false && (c.id !== S.active || S.view === 'list') && !S.msgs[c.id])
      .sort((a, b) => Number(b.unread > 0) - Number(a.unread > 0) || String(b.last_at || '').localeCompare(String(a.last_at || '')))
      .slice(0, this.dock ? 3 : 6)
      .map((c) => c.id as string);
    const next = () => {
      const id = ids.shift();
      if (!id) return;
      if (S.msgs[id]) return next();
      chatApi
        .history(id)
        .then(
          (r) => {
            if (!S.msgs[id]) {
              S.msgs[id] = r.messages;
              S.hasMore[id] = !!r.more;
              S.warm[id] = true;
              (r.messages || []).slice(-15).forEach((m: J) =>
                (m.attachments || []).forEach((a: J) => {
                  const u = a.type === 'clip' && a.thumb ? a.thumb : a.type === 'file' && /^image\//.test(a.mime || '') ? a.url : '';
                  if (u) {
                    const im = new Image();
                    im.decoding = 'async';
                    im.src = u;
                  }
                })
              );
              if (id === S.active) this.notify();
            }
          },
          () => undefined
        )
        .then(() => setTimeout(next, 250));
    };
    setTimeout(next, 0);
  }

  /* ---------------------------------------------------------------- sending */
  tokenize(scope: Scope, text: string): string {
    const map = this.S.mentionMap[scope] || {};
    Object.keys(map)
      .sort((a, b) => b.length - a.length)
      .forEach((label) => {
        const re = new RegExp('(^|[^\\w])' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w])', 'g');
        text = text.replace(re, (_m, pre: string) => pre + map[label]);
      });
    return text;
  }
  /** Returns true when the text was taken (sent or run as a command), so the box clears. */
  send(scope: Scope, raw: string, also = false): boolean {
    const S = this.S;
    const c = this.chan(S.active);
    if (!c) {
      // Sent while Chat is still loading: it goes out as soon as the conversation is open; if none opens, the words come back.
      if (!this.bootP || raw.trim() === '') return false;
      void this.bootP.then(() => {
        if (!this.chan(this.S.active) || !this.send(scope, raw, also)) {
          this.S.restore = { scope, text: raw, n: Date.now() };
          this.notify();
        }
      });
      return true;
    }
    if (S.pending[scope].some((a: J) => a.uploading)) {
      this.toast('Wait for the upload to finish');
      return false;
    }
    if (!S.pending[scope].length && this.runSlash(scope, raw.trim())) return true;
    const body = this.tokenize(scope, raw).trim();
    const att = S.pending[scope].filter((a: J) => !a.uploading).map((a: J) => {
      const { preview, uploading, ...rest } = a;
      void preview;
      void uploading;
      return rest;
    });
    if (!body && !att.length) return false;
    const map = S.mentionMap[scope];
    const thread = scope === 'thread' ? S.threadRoot : null;
    const key = this.draftKey(scope);
    S.pending[scope] = [];
    S.mentionMap[scope] = {};
    this.clearDraft(scope);
    this.setPop(null);
    void this.guard(chatApi.send(S.active, { body, thread_id: thread, attachments: att, also: also || undefined }))
      .then((m) => {
        this.toBottom[scope] = Date.now();
        this.addMessage(m, true);
      })
      .catch(() => {
        if (key) {
          S.drafts[key] = { text: raw, map, at: Date.now() };
          lsSet('favor.chat.drafts.v1', S.drafts);
          this.composerFocus = { scope, n: Date.now(), prefix: '' };
          this.S.restore = { scope, text: raw, n: Date.now() };
          this.notify();
        }
      });
    this.notify();
    return true;
  }
  typing(scope: Scope, text: string) {
    if (Date.now() - this.typingSent > 3000 && text && text.charAt(0) !== '/') {
      this.typingSent = Date.now();
      chatApi.typing(this.S.active, scope === 'thread' ? this.S.threadRoot : null);
    }
  }
  askBrain(q: string, o: { thread?: number | null; channel?: string | null; hidden?: boolean; intent?: string } = {}) {
    const ch = o.channel && this.chan(o.channel) ? o.channel : this.S.active;
    q = String(q || '').trim();
    if (!q || !this.chan(ch)) return Promise.resolve();
    return this.guard(chatApi.send(ch, { body: '<@brain> ' + q, thread_id: o.thread || null, private: o.hidden ? true : undefined, intent: o.intent || undefined })).then((m) => {
      this.toBottom.main = Date.now();
      this.addMessage(m, true);
    });
  }
  static SLASH = [
    { cmd: 'brain', args: 'question', sub: 'Ask Favor Brain', icon: 'spark' },
    { cmd: 'request', args: 'summary', sub: 'Make a request board card', icon: 'task' },
    { cmd: 'huddle', args: '', sub: 'Start or join a huddle here', icon: 'headset' },
    { cmd: 'clip', args: '', sub: 'Record a clip and post it here', icon: 'rec' },
    { cmd: 'remind', args: 'me tomorrow 9am to ...', sub: 'Remind me, #channel or @person later', icon: 'bell' },
    { cmd: 'schedule', args: 'monday 8am message', sub: 'Post a message later', icon: 'clock' },
    { cmd: 'todo', args: 'Title: item @person fri; item', sub: 'Checklist; each line is a task in Projects', icon: 'task' },
    { cmd: 'task', args: 'what needs doing @person due fri', sub: 'Make a task in Projects', icon: 'task' },
    { cmd: 'poll', args: 'Question? | choice | choice', sub: 'Ask everyone to pick', icon: 'list' },
    { cmd: 'meet', args: 'tomorrow 10am title', sub: 'Book a meeting with everyone here', icon: 'video' },
    { cmd: 'status', args: 'In Uganda until friday', sub: 'Set a status beside your name', icon: 'spark' },
    { cmd: 'away', args: 'until monday', sub: 'Out of office; direct messages get a note', icon: 'spark' },
    { cmd: 'back', args: '', sub: 'Clear your status', icon: 'spark' },
    { cmd: 'scheduled', args: '', sub: 'What you have waiting to post', icon: 'clock' },
  ];
  /** Commands the server runs (chat/plus.ts and /task): the text is sent as typed. */
  static SERVER_SLASH = new Set(['remind', 'schedule', 'todo', 'checklist', 'task', 'poll', 'meet', 'status', 'away', 'back', 'scheduled']);
  runSlash(scope: Scope, raw: string): boolean {
    const m = String(raw || '').match(/^\/([a-z]+)(?:\s+([\s\S]*))?$/i);
    if (!m) return false;
    const cmd = m[1].toLowerCase();
    const rest = (m[2] || '').trim();
    if (!ChatEngine.SLASH.some((c) => c.cmd === cmd) || ChatEngine.SERVER_SLASH.has(cmd)) return false;
    const thread = scope === 'thread' ? this.S.threadRoot : null;
    this.clearDraft(scope);
    if (cmd === 'brain') {
      if (!rest) {
        this.toast('Type a question after /brain');
        return false;
      }
      void this.askBrain(rest, { thread });
    } else if (cmd === 'request') this.setModal({ kind: 'request', title: rest, thread });
    else if (cmd === 'huddle') this.openHuddle(this.S.active);
    else if (cmd === 'clip') this.recordClip();
    return true;
  }
  recordClip() {
    const cam = document.getElementById('clip-cam') as HTMLButtonElement | null;
    if (!cam || cam.hidden || getComputedStyle(cam).display === 'none') {
      this.toast('Recording is not available for your account');
      return;
    }
    this.S.pendingClip = this.S.active;
    cam.click();
  }
  /** A clip saved from the recorder this channel opened is posted here (the recorder announces it on the favor-clips channel). */
  clipSaved(id: string) {
    const ch = this.S.pendingClip;
    if (!ch) return;
    this.S.pendingClip = null;
    chatApi
      .send(ch, { body: '', attachments: [{ type: 'clip', id }] })
      .then((m) => this.addMessage(m, true))
      .catch(() => undefined);
  }

  /* ---------------------------------------------------------------- arriving messages */
  addMessage(m: J, mine: boolean) {
    const S = this.S;
    const ch = this.chan(m.channel_id);
    if (!ch) {
      this.resync();
      return;
    }
    ch.last_at = m.created_at;
    if (m.thread_id) {
      const t = S.threads[m.thread_id];
      const isNew = !(t && (t.replies || []).some((x: J) => String(x.id) === String(m.id)));
      if (!m.visible_to && isNew)
        this.patchWhere(m.thread_id, (p) => (p.channel_id === m.channel_id && !p.thread_id ? { ...p, reply_count: (p.reply_count || 0) + 1, last_reply_at: m.created_at, reply_users: (p.reply_users || []).filter((u: string) => u !== m.user_id).concat([m.user_id]).slice(-3) } : p));
      if (t && isNew) t.replies = t.replies.concat([m]);
      if (S.threadTyping[m.thread_id]) delete S.threadTyping[m.thread_id][m.user_id];
      const open = S.active === m.channel_id && S.right === 'thread' && S.threadRoot === m.thread_id;
      if (open && !mine && isNew && !S.threadPinned) S.newBelow.thread += 1;
      if (open && mine) this.toBottom.thread = Date.now();
      if (!mine && !m.visible_to) {
        if (open && !document.hidden) this.touchThread(m.thread_id);
        else this.refreshThreads();
      }
      if (!m.visible_to) this.notifyIfNeeded(m, ch);
      this.wantTr();
      this.notify();
      return;
    }
    if (S.typing[m.channel_id] && S.typing[m.channel_id][m.user_id]) delete S.typing[m.channel_id][m.user_id];
    const list = S.msgs[m.channel_id];
    if (list) {
      if (list.some((x: J) => String(x.id) === String(m.id))) return;
      S.msgs[m.channel_id] = list.concat([m]);
    }
    const here = S.active === m.channel_id && S.page === 'channel' && !(this.phone() && S.view === 'list');
    if (here && !document.hidden) {
      if (!mine && !S.pinned) S.newBelow.main += 1;
      if (mine) this.toBottom.main = Date.now();
      if (!mine) this.markRead();
      else if (!m.visible_to) {
        ch.last_read = m.id;
        void chatApi.read(m.channel_id, m.id);
      }
    }
    if (!m.visible_to) this.notifyIfNeeded(m, ch);
    if (here) this.catchCheck();
    // A meeting card: read the channel's huddle now, so the bar and the card show who is in the room.
    if ((m.attachments || []).some((a: J) => a.type === 'meeting')) void this.loadHuddle(m.channel_id);
    this.wantTr();
    this.notify();
  }
  private notifyIfNeeded(m: J, ch: J) {
    const S = this.S;
    if (m.user_id === S.me.id) return;
    const viewing = S.active === m.channel_id && S.page === 'channel' && !document.hidden && S.keepUnread !== m.channel_id && !(this.phone() && S.view === 'list');
    const care = mentionsMe(m, S.me.id) || ch.kind === 'dm' || ch.kind === 'group';
    if (!viewing && !m.thread_id) {
      ch.unread = (ch.unread || 0) + 1;
      if (care) ch.mentions = (ch.mentions || 0) + 1;
      this.unreadOut();
    }
    if (!viewing && !ch.muted && care && !this.dock) this.desktopNotice(m, ch);
  }
  private desktopNotice(m: J, ch: J) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || (!document.hidden && document.hasFocus())) return;
    const who = this.user(m.user_id).name;
    const where = ch.kind === 'dm' ? who : ch.kind === 'group' ? 'Group conversation' : '#' + ch.name;
    const text = plain(m.body, this.names).replace(/<#[^>]+>/g, '').trim() || 'Shared an attachment';
    try {
      const n = new Notification(ch.kind === 'dm' ? who : who + ' in ' + where, { body: text.slice(0, 180), tag: 'chat-' + ch.id, icon: '/images/favor-icon.png' });
      n.onclick = () => {
        focus();
        if (m.thread_id) this.openThreadIn(ch.id, m.thread_id);
        else this.openChannel(ch.id);
        n.close();
      };
    } catch {
      // a phone browser outside the home screen app has no notices
    }
  }
  /** Replace a message everywhere it is kept (channel lists, threads), by id. */
  patchWhere(id: number | string, fn: (m: J) => J) {
    const S = this.S;
    const sid = String(id);
    let done = false;
    Object.keys(S.msgs).forEach((k) => {
      const l = S.msgs[k] || [];
      const i = l.findIndex((x: J) => String(x.id) === sid);
      if (i >= 0) {
        const n = fn(l[i]);
        if (n !== l[i]) {
          const c = l.slice();
          c[i] = n;
          S.msgs[k] = c;
        }
        done = true;
      }
    });
    Object.keys(S.threads).forEach((k) => {
      const t = S.threads[k];
      if (String(t.root.id) === sid) {
        t.root = fn(t.root);
        done = true;
      }
      const i = (t.replies || []).findIndex((x: J) => String(x.id) === sid);
      if (i >= 0) {
        const c = t.replies.slice();
        c[i] = fn(c[i]);
        t.replies = c;
        done = true;
      }
    });
    Object.keys(S.pins).forEach((k) => {
      const P = S.pins[k];
      const i = (P.pins || []).findIndex((x: J) => String(x.id) === sid);
      if (i >= 0) {
        const c = P.pins.slice();
        c[i] = fn(c[i]);
        P.pins = c;
      }
    });
    return done;
  }
  patchMessage(nm: J) {
    if (this.patchWhere(nm.id, (m) => ({ ...m, ...nm }))) this.notify();
  }
  purgeMessage(id: number | string) {
    const S = this.S;
    const sid = String(id);
    Object.keys(S.msgs).forEach((k) => {
      if ((S.msgs[k] || []).some((x: J) => String(x.id) === sid)) S.msgs[k] = S.msgs[k].filter((x: J) => String(x.id) !== sid);
    });
    Object.keys(S.threads).forEach((k) => {
      const t = S.threads[k];
      if ((t.replies || []).some((x: J) => String(x.id) === sid)) t.replies = t.replies.filter((x: J) => String(x.id) !== sid);
    });
    this.notify();
  }

  /* ---------------------------------------------------------------- one message */
  react(id: number, em: string) {
    return this.guard(chatApi.react(id, em)).then((r) => {
      if (r && r.reactions) this.patchMessage({ id, reactions: r.reactions });
    });
  }
  startEdit(id: number) {
    this.S.editing = id;
    this.S.editDraft = null;
    this.setPop(null);
  }
  saveEdit(id: number, text: string) {
    const v = this.tokenize('main', text).trim();
    if (!v) return;
    this.S.editing = null;
    this.notify();
    void this.guard(chatApi.edit(id, v))
      .then((m) => this.patchMessage(m))
      .catch(() => this.notify());
  }
  del(id: number) {
    this.setModal(null);
    void this.guard(chatApi.del(id)).then((r) => {
      const m = this.findMsg(id);
      if (m && m.visible_to) this.purgeMessage(id);
      else this.patchMessage({ id, deleted: true, body: '', attachments: [], pinned: false });
      if (r && r.also) this.patchMessage({ id: r.also, deleted: true, body: '', attachments: [], pinned: false });
    });
  }
  pin(id: number, on: boolean) {
    this.setPop(null);
    void this.guard(chatApi.pin(id, on)).then((r) => {
      this.patchMessage({ id, pinned: on });
      const pc = this.chan(r.channel_id);
      if (pc) pc.pins = r.pins;
      delete this.S.pins[r.channel_id];
      if (this.S.right === 'pins') void this.loadPins(r.channel_id);
      this.toast(on ? 'Pinned' : 'Unpinned');
    });
  }
  markUnread(id: number) {
    this.setPop(null);
    const um = this.findMsg(id);
    if (!um) return;
    void this.guard(chatApi.unread(um.channel_id, id)).then((r) => {
      const uc = this.chan(um.channel_id);
      if (!uc) return;
      uc.last_read = r.last_read;
      uc.unread = r.unread;
      uc.mentions = r.mentions;
      this.S.lastRead[uc.id] = r.last_read;
      this.S.keepUnread = uc.id;
      this.unreadOut();
      this.toast('Marked unread');
    });
  }
  copyText(id: number) {
    this.setPop(null);
    const m = this.findMsg(id);
    const txt = m ? plain(m.body, this.names).replace(/<#[^>]+>/g, '') : '';
    if (navigator.clipboard)
      navigator.clipboard.writeText(txt).then(
        () => this.toast('Copied'),
        () => this.toast('Copy did not work')
      );
  }
  linkTo(m: J) {
    return location.origin + '/chat/?c=' + encodeURIComponent(m.channel_id) + (m.thread_id ? '&t=' + m.thread_id : '') + '&m=' + m.id;
  }
  copyLink(id: number) {
    this.setPop(null);
    const m = this.findMsg(id);
    if (m && navigator.clipboard)
      navigator.clipboard.writeText(this.linkTo(m)).then(
        () => this.toast('Link copied'),
        () => this.toast('Copy did not work')
      );
  }
  shareAnswer(id: number, summary = false): Promise<void> {
    // An answer with partner records goes only where everyone has partner access in the Brain. Elsewhere the server refuses, and
    // the person may share the summary without partner details instead.
    return chatApi
      .shareAnswer(id, summary)
      .then((r) => {
        this.purgeMessage(id);
        if (r && r.message) this.addMessage(r.message, true);
        this.toast(summary ? 'Shared the summary' : 'Shared to the channel');
      })
      .catch((e: any) => {
        if (!summary && e && e.code === 'partner_audience' && window.confirm(`${e.message}\n\nShare the summary only?`)) return this.shareAnswer(id, true);
        this.toast((e && e.message) || 'That did not work. Try again.');
        throw e;
      });
  }
  dismissAnswer(id: number) {
    return this.guard(chatApi.dismissAnswer(id)).then(() => this.purgeMessage(id));
  }
  focusMessage(id: number, inThread = false) {
    this.focusReq = { id, thread: inThread, n: Date.now() };
    this.notify();
  }
  jumpTo(h: J) {
    this.ui.search = null;
    this.ui.switcher = null;
    const go = () => {
      if (h.thread_id) {
        this.openThread(h.thread_id);
        this.focusMessage(h.id, true);
      } else if ((this.S.msgs[h.channel_id] || []).some((x: J) => String(x.id) === String(h.id))) this.focusMessage(h.id);
      else this.toast('That message is further back');
    };
    if (this.S.active !== h.channel_id || this.S.page !== 'channel') {
      this.openChannel(h.channel_id);
      let n = 0;
      const w = setInterval(() => {
        if (this.S.msgs[h.channel_id] || ++n > 60) {
          clearInterval(w);
          go();
        }
      }, 60);
    } else go();
    this.notify();
  }
  older() {
    const S = this.S;
    const id = S.active;
    const lst = S.msgs[id];
    if (!lst || !lst.length) return;
    void this.guard(chatApi.history(id, lst[0].id)).then((r) => {
      S.msgs[id] = r.messages.concat(S.msgs[id] || []);
      S.hasMore[id] = !!r.more;
      S.keepScroll = Date.now();
      this.notify();
    });
  }

  /* ---------------------------------------------------------------- conversations */
  private take(c: J) {
    this.S.channels[c.id] = Object.assign(this.S.channels[c.id] || {}, c, { joined: true });
  }
  openDm(ids: string[]) {
    return this.guard(chatApi.openDm(ids)).then((c) => {
      this.take(c);
      this.openChannel(c.id);
    });
  }
  join(id: string) {
    return this.guard(chatApi.join(id)).then((c) => {
      this.take(c);
      this.openChannel(c.id);
    });
  }
  createChannel(p: J) {
    return this.guard(chatApi.createChannel(p)).then((c) => {
      this.S.channels[c.id] = c;
      this.S.msgs[c.id] = this.S.msgs[c.id] || [];
      this.setModal(null);
      this.openChannel(c.id);
    });
  }
  leave() {
    const lc = this.chan(this.S.active);
    if (!lc) return;
    void this.guard(chatApi.leave(lc.id)).then(() => {
      lc.joined = false;
      if (this.navs.length && this.S.right !== 'none') this.unpush();
      this.S.right = 'none';
      this.toast('You left ' + (lc.kind === 'group' ? 'the conversation' : '#' + lc.name));
      const nx = this.sorted().chans[0];
      if (nx && !this.phone()) this.openChannel(nx.id);
      else {
        if (this.navs.length) this.unpush();
        this.S.active = nx ? nx.id : null;
        this.toList();
      }
      this.unreadOut();
      this.notify();
    });
  }
  mute() {
    const mc = this.chan(this.S.active);
    if (!mc) return;
    mc.muted = !mc.muted;
    void this.guard(chatApi.mute(mc.id, mc.muted));
    this.toast(mc.muted ? 'Muted' : 'Unmuted');
    this.unreadOut();
    this.notify();
  }
  addMembers(ids: string[]) {
    const cc = this.chan(this.S.active);
    if (!cc) return;
    void this.guard(chatApi.addMembers(cc.id, ids)).then((c) => {
      Object.assign(cc, c);
      this.notify();
    });
  }
  setTopic(t: string) {
    const id = this.S.active;
    void chatApi.setTopic(id, t).then(() => {
      const c = this.chan(id);
      if (c) c.topic = t;
      this.notify();
    });
  }
  addBookmark(url: string, title: string) {
    return this.guard(chatApi.addBookmark(this.S.active, { url, title })).then((r) => {
      const c = this.chan(this.S.active);
      if (c) c.bookmarks = r.bookmarks;
      if (this.S.pins[this.S.active]) this.S.pins[this.S.active].bookmarks = r.bookmarks;
      this.setModal(null);
    });
  }
  removeBookmark(id: string) {
    void this.guard(chatApi.removeBookmark(this.S.active, id)).then((r) => {
      const c = this.chan(this.S.active);
      if (c) c.bookmarks = r.bookmarks;
      if (this.S.pins[this.S.active]) this.S.pins[this.S.active].bookmarks = r.bookmarks;
      this.notify();
    });
  }
  makeRequest(p: J) {
    return this.guard(chatApi.makeRequest(p.channel || this.S.active, p)).then((r) => {
      this.setModal(null);
      if (r.message) this.addMessage(r.message, true);
      this.toast('Request made');
    });
  }

  /* ---------------------------------------------------------------- attachments */
  addFiles(scope: Scope, files: FileList | File[]) {
    Array.prototype.forEach.call(files, (f: File) => {
      const item: J = { type: 'file', name: f.name || 'Pasted picture', size: f.size, mime: f.type, uploading: true };
      if (/^image\//.test(f.type || '') && URL.createObjectURL) {
        item.preview = URL.createObjectURL(f);
        const im = new Image();
        im.onload = () => {
          item.w = im.naturalWidth;
          item.h = im.naturalHeight;
        };
        im.src = item.preview;
      }
      this.pend(scope, item);
      void this.guard(chatApi.upload(f))
        .then((r) => {
          Object.assign(item, r, { uploading: false });
          this.S.pending[scope] = this.S.pending[scope].slice();
          this.notify();
        })
        .catch(() => this.dropPend(scope, item));
    });
  }
  pend(scope: Scope, att: J) {
    this.S.pending[scope] = this.S.pending[scope].concat([att]);
    this.notify();
  }
  dropPend(scope: Scope, att: J) {
    this.S.pending[scope] = this.S.pending[scope].filter((x: J) => x !== att);
    this.notify();
  }

  /* ---------------------------------------------------------------- huddles */
  loadHuddle(id: string) {
    return chatApi
      .huddle(id)
      .then((h) => this.setHuddle(id, h))
      .catch(() => undefined);
  }
  setHuddle(id: string, h: J | null) {
    const prev = this.S.huddle[id];
    const next = h && h.live !== false ? h : null;
    if (JSON.stringify(prev || null) === JSON.stringify(next)) return;
    this.S.huddle[id] = next;
    this.notify();
  }
  openHuddle(channelId: string) {
    const c = this.chan(channelId);
    if (!c) return;
    this.setPop(null);
    const P = (window as any).FavorPrejoin;
    if (!P) {
      void this.guard(chatApi.startMeeting(channelId)).then((r) => {
        if (r && r.url) location.href = r.url;
      });
      return;
    }
    const name = c.kind === 'public' ? '#' + c.name : c.kind === 'private' ? c.name : this.chName(c);
    P.open({
      title: 'Huddle in ' + name,
      me: { email: this.S.me.id, name: this.S.me.name },
      face: (p: J) => {
        const u = p.email ? this.user(p.email) : { name: p.name };
        return '<span class="ch-av ch-av--sm" data-c="sky">' + (u.name || '?').slice(0, 1) + '</span>';
      },
      load: () => chatApi.huddle(channelId).then((h) => (this.setHuddle(channelId, h), h ? { live: true, startedAt: h.startedAt, people: h.people } : { live: false, people: [] })),
      emptyLine: 'No huddle going',
      joinLabel: (st: J, list: J[]) => (st.live && list.length ? 'Join huddle' : 'Start a huddle'),
      join: () => chatApi.startMeeting(channelId).then((r) => ({ id: r.id || (r.message && r.message.attachments && r.message.attachments[0] && r.message.attachments[0].id), url: r.url })),
    });
  }

  /* ---------------------------------------------------------------- live events */
  onEvent = (ev: Ev) => {
    const S = this.S;
    if (!S.me && ev.type !== 'conn') return;
    if (ev.type === 'message') this.addMessage(ev.message, ev.message.user_id === S.me.id);
    else if (ev.type === 'edit') this.patchMessage(ev.message);
    else if (ev.type === 'delete' && ev.purge) this.purgeMessage(ev.id);
    else if (ev.type === 'delete') this.patchMessage({ id: ev.id, deleted: true, body: '', attachments: [] });
    else if (ev.type === 'reaction') this.patchMessage({ id: ev.id, reactions: ev.reactions });
    else if (ev.type === 'typing') {
      if (ev.thread_id) (S.threadTyping[ev.thread_id] = S.threadTyping[ev.thread_id] || {})[ev.user_id] = Date.now();
      else (S.typing[ev.channel_id] = S.typing[ev.channel_id] || {})[ev.user_id] = Date.now();
      if (S.active === ev.channel_id) this.typingTick();
    } else if (ev.type === 'pin') {
      this.patchWhere(ev.id, (m) => ({ ...m, pinned: !!ev.on }));
      const pc = this.chan(ev.channel_id);
      if (pc) pc.pins = ev.pins;
      delete S.pins[ev.channel_id];
      if (S.right === 'pins' && S.active === ev.channel_id) void this.loadPins(ev.channel_id);
      this.notify();
    } else if (ev.type === 'bar') {
      const c = this.chan(ev.channel_id);
      if (c) c.bookmarks = ev.bookmarks || [];
      if (S.pins[ev.channel_id]) S.pins[ev.channel_id].bookmarks = ev.bookmarks || [];
      this.notify();
    } else if (ev.type === 'presence') {
      if (S.users[ev.user_id]) {
        S.users[ev.user_id] = { ...S.users[ev.user_id], presence: ev.presence };
        this.notify();
      }
    } else if (ev.type === 'channel') {
      const prev = S.channels[ev.channel.id];
      const mine = (ev.channel.members || null) as string[] | null;
      S.channels[ev.channel.id] = Object.assign(prev || {}, ev.channel);
      // Added back to a conversation (or removed from it) by someone else.
      if (mine) S.channels[ev.channel.id].joined = mine.indexOf(S.me.id) >= 0;
      this.notify();
    } else if (ev.type === 'status') {
      if (S.users[ev.user_id]) {
        S.users[ev.user_id] = { ...S.users[ev.user_id], status: ev.status || null };
        this.notify();
      }
    } else if (ev.type === 'users') {
      Object.assign(S.users, ev.users);
      this.notify();
    } else if (ev.type === 'conn') this.setConn(ev.ok);
    else if (ev.type === 'resync') this.resync();
    else if (ev.type === 'huddle') this.setHuddle(ev.channel_id, ev.huddle);
  };
  private typingTick() {
    clearTimeout(this.typingT);
    this.notify();
    const now = Date.now();
    const live = (t: J) => Object.keys(t || {}).some((id) => id !== this.S.me.id && now - t[id] < 5000);
    if (live(this.S.typing[this.S.active]) || live(this.S.threadTyping[this.S.threadRoot])) this.typingT = setTimeout(() => this.typingTick(), 1000);
  }
  typingNames(t: J): string {
    const now = Date.now();
    const names = Object.keys(t || {})
      .filter((id) => id !== this.S.me?.id && now - t[id] < 5000)
      .map((id) => this.user(id).name.split(' ')[0]);
    return names.length ? (names.length === 1 ? names[0] + ' is typing' : names.length === 2 ? names.join(' and ') + ' are typing' : 'Several people are typing') : '';
  }
  private setConn(ok: boolean) {
    this.S.connected = ok;
    clearTimeout(this.connT);
    if (ok) {
      if (this.S.conn !== 'ok') {
        this.S.conn = 'ok';
        this.notify();
      }
      return;
    }
    this.connT = setTimeout(() => {
      if (this.S.connected) return;
      this.S.conn = navigator.onLine === false ? 'Offline' : 'Reconnecting';
      this.notify();
    }, 3000);
  }
  resync = () => {
    if (this.resyncing) return;
    this.resyncing = true;
    const S = this.S;
    chatApi
      .boot()
      .then((b) => {
        S.users = Object.assign(S.users, b.users || {});
        const seen = new Set<string>();
        (b.channels || []).forEach((c: J) => {
          seen.add(c.id);
          const prev = S.channels[c.id];
          const keep = prev && c.id === S.active && S.page === 'channel' && S.keepUnread !== c.id && !(this.phone() && S.view === 'list') ? { unread: 0, mentions: 0 } : {};
          S.channels[c.id] = Object.assign(prev || {}, c, keep, { joined: true });
        });
        Object.keys(S.channels).forEach((k) => {
          if (!seen.has(k) && S.channels[k].joined !== false && S.channels[k].kind !== 'public') S.channels[k].joined = false;
        });
        S.features = b.features || S.features;
        if (b.threads_unread != null) S.threadsUnread = b.threads_unread;
        const id = S.active;
        if (id)
          chatApi
            .history(id)
            .then((r) => {
              if (S.active !== id) return;
              S.msgs[id] = r.messages;
              S.hasMore[id] = !!r.more;
              this.markRead();
              this.wantTr();
              this.notify();
            })
            .catch(() => undefined);
        if (id) void this.loadHuddle(id);
        if (S.page === 'threads') void chatApi.threads().then((r) => this.takeThreads(r));
        const tr = S.threadRoot;
        if (S.right === 'thread' && tr)
          chatApi
            .thread(tr)
            .then((t) => {
              t.loaded = true;
              if (S.threadRoot !== tr) return;
              S.threads[tr] = t;
              this.threadRead(tr, t.threads_unread);
              this.notify();
            })
            .catch(() => undefined);
        this.unreadOut();
        this.notify();
      })
      .catch(() => undefined)
      .then(() => {
        this.resyncing = false;
      });
  };

  /* ---------------------------------------------------------------- translation (chat-smart) */
  langName = (code: string) => {
    const l = (this.S.langs || []).filter((x: J) => x.code === code)[0];
    return l ? l.name : code;
  };
  trFor = (m: J): J | null => {
    const S = this.S;
    const t = S.lang && S.tr[m.id];
    return t && t.text && t.body === m.body && !S.trOrig[m.id] && m.user_id !== S.me?.id ? t : null;
  };
  wantTr() {
    clearTimeout(this.trT);
    this.trT = setTimeout(() => {
      const S = this.S;
      if (!S.lang || !S.me) return;
      const pool: J[] = (S.page === 'channel' ? (S.msgs[S.active] || []).slice(-60) : []).concat(S.right === 'thread' && S.threadRoot && S.threads[S.threadRoot] ? [S.threads[S.threadRoot].root].concat(S.threads[S.threadRoot].replies || []) : []);
      const ids: number[] = [];
      pool.forEach((m) => {
        if (!m || m.deleted || m.user_id === S.me.id || m.user_id === 'brain' || m.user_id === 'meetings' || m.user_id === 'gifts') return;
        const voice = (m.attachments || []).filter((a: J) => a.voice && a.transcript_status === 'ready' && a.transcript).length;
        if (!m.body && !voice) return;
        const key = S.lang + '|' + m.id + '|' + m.body + '|' + voice;
        if (this.trAsked[key] || ids.length >= 24) return;
        this.trAsked[key] = 1;
        ids.push(Number(m.id));
      });
      if (!ids.length) return;
      chatApi
        .translate(ids)
        .then((d) => {
          let any = false;
          ids.forEach((id) => {
            const it = d.items && d.items[id];
            const m = this.findMsg(id);
            if (!it || !m) return;
            S.tr[id] = { text: it.text || '', src: it.src || '', body: m.body, voice: it.voice || null };
            any = true;
            this.patchWhere(id, (x) => ({ ...x }));
          });
          if (any) this.notify();
        })
        .catch(() => undefined);
    }, 250);
  }
  toggleOrig(id: number) {
    this.S.trOrig[id] = !this.S.trOrig[id];
    this.patchWhere(id, (x) => ({ ...x }));
    this.setPop(null);
    this.setModal(null);
  }
  setLang(code: string) {
    void this.guard(chatApi.setLang(code)).then((d) => {
      const S = this.S;
      S.lang = d.lang || '';
      S.tr = {};
      S.trOrig = {};
      this.trAsked = {};
      Object.keys(S.msgs).forEach((k) => (S.msgs[k] = (S.msgs[k] || []).map((x: J) => ({ ...x }))));
      this.setPop(null);
      this.wantTr();
      const l = (S.langs || []).filter((x: J) => x.code === S.lang)[0];
      this.toast(S.lang ? 'Messages in other languages show in ' + (l ? l.name : S.lang) : 'Messages show as they were written');
    });
  }

  /* ---------------------------------------------------------------- Catch me up */
  private unreadFrom(c: J) {
    const S = this.S;
    const lr = Number(S.lastRead[c.id]) || 0;
    const fresh = (S.msgs[c.id] || []).filter((m: J) => Number(m.id) > lr && m.user_id !== S.me.id && !m.deleted && m.user_id !== 'brain');
    return { from: lr, count: lr > 0 ? fresh.length : 0, people: new Set(fresh.map((m: J) => m.user_id)).size };
  }
  catchCheck() {
    const c = this.chan(this.S.active);
    if (!c || !this.S.me) return;
    const st = this.S.catchup[c.id] || (this.S.catchup[c.id] = { st: 'idle' });
    if (st.st !== 'idle') return;
    const u = this.unreadFrom(c);
    if (u.count >= 5) Object.assign(st, { st: 'offer', from: u.from, n: u.count, people: u.people });
  }
  catchGo(manual: boolean) {
    const S = this.S;
    const c = this.chan(S.active);
    if (!c) return;
    const st = S.catchup[c.id] || (S.catchup[c.id] = { st: 'idle' });
    const u = this.unreadFrom(c);
    let from = st.from != null && st.st !== 'idle' ? st.from : u.from;
    const others = (S.msgs[c.id] || []).filter((m: J) => m.user_id !== S.me.id && !m.deleted && m.user_id !== 'brain');
    if (manual && !others.length) {
      st.st = 'none';
      this.notify();
      return;
    }
    if (manual && !(u.count >= 3)) {
      const list = others.slice(-30);
      from = list.length ? Number(list[0].id) - 1 : 0;
    }
    st.st = 'work';
    this.notify();
    void chatApi
      .catchup(c.id, from)
      .then((d) => {
        if (d.empty) st.st = 'none';
        else {
          st.st = 'done';
          st.data = d;
        }
        this.notify();
      })
      .catch((e) => {
        st.st = manual ? 'off' : 'offer';
        this.toast((e && e.message) || 'That did not work. Try again.');
        this.notify();
      });
  }
  catchOff() {
    const c = this.chan(this.S.active);
    if (c && this.S.catchup[c.id]) this.S.catchup[c.id].st = 'off';
    this.notify();
  }

  /* ---------------------------------------------------------------- reminders */
  remind(id: number, when: J) {
    void this.guard(chatApi.remind(id, when)).then((d) => {
      this.setModal(null);
      this.toast('Reminder set for ' + new Date(d.due_at).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET');
      dispatchEvent(new CustomEvent('favor-reminders:changed'));
    });
  }

  /* ---------------------------------------------------------------- partners and funds for the @ list */
  findEnt(q: string, done: () => void) {
    q = String(q || '').toLowerCase().trim();
    if (q.length < 3 || this.ent[q]) return;
    this.ent[q] = { items: [], wait: true };
    clearTimeout(this.entT);
    this.entT = setTimeout(() => {
      chatApi
        .entities(q)
        .then((d) => {
          this.ent[q] = { items: d.items || [] };
          done();
        })
        .catch(() => (this.ent[q] = { items: [] }));
    }, 220);
  }
  entHits(q: string): J[] {
    q = String(q || '').toLowerCase().trim();
    let best = '';
    Object.keys(this.ent).forEach((k) => {
      if (q.indexOf(k) === 0 && k.length > best.length && !this.ent[k].wait) best = k;
    });
    return best ? (this.ent[best].items || []).filter((x) => !q || x.name.toLowerCase().indexOf(q.split(' ')[0]) >= 0).map((x) => ({ ent: true, kind: x.kind, id: x.id, name: x.name, sub: x.sub })) : [];
  }
}

/** The Chat page's engine lives as long as the app: going back to Chat paints at once from what it already has. */
let page: ChatEngine | null = null;
export function pageEngine(): ChatEngine {
  if (!page) page = new ChatEngine();
  return page;
}

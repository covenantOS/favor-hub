// The floating dock's state and live socket. A port of the logic in public/js/dock.js into a store the React <Dock> reads.
// The object on window.FavorDock keeps the shape dock-panel.js builds on (ch, users, me, threads, on, req, save, paint, toggle, open, close,
// plain, name, mentions, size, state, ready, refresh), so the panel's own code (public/js/dock-panel.js) loads unchanged on first open.
// Hidden on the Chat and Brain pages and on phones. State that must survive a page change lives in sessionStorage (favor.dock.v1).
import { loadScript, loadStyle } from '@/lib/legacy';

const KEY = 'favor.dock.v1';
const DATA = 'favor.dock.data.v1';
const SIZE = 'favor.dock.size.v1';

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Handler = (ev: J) => void;

export interface DockToast {
  id: number;
  message: J;
  channel: J;
  who: string;
  where: string;
  text: string;
  picture: string;
}

export interface DockSnapshot {
  eligible: boolean;
  live: boolean;
  show: boolean;
  open: boolean;
  tab: 'chat' | 'brain';
  n: number;
  chatN: number;
  toasts: DockToast[];
  lift: number;
  big: boolean;
  w: number;
  h: number;
}

function read<T>(k: string, d: T): T {
  try {
    const v = JSON.parse((k === SIZE ? localStorage : sessionStorage).getItem(k) || 'null');
    return v == null ? d : (v as T);
  } catch {
    return d;
  }
}

export interface DockApi extends J {
  ch: Record<string, J>;
  users: Record<string, J>;
  me: string;
  threads: number;
  at?: number;
}

class DockStore {
  D: DockApi;
  private st: J = read(KEY, {});
  private handlers: Handler[] = [];
  private subs = new Set<() => void>();
  private snap: DockSnapshot;
  private toasts: DockToast[] = [];
  private toastN = 0;
  private ready_ = false;
  private ws: WebSocket | null = null;
  private wsT: ReturnType<typeof setTimeout> | undefined;
  private retry = 0;
  private pingT: ReturnType<typeof setInterval> | undefined;
  private poll: ReturnType<typeof setInterval> | undefined;
  private lastSeen = Date.now();
  private everOpen = false;
  private refreshing: Promise<void> | null = null;
  private loaded: Promise<void> | 0 = 0;
  private eligible_ = false;
  private page_ = '';
  private lift_ = 0;
  private dodgeT: ReturnType<typeof setTimeout> | undefined;
  private bound = false;
  private desk = typeof matchMedia === 'undefined' ? null : matchMedia('(min-width: 861px)');

  constructor() {
    this.D = {
      ch: {},
      users: {},
      me: '',
      threads: 0,
      on: (fn: Handler) => this.handlers.push(fn),
      req: this.req,
      save: this.save,
      paint: () => this.paint(),
      toggle: () => this.toggle(),
      open: (w?: J) => this.open(w),
      close: (refocus?: boolean) => this.close(refocus),
      plain: (t: string) => this.plain(t),
      name: (id: string) => this.name(id),
      mentions: () => this.mentions(),
      size: (v?: J) => this.size(v),
      state: () => this.st,
      ready: () => (this.ready_ ? Promise.resolve() : this.refresh(true)),
      refresh: (f?: boolean) => this.refresh(f),
    };
    this.snap = this.compute();
  }

  /* ------------------------------------------------------------- React */
  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  };
  getSnapshot = () => this.snap;

  private compute(): DockSnapshot {
    let n = 0;
    Object.keys(this.D.ch).forEach((k) => {
      n += this.D.ch[k].mentions || 0;
    });
    n += this.D.threads || 0;
    const live = this.eligible_ && this.page_ !== 'chat';
    const show = this.eligible_ && this.page_ !== 'chat' && this.page_ !== 'brain';
    const s = this.size();
    const tab = this.st.tab === 'brain' ? 'brain' : 'chat';
    return { eligible: this.eligible_, live, show, open: !!this.st.open && show, tab, n, chatN: 0, toasts: this.toasts, lift: this.lift_, big: !!s.x, w: s.w || 400, h: s.h || 600 };
  }
  private notify() {
    this.snap = this.compute();
    this.subs.forEach((f) => f());
  }

  /* ------------------------------------------------------------- state */
  save = (patch?: J) => {
    if (patch) for (const k in patch) this.st[k] = patch[k];
    try {
      sessionStorage.setItem(KEY, JSON.stringify(this.st));
    } catch {
      // private mode
    }
    this.notify();
  };
  size(v?: J): J {
    if (v) {
      try {
        localStorage.setItem(SIZE, JSON.stringify(v));
      } catch {
        // full
      }
      this.notify();
    }
    return read<J>(SIZE, {});
  }
  private emit(ev: J) {
    this.handlers.forEach((h) => {
      try {
        h(ev);
      } catch (e) {
        console.error(e);
      }
    });
  }
  paint() {
    this.notify();
    this.emit({ type: 'dock:paint' });
  }

  req = (method: string, path: string, body?: unknown): Promise<J> => {
    const h: Record<string, string> = { 'X-Hub-Request': '1' };
    if (body) h['Content-Type'] = 'application/json';
    return fetch('/api/chat/' + path, { method, credentials: 'same-origin', headers: h, body: body ? JSON.stringify(body) : undefined }).then((r) =>
      r
        .json()
        .catch(() => ({}))
        .then((d: J) => {
          if (!r.ok || d.ok === false) {
            const e = new Error(d.message || 'That did not work. Try again.') as Error & { status?: number };
            e.status = r.status;
            throw e;
          }
          return d;
        })
    );
  };

  name(id: string) {
    const u = this.D.users[id];
    return u ? u.name : id === 'brain' ? 'Favor Brain' : String(id || '').split('@')[0];
  }
  mentions() {
    const o: Record<string, string> = {};
    Object.keys(this.D.users).forEach((k) => {
      o[k] = this.D.users[k].name;
    });
    o.brain = 'Favor Brain';
    return o;
  }
  plain(text: string) {
    const t = String(text || '');
    const fm = (window as unknown as { FavorMention?: { plain(t: string, m: Record<string, string>): string } }).FavorMention;
    return fm ? fm.plain(t, this.mentions()) : t.replace(/<@([^>]+)>/g, (_m, id: string) => '@' + this.name(id));
  }
  private mentionsMe(m: J) {
    const b = m.body || '';
    return b.indexOf('<@' + this.D.me + '>') >= 0 || b.indexOf('<@channel>') >= 0 || b.indexOf('<@all>') >= 0;
  }

  /* ------------------------------------------------------------- when to show */
  configure(eligible: boolean, page: string) {
    const was = this.snap;
    this.eligible_ = eligible && !!this.desk?.matches;
    this.page_ = page;
    this.sync();
    if (was.show !== this.snap.show) this.dodge();
  }
  isVisible() {
    return this.eligible_ && this.page_ !== 'chat' && this.page_ !== 'brain';
  }
  private sync() {
    const live = this.eligible_ && this.page_ !== 'chat';
    if (live) {
      if (!this.ready_) this.fromCache();
      void this.refresh();
      this.connect();
    } else this.hang();
    if (this.isVisible()) {
      if (this.st.open) this.openPanel();
    } else {
      document.documentElement.classList.remove('fd-open');
    }
    this.notify();
  }

  /* ------------------------------------------------------------- the panel */
  open(where?: J) {
    if (!this.isVisible()) return;
    if (where && where.tab) this.save({ tab: where.tab });
    if (where && where.ch) this.save({ ch: where.ch, th: where.th || null, list: 0 });
    this.save({ open: 1 });
    this.openPanel();
  }
  private openPanel() {
    document.documentElement.classList.add('fd-open');
    this.toasts = [];
    this.notify();
    this.tab(this.st.tab || 'chat');
    this.loadPanel()
      .then(() => (window as unknown as { FavorDockPanel?: { show(): void } }).FavorDockPanel?.show())
      .catch((e: Error) => this.emit({ type: 'dock:error', message: e.message }));
  }
  tab(t: string) {
    if (t !== 'chat' && t !== 'brain') t = 'chat';
    this.save({ tab: t });
    this.emit({ type: 'dock:tab', tab: t });
  }
  loadPanel(): Promise<void> {
    if (this.loaded) return this.loaded;
    loadStyle('/css/dock-panel.css?v=1');
    this.loaded = loadScript('/js/dock-panel.js?v=1').catch((e) => {
      this.loaded = 0;
      throw e;
    });
    return this.loaded;
  }
  close(refocus?: boolean) {
    this.save({ open: 0 });
    document.documentElement.classList.remove('fd-open');
    this.emit({ type: 'dock:close', refocus: !!refocus });
    this.notify();
  }
  toggle() {
    if (this.st.open) this.close(true);
    else this.open();
  }
  bigger() {
    const s = this.size();
    s.x = !s.x;
    this.size(s);
    this.emit({ type: 'dock:size' });
  }
  retryPanel() {
    this.loaded = 0;
    this.open();
  }

  /* ------------------------------------------------------------- never cover the page's own buttons */
  dodge = () => {
    clearTimeout(this.dodgeT);
    this.dodgeT = setTimeout(() => {
      let lift = 0;
      const W = innerWidth;
      const H = innerHeight;
      const zone = { l: W - 20 - 56 - 10, t: H - 20 - 56 - 10, r: W, b: H };
      const list = document.querySelectorAll('.h-main .h-btn--primary, .h-main button[type="submit"], .h-main [data-dock-avoid], .h-drawer .h-btn--primary, .rd .h-btn--primary');
      for (let i = 0; i < list.length && i < 60; i++) {
        const r = list[i].getBoundingClientRect();
        if (!r.width || !r.height || r.bottom < 0 || r.top > H) continue;
        if (r.right > zone.l && r.left < zone.r && r.bottom > zone.t && r.top < zone.b) lift = Math.max(lift, H - r.top + 10 - 20);
      }
      this.lift_ = Math.min(lift, Math.round(H * 0.45));
      this.notify();
    }, 120);
  };

  /* ------------------------------------------------------------- toasts */
  dismissToast(id: number) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.notify();
  }
  private toast(m: J, c: J) {
    if (this.page_ === 'chat') return;
    const who = this.name(m.user_id);
    const where = c.kind === 'dm' ? '' : c.kind === 'group' ? ' in a group conversation' : ' in #' + c.name;
    const text = this.plain(m.body).replace(/<#[^>]+>/g, '').trim() || 'Shared an attachment';
    const u = this.D.users[m.user_id] || {};
    this.toasts = [...this.toasts.slice(-2), { id: ++this.toastN, message: m, channel: c, who, where, text, picture: u.picture || '' }];
    this.notify();
    if (document.hidden || !document.hasFocus()) this.desktop(m, c, who, where, text);
  }
  private desktop(m: J, c: J, who: string, where: string, text: string) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      const n = new Notification(c.kind === 'dm' ? who : who + where, { body: text.slice(0, 180), tag: 'chat-' + c.id, icon: '/images/favor-icon.png' });
      n.onclick = () => {
        window.focus();
        this.open({ tab: 'chat', ch: m.channel_id, th: m.thread_id || null });
        n.close();
      };
    } catch {
      // no notices here
    }
  }
  /** Reply from a toast; resolves when sent. */
  async reply(t: DockToast, body: string) {
    const m = t.message;
    const c = t.channel;
    const d = await this.req('POST', 'channels/' + encodeURIComponent(m.channel_id) + '/messages', Object.assign({ body }, m.thread_id ? { thread_id: m.thread_id } : {}));
    c.unread = 0;
    c.mentions = 0;
    this.req('POST', 'channels/' + encodeURIComponent(m.channel_id) + '/read', { upTo: d.message.id }).catch(() => undefined);
    this.paint();
  }
  openFromToast(t: DockToast) {
    this.open({ tab: 'chat', ch: t.message.channel_id, th: t.message.thread_id || null });
  }

  /* ------------------------------------------------------------- the numbers */
  refresh(force?: boolean): Promise<void> {
    if (this.refreshing) return this.refreshing;
    if (!force && this.ready_ && Date.now() - (this.D.at || 0) < 20000) return Promise.resolve();
    this.refreshing = this.req('GET', 'dock')
      .then((d) => {
        this.D.me = d.me;
        this.D.users = d.users || {};
        this.D.threads = d.threads_unread || 0;
        this.D.at = Date.now();
        const next: Record<string, J> = {};
        (d.channels || []).forEach((c: J) => {
          next[c.id] = c;
        });
        this.D.ch = next;
        this.ready_ = true;
        try {
          sessionStorage.setItem(DATA, JSON.stringify({ at: this.D.at, me: this.D.me, users: this.D.users, ch: this.D.ch, threads: this.D.threads }));
        } catch {
          // full
        }
        this.paint();
      })
      .catch(() => undefined)
      .then(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }
  private fromCache() {
    try {
      const c = JSON.parse(sessionStorage.getItem(DATA) || 'null');
      if (c && c.me && Date.now() - c.at < 30 * 60000) {
        this.D.me = c.me;
        this.D.users = c.users || {};
        this.D.ch = c.ch || {};
        this.D.threads = c.threads || 0;
        this.D.at = c.at;
        this.ready_ = true;
        this.paint();
      }
    } catch {
      // no cache
    }
  }

  private viewing(m: J) {
    return !!(this.st.open && this.st.tab === 'chat' && this.st.ch === m.channel_id && !document.hidden && document.hasFocus());
  }
  private onMessage(m: J) {
    const c = this.D.ch[m.channel_id];
    if (m.visible_to && m.visible_to !== this.D.me) return;
    if (!c) {
      void this.refresh(true).then(() => {
        if (this.D.ch[m.channel_id]) this.onMessage(m);
      });
      return;
    }
    if (m.user_id === this.D.me) {
      this.emit({ type: 'message', message: m });
      return;
    }
    const care = this.mentionsMe(m) || c.kind === 'dm' || c.kind === 'group';
    const here = this.viewing(m);
    if (m.thread_id) {
      if (!here) void this.refresh(true);
    } else if (!here) {
      c.unread = (c.unread || 0) + 1;
      if (care) c.mentions = (c.mentions || 0) + 1;
    }
    this.emit({ type: 'message', message: m });
    this.paint();
    if (!here && care && !c.muted && !m.visible_to) this.toast(m, c);
  }
  private onEvent(ev: J) {
    if (ev.type === 'message') this.onMessage(ev.message);
    else if (ev.type === 'channel' && ev.channel) {
      this.D.ch[ev.channel.id] = Object.assign(this.D.ch[ev.channel.id] || { unread: 0, mentions: 0 }, ev.channel);
      this.paint();
      this.emit(ev);
    } else if (ev.type === 'users' && ev.users) {
      Object.assign(this.D.users, ev.users);
      this.emit(ev);
    } else if (ev.type === 'resync') {
      void this.refresh(true);
      this.emit(ev);
    } else this.emit(ev);
  }

  /* ------------------------------------------------------------- the socket (one per tab, closed on Chat and on phones) */
  private connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    if (!this.isVisible() && !(this.eligible_ && this.page_ === 'brain')) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/chat/ws');
    } catch {
      this.fallback();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      clearInterval(this.pingT);
      clearInterval(this.poll);
      this.poll = undefined;
      this.pingT = setInterval(() => {
        if (this.ws && this.ws.readyState === 1) this.ws.send('ping');
      }, 30000);
      if (document.hidden) ws.send(JSON.stringify({ t: 'p', s: 'away' }));
      this.emit({ type: 'conn', ok: true });
      if (this.everOpen || Date.now() - this.lastSeen > 20000) this.onEvent({ type: 'resync' });
      this.everOpen = true;
    };
    ws.onmessage = (e) => {
      this.lastSeen = Date.now();
      if (e.data === 'pong') return;
      try {
        this.onEvent(JSON.parse(e.data));
      } catch {
        // not ours
      }
    };
    ws.onclose = () => {
      clearInterval(this.pingT);
      this.ws = null;
      if (!this.eligible_ || this.page_ === 'chat') return;
      this.emit({ type: 'conn', ok: false });
      this.retry = Math.min(this.retry + 1, 6);
      clearTimeout(this.wsT);
      this.wsT = setTimeout(() => this.connect(), this.retry <= 1 ? 250 : Math.min(30000, 800 * Math.pow(2, this.retry)));
      this.fallback();
    };
    ws.onerror = () => undefined;
  }
  private fallback() {
    if (this.poll) return;
    this.poll = setInterval(() => {
      if (!document.hidden) this.onEvent({ type: 'resync' });
    }, 20000);
  }
  private hang() {
    clearTimeout(this.wsT);
    clearInterval(this.poll);
    this.poll = undefined;
    clearInterval(this.pingT);
    if (this.ws) {
      const w = this.ws;
      this.ws = null;
      try {
        w.close();
      } catch {
        // gone
      }
    }
  }

  /** Window-level listeners, once. */
  bind() {
    if (this.bound) return;
    this.bound = true;
    document.addEventListener('visibilitychange', () => {
      if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'p', s: document.hidden ? 'away' : 'online' }));
      if (!document.hidden && this.eligible_ && this.page_ !== 'chat') {
        if (!this.ws || this.ws.readyState !== 1) {
          this.retry = 0;
          this.connect();
        }
        void this.refresh();
      }
    });
    addEventListener('online', () => {
      this.retry = 0;
      this.connect();
    });
    addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === '.' || e.code === 'Period')) {
        if (!this.isVisible()) return;
        e.preventDefault();
        this.toggle();
      }
    });
    this.desk?.addEventListener('change', () => this.configure(this.eligibleWanted, this.page_));
    addEventListener('resize', this.dodge);
    addEventListener('scroll', this.dodge, { passive: true, capture: true });
    addEventListener('load', () => setTimeout(this.dodge, 600));
    addEventListener('pagehide', () => this.save());
    (window as unknown as { FavorDock: DockApi }).FavorDock = this.D;
  }
  eligibleWanted = false;
  setEligible(want: boolean, page: string) {
    this.eligibleWanted = want;
    this.configure(want, page);
  }
}

export const dock = new DockStore();

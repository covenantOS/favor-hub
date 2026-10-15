// The Favor Brain conversation, shared by the Brain page and the dock's Favor Brain tab: your chats, the open chat, the
// answer being made (with its live steps), and every change to them. Components read it with useBrain(); one engine per
// page (the page makes its own, so a server render never shares one between people).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useSyncExternalStore } from 'react';
import { askStream, BrainError, brainCall } from './api';
import { fromReply, fromStored, type Conv, type ConvRow, type Me, type Step, type StoredTurn, type Turn } from './types';
import { titleOf } from './fmt';

export interface Busy {
  conv: Conv;
  ctl: AbortController;
  steps: Step[] | null;
}
export interface ToastMsg {
  id: number;
  text: string;
  link?: { href: string; label: string };
}
export interface State {
  me: Me | null;
  convs: ConvRow[];
  cur: Conv | null;
  busy: Busy | null;
  found: Set<string> | null;
  renaming: string | null;
  toast: ToastMsg | null;
  sheets: { title: string; url: string }[];
  connected: boolean | null;
  /** Bumped on every change to a turn's blocks, so the answer redraws. */
  v: number;
}

const LAST = 'favor.brain.last';
const ANSWERS = 'favor.brain.answers';
const newId = () => 'c_' + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => (b % 36).toString(36)).join('');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cue = (name: string) => {
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('favor:cue', { detail: name }));
};

export interface Seed {
  me?: Me | null;
  convs?: ConvRow[];
  thread?: { thread: { id: string; title: string }; turns: StoredTurn[] } | null;
}

export class BrainEngine {
  s: State;
  private subs = new Set<() => void>();
  private toastT: ReturnType<typeof setTimeout> | undefined;
  private histT: ReturnType<typeof setTimeout> | undefined;
  private seq = 0;
  /** Where this engine draws: the page keeps ?c= in the address; the dock keeps its own record. */
  where: 'page' | 'dock';
  onConv?: (id: string | null) => void;
  /** Put a question back in the ask box (Rephrase on a handed-off answer); set by the view that owns the box. */
  rephrase?: (q: string) => void;

  constructor(where: 'page' | 'dock', seed: Seed = {}) {
    this.where = where;
    const t = seed.thread;
    this.s = {
      me: seed.me || null,
      convs: seed.convs || [],
      cur: t ? { id: t.thread.id, title: t.thread.title, turns: (t.turns || []).map(fromStored) } : null,
      busy: null,
      found: null,
      renaming: null,
      toast: null,
      sheets: [],
      connected: null,
      v: 0,
    };
  }

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  };
  get = () => this.s;
  private set(p: Partial<State>) {
    this.s = { ...this.s, ...p, v: this.s.v + 1 };
    this.subs.forEach((f) => f());
  }
  /** Something inside a turn changed (a table filter, a confirm card, a rating): draw again. */
  touch() {
    this.set({});
  }

  // ---- Notices ----------------------------------------------------------------------------------------------------
  toast(text: string, link?: { href: string; label: string }) {
    clearTimeout(this.toastT);
    this.set({ toast: { id: ++this.seq, text, link } });
    this.toastT = setTimeout(() => this.set({ toast: null }), link ? 5200 : 2600);
  }

  // ---- Who is asking -----------------------------------------------------------------------------------------------
  has = (k: string) => !!(this.s.me && (this.s.me.packages || []).some((p) => p.key === k && p.has));
  canRequest = (k: string) => !!(this.s.me && (this.s.me.packages || []).some((p) => p.key === k && !p.has && p.requestable));
  pending = (k: string) => !!(this.s.me && (this.s.me.requests || []).some((r) => r.package === k && r.status === 'pending'));
  canSheets = () => this.has('sheets') && typeof window !== 'undefined' && !!(window as any).FavorSheets;

  async loadMe() {
    try {
      this.set({ me: await brainCall<Me>('me') });
    } catch {
      /* the page keeps what it had */
    }
  }
  async loadConnector() {
    try {
      const d = await brainCall<{ connected?: boolean }>('connector');
      this.set({ connected: !!d.connected });
    } catch {
      this.set({ connected: null });
    }
  }
  async loadSheets() {
    try {
      const res = await fetch('/api/sheets/recent', { credentials: 'same-origin' });
      const d = await res.json();
      if (d.ok) this.set({ sheets: d.sheets || [] });
    } catch {
      /* nothing to list */
    }
  }
  sheetMade(r: { title: string; url: string }) {
    this.set({ sheets: [{ title: r.title, url: r.url }, ...this.s.sheets] });
  }

  // ---- Your chats --------------------------------------------------------------------------------------------------
  async loadHistory() {
    try {
      const d = await brainCall<{ threads?: ConvRow[] }>('history');
      const convs = d.threads || [];
      const cur = this.s.cur;
      const open = cur && convs.find((c) => c.id === cur.id);
      // The Brain may have titled the open chat after its answer; the header follows the list.
      if (open && cur && open.title !== cur.title) cur.title = open.title;
      this.set({ convs });
      clearTimeout(this.histT);
      if (convs.some((c) => c.pending)) this.histT = setTimeout(() => this.loadHistory(), 3500);
    } catch {
      /* the list stays as it was */
    }
  }
  private searchSeq = 0;
  async search(q: string) {
    const seq = ++this.searchSeq;
    if (q.length < 2) return this.set({ found: null });
    try {
      const d = await brainCall<{ threads?: ConvRow[] }>('history?q=' + encodeURIComponent(q));
      if (seq === this.searchSeq) this.set({ found: new Set((d.threads || []).map((c) => c.id)) });
    } catch {
      /* keep the title matches */
    }
  }
  remember(id: string) {
    try {
      localStorage.setItem(LAST, JSON.stringify({ id, at: Date.now() }));
    } catch {
      /* not kept */
    }
    this.onConv?.(id);
  }
  /** Back from another page: the chat that was being answered (or answered a moment ago). */
  recent(): string | null {
    let last: { id: string; at: number } | null = null;
    try {
      last = JSON.parse(localStorage.getItem(LAST) || 'null');
    } catch {
      last = null;
    }
    const row = last && this.s.convs.find((x) => x.id === last!.id);
    if (row && last && (row.pending || Date.now() - new Date(row.changed_at).getTime() < 6e5) && Date.now() - last.at < 6e5) return row.id;
    return null;
  }
  async openConv(id: string) {
    this.s.busy?.ctl.abort();
    this.set({ busy: null });
    try {
      const d = await brainCall<{ thread: { id: string; title: string }; turns: StoredTurn[] }>('thread/' + encodeURIComponent(id));
      const cur: Conv = { id: d.thread.id, title: d.thread.title, turns: (d.turns || []).map(fromStored) };
      this.set({ cur });
      this.remember(id);
      if (cur.turns.some((t) => t.pending)) this.pollPending(cur);
    } catch (err) {
      const e = err as BrainError;
      this.toast(e.status === 404 ? 'That chat is gone.' : e.message);
      if (e.status === 404) this.set({ convs: this.s.convs.filter((c) => c.id !== id) });
    }
  }
  startNew() {
    this.s.busy?.ctl.abort();
    this.set({ busy: null, cur: null });
    this.onConv?.(null);
  }
  async pin(c: ConvRow) {
    const was = !!c.pinned;
    this.set({ convs: this.s.convs.map((x) => (x.id === c.id ? { ...x, pinned: was ? 0 : 1 } : x)) });
    this.toast(was ? 'Unpinned' : 'Pinned');
    try {
      await brainCall('thread/' + encodeURIComponent(c.id), { method: 'PATCH', body: { pinned: !was } });
    } catch (e) {
      this.set({ convs: this.s.convs.map((x) => (x.id === c.id ? { ...x, pinned: was ? 1 : 0 } : x)) });
      this.toast((e as Error).message);
    }
  }
  startRename(id: string | null) {
    this.set({ renaming: id });
  }
  async rename(c: ConvRow, value: string, save: boolean) {
    this.set({ renaming: null });
    const t = value.trim().slice(0, 80);
    if (!save || !t || t === c.title) return;
    const old = c.title;
    this.set({ convs: this.s.convs.map((x) => (x.id === c.id ? { ...x, title: t } : x)), cur: this.s.cur && this.s.cur.id === c.id ? { ...this.s.cur, title: t } : this.s.cur });
    try {
      await brainCall('thread/' + encodeURIComponent(c.id), { method: 'PATCH', body: { title: t } });
    } catch (e) {
      this.set({ convs: this.s.convs.map((x) => (x.id === c.id ? { ...x, title: old } : x)) });
      this.toast((e as Error).message);
    }
  }
  /** Deletes a chat, and the copies of the same question folded into its row. */
  async remove(c: ConvRow) {
    try {
      for (const id of [c.id].concat(c.same || [])) await brainCall('thread/' + encodeURIComponent(id), { method: 'DELETE' });
    } catch (e) {
      this.toast((e as Error).message);
      return;
    }
    const gone = new Set([c.id].concat(c.same || []));
    this.set({ convs: this.s.convs.filter((x) => !gone.has(x.id)) });
    if (this.s.cur && gone.has(this.s.cur.id)) this.startNew();
    this.toast('Chat deleted');
  }

  // ---- Asking --------------------------------------------------------------------------------------------------------
  /** opt: { intent, rerun: { ref, key, value }, at: turn index to replace in place } */
  async ask(q: string, opt: { intent?: string; rerun?: { ref: string; key: string; value: string }; at?: number } = {}) {
    q = String(q || '').trim();
    if ((q.length < 2 && !opt.rerun) || this.s.busy) return;
    const conv: Conv = this.s.cur || { id: newId(), title: 'New chat', turns: [] };
    const replacing = opt.at != null;
    let turn: Turn;
    if (replacing) {
      turn = conv.turns[opt.at!];
      Object.assign(turn, { blocks: null, error: null, stopped: false, extras: [], rated: null, steps: [] });
    } else {
      turn = { q, blocks: null, extras: [], reading: [], follow: [] };
      conv.turns.push(turn);
      if (conv.turns.length === 1) conv.title = titleOf(q);
    }
    const mine: Busy = { conv, ctl: new AbortController(), steps: null };
    this.set({ cur: conv, busy: mine });
    this.remember(conv.id);
    const body: Record<string, unknown> = { question: q || turn.q, v: 2, conv: conv.id };
    const before = replacing ? conv.turns.slice(0, opt.at) : conv.turns.slice(0, -1);
    const prev = [...before].reverse().find((x) => x.blocks && x.outcome === 'ok');
    if (prev) body.previous = prev.asked_as || prev.q;
    if (opt.intent) body.intent = opt.intent;
    if (opt.rerun) body.rerun = opt.rerun;
    try {
      const d = await askStream(body, {
        signal: mine.ctl.signal,
        onSteps: (st) => {
          if (this.s.busy !== mine) return;
          mine.steps = st;
          this.touch();
        },
      });
      Object.assign(turn, fromReply(turn.q || q, d), { q: turn.q || q });
      turn.hint = false;
      if (d.outcome === 'ok' && !(d.blocks || []).some((b: any) => b.type === 'choice') && this.tenth()) turn.connectCard = true;
      cue('droplet');
    } catch (err) {
      const e = err as BrainError;
      if (e.name === 'AbortError') turn.stopped = true;
      else {
        turn.error = e.message;
        turn.ref = e.ref;
      }
    }
    if (this.s.busy === mine) this.set({ busy: null });
    else this.touch();
    if (this.s.cur !== conv && !turn.stopped) this.toast('Your answer is ready in "' + conv.title + '"');
    this.loadHistory();
  }
  stop() {
    this.s.busy?.ctl.abort();
  }
  rerun(ti: number, key: string, value: string) {
    const t = this.s.cur?.turns[ti];
    if (!t) return;
    void this.ask(t.q, { at: ti, rerun: { ref: t.ref || '', key, value } });
  }
  again(ti: number) {
    const t = this.s.cur?.turns[ti];
    if (t && !this.s.busy) void this.ask(t.asked_as || t.q, { at: ti });
  }
  /** Edit a question: the chat drops it and what came after, and asks the new words. */
  editAsk(ti: number, q: string) {
    const c = this.s.cur;
    if (!c || !q.trim()) return;
    c.turns.splice(ti);
    this.touch();
    void this.ask(q);
  }
  private tenth() {
    try {
      const n = Number(localStorage.getItem(ANSWERS) || 0) + 1;
      localStorage.setItem(ANSWERS, String(n));
      return n % 10 === 0;
    } catch {
      return false;
    }
  }
  /** A chat opened while its last answer is still being made: read the stored chat until the answer lands. */
  pollPending(c: Conv) {
    const mine: Busy = { conv: c, ctl: new AbortController(), steps: null };
    this.set({ busy: mine });
    void (async () => {
      for (let i = 0; i < 150; i++) {
        await sleep(i < 3 ? 1200 : 2500);
        if (this.s.cur !== c || this.s.busy !== mine) return;
        if (mine.ctl.signal.aborted) {
          const t = c.turns[c.turns.length - 1];
          if (t && t.pending) Object.assign(t, { pending: false, stopped: true });
          this.set({ busy: null });
          return;
        }
        try {
          const d = await brainCall<{ turns: StoredTurn[] }>('thread/' + encodeURIComponent(c.id));
          if (this.s.cur !== c || this.s.busy !== mine) return;
          const turns = (d.turns || []).map(fromStored);
          if (turns.length >= c.turns.length) c.turns = turns;
          if (!c.turns.some((t) => t.pending)) {
            this.set({ busy: null });
            cue('droplet');
            this.loadHistory();
            return;
          }
        } catch (err) {
          if ((err as BrainError).status === 404) return this.set({ busy: null });
        }
      }
      const t = c.turns[c.turns.length - 1];
      if (t && t.pending) Object.assign(t, { pending: false, error: 'This answer is taking too long. Ask again.' });
      this.set({ busy: null });
    })();
  }

  // ---- Under an answer ---------------------------------------------------------------------------------------------
  async rateRight(t: Turn) {
    if (!t.ref || t.rated) return;
    try {
      const res = await fetch('/api/feedback', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'hub-brain', rating: 'right', ref: t.ref, page: '/brain/' }) });
      if (!res.ok) throw new Error();
      t.rated = 'right';
      cue('droplet');
      this.touch();
    } catch {
      this.toast('That did not send. Try again.');
    }
  }
  async pinAnswer(t: Turn) {
    try {
      const res = await fetch('/api/reporting/pins', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: t.asked_as || t.q, title: t.q, answer: { blocks: t.blocks, reading: t.reading, markdown: t.markdown } }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.message || 'That did not pin. Try again.');
      this.toast('Pinned to My dashboard', { href: '/highlights/?tab=mine', label: 'Open' });
    } catch (err) {
      this.toast((err as Error).message || 'That did not pin. Try again.');
    }
  }
  async requestAccess(pkg: string, reason: string, days: number) {
    await brainCall('request', { body: { package: pkg, reason, days } });
    cue('success');
    const me = this.s.me;
    if (me) this.set({ me: { ...me, requests: (me.requests || []).concat([{ package: pkg, status: 'pending' }]) } });
    this.toast('Sent to Will');
  }
}

export function useBrain(e: BrainEngine): State {
  return useSyncExternalStore(e.subscribe, e.get, e.get);
}

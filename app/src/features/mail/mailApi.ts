// The Mail client's server calls, the same set public/js/mail/mail.js makes, with the same names and arguments so the sample mailbox
// (public/js/mail/mail-mock.js, used for the FavorOS Tester and ?mock=1) answers them unchanged. The conversations read or opened are
// also kept on this device (IndexedDB 'favor-mail'), never on the server, so a conversation opens from here while Gmail is asked
// whether anything changed. Cleared when another person signs in and after seven days.
/* eslint-disable @typescript-eslint/no-explicit-any */
export class MailError extends Error {
  code = '';
  need = '';
  status = 0;
}

async function req(method: string, path: string, body?: unknown): Promise<any> {
  let r: Response;
  try {
    r = await fetch(path.charAt(0) === '/' ? path : '/api/mail/' + path, {
      method,
      credentials: 'same-origin',
      headers: { 'X-Hub-Request': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    const e = new MailError('No connection. Try again when you are back online.');
    e.code = 'offline';
    throw e;
  }
  const d = (await r.json().catch(() => ({}))) as any;
  if (!r.ok || d.ok === false) {
    const e = new MailError(d.message || 'Something went wrong. Try again.');
    e.code = d.error || '';
    e.need = d.need || '';
    e.status = r.status;
    throw e;
  }
  return d;
}

/** Every call for a conversation names the mailbox it lives in (?mb=); the person's own mailbox is the one with none. */
export const pathMb = (path: string, mb?: string) => (mb ? path + (path.indexOf('?') < 0 ? '?' : '&') + 'mb=' + encodeURIComponent(mb) : path);

/** Which mailbox a conversation lives in, learned from the lists. */
export const mbOf: Record<string, string> = {};
export const boxOf = (id: string) => mbOf[id] || '';

/* ------------------------------------------------------------------ device copy */
let me = '';
export const setMe = (email: string) => (me = email);
const TTL = 7 * 864e5;
let dbp: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((ok) => {
    if (!window.indexedDB) return ok(null);
    const r = indexedDB.open('favor-mail', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('threads', { keyPath: 'k' });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ok(null);
  });
  return dbp;
}
function run<T>(mode: IDBTransactionMode, fn: (st: IDBObjectStore) => IDBRequest | undefined): Promise<T | null> {
  return db().then(
    (d) =>
      new Promise<T | null>((ok) => {
        if (!d) return ok(null);
        try {
          const tx = d.transaction('threads', mode);
          const rq = fn(tx.objectStore('threads'));
          tx.oncomplete = () => ok(rq && rq.result !== undefined ? (rq.result as T) : null);
          tx.onerror = tx.onabort = () => ok(null);
        } catch {
          ok(null);
        }
      })
  );
}
const keyOf = (id: string) => me + '|' + boxOf(id) + '|' + id;
export const device = {
  get: (id: string) => run<{ at: number; data: any }>('readonly', (st) => st.get(keyOf(id))).then((r) => (r && Date.now() - r.at < TTL ? r : null)),
  put: (id: string, data: unknown) => run('readwrite', (st) => st.put({ k: keyOf(id), at: Date.now(), data })),
  drop: (id: string) => run('readwrite', (st) => st.delete(keyOf(id))),
  sweep() {
    try {
      const who = localStorage.getItem('favor.mail.owner');
      if (who && who !== me && window.indexedDB) {
        indexedDB.deleteDatabase('favor-mail');
        dbp = null;
      }
      localStorage.setItem('favor.mail.owner', me);
    } catch {
      // private mode
    }
    void run('readwrite', (st) => {
      const c = st.openCursor();
      c.onsuccess = () => {
        const cur = c.result;
        if (!cur) return;
        if (Date.now() - cur.value.at > TTL) cur.delete();
        cur.continue();
      };
      return c;
    });
  },
};

export const sigOf = (d: any) => ((d && d.thread ? d.thread.messages || [] : []) as any[]).map((m) => m.id + ':' + (m.labelIds || []).join(',')).join('|');

/** Conversations read ahead in this tab (90 s), so opening one shows it at once. Any change to a conversation drops its copy. */
export const PRE: Record<string, { at: number; p: Promise<any> }> = {};
const drop = (id: string) => {
  delete PRE[id];
  void device.drop(id);
};

const real = {
  state: () => req('GET', 'state'),
  boxes: () => req('GET', 'boxes'),
  from: () => req('GET', 'from'),
  removeBox: (email: string) => req('DELETE', 'boxes/' + encodeURIComponent(email)),
  labels: (mb?: string) => req('GET', pathMb('labels', mb)),
  threads: (label: string, q: string, page: string, o: any = {}) =>
    req(
      'GET',
      'threads?label=' + encodeURIComponent(label || 'INBOX') + (q ? '&q=' + encodeURIComponent(q) : '') + (page ? '&page=' + encodeURIComponent(page) : '') +
        (o.view ? '&view=' + encodeURIComponent(o.view) : '') + (o.flags && o.flags.length ? '&f=' + o.flags.join(',') : '') + (o.sort ? '&sort=' + o.sort : '') + (o.mb ? '&mb=' + encodeURIComponent(o.mb) : '')
    ),
  smartSearch: (q: string, mb?: string) => req('POST', pathMb('smart/search', mb), { q }),
  overview: (mb?: string) => req('GET', pathMb('smart/overview', mb)),
  briefing: (fresh: boolean, mb?: string) => req('GET', pathMb('smart/briefing' + (fresh ? '?fresh=1' : ''), mb)),
  assist: (id: string) => req('GET', pathMb('threads/' + encodeURIComponent(id) + '/assist', boxOf(id))),
  partner: (id: string) => req('GET', 'partner/' + encodeURIComponent(id)),
  bulk: (b: any, mb?: string) => {
    (b.ids || []).forEach(drop);
    return req('POST', pathMb('bulk', mb), b);
  },
  thread(id: string) {
    const h = PRE[id];
    if (h && Date.now() - h.at < 90000) return h.p;
    const p = req('GET', pathMb('threads/' + encodeURIComponent(id), boxOf(id)));
    p.then((d) => {
      if (!d.headersOnly) void device.put(id, d);
    }).catch(() => undefined);
    return p;
  },
  batch: (ids: string[], mb?: string) => req('POST', pathMb('threads/batch', mb), { ids }),
  modify(id: string, add: string[], remove: string[]) {
    drop(id);
    return req('POST', pathMb('threads/' + encodeURIComponent(id) + '/modify', boxOf(id)), { add: add || [], remove: remove || [] });
  },
  trash(id: string) {
    drop(id);
    return req('POST', pathMb('threads/' + encodeURIComponent(id) + '/trash', boxOf(id)), {});
  },
  untrash: (id: string) => req('POST', pathMb('threads/' + encodeURIComponent(id) + '/untrash', boxOf(id)), {}),
  snooze: (id: string, until: string) => req('POST', pathMb('threads/' + encodeURIComponent(id) + '/snooze', boxOf(id)), { until }),
  unsnooze: (id: string) => req('DELETE', pathMb('threads/' + encodeURIComponent(id) + '/snooze', boxOf(id))),
  newLabel: (name: string, mb?: string) => req('POST', pathMb('labels', mb), { name }),
  hold: (b: any) => req('POST', pathMb('hold', b.mb), b),
  release: (id: string, mb?: string) => req('POST', pathMb('hold/' + encodeURIComponent(id) + '/release', mb), {}),
  cancelHold: (id: string, mb?: string) => req('DELETE', pathMb('hold/' + encodeURIComponent(id), mb)),
  check: (b: any) => req('POST', pathMb('check', b.mb), b),
  send: (b: any) => req('POST', pathMb('send', b.mb), b),
  saveDraft: (b: any) => req('PUT', pathMb('drafts', b.mb), b),
  dropDraft: (id: string, mb?: string) => req('DELETE', pathMb('drafts/' + encodeURIComponent(id), mb)),
  contacts: (q: string) => req('GET', 'contacts?q=' + encodeURIComponent(q || '')),
  timeline: (pid: string, email: string, id: string) => req('GET', pathMb('partner/' + encodeURIComponent(pid) + '/timeline?email=' + encodeURIComponent(email || ''), boxOf(id))),
  sender: (email: string, name: string, mb?: string) => req('GET', pathMb('smart/sender?email=' + encodeURIComponent(email) + '&name=' + encodeURIComponent(name || ''), mb)),
  categories: () => req('GET', 'smart/categories'),
  newCategory: (name: string, description: string) => req('POST', 'smart/categories', { name, description }),
  dropCategory: (id: string) => req('DELETE', 'smart/categories/' + encodeURIComponent(id)),
  moveCat: (senders: string[], cat: string, mb?: string) => req('POST', pathMb('smart/move', mb), { senders, cat }),
  logged: (threadId: string, partnerId?: string) => req('POST', pathMb('smart/logged', boxOf(threadId)), { threadId, partnerId: partnerId || '' }),
  templates: () => req('GET', 'templates'),
  saveTemplate: (name: string, body: string) => req('POST', 'templates', { name, body }),
  dropTemplate: (id: string) => req('DELETE', 'templates/' + encodeURIComponent(id)),
  fillTemplate: (body: string, to: string[]) => req('POST', 'templates/fill', { body, to }),
  later: () => req('GET', 'later'),
  makeLater: (b: any) => req('POST', pathMb('later', b.mb), b),
  dropLater: (id: string) => req('DELETE', 'later/' + encodeURIComponent(id)),
  snoozeWait: (id: string, kind: string, partnerId?: string) => req('POST', pathMb('threads/' + encodeURIComponent(id) + '/snooze', boxOf(id)), { until: kind, partnerId: partnerId || '' }),
  readFile: (mid: string, f: any, subject: string, id: string) => req('GET', pathMb('messages/' + encodeURIComponent(mid) + '/attachments/' + encodeURIComponent(f.id) + '/read?name=' + encodeURIComponent(f.name) + '&mime=' + encodeURIComponent(f.mime) + '&size=' + (f.size || 0) + '&subject=' + encodeURIComponent(subject || ''), boxOf(id))),
  ask: (id: string, q: string) => req('POST', pathMb('threads/' + encodeURIComponent(id) + '/ask', boxOf(id)), { q }),
  times: (b: any) => req('POST', 'smart/times', b),
  entity: (kind: string, q: string) => req('GET', 'entity?kind=' + encodeURIComponent(kind) + '&q=' + encodeURIComponent(q)),
  entityNames: () => req('GET', 'entity/names'),
  assign: (id: string, to: string, note: string) => req('POST', pathMb('threads/' + encodeURIComponent(id) + '/assign', boxOf(id)), { to, note }),
  mention: (id: string, to: string[], note: string) => req('POST', pathMb('threads/' + encodeURIComponent(id) + '/mention', boxOf(id)), { to, note }),
  makeRequest: (id: string, note: string, surface: string) => req('POST', pathMb('threads/' + encodeURIComponent(id) + '/request', boxOf(id)), { note, surface }),
  assigned: () => req('GET', 'assigned'),
  assignedDone: (id: string) => req('POST', 'assigned/' + encodeURIComponent(id) + '/done', {}),
  meetCreate: (b: any) => req('POST', '/api/meet/meetings', b),
  drive: (q: string) => req('GET', 'drive?q=' + encodeURIComponent(q || '')),
  clips: () => req('GET', 'clips'),
  owners: () => req('GET', 'log-owners'),
  task: (b: any) => req('POST', '/api/tasks', b),
  chatBoot: () => req('GET', '/api/chat/boot'),
  chatSend: (ch: string, body: string) => req('POST', '/api/chat/channels/' + encodeURIComponent(ch) + '/messages', { body }),
  logAction: (b: any) => req('POST', '/api/work/entry/many', b),
  fileUrl: (mid: string, f: any, dl?: boolean, mb?: string) =>
    '/api/mail/messages/' + encodeURIComponent(mid) + '/attachments/' + encodeURIComponent(f.id) + '?name=' + encodeURIComponent(f.name) + '&mime=' + encodeURIComponent(f.mime) + (dl ? '&dl=1' : '') + (mb ? '&mb=' + encodeURIComponent(mb) : ''),
};

export type MailApi = typeof real;
let api: MailApi = real;

declare global {
  interface Window {
    /** The shared email composer (public/js/compose/compose.js). */
    FavorCompose?: {
      open: (o: Record<string, unknown>) => Promise<string | null>;
      add: (item: Record<string, unknown>) => Promise<string | null>;
      host: (threadId: string, el: HTMLElement) => void;
      list: () => Array<{ id: string; mode: string; threadId: string; kind: string; draftId: string }>;
      focus: (id: string) => void;
      close: (id: string) => void;
    };
    FavorHandoff?: { open: (o: { kind: string; id: string; title: string }) => void };
    FavorMailMock?: (r: unknown) => MailApi;
    __mailMock?: boolean;
  }
}

/** The sample mailbox is on for the FavorOS Tester, ?mock=1, and a tab that asked for it; ?mock=0 goes back to the real one. */
export function wantsMock(): boolean {
  const q = location.search;
  let on = /[?&]mock=1/.test(q);
  try {
    if (on) sessionStorage.setItem('favor.mail.mock', '1');
    if (/[?&]mock=0/.test(q)) sessionStorage.removeItem('favor.mail.mock');
    on = sessionStorage.getItem('favor.mail.mock') === '1';
  } catch {
    // private mode
  }
  return on;
}

let ready: Promise<MailApi> | null = null;
/** The API object (the sample mailbox when asked for). Loads the sample file once. */
export function mailApi(): Promise<MailApi> {
  if (!ready) {
    ready = (async () => {
      if (!wantsMock()) return real;
      window.__mailMock = true;
      await new Promise<void>((ok) => {
        if (window.FavorMailMock) return ok();
        const s = document.createElement('script');
        s.src = '/js/mail/mail-mock.js?v=7';
        s.onload = () => ok();
        s.onerror = () => ok();
        document.head.appendChild(s);
      });
      if (!window.FavorMailMock) return real;
      const mocked = window.FavorMailMock(real);
      const mockThread = mocked.thread;
      // The sample mailbox goes through the same read-ahead and device copy as a real one.
      mocked.thread = (id: string) => {
        const h = PRE[id];
        if (h && Date.now() - h.at < 90000) return h.p;
        const p = mockThread(id);
        p.then((d: any) => {
          if (!d.headersOnly) void device.put(id, d);
        }).catch(() => undefined);
        return p;
      };
      api = mocked;
      return mocked;
    })();
  }
  return ready;
}
export const getApi = () => api;

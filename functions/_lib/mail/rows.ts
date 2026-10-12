// The rows of the list, kept per thread and history id, so a second look at a page reads only the conversations that changed.
// Shared by the list route and the smart views, which scan the same conversations.
import { GmailError, ROW_HEADERS, pool, shapeThreadRow, type Gmail, type ThreadRow } from './gmail';

const ROWS = new Map<string, ThreadRow>();
const remember = (k: string, v: ThreadRow) => {
  if (ROWS.size > 2000) ROWS.clear();
  ROWS.set(k, v);
};

/** One conversation's headers. Gmail answers 429 when a person's calls bunch up, so a refusal waits a moment and tries again. */
async function readRow(gm: Gmail, id: string): Promise<any> {
  for (let i = 0; i < 4; i++) {
    try {
      return await gm.get('/threads/' + id, { format: 'metadata', metadataHeaders: ROW_HEADERS });
    } catch (e) {
      const busy = e instanceof GmailError && (e.status === 429 || (e.status === 403 && /rate|quota/i.test(e.reason + e.message)) || e.status >= 500);
      if (!busy || i === 3) return null;
      await new Promise((r) => setTimeout(r, 350 * (i + 1)));
    }
  }
  return null;
}

// The saved rows live in D1 (hub_mail_rows, db/mail-cache.sql) as well as in memory, so a request that lands on a cold server copy still
// reads the whole page in one query. A row is kept under the thread's history id, which Gmail changes with every message or label change,
// so a row is never stale: a changed thread has a new history id and is read again. Headers and a short preview only, never a body.
type Store = { prepare(sql: string): any; batch(list: any[]): Promise<unknown> };
let STORE: Store | null = null;
export const useRowStore = (db: Store | null | undefined) => {
  STORE = db || null;
};

async function stored(me: string, ids: string[]): Promise<Map<string, { hid: string; row: ThreadRow }>> {
  const out = new Map<string, { hid: string; row: ThreadRow }>();
  if (!STORE || !ids.length) return out;
  try {
    const r = await STORE.prepare('SELECT thread_id, hid, row_json FROM hub_mail_rows WHERE mailbox = ? AND thread_id IN (SELECT value FROM json_each(?))').bind(me, JSON.stringify(ids)).all();
    for (const x of r.results || []) {
      try {
        out.set(String(x.thread_id), { hid: String(x.hid), row: JSON.parse(String(x.row_json)) as ThreadRow });
      } catch {
        /* a damaged row is read again */
      }
    }
  } catch {
    /* the table is not there yet: Gmail answers */
  }
  return out;
}

/** One row for each listed thread (id and history id), read from Gmail only when the thread changed since the last look. */
export async function rowsFor(gm: Gmail, me: string, threads: Array<{ id: string; historyId?: string }>, width = 8): Promise<ThreadRow[]> {
  const known = await stored(me, threads.map((t) => t.id));
  const fresh: Array<{ id: string; hid: string; row: ThreadRow }> = [];
  const rows = await pool(threads, width, async (t) => {
    const key = me + '|' + t.id + '|' + t.historyId;
    const hit = ROWS.get(key);
    if (hit) return hit;
    const kept = known.get(t.id);
    if (kept && t.historyId && kept.hid === String(t.historyId)) {
      remember(key, kept.row);
      return kept.row;
    }
    const full = await readRow(gm, t.id);
    if (!full) return null;
    const row = shapeThreadRow(full, me);
    remember(key, row);
    fresh.push({ id: t.id, hid: String(t.historyId || row.historyId || ''), row });
    return row;
  });
  if (STORE && fresh.length) {
    const at = new Date().toISOString();
    await STORE.batch(fresh.map((f) => STORE!.prepare('INSERT INTO hub_mail_rows (mailbox, thread_id, hid, row_json, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(mailbox, thread_id) DO UPDATE SET hid = excluded.hid, row_json = excluded.row_json, at = excluded.at').bind(me, f.id, f.hid, JSON.stringify(f.row), at))).catch(() => undefined);
  }
  return rows.filter(Boolean) as ThreadRow[];
}

/** Thread ids from a Gmail search, newest first, across pages up to `cap`. */
export async function idsFor(gm: Gmail, params: Record<string, string | string[] | undefined>, cap: number): Promise<{ threads: Array<{ id: string; historyId?: string }>; more: boolean }> {
  const out: Array<{ id: string; historyId?: string }> = [];
  let page = '';
  for (let i = 0; i < 6 && out.length < cap; i++) {
    const l = await gm.get('/threads', { ...params, maxResults: String(Math.min(500, cap - out.length)), pageToken: page || undefined });
    out.push(...(l.threads || []));
    page = l.nextPageToken || '';
    if (!page) break;
  }
  return { threads: out.slice(0, cap), more: !!page };
}

export const forgetRows = () => ROWS.clear();

/** Drops the saved rows older than 45 days, now and then, so the table stays small. */
export async function pruneRows(): Promise<void> {
  if (!STORE || Math.random() > 0.02) return;
  await STORE.prepare('DELETE FROM hub_mail_rows WHERE at < ?').bind(new Date(Date.now() - 45 * 864e5).toISOString()).run().catch(() => undefined);
}

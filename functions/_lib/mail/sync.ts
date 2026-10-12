// The saved inbox: each mailbox's newest conversations kept in D1 (hub_mail_rows) and brought up to date from Gmail's history list, so the
// first screen of the inbox is one D1 read and Gmail answers only for changes. Headers and a one-line preview, never a body.
//
//   bootstrap     the profile's history id, then the newest INBOX conversations read once (BOOT of them)
//   catch up      history.list from the saved history id: every conversation it names is read again (or dropped when Gmail no longer has it)
//   own changes   a change made through Mail edits the saved row at once (applyLabels), and the history list later confirms it
//   too far back  Gmail keeps history about a week; an older id (404) or a very long list starts the bootstrap over
import type { Env } from '../http';
import { nowIso } from '../http';
import { GmailError, ROW_HEADERS, pool, shapeThreadRow, type Gmail, type ThreadRow } from './gmail';
import { idsFor, readRowPublic, rowsFor, saveRows } from './rows';

export const BOOT = 40;
export const FRESH_MS = 20_000;
const MAX_CHANGED = 40;

export interface SyncState {
  historyId: string;
  syncedAt: number;
  nextToken: string;
}

export async function stateOf(env: Env, mailbox: string): Promise<SyncState | null> {
  const r = await env.DB.prepare('SELECT history_id, synced_at, next_token FROM hub_mail_sync WHERE mailbox = ?').bind(mailbox).first<{ history_id: string; synced_at: string; next_token: string }>().catch(() => null);
  return r ? { historyId: r.history_id, syncedAt: Date.parse(r.synced_at) || 0, nextToken: r.next_token || '' } : null;
}

async function save(env: Env, mailbox: string, historyId: string, nextToken: string) {
  await env.DB.prepare('INSERT INTO hub_mail_sync (mailbox, history_id, synced_at, next_token) VALUES (?, ?, ?, ?) ON CONFLICT(mailbox) DO UPDATE SET history_id = excluded.history_id, synced_at = excluded.synced_at, next_token = excluded.next_token')
    .bind(mailbox, historyId, nowIso(), nextToken).run().catch(() => undefined);
}

/** Reads the newest INBOX conversations once and notes where Gmail's history stands. */
export async function bootstrap(env: Env, gm: Gmail, mailbox: string, later?: (p: Promise<unknown>) => void): Promise<void> {
  const [profile, list] = await Promise.all([gm.get('/profile').catch(() => null), gm.get('/threads', { labelIds: 'INBOX', maxResults: String(BOOT) })]);
  const all = list.threads || [];
  // The first screen is read now; the rest of the first 40 is read after the answer is sent when the caller can wait on it.
  const now = later ? all.slice(0, 20) : all;
  await rowsFor(gm, mailbox, now, 6);
  if (later && all.length > 20) later(rowsFor(gm, mailbox, all.slice(20), 4).catch(() => undefined));
  await save(env, mailbox, String(profile?.historyId || ''), String(list.nextPageToken || ''));
}

/** Brings the saved rows up to date from Gmail's history. Returns how many conversations changed. */
export async function catchUp(env: Env, gm: Gmail, mailbox: string, st: SyncState): Promise<number> {
  if (!st.historyId) {
    await bootstrap(env, gm, mailbox);
    return -1;
  }
  const changed = new Set<string>();
  let page = '';
  let newest = st.historyId;
  try {
    for (let i = 0; i < 5; i++) {
      const h = await gm.get('/history', { startHistoryId: st.historyId, maxResults: '200', pageToken: page || undefined, historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'] });
      for (const rec of h.history || []) for (const m of rec.messages || []) if (m?.threadId) changed.add(String(m.threadId));
      if (h.historyId) newest = String(h.historyId);
      page = h.nextPageToken || '';
      if (!page) break;
    }
  } catch (e) {
    // The id is older than Gmail keeps: start over.
    if (e instanceof GmailError && e.status === 404) {
      await bootstrap(env, gm, mailbox);
      return -1;
    }
    throw e;
  }
  if (changed.size > MAX_CHANGED) {
    await bootstrap(env, gm, mailbox);
    return -1;
  }
  const ids = [...changed];
  const fresh: Array<{ id: string; hid: string; row: ThreadRow }> = [];
  const gone: string[] = [];
  await pool(ids, 5, async (id) => {
    const full = await readRowPublic(gm, id);
    if (!full) return gone.push(id);
    const row = shapeThreadRow(full, mailbox);
    fresh.push({ id, hid: String(full.historyId || row.historyId || ''), row });
  });
  await saveRows(mailbox, fresh);
  if (gone.length) await env.DB.prepare('DELETE FROM hub_mail_rows WHERE mailbox = ? AND thread_id IN (SELECT value FROM json_each(?))').bind(mailbox, JSON.stringify(gone)).run().catch(() => undefined);
  await save(env, mailbox, newest, st.nextToken);
  return ids.length;
}

/** The newest INBOX conversations from D1: offset and count. Total says how many the saved inbox holds. */
export async function inboxFromCache(env: Env, mailbox: string, offset: number, count: number): Promise<{ rows: ThreadRow[]; total: number }> {
  const where = `mailbox = ?1 AND EXISTS (SELECT 1 FROM json_each(json_extract(row_json, '$.labelIds')) WHERE value = 'INBOX')`;
  const [r, n] = await Promise.all([
    env.DB.prepare(`SELECT row_json FROM hub_mail_rows WHERE ${where} ORDER BY json_extract(row_json, '$.date') DESC LIMIT ?2 OFFSET ?3`).bind(mailbox, count, offset).all<{ row_json: string }>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM hub_mail_rows WHERE ${where}`).bind(mailbox).first<{ n: number }>(),
  ]);
  const rows: ThreadRow[] = [];
  for (const x of r.results || []) {
    try {
      rows.push(JSON.parse(x.row_json));
    } catch {
      /* skipped */
    }
  }
  return { rows, total: Number(n?.n) || 0 };
}

/** A change made through Mail, written into the saved row at once so the next list shows it without waiting for the history list. */
export async function applyLabels(env: Env, mailbox: string, threadId: string, add: string[], remove: string[]): Promise<void> {
  try {
    const r = await env.DB.prepare('SELECT row_json FROM hub_mail_rows WHERE mailbox = ? AND thread_id = ?').bind(mailbox, threadId).first<{ row_json: string }>();
    if (!r) return;
    const row = JSON.parse(r.row_json) as ThreadRow;
    const set = new Set(row.labelIds || []);
    for (const l of remove) set.delete(l);
    for (const l of add) set.add(l);
    row.labelIds = [...set];
    row.unread = set.has('UNREAD');
    row.starred = set.has('STARRED');
    await env.DB.prepare('UPDATE hub_mail_rows SET row_json = ? WHERE mailbox = ? AND thread_id = ?').bind(JSON.stringify(row), mailbox, threadId).run();
  } catch {
    /* the history list catches up */
  }
}

export const forgetMailbox = (env: Env, mailbox: string) => env.DB.prepare('DELETE FROM hub_mail_sync WHERE mailbox = ?').bind(mailbox).run().catch(() => undefined);

void idsFor;
void ROW_HEADERS;

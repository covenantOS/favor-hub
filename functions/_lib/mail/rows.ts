// The rows of the list, kept per thread and history id, so a second look at a page reads only the conversations that changed.
// Shared by the list route and the smart views, which scan the same conversations.
import { ROW_HEADERS, pool, shapeThreadRow, type Gmail, type ThreadRow } from './gmail';

const ROWS = new Map<string, ThreadRow>();
const remember = (k: string, v: ThreadRow) => {
  if (ROWS.size > 2000) ROWS.clear();
  ROWS.set(k, v);
};

/** One row for each listed thread (id and history id), read from Gmail only when the thread changed since the last look. */
export async function rowsFor(gm: Gmail, me: string, threads: Array<{ id: string; historyId?: string }>, width = 8): Promise<ThreadRow[]> {
  const rows = await pool(threads, width, async (t) => {
    const key = me + '|' + t.id + '|' + t.historyId;
    const hit = ROWS.get(key);
    if (hit) return hit;
    const full = await gm.get('/threads/' + t.id, { format: 'metadata', metadataHeaders: ROW_HEADERS }).catch(() => null);
    if (!full) return null;
    const row = shapeThreadRow(full, me);
    remember(key, row);
    return row;
  });
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

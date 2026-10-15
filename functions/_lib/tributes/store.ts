// Tributes in FavorOS D1 (db/gift-tributes.sql) and the copy of the comment tributes from the Blackbaud mirror.
import { newId, nowIso, type Env } from '../http';
import { mirror } from '../foundations/blackbaud';
import { parseTribute } from './parse';

export interface TributeRow {
  id: string;
  bb_gift_id: string | null;
  og_gift_id: string | null;
  partner_id: string | null;
  kind: 'honor' | 'memorial';
  honoree: string;
  notify: string | null;
  source: 'entry' | 'from comment';
  comment: string | null;
  gift_date: string | null;
}

export const tributeView = (r: TributeRow) => ({
  id: r.id,
  giftId: r.bb_gift_id || '',
  partnerId: r.partner_id || '',
  kind: r.kind,
  honoree: r.honoree,
  notify: r.notify || '',
  source: r.source,
  comment: r.comment || '',
  giftDate: r.gift_date || '',
});

/** The tribute a gift took at entry, written when the gift reaches Blackbaud (a retry finds it by og_gift_id). */
export async function saveEntryTribute(
  env: Env,
  g: { id: string; bb_gift_id: string | null; partner_id: string | null; gift_date: string | null; tribute_kind: string | null; tribute_name: string | null; tribute_notify: string | null },
  actor: string
): Promise<void> {
  if (!g.tribute_kind || !(g.tribute_name || '').trim()) return;
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO fo_gift_tribute (id, bb_gift_id, og_gift_id, partner_id, kind, honoree, notify, source, gift_date, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,'entry',?,?,?,?)
     ON CONFLICT(og_gift_id) WHERE og_gift_id IS NOT NULL DO UPDATE SET bb_gift_id = excluded.bb_gift_id, kind = excluded.kind, honoree = excluded.honoree,
       notify = excluded.notify, updated_at = excluded.updated_at`
  )
    .bind(newId('tr'), g.bb_gift_id, g.id, g.partner_id, g.tribute_kind, g.tribute_name!.trim(), (g.tribute_notify || '').trim() || null, g.gift_date, actor, now, now)
    .run();
}

const WORDS = `lower(gift_comments) NOT LIKE '%do not honor%' AND (lower(gift_comments) LIKE '%memory%' OR lower(gift_comments) LIKE '%memorial%' OR lower(gift_comments) LIKE '%honor%' OR lower(gift_comments) LIKE '%tribute%')`;

/** Copies tributes written in Blackbaud gift comments into FavorOS, flagged "from comment". A gift that already has a row is left alone. */
export async function backfillFromComments(env: Env, actor: string): Promise<{ read: number; added: number; skipped: number; unparsed: Array<{ id: string; comment: string }> }> {
  const rows = await mirror<{ id: string; partner: string; d: string; comment: string }>(
    env,
    `SELECT id, constituent_record_id AS partner, substr(gift_date, 1, 10) AS d, gift_comments AS comment FROM gifts WHERE gift_comments IS NOT NULL AND ${WORDS} AND gift_comments NOT LIKE 'HARDREJECT%' AND gift_comments NOT LIKE 'SOFTREJECT%' ORDER BY gift_date`
  );
  const have = new Set(((await env.DB.prepare('SELECT bb_gift_id FROM fo_gift_tribute WHERE bb_gift_id IS NOT NULL').all<{ bb_gift_id: string }>()).results || []).map((r) => String(r.bb_gift_id)));
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  const unparsed: Array<{ id: string; comment: string }> = [];
  let skipped = 0;
  for (const r of rows) {
    const t = parseTribute(r.comment);
    if (!t) {
      unparsed.push({ id: String(r.id), comment: String(r.comment).slice(0, 160) });
      continue;
    }
    if (have.has(String(r.id))) {
      skipped += 1;
      continue;
    }
    stmts.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO fo_gift_tribute (id, bb_gift_id, partner_id, kind, honoree, source, comment, gift_date, created_by, created_at, updated_at) VALUES (?,?,?,?,?,'from comment',?,?,?,?,?)`
      ).bind(newId('tr'), String(r.id), String(r.partner || ''), t.kind, t.honoree, String(r.comment).slice(0, 600), r.d, actor, now, now)
    );
  }
  for (let i = 0; i < stmts.length; i += 40) await env.DB.batch(stmts.slice(i, i + 40));
  return { read: rows.length, added: stmts.length, skipped, unparsed };
}

export async function tributesFor(env: Env, by: { gift?: string[]; partner?: string }): Promise<TributeRow[]> {
  if (by.partner) return (await env.DB.prepare('SELECT * FROM fo_gift_tribute WHERE partner_id = ? ORDER BY gift_date DESC').bind(by.partner).all<TributeRow>()).results || [];
  const ids = (by.gift || []).filter((x) => /^[A-Za-z0-9_-]{1,40}$/.test(x)).slice(0, 200);
  if (!ids.length) return [];
  return (await env.DB.prepare(`SELECT * FROM fo_gift_tribute WHERE bb_gift_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<TributeRow>()).results || [];
}

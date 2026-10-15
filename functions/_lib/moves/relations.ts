// The relationship map. A partner's relationships come from the Blackbaud copy (constituent_relationships, both directions) and from
// relationships added in FavorOS (mv_relationship, db/moves.sql). Each related partner carries their giving by the shared rule.
// A relationship added here is sent to Blackbaud through the guarded upkeep route (POST /constituent/v1/relationships). A test account
// or a role test uses the stand-in sender, which checks the call and sends nothing. When Blackbaud refuses, the relationship stays in
// FavorOS and is labeled FavorOS-only.
import { HttpError, newId, nowIso } from '../http';
import { listMirrorQ } from '../work/partner';
import { readOnly } from '../work/repo';
import type { Ctx } from '../work/service';
import { can } from '../work/role';
import { standInSender, type Sender } from '../work/addpartner';
import { isTester } from '../testuser';
import { givingForMany, type MirrorQ } from '../gifts/partner-giving';
import { mayMoves } from './service';

const ID = /^\d{1,12}$/;

/** What this partner is to the other record, keyed by what the other record is to this partner. Pairs seen in Blackbaud's own relationships, plus the person pairs read back on test records. */
export const REL_TYPES: Record<string, string> = {
  Parent: 'Child', Child: 'Parent', Sibling: 'Sibling', Friend: 'Friend', Grandparent: 'Grandchild', Grandchild: 'Grandparent', Mentor: 'Mentee', Mentee: 'Mentor',
  Employer: 'Employee', Employee: 'Employer', Pastor: 'Church', Church: 'Pastor', 'Missions Pastor': 'Church', Member: 'Church',
  Director: 'Church', 'Committee Member': 'Church', Founder: 'Ministry', Ministry: 'Founder', Owner: 'Organization', Organization: 'Owner',
  Foundation: 'Funds Administrator', 'Funds Administrator': 'Foundation',
};

export type Group = 'family' | 'church' | 'work' | 'board' | 'foundation' | 'other';
const FAMILY = ['spouse', 'parent', 'child', 'sibling', 'grandparent', 'grandchild'];
export function groupOf(type: string): Group {
  const t = type.toLowerCase();
  if (FAMILY.includes(t)) return 'family';
  if (/board/.test(t)) return 'board';
  if (/pastor|church|member|director|committee/.test(t)) return 'church';
  if (/foundation|funds administrator/.test(t)) return 'foundation';
  if (/employer|employee|owner|organization|founder|ministry|staff/.test(t)) return 'work';
  return 'other';
}

interface RelRow { rid: string; other: string; type: string | null; rtype: string | null; name: string | null; spouse: number; orgc: number; position: string | null; comment: string | null }

const FWD_SQL = readOnly(`SELECT id AS rid, relation_id AS other, type, reciprocal_type AS rtype, name, is_spouse AS spouse, is_organization_contact AS orgc, position, substr(COALESCE(comment, ''), 1, 200) AS comment
  FROM constituent_relationships WHERE constituent_id = ?1 AND end_date IS NULL LIMIT 80`);
const REV_SQL = readOnly(`SELECT r.id AS rid, r.constituent_id AS other, r.type AS type, r.reciprocal_type AS rtype,
  COALESCE(json_extract(c.raw_json, '$.name'), trim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))) AS name, r.is_spouse AS spouse, r.is_organization_contact AS orgc, r.position AS position, substr(COALESCE(r.comment, ''), 1, 200) AS comment
  FROM constituent_relationships r LEFT JOIN constituents c ON c.id = r.constituent_id WHERE r.relation_id = ?1 AND r.end_date IS NULL LIMIT 80`);
const NAME_SQL = readOnly(`SELECT id AS id, COALESCE(json_extract(raw_json, '$.name'), trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))) AS name, constituent_type AS ctype, deceased AS dec,
  json_extract(raw_json, '$.address.city') AS city, json_extract(raw_json, '$.address.state') AS st FROM constituents WHERE id IN (SELECT value FROM json_each(?1))`);
const EXISTS_SQL = readOnly(`SELECT COUNT(*) AS n FROM constituent_relationships WHERE constituent_id = ?1 AND relation_id = ?2 AND lower(COALESCE(type, '')) = lower(?3) AND end_date IS NULL`);

export interface Node {
  cid: string;
  name: string;
  /** What this record is to the center partner. */
  role: string;
  /** What the center partner is to them. */
  back: string;
  group: Group;
  position: string;
  place: string;
  kind: string;
  deceased: boolean;
  lifetime: number;
  largest: number;
  lastGift: string | null;
  major: boolean;
  /** blackbaud: in the Blackbaud copy. favoros: added here and sent. favoros-only: added here, not in Blackbaud. */
  source: 'blackbaud' | 'favoros' | 'favoros-only';
}

export async function graphFor(ctx: Ctx, cid: string) {
  if (!ID.test(cid)) throw new HttpError(400, 'bad_id', 'That is not a partner number.');
  const q = listMirrorQ(ctx.env);
  const [fwd, rev, mine] = await Promise.all([
    q<RelRow>(FWD_SQL, [cid]),
    q<RelRow>(REV_SQL, [cid]),
    ctx.env.DB.prepare("SELECT other_cid, other_name, type, reciprocal_type, position, bb_state FROM mv_relationship WHERE cid = ?1 AND bb_state <> 'pending'")
      .bind(cid)
      .all<{ other_cid: string; other_name: string; type: string; reciprocal_type: string; position: string; bb_state: string }>()
      .then((r) => r.results)
      .catch(() => []),
  ]);
  const seen = new Set<string>();
  const items: { other: string; role: string; back: string; name: string; position: string; source: Node['source'] }[] = [];
  const push = (other: string, role: string, back: string, name: string, position: string, source: Node['source']) => {
    const k = `${other}|${role.toLowerCase()}`;
    if (!other || other === cid || seen.has(k)) return;
    seen.add(k);
    items.push({ other, role, back, name, position, source });
  };
  for (const r of fwd) push(String(r.other), r.type || (Number(r.spouse) === 1 ? 'Spouse' : 'Contact'), r.rtype || '', String(r.name || ''), String(r.position || ''), 'blackbaud');
  for (const r of rev) push(String(r.other), r.rtype || (Number(r.spouse) === 1 ? 'Spouse' : r.type || 'Contact'), r.type || '', String(r.name || ''), String(r.position || ''), 'blackbaud');
  // A relationship added here and since synced from Blackbaud shows once, from Blackbaud (the key above matches on the other record and the role).
  for (const m of mine) push(String(m.other_cid), m.type, m.reciprocal_type || '', String(m.other_name || ''), String(m.position || ''), m.bb_state === 'sent' || m.bb_state === 'standin' ? 'favoros' : 'favoros-only');
  const ids = [...new Set(items.map((i) => i.other))].slice(0, 40);
  const [info, giving] = await Promise.all([
    ids.length ? q<{ id: string; name: string; ctype: string; dec: number; city: string; st: string }>(NAME_SQL, [JSON.stringify(ids)]) : Promise.resolve([]),
    givingForMany(q as unknown as MirrorQ, [cid, ...ids]),
  ]);
  const byId = new Map(info.map((r) => [String(r.id), r]));
  const nodes: Node[] = items
    .filter((i) => ids.includes(i.other))
    .map((i) => {
      const rec = byId.get(i.other);
      const g = giving.get(i.other);
      return {
        cid: i.other,
        name: String((rec && rec.name) || i.name || `Record ${i.other}`),
        role: i.role,
        back: i.back,
        group: groupOf(i.role),
        position: i.position,
        place: rec ? [rec.city, rec.st].filter(Boolean).join(', ') : '',
        kind: rec && rec.ctype === 'Organization' ? 'organization' : 'person',
        deceased: !!rec && Number(rec.dec) === 1,
        lifetime: g ? g.total : 0,
        largest: g && g.largest ? g.largest.amount : 0,
        lastGift: g && g.last ? g.last.date : null,
        major: !!g && g.major,
        source: i.source,
      };
    });
  const centerRec = (await q<{ id: string; name: string }>(NAME_SQL, [JSON.stringify([cid])]))[0];
  const c = giving.get(cid);
  const order: Group[] = ['family', 'church', 'work', 'board', 'foundation', 'other'];
  nodes.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || b.lifetime - a.lifetime || a.name.localeCompare(b.name));
  return {
    ok: true,
    center: { cid, name: String((centerRec && centerRec.name) || `Record ${cid}`), lifetime: c ? c.total : 0, largest: c && c.largest ? c.largest.amount : 0, lastGift: c && c.last ? c.last.date : null, major: !!c && c.major },
    nodes,
    types: Object.keys(REL_TYPES).map((t) => ({ type: t, back: REL_TYPES[t] })),
  };
}

export interface RelIn { cid?: unknown; otherCid?: unknown; type?: unknown; position?: unknown }

export async function addRelationship(ctx: Ctx, b: RelIn, send?: Sender) {
  if (!mayMoves(ctx.scope) && !(ctx.scope && can(ctx.scope, 'partner_edit'))) throw new HttpError(403, 'not_yours', 'Your role cannot add a relationship.');
  const cid = String(b.cid || '');
  const other = String(b.otherCid || '').replace(/\D/g, '');
  const type = String(b.type || '');
  const position = String(b.position || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!ID.test(cid) || !ID.test(other)) throw new HttpError(400, 'bad_id', 'Pick two partners.');
  if (cid === other) throw new HttpError(400, 'same', 'A partner cannot be related to themselves.');
  if (!REL_TYPES[type]) throw new HttpError(400, 'bad_relationship', 'Pick the relationship from the list.');
  if (ctx.testCid && cid !== ctx.testCid) throw new HttpError(403, 'test_only', 'A role test may change only the test record.');
  const env = ctx.env;
  const q = listMirrorQ(env);
  const recs = await q<{ id: string; name: string }>(NAME_SQL, [JSON.stringify([cid, other])]);
  const mineRec = recs.find((r) => String(r.id) === cid);
  const otherRec = recs.find((r) => String(r.id) === other);
  if (!mineRec) throw new HttpError(404, 'no_partner', 'No partner has that number.');
  if (!otherRec) throw new HttpError(404, 'no_other', 'No partner has the number you gave for the other person.');
  // Who may add: admins, Support, and a director or Partner Care who holds the partner (the same line as editing the record).
  const sc = ctx.scope;
  if (sc && !sc.all && sc.role !== 'support') {
    const held = await env.DB.prepare('SELECT 1 AS x FROM lr_holder h JOIN lr_hh x ON x.household_id = h.household_id WHERE (x.record_id = ?1 OR x.spouse_record_id = ?1) AND h.fundraiser_id IN (SELECT value FROM json_each(?2)) LIMIT 1')
      .bind(cid, JSON.stringify([...sc.fids]))
      .first()
      .catch(() => null);
    if (!held) throw new HttpError(403, 'not_yours', 'That partner is not in your portfolio.');
  }
  const have = await q<{ n: number }>(EXISTS_SQL, [cid, other, type]);
  if (have[0] && Number(have[0].n) > 0) throw new HttpError(409, 'exists', 'Blackbaud already has that relationship.');
  const id = newId('mvr');
  const now = nowIso();
  try {
    await env.DB.prepare('INSERT INTO mv_relationship (id, cid, other_cid, other_name, type, reciprocal_type, position, bb_state, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(id, cid, other, String(otherRec.name || ''), type, REL_TYPES[type], position || null, 'pending', now, ctx.actor)
      .run();
  } catch {
    throw new HttpError(409, 'exists', 'That relationship is already on the record.');
  }
  const standin = !!ctx.testCid || isTester(ctx.email);
  const log: { method: string; path: string; body?: unknown }[] = [];
  const sender: Sender = send || (standin ? standInSender(log) : (calls) => ctx.repo.send(calls));
  const body: Record<string, unknown> = { constituent_id: cid, relation_id: other, type, reciprocal_type: REL_TYPES[type], ...(position ? { position } : {}) };
  let state = 'local';
  let bbId: string | null = null;
  let why = '';
  try {
    const out = await sender([{ method: 'POST', path: '/constituent/v1/relationships', body }]);
    const r = out.results && out.results[0];
    if (r && r.ok) {
      state = standin ? 'standin' : 'sent';
      bbId = r.body && r.body.id ? String(r.body.id) : null;
    } else why = out.wait || (r && (r.refused || (r.body && (r.body.message || r.body.title)))) || 'Blackbaud did not take it.';
  } catch (err) {
    why = err instanceof Error ? err.message : 'Blackbaud did not answer.';
  }
  await env.DB.batch([
    env.DB.prepare('UPDATE mv_relationship SET bb_state = ?, bb_id = ? WHERE id = ?').bind(state, bbId, id),
    env.DB.prepare('INSERT INTO mv_audit (id, at, actor, actor_email, key, kind, detail) VALUES (?,?,?,?,?,?,?)').bind(newId('mva'), now, ctx.actor, ctx.email, cid, 'relationship', `${type}: ${otherRec.name} (${other}) ${state}`),
  ]);
  return { id, state, standin, why: String(why).slice(0, 160), calls: standin ? log : undefined, label: state === 'sent' ? 'Sent to Blackbaud' : state === 'standin' ? 'Test: nothing sent to Blackbaud' : 'Saved in FavorOS only' };
}

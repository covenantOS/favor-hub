import { newId, nowIso, type Env } from '../http';

export interface Foundation {
  id: string;
  name: string;
  name_key: string;
  location: string;
  phone: string;
  email: string;
  website: string;
  ein: string;
  assets: string;
  notes: string;
  status: string;
  dead_reason: string;
  bb_lookup_id: string | null;
  bb_system_id: string | null;
  bb_name: string | null;
  bb_match_reason: string | null;
  bb_linked_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  foundation_id: string;
  contact_date: string;
  how: string;
  category: string;
  rdd_name: string;
  rdd_id: string;
  summary: string;
  note: string;
  outcome: string;
  tags: string;
  source: string;
  bb_action_id: string | null;
  bb_on: string | null;
  bb_state: string;
  bb_tags_state: string;
  bb_error: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

const STOP = new Set(['the', 'of', 'and', 'for', 'inc', 'foundation', 'fund', 'family', 'charitable', 'trust', 'fnd', 'a', 'co', 'llc', 'incorporated']);

export function words(s: string): string[] {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** The words that tell one foundation from another: "The Adair Family Foundation" and "Adair Foundation" share a key. */
export function nameKey(name: string): string {
  const all = words(name);
  const kept = all.filter((w) => !STOP.has(w));
  return (kept.length ? kept : all).join(' ');
}

export async function getSetting(env: Env, key: string, fallback = ''): Promise<string> {
  const row = await env.DB.prepare('SELECT value FROM fnd_settings WHERE key = ? LIMIT 1').bind(key).first<{ value: string }>();
  return row ? row.value : fallback;
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO fnd_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  )
    .bind(key, value, nowIso())
    .run();
}

export async function logEvent(
  env: Env,
  e: { foundation_id?: string | null; contact_id?: string | null; kind: string; actor?: string; method?: string; path?: string; ok?: boolean; status?: number; detail?: string }
): Promise<void> {
  try {
    await env.DB.prepare(
      'INSERT INTO fnd_log (id, foundation_id, contact_id, kind, actor, method, path, ok, status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(
        newId('fnl'),
        e.foundation_id ?? null,
        e.contact_id ?? null,
        e.kind,
        e.actor || '',
        e.method ?? null,
        e.path ?? null,
        e.ok === undefined ? null : e.ok ? 1 : 0,
        e.status ?? null,
        (e.detail || '').slice(0, 900),
        nowIso()
      )
      .run();
  } catch (err) {
    console.error('[foundations] log failed', err);
  }
}

const LIST_SQL = `
  SELECT f.id, f.name, f.location, f.assets, f.status, f.dead_reason, f.bb_lookup_id, f.bb_name, f.updated_at,
    (SELECT COUNT(*) FROM fnd_contacts c WHERE c.foundation_id = f.id) AS contacts,
    (SELECT MAX(c.contact_date) FROM fnd_contacts c WHERE c.foundation_id = f.id) AS last_contact,
    (SELECT GROUP_CONCAT(DISTINCT c.rdd_name) FROM fnd_contacts c WHERE c.foundation_id = f.id AND c.rdd_name <> '') AS rdds,
    (SELECT COUNT(*) FROM fnd_contacts c WHERE c.foundation_id = f.id AND c.bb_state IN ('pending', 'failed', 'held')) AS waiting,
    (SELECT COUNT(*) FROM fnd_contacts c WHERE c.foundation_id = f.id AND f.bb_lookup_id IS NOT NULL AND c.bb_on IS NOT NULL AND c.bb_on <> f.bb_lookup_id) AS misplaced
  FROM fnd_foundations f`;

export async function listFoundations(env: Env): Promise<Record<string, unknown>[]> {
  const res = await env.DB.prepare(`${LIST_SQL} ORDER BY contacts DESC, f.name COLLATE NOCASE`).all();
  return res.results;
}

export async function getFoundation(env: Env, id: string): Promise<Foundation | null> {
  return env.DB.prepare('SELECT * FROM fnd_foundations WHERE id = ? LIMIT 1').bind(id).first<Foundation>();
}

export async function contactsFor(env: Env, foundationId: string): Promise<Contact[]> {
  const res = await env.DB.prepare('SELECT * FROM fnd_contacts WHERE foundation_id = ? ORDER BY contact_date DESC, created_at DESC')
    .bind(foundationId)
    .all<Contact>();
  return res.results;
}

export async function getContact(env: Env, id: string): Promise<Contact | null> {
  return env.DB.prepare('SELECT * FROM fnd_contacts WHERE id = ? LIMIT 1').bind(id).first<Contact>();
}

export function publicContact(c: Contact): Record<string, unknown> {
  let tags: string[] = [];
  try {
    tags = JSON.parse(c.tags || '[]');
  } catch {
    tags = [];
  }
  return {
    id: c.id,
    date: c.contact_date,
    how: c.how,
    category: c.category,
    rdd: c.rdd_name,
    summary: c.summary,
    note: c.note,
    outcome: c.outcome,
    tags,
    source: c.source,
    bb_action_id: c.bb_action_id,
    bb_on: c.bb_on,
    bb_state: c.bb_state,
    bb_tags_state: c.bb_tags_state,
    bb_error: c.bb_error,
    by: c.created_by,
    created_at: c.created_at,
  };
}

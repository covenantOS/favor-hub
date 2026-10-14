// Favor Brain packages from FavorOS roles and teams (2026-10-14). The rules live in brain_access_rules (db/brain-access.sql),
// FavorOS Admin > People edits them, and the Brain (favor-mcp src/access.ts) reads the same table with the same matching rule.
// Grants from the Brain page (brain_grants) still add or take away one package for one person, with an end date.
// FavorOS reads packages here for two things: the Admin table, and the audience check before a Brain answer with partner
// data is shared into a Chat conversation.
import type { Env } from './http';

export const RULE_KINDS = ['everyone', 'role', 'team', 'lead', 'person'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];
export const RULE_PACKAGES = ['partners', 'contacts', 'iwave', 'all_teams', 'sheets', 'admin'] as const;
export type Pkg = (typeof RULE_PACKAGES)[number] | 'basics';
export const PACKAGE_LABEL: Record<string, string> = {
  partners: 'Partner records and giving',
  contacts: 'Contact details in lists (phone, email, street address)',
  iwave: 'iWave capacity',
  all_teams: "Every team's dashboard numbers",
  sheets: 'Google Sheets export',
  admin: 'Brain admin',
};

export interface AccessRule {
  id?: number;
  kind: RuleKind;
  key: string;
  package: string;
}
export interface Who {
  email: string;
  role?: string | null;
  team?: string | null;
  lead?: number | null;
  blocked?: number | null;
}

/** The same matching rule as favor-mcp rulePackages: keep the two in step. */
export function rulePackages(rules: AccessRule[], who: Who): Set<string> {
  const p = new Set<string>(['basics']);
  const email = who.email.toLowerCase();
  const team = String(who.team || '').trim().toLowerCase();
  for (const r of rules) {
    if (!(RULE_PACKAGES as readonly string[]).includes(r.package)) continue;
    const key = String(r.key || '').trim().toLowerCase();
    const hit =
      r.kind === 'everyone' ||
      (r.kind === 'person' && key === email) ||
      (r.kind === 'role' && key === String(who.role || '').toLowerCase()) ||
      (r.kind === 'team' && !!team && key === team) ||
      (r.kind === 'lead' && !!who.lead && (key === '' || key === team));
    if (hit && (r.package !== 'admin' || r.kind === 'person')) p.add(r.package);
  }
  return p;
}

export async function readRules(env: Env): Promise<AccessRule[]> {
  const r = await env.DB.prepare('SELECT id, kind, key, package FROM brain_access_rules ORDER BY kind, key, package').all<AccessRule>().catch(() => ({ results: [] as AccessRule[] }));
  return r.results || [];
}

interface GrantRow {
  email: string;
  package: string;
  effect: string;
  ends_at: string | null;
}

/**
 * Each person's Brain packages after rules and grants. A blocked person, a field account and anyone when no rules can be read
 * get Basics only, so a read failure never widens access.
 */
export async function brainPackagesFor(env: Env, emails: string[]): Promise<Map<string, Set<string>>> {
  const list = [...new Set(emails.map((e) => String(e || '').toLowerCase()).filter(Boolean))];
  const out = new Map<string, Set<string>>();
  for (const e of list) out.set(e, new Set(['basics']));
  if (!list.length) return out;
  const rules = await readRules(env);
  if (!rules.length) return out;
  const who = await env.DB.prepare(
    `SELECT e.value AS email,
            (SELECT u.role FROM hub_users u WHERE lower(u.email) = e.value) AS role,
            (SELECT u.blocked FROM hub_users u WHERE lower(u.email) = e.value) AS blocked,
            (SELECT d.team FROM meet_directory d WHERE lower(d.email) = e.value AND d.active = 1) AS team,
            (SELECT d.lead FROM meet_directory d WHERE lower(d.email) = e.value AND d.active = 1) AS lead
       FROM json_each(?) e`
  ).bind(JSON.stringify(list)).all<Who>().catch(() => ({ results: [] as Who[] }));
  const grants = await env.DB.prepare(`SELECT lower(g.email) AS email, g.package, g.effect, g.ends_at FROM brain_grants g, json_each(?) e WHERE lower(g.email) = e.value AND (g.ends_at IS NULL OR g.ends_at > ?) ORDER BY g.id`)
    .bind(JSON.stringify(list), new Date().toISOString())
    .all<GrantRow>()
    .catch(() => ({ results: [] as GrantRow[] }));
  for (const w of who.results || []) {
    const e = String(w.email);
    if (w.blocked || w.role === 'field') continue;
    const p = rulePackages(rules, w);
    for (const g of (grants.results || []).filter((x) => x.email === e)) {
      if (g.effect === 'deny') p.delete(g.package);
      else p.add(g.package);
    }
    out.set(e, p);
  }
  return out;
}

// ---- Partner data in a Brain answer ------------------------------------------------------------------
// Blocks that name partners or carry their records: partner cards, lists (tables with person columns, or a list behind them),
// sheet cards, option buttons (often partner names) and iWave confirm cards. Tiles, team tables, charts, steps and notes are
// Favor-level numbers and words and stay in the summary.
const PERSON_COL = /^(name|partner|partners|lookup_id|email|phone|address|given_through|funder|holder|household|households|constituent|donor|contact)$/i;
const SUMMARY_TYPES = new Set(['tiles', 'team', 'chart', 'steps', 'note']);

function tableHasPeople(b: any): boolean {
  if (b && b.token) return true;
  const keys: string[] = Array.isArray(b?.keys) ? b.keys.map(String) : Array.isArray(b?.rows) && b.rows[0] && typeof b.rows[0] === 'object' ? Object.keys(b.rows[0]) : [];
  return keys.some((k) => PERSON_COL.test(k));
}

export function blockHasPartnerData(b: any): boolean {
  const t = String(b?.type || '');
  if (t === 'partner' || t === 'coverage' || t === 'sheet' || t === 'choice' || t === 'confirm') return true;
  if (t === 'table') return tableHasPeople(b);
  return false;
}

export function answerHasPartnerData(brain: any): boolean {
  if (!brain || typeof brain !== 'object') return false;
  if (Array.isArray(brain.lists) && brain.lists.length) return true;
  return (Array.isArray(brain.blocks) ? brain.blocks : []).some(blockHasPartnerData);
}

/** The answer with only Favor-level blocks (tiles, team numbers, charts, steps, notes), or null when nothing is left. */
export function partnerFreeSummary(brain: any): Record<string, unknown> | null {
  const blocks = (Array.isArray(brain?.blocks) ? brain.blocks : []).filter((b: any) => SUMMARY_TYPES.has(String(b?.type || '')) && !blockHasPartnerData(b));
  if (!blocks.length) return null;
  return { status: 'done', blocks, follow: [], asked_as: '', summary_only: true };
}

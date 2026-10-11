// Which roles see each report. The catalog in reports/registry.ts is the starting answer; an admin's saved choice for a report
// (hub_settings reports.roles.<id>, a JSON list of audiences) replaces it. Applied at the top of audiencesOf, so every report route
// obeys it, and with nothing saved the catalog answers exactly as before.
import type { Env } from '../http';
import { ALL_AUDIENCES, CATALOG } from '../reports/registry';
import type { Audience } from '../reports/types';

const ORIGINAL = new Map<string, Audience[]>(CATALOG.map((e) => [e.id, [...e.audience]]));

export const AUDIENCE_LABEL: Record<Audience, string> = {
  admin_desk: 'Admin desk',
  operations: 'Operations',
  leadership: 'Leadership',
  support: 'Support Team',
  partner_care: 'Partner Care',
  rdd: 'Regional directors',
  grants: 'Grants',
  marketing: 'Marketing',
};

export async function savedReportRoles(env: Env): Promise<Record<string, Audience[]>> {
  const out: Record<string, Audience[]> = {};
  try {
    const r = await env.DB.prepare("SELECT key, value FROM hub_settings WHERE key LIKE 'reports.roles.%'").all<{ key: string; value: string }>();
    for (const row of r.results || []) {
      const id = row.key.slice('reports.roles.'.length);
      try {
        const list = JSON.parse(row.value);
        if (Array.isArray(list)) out[id] = list.filter((a: unknown): a is Audience => (ALL_AUDIENCES as string[]).includes(String(a)));
      } catch {
        // a damaged row is ignored; the catalog answers
      }
    }
  } catch {
    // before db/admin-home.sql is applied
  }
  return out;
}

export async function applyReportRoles(env: Env): Promise<void> {
  const saved = await savedReportRoles(env);
  for (const e of CATALOG) e.audience = saved[e.id] ? [...saved[e.id]] : [...(ORIGINAL.get(e.id) || e.audience)];
}

export const originalRoles = (id: string): Audience[] => [...(ORIGINAL.get(id) || [])];

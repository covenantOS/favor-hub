// A person's jobs, for the menu: which areas sit in their rail and which tabs come first (src/data/areas.ts `jobs`).
// Jobs never open or close a page. Access stays with the gates in accessOf (functions/_lib/hub/today.ts).
import type { Job } from '../../../src/data/areas';
import type { Env } from '../http';

/** The Work Center team (act_staff.team) to a job. */
const ACT_TEAM: Record<string, Job> = { rdd: 'rdd', partner_care: 'partner_care', church: 'church', grants: 'grants', support: 'support', exec: 'exec' };

/** The meetings roster team (meet_directory.team) to a job. */
const ROSTER_TEAM: Record<string, Job> = {
  'development (rdd)': 'rdd',
  rdd: 'rdd',
  'partner care': 'partner_care',
  'church engagement': 'church',
  grants: 'grants',
  'support team': 'support',
  support: 'support',
  leadership: 'exec',
};

export interface JobFlags {
  admin?: boolean;
  giftEntry?: boolean;
  hr?: boolean;
  approver?: boolean;
}

/** Pure: the jobs from the two team names and the access flags. Admins hold every job. */
export function jobsFrom(actTeam: string | null | undefined, rosterTeam: string | null | undefined, flags: JobFlags): Job[] {
  if (flags.admin) return ['admin'];
  const out = new Set<Job>();
  const a = ACT_TEAM[String(actTeam || '').trim().toLowerCase()];
  if (a) out.add(a);
  const r = ROSTER_TEAM[String(rosterTeam || '').trim().toLowerCase()];
  if (r) out.add(r);
  if (flags.giftEntry) out.add('giftdesk');
  if (flags.hr) out.add('hr');
  if (flags.approver) out.add('approver');
  return [...out];
}

export async function jobsOf(env: Env, email: string, flags: JobFlags): Promise<Job[]> {
  if (flags.admin) return ['admin'];
  const e = email.trim().toLowerCase();
  const row = await env.DB.prepare(
    `SELECT (SELECT team FROM act_staff WHERE email = ?1 AND active = 1 LIMIT 1) AS act_team,
            (SELECT team FROM meet_directory WHERE email = ?1 AND active = 1 LIMIT 1) AS roster_team`
  )
    .bind(e)
    .first<{ act_team: string | null; roster_team: string | null }>()
    .catch(() => null);
  return jobsFrom(row?.act_team, row?.roster_team, flags);
}

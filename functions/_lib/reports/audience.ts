// Who sees which report. Three sources, none of them a person's name in this repository:
//   1. A hub admin sees every report.
//   2. The Work Center staff list (act_staff.team) puts a person in the support, rdd, partner_care, grants,
//      leadership or admin-desk audience.
//   3. rpt_people (db/reports.sql) holds the rest by email: admin desk, operations, marketing.
import type { Env } from '../http';
import type { HubUser } from '../session';
import { ALL_AUDIENCES } from './registry';
import type { Audience } from './types';
import { applyReportRoles } from '../admin/reportRoles';

export const FROM_TEAM: Record<string, Audience[]> = {
  support: ['support'],
  rdd: ['rdd'],
  church: ['rdd'],
  partner_care: ['partner_care'],
  grants: ['grants'],
  exec: ['leadership'],
  admin: ['admin_desk', 'operations'],
};

export async function audiencesOf(env: Env, user: HubUser): Promise<{ admin: boolean; mine: Set<Audience> }> {
  await applyReportRoles(env);
  const admin = user.role === 'admin';
  const mine = new Set<Audience>();
  const email = user.email.toLowerCase();
  try {
    const staff = await env.DB.prepare('SELECT team FROM act_staff WHERE email = ? AND active = 1 LIMIT 1').bind(email).first<{ team: string }>();
    for (const a of FROM_TEAM[staff?.team ?? ''] || []) mine.add(a);
  } catch {
    // The staff list is optional here.
  }
  try {
    const r = await env.DB.prepare('SELECT audience FROM rpt_people WHERE email = ?').bind(email).all<{ audience: string }>();
    for (const x of r.results || []) if ((ALL_AUDIENCES as string[]).includes(x.audience)) mine.add(x.audience as Audience);
  } catch {
    // Before db/reports.sql is applied, only admins see reports.
  }
  return { admin, mine };
}

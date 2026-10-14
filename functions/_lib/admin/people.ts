// People and roles: hub_users (who may sign in, admin or staff, blocked) joined with act_staff (team, Blackbaud fundraiser link, Work
// Center access). One list, one save. The preview ("act as") computes what a person would see from the same rules the hub applies;
// it never signs in as them and never changes anything.
import { HttpError, nowIso, type Env } from '../http';
import { approverEmails, expenseLogEmails } from '../expenses/auth';
import { AREAS } from '../../../src/data/areas';
import { getRelease } from '../work/db';
import { roleOfTeam } from '../work/role';
import { FROM_TEAM } from '../reports/audience';
import { ALL_AUDIENCES, CATALOG } from '../reports/registry';
import { applyReportRoles, AUDIENCE_LABEL } from './reportRoles';
import { effective, audit } from './settings';
import { allowedDomains, isAdminEmail } from '../session';
import { isDate } from '../evals/rules';

export const TEAMS = ['support', 'rdd', 'partner_care', 'church', 'grants', 'admin', 'exec'];
export const TEAM_LABEL: Record<string, string> = {
  support: 'Support Team', rdd: 'Regional directors', partner_care: 'Partner Care', church: 'Church Engagement', grants: 'Grants', admin: 'Admin desk', exec: 'Leadership',
};
export const ENTRY_TYPES = ['RDD Action', 'CED Action', 'Carole Action', 'Terry Action'];

export interface Person {
  email: string;
  name: string;
  picture: string;
  role: 'admin' | 'staff' | 'field';
  /** Signed in from an allowed partner domain and waiting for an admin to approve or decline. */
  pending: boolean;
  /** The address is also listed in the HUB_ADMINS Pages variable, so it stays admin whatever is saved here. */
  envAdmin: boolean;
  blocked: boolean;
  note: string;
  signIns: number;
  lastSeen: string;
  team: string;
  fundraiser: string;
  workCenter: boolean;
  entryOwner: boolean;
  entryType: string;
  sheetTab: string;
  active: boolean;
  /** In the Work Center staff list (act_staff). */
  listed: boolean;
  /** Who this person reports to (hub_reporting), their title and department as Admin > People records them, and the date they started. */
  supervisor: string;
  title: string;
  department: string;
  startDate: string;
  /** Marked HR: admin rights in Evaluations, Learn authoring and Onboarding, nothing else. */
  hr: boolean;
  sees: { workCenter: boolean; meetings: boolean; clips: boolean; reports: number; expenseLog: boolean; admin: boolean };
}

interface UserRow { email: string; name: string; picture: string; role: string; blocked: number; note: string; sign_ins: number; last_seen: string | null }
interface StaffRow { email: string; name: string; team: string; bb_fundraiser_id: string | null; work_center: number; entry_owner: number; entry_type: string | null; sheet_tab: string | null; active: number }

async function sets(env: Env) {
  const [release, meetRelease, clipsWho, clipsList, rpt, log, appr] = await Promise.all([
    getRelease(env).catch(() => 'admins' as const),
    effective(env, 'meet.release', 'MEET_RELEASE', 'admin'),
    effective(env, 'clips.who', undefined, 'all'),
    effective(env, 'clips.list', undefined, ''),
    env.DB.prepare('SELECT email, audience FROM rpt_people').all<{ email: string; audience: string }>().catch(() => ({ results: [] as { email: string; audience: string }[] })),
    expenseLogEmails(env).catch(() => new Set<string>()),
    approverEmails(env).catch(() => new Set<string>()),
  ]);
  const rptBy = new Map<string, string[]>();
  for (const r of rpt.results || []) rptBy.set(r.email.toLowerCase(), [...(rptBy.get(r.email.toLowerCase()) || []), r.audience]);
  return { release, meetOpen: meetRelease.toLowerCase() === 'staff', clipsWho, clipsList: clipsList.split(/[,\s]+/).map((e) => e.toLowerCase()).filter(Boolean), rptBy, log, appr };
}

type Sets = Awaited<ReturnType<typeof sets>>;

function audiencesFor(s: Sets, email: string, team: string | undefined, active: boolean, admin: boolean): Set<string> {
  const mine = new Set<string>();
  if (admin) return new Set(ALL_AUDIENCES);
  for (const a of active && team ? FROM_TEAM[team] || [] : []) mine.add(a);
  for (const a of s.rptBy.get(email) || []) mine.add(a);
  return mine;
}

function seesFor(s: Sets, email: string, admin: boolean, st: StaffRow | undefined) {
  const listed = !!st && st.work_center === 1 && st.active === 1;
  const mine = audiencesFor(s, email, st?.team, !!st && st.active === 1, admin);
  return {
    workCenter: admin || (s.release === 'support' && listed),
    meetings: admin || s.meetOpen,
    clips: admin || s.clipsWho === 'all' || (s.clipsWho === 'list' && s.clipsList.includes(email)),
    reports: admin ? CATALOG.length : CATALOG.filter((e) => e.audience.some((a) => mine.has(a))).length,
    expenseLog: admin || s.log.has(email) || s.appr.has(email),
    admin,
  };
}

export async function listPeople(env: Env): Promise<Person[]> {
  await applyReportRoles(env);
  const [users, staff, s, rep, hrRows] = await Promise.all([
    env.DB.prepare("SELECT email, name, picture, role, blocked, note, sign_ins, last_seen FROM hub_users WHERE lower(email) NOT IN ('tester@favorintl.org', 'tester2@favorintl.org') ORDER BY lower(name), email").all<UserRow>(),
    env.DB.prepare('SELECT email, name, team, bb_fundraiser_id, work_center, entry_owner, entry_type, sheet_tab, active FROM act_staff').all<StaffRow>().catch(() => ({ results: [] as StaffRow[] })),
    sets(env),
    env.DB.prepare('SELECT email, supervisor_email, department, title, start_date FROM hub_reporting').all<{ email: string; supervisor_email: string | null; department: string | null; title: string | null; start_date: string | null }>().catch(() => ({ results: [] as { email: string; supervisor_email: string | null; department: string | null; title: string | null; start_date: string | null }[] })),
    env.DB.prepare('SELECT email FROM hub_hr').all<{ email: string }>().catch(() => ({ results: [] as { email: string }[] })),
  ]);
  const repBy = new Map((rep.results || []).map((r) => [r.email.toLowerCase(), r]));
  const pendingSet = new Set(((await env.DB.prepare('SELECT email FROM hub_users WHERE pending = 1').all<{ email: string }>().catch(() => ({ results: [] as { email: string }[] }))).results || []).map((r) => r.email.toLowerCase()));
  const hrSet = new Set((hrRows.results || []).map((r) => r.email.toLowerCase()));
  const staffBy = new Map((staff.results || []).map((r) => [r.email.toLowerCase(), r]));
  const seen = new Set<string>();
  const out: Person[] = [];
  const mk = (email: string, u: UserRow | undefined, st: StaffRow | undefined): Person => {
    const envAdmin = isAdminEmail(env, email);
    const admin = (u?.role === 'admin' || envAdmin) && !u?.blocked;
    return {
      email,
      name: u?.name || st?.name || email,
      picture: u?.picture || '',
      role: u?.role === 'admin' || envAdmin ? 'admin' : u?.role === 'field' ? 'field' : 'staff',
      pending: pendingSet.has(email),
      envAdmin,
      blocked: !!u?.blocked,
      note: u?.note || '',
      signIns: Number(u?.sign_ins) || 0,
      lastSeen: u?.last_seen || '',
      team: st?.team || '',
      fundraiser: st?.bb_fundraiser_id || '',
      workCenter: st?.work_center === 1,
      entryOwner: st?.entry_owner === 1,
      entryType: st?.entry_type || '',
      sheetTab: st?.sheet_tab || '',
      active: st ? st.active === 1 : true,
      listed: !!st,
      supervisor: (repBy.get(email)?.supervisor_email || '').toLowerCase(),
      title: repBy.get(email)?.title || '',
      department: repBy.get(email)?.department || '',
      startDate: repBy.get(email)?.start_date || '',
      hr: hrSet.has(email),
      sees: u?.role === 'field' && !envAdmin && !u.blocked ? { workCenter: false, meetings: true, clips: false, reports: 0, expenseLog: false, admin: false } : u?.blocked ? { workCenter: false, meetings: false, clips: false, reports: 0, expenseLog: false, admin: false } : seesFor(s, email, admin, st),
    };
  };
  for (const u of users.results || []) {
    const email = u.email.toLowerCase();
    seen.add(email);
    out.push(mk(email, u, staffBy.get(email)));
  }
  for (const [email, st] of staffBy) if (!seen.has(email)) out.push(mk(email, undefined, st));
  return out;
}

export interface SaveInput {
  email: string;
  name?: string;
  role?: string;
  blocked?: boolean;
  note?: string;
  team?: string;
  fundraiser?: string;
  workCenter?: boolean;
  entryOwner?: boolean;
  entryType?: string;
  sheetTab?: string;
  active?: boolean;
  supervisor?: string;
  title?: string;
  department?: string;
  startDate?: string;
  hr?: boolean;
  /** Approve or decline a person who signed in from an allowed partner domain and is waiting. */
  decide?: 'approve' | 'decline';
}

const EMAIL = /^[a-z0-9._%+-]+@([a-z0-9-]+\.)+[a-z]{2,24}$/;

/** Add a person or change one. Only the fields present change. Returns the saved person. */
export async function savePerson(env: Env, actor: { email: string; name: string }, b: SaveInput): Promise<Person> {
  const email = String(b.email || '').trim().toLowerCase();
  const domain = email.split('@')[1] || '';
  if (!EMAIL.test(email) || (domain !== 'favorintl.org' && !(await allowedDomains(env)).includes(domain))) throw new HttpError(400, 'bad_email', 'Use a favorintl.org address, or one on a domain listed under Sign-in domains.');
  const before = (await listPeople(env)).find((p) => p.email === email) || null;
  const self = email === actor.email.toLowerCase();
  const now = nowIso();
  const has = (k: keyof SaveInput) => b[k] !== undefined;

  if (has('role') && b.role !== 'admin' && b.role !== 'staff' && b.role !== 'field') throw new HttpError(400, 'bad_role', 'The role is admin, staff or field staff.');
  if (b.decide !== undefined && b.decide !== 'approve' && b.decide !== 'decline') throw new HttpError(400, 'bad_decision', 'Approve or decline.');
  if (b.decide && !before?.pending) throw new HttpError(400, 'not_waiting', 'That person is not waiting for approval.');
  if (b.decide && self) throw new HttpError(400, 'self_decide', 'You cannot decide your own request.');
  if (self && has('role') && b.role !== 'admin') throw new HttpError(400, 'self_demote', 'You cannot take admin from your own account.');
  if (self && b.blocked) throw new HttpError(400, 'self_block', 'You cannot block your own account.');
  if (has('team') && b.team && !TEAMS.includes(String(b.team))) throw new HttpError(400, 'bad_team', 'Pick a team from the list.');
  if (has('entryType') && b.entryType && !ENTRY_TYPES.includes(String(b.entryType))) throw new HttpError(400, 'bad_type', 'Pick an action type from the list.');
  const fid = has('fundraiser') ? String(b.fundraiser || '').replace(/\D/g, '').slice(0, 12) : undefined;

  // hub_users: the sign-in row.
  const hubTouched = !b.decide && (has('name') || has('role') || has('blocked') || has('note'));
  if (hubTouched || !before) {
    const name = has('name') ? String(b.name || '').trim().slice(0, 80) : before?.name || '';
    const role = has('role') ? String(b.role) : before?.role || 'staff';
    const blocked = has('blocked') ? (b.blocked ? 1 : 0) : before?.blocked ? 1 : 0;
    const note = has('note') ? String(b.note || '').slice(0, 200) : before?.note || '';
    await env.DB.prepare(
      `INSERT INTO hub_users (email, name, picture, role, blocked, note, sign_ins, created_at, updated_at) VALUES (?, ?, '', ?, ?, ?, 0, ?, ?)
       ON CONFLICT(email) DO UPDATE SET name = excluded.name, role = excluded.role, blocked = excluded.blocked, note = excluded.note, updated_at = excluded.updated_at`
    )
      .bind(email, name, role, blocked, note, now, now)
      .run();
    // A block ends open sessions at once.
    if (blocked) {
      await env.DB.prepare('DELETE FROM hub_sessions WHERE email = ?').bind(email).run();
      // Phones that turned on push and notices held for quiet hours stop too. Either table may not exist yet.
      await env.DB.prepare('DELETE FROM push_subs WHERE lower(email) = ?').bind(email).run().catch(() => undefined);
      await env.DB.prepare('DELETE FROM hub_quiet_held WHERE lower(email) = ?').bind(email).run().catch(() => undefined);
    }
    if (role === 'field' && !blocked && !before?.pending) await joinFieldChannel(env, email, now);
  }

  // A person waiting for approval: approve opens Chat, Meetings and Favor Brain (role field unless one is chosen); decline keeps them out.
  if (b.decide) {
    const approve = b.decide === 'approve';
    const role = approve ? (has('role') ? String(b.role) : 'field') : 'field';
    await env.DB.prepare('UPDATE hub_users SET pending = 0, blocked = ?, role = ?, note = ?, updated_at = ? WHERE email = ?')
      .bind(approve ? 0 : 1, role, approve ? '' : 'Declined ' + now.slice(0, 10), now, email)
      .run();
    if (approve && role === 'field') await joinFieldChannel(env, email, now);
    await audit(env, { actor: actor.email, area: 'people', key: `${email}:access`, label: `${before?.name || email}, access request`, before: 'waiting', after: approve ? 'approved' : 'declined' });
  }

  // hub_reporting: who this person reports to, their title and department, and when they started. hub_hr: the HR flag.
  const repTouched = ['supervisor', 'title', 'department', 'startDate'].some((k) => has(k as keyof SaveInput));
  if (repTouched) {
    const sup = has('supervisor') ? String(b.supervisor || '').trim().toLowerCase() : before?.supervisor || '';
    if (sup) {
      if (sup === email) throw new HttpError(400, 'self_supervisor', 'Nobody reports to themselves.');
      if (!EMAIL.test(sup)) throw new HttpError(400, 'bad_supervisor', 'Pick the supervisor from the list.');
      // Nobody may end up supervising their own supervisor, however far up the line.
      let up = sup;
      for (let i = 0; i < 12 && up; i++) {
        const row = await env.DB.prepare('SELECT supervisor_email AS s FROM hub_reporting WHERE email = ?').bind(up).first<{ s: string | null }>();
        up = (row?.s || '').toLowerCase();
        if (up === email) throw new HttpError(400, 'loop', 'That would make the reporting line a circle.');
      }
    }
    const start = has('startDate') ? String(b.startDate || '').trim() : before?.startDate || '';
    if (start && !isDate(start)) throw new HttpError(400, 'bad_date', 'Use a real start date.');
    await env.DB.prepare(
      `INSERT INTO hub_reporting (email, supervisor_email, department, title, start_date, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET supervisor_email = excluded.supervisor_email, department = excluded.department, title = excluded.title, start_date = excluded.start_date, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
    )
      .bind(email, sup || null, (has('department') ? String(b.department || '').trim().slice(0, 80) : before?.department || '') || null, (has('title') ? String(b.title || '').trim().slice(0, 80) : before?.title || '') || null, start || null, actor.email, now)
      .run();
  }
  if (has('hr')) {
    if (b.hr) await env.DB.prepare('INSERT INTO hub_hr (email, set_by, set_at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET set_by = excluded.set_by, set_at = excluded.set_at').bind(email, actor.email, now).run();
    else await env.DB.prepare('DELETE FROM hub_hr WHERE email = ?').bind(email).run();
  }

  // act_staff: the Work Center roster row. Written when any of its fields is sent.
  const staffTouched = ['team', 'fundraiser', 'workCenter', 'entryOwner', 'entryType', 'sheetTab', 'active'].some((k) => has(k as keyof SaveInput));
  if (staffTouched) {
    const team = has('team') ? String(b.team || '') : before?.team || '';
    if (!team) throw new HttpError(400, 'bad_team', 'Pick a team before adding the person to the Work Center list.');
    const name = (has('name') ? String(b.name || '').trim() : before?.name || '') || email;
    await env.DB.prepare(
      `INSERT INTO act_staff (email, name, team, bb_fundraiser_id, work_center, entry_owner, entry_type, sheet_tab, active, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(email) DO UPDATE SET name = excluded.name, team = excluded.team, bb_fundraiser_id = excluded.bb_fundraiser_id, work_center = excluded.work_center,
         entry_owner = excluded.entry_owner, entry_type = excluded.entry_type, sheet_tab = excluded.sheet_tab, active = excluded.active, updated_at = excluded.updated_at`
    )
      .bind(
        email,
        name.slice(0, 80),
        team,
        (fid !== undefined ? fid : before?.fundraiser) || null,
        (has('workCenter') ? !!b.workCenter : !!before?.workCenter) ? 1 : 0,
        (has('entryOwner') ? !!b.entryOwner : !!before?.entryOwner) ? 1 : 0,
        (has('entryType') ? String(b.entryType || '') : before?.entryType) || null,
        (has('sheetTab') ? String(b.sheetTab || '').slice(0, 60) : before?.sheetTab) || null,
        (has('active') ? !!b.active : before ? before.active : true) ? 1 : 0,
        now
      )
      .run();
  }

  const after = (await listPeople(env)).find((p) => p.email === email)!;
  const keys: Array<keyof Person> = ['name', 'role', 'blocked', 'note', 'team', 'fundraiser', 'workCenter', 'entryOwner', 'entryType', 'sheetTab', 'active', 'supervisor', 'title', 'department', 'startDate', 'hr'];
  const diff = keys.filter((k) => !before || before[k] !== after[k]);
  for (const k of diff) {
    await audit(env, { actor: actor.email, area: 'people', key: `${email}:${String(k)}`, label: `${after.name}, ${String(k)}`, before: before ? String(before[k]) : '(new person)', after: String(after[k]) });
  }
  return after;
}

/** The channel field staff start in. Created the first time someone is approved; the approved person joins it. */
async function joinFieldChannel(env: Env, email: string, now: string): Promise<void> {
  try {
    let ch = await env.DB.prepare(`SELECT id FROM chat_channels WHERE name = 'field-staff' AND kind IN ('public', 'private')`).first<{ id: string }>();
    if (!ch) {
      await env.DB.prepare(`INSERT OR IGNORE INTO chat_channels (id, kind, name, topic, created_by, created_at, last_at) VALUES ('ch_field_staff', 'public', 'field-staff', 'Chat for Favor field staff and the US team', 'system', ?, ?)`).bind(now, now).run();
      ch = await env.DB.prepare(`SELECT id FROM chat_channels WHERE name = 'field-staff'`).first<{ id: string }>();
    }
    if (ch) await env.DB.prepare(`INSERT OR IGNORE INTO chat_members (channel_id, email, role, joined_at) VALUES (?, ?, 'member', ?)`).bind(ch.id, email, now).run();
  } catch (err) {
    console.warn('[people] field channel', err);
  }
}

/** What a person would see, from the same rules the hub applies. */
export async function previewFor(env: Env, email: string) {
  email = email.trim().toLowerCase();
  const people = await listPeople(env);
  const p = people.find((x) => x.email === email);
  if (!p) throw new HttpError(404, 'no_person', 'That person is not in the list.');
  const s = await sets(env);
  const st = (await env.DB.prepare('SELECT email, name, team, bb_fundraiser_id, work_center, entry_owner, entry_type, sheet_tab, active FROM act_staff WHERE email = ?').bind(email).first<StaffRow>().catch(() => null)) || undefined;
  const admin = p.role === 'admin' && !p.blocked;
  const mine = audiencesFor(s, email, st?.team, !!st && st.active === 1, admin);
  const flags: Record<string, boolean> = {
    admin,
    kpi: !p.blocked,
    expenseLog: p.sees.expenseLog,
    workCenter: p.sees.workCenter,
    clips: !p.blocked,
    meetings: p.sees.meetings,
  };
  const pages: Array<{ area: string; label: string; href: string }> = [];
  if (!p.blocked) {
    for (const a of AREAS) {
      if (a.id === 'admin' && !admin && !p.sees.expenseLog) continue;
      for (const pg of a.pages) {
        if (pg.ext) continue;
        if (pg.need && !flags[pg.need]) continue;
        if (pg.team) continue;
        pages.push({ area: a.label, label: pg.label, href: pg.href });
      }
    }
  }
  const reports = p.blocked ? [] : CATALOG.filter((e) => admin || e.audience.some((a) => mine.has(a))).map((e) => e.name);
  const workRole = p.team ? roleOfTeam(p.team) : null;
  return {
    person: { email: p.email, name: p.name, role: p.role, blocked: p.blocked, team: p.team ? TEAM_LABEL[p.team] || p.team : '', workRole: admin ? 'admin' : workRole },
    pages,
    reports,
    audiences: [...mine].map((a) => AUDIENCE_LABEL[a as keyof typeof AUDIENCE_LABEL] || a),
    clipsRecord: p.sees.clips,
    note: p.blocked ? 'This account is blocked and cannot sign in.' : 'Dashboard tabs follow the KPI dashboard team map, which this preview does not read.',
  };
}

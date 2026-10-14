// Admin > Adoption: who uses FavorOS and how. Reads hub_usage (page visits, db/adoption.sql) and the traces the features already leave:
// sign-ins, sessions, Favor Brain questions and ratings, tasks, meetings, Work Center events and gift entry. Nothing here writes.
// Testers and blocked accounts are left out. The admin's own row is shown and marked, and left out of the totals.
import type { Env } from '../http';
import { staffDirectory } from '../people';
import { TESTERS } from '../testuser';
import { easternDay } from '../hub/usage';

type Db = Pick<Env, 'DB'>;
const lower = (s: unknown) => String(s || '').trim().toLowerCase();
const DAY = 86400000;
const notTester = (c: string) => `lower(${c}) NOT IN (${TESTERS.map((e) => `'${e}'`).join(', ')})`;
const ACT_KINDS = `kind NOT IN ('call', 'verified', 'failed')`;

async function rows<T>(db: Db, sql: string, ...bind: unknown[]): Promise<T[]> {
  try {
    return ((await db.DB.prepare(sql).bind(...bind).all<T>()).results || []) as T[];
  } catch (err) {
    // A table that is not there yet answers nothing.
    if (/no such (table|column)/i.test(String((err as Error)?.message || err))) return [];
    throw err;
  }
}

/** The SQLite shift from UTC to Eastern for date(): "-4 hours" in daylight time, "-5 hours" otherwise. */
export function easternShift(now = new Date()): string {
  const zone = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' }).formatToParts(now).find((x) => x.type === 'timeZoneName')?.value;
  return zone === 'EST' ? '-5 hours' : '-4 hours';
}

export function dayMinus(today: string, days: number): string {
  return new Date(Date.parse(today + 'T12:00:00Z') - days * DAY).toISOString().slice(0, 10);
}

/** The Monday on or before a YYYY-MM-DD day. */
export function weekStart(day: string): string {
  const dow = new Date(day + 'T12:00:00Z').getUTCDay();
  return dayMinus(day, (dow + 6) % 7);
}

/** One (email, day) row for every sign-in, Brain question or rating, task, task event, meeting join and Work Center event since `from`. */
export function traceDaysSql(shift: string): string[] {
  const d = (col: string) => `date(${col}, '${shift}')`;
  const all = [
    `SELECT lower(email) AS email, ${d('at')} AS day FROM hub_auth_log WHERE event = 'signed_in' AND email <> '' AND ${d('at')} >= ?`,
    `SELECT lower(email), ${d('at')} FROM mcp_audit WHERE email <> '' AND ${d('at')} >= ?`,
    `SELECT lower(email), ${d('at')} FROM brain_feedback WHERE email <> '' AND ${d('at')} >= ?`,
    `SELECT lower(created_by), ${d('created_at')} FROM hub_tasks WHERE created_by <> '' AND ${d('created_at')} >= ?`,
    `SELECT lower(actor_email), ${d('created_at')} FROM hub_task_events WHERE actor_email <> '' AND ${d('created_at')} >= ?`,
    `SELECT lower(actor_email), ${d('at')} FROM act_events WHERE actor_email <> '' AND ${ACT_KINDS} AND ${d('at')} >= ?`,
    `SELECT lower(email), date(joined_at / 1000, 'unixepoch', '${shift}') FROM hub_meeting_presence WHERE email <> '' AND role <> 'guest' AND date(joined_at / 1000, 'unixepoch', '${shift}') >= ?`,
  ];
  // D1 allows only a few terms in one compound SELECT, so the seven sources go in two queries.
  return [all.slice(0, 3).join(' UNION '), all.slice(3).join(' UNION ')];
}

export interface PersonRow {
  email: string;
  name: string;
  team: string;
  you: boolean;
  firstSignin: string;
  lastActive: string;
  activeDays30: number;
  areas: Array<{ area: string; n: number }>;
  brain: number;
  feedback: number;
  tasks: number;
  meetings: number;
  work: number;
  gifts: number;
}

const maxIso = (...v: Array<string | null | undefined>) => v.filter(Boolean).sort().slice(-1)[0] || '';
const minIso = (...v: Array<string | null | undefined>) => v.filter(Boolean).sort()[0] || '';

export async function overview(env: Db, adminEmail: string, now = new Date()) {
  const shift = easternShift(now);
  const today = easternDay(now);
  const d30 = dayMinus(today, 29);
  const d7 = dayMinus(today, 6);
  const weeks = 8;
  const firstWeek = dayMinus(weekStart(today), (weeks - 1) * 7);
  const from = firstWeek < d30 ? firstWeek : d30;
  const me = lower(adminEmail);
  const traceSql = traceDaysSql(shift);

  const [dir, users, sessions, authFirst, usage, brainQ, fb, tasks, meets, work, gifts, feed, traceA, traceB] = await Promise.all([
    staffDirectory(env),
    rows<{ email: string; blocked: number; sign_ins: number; first_seen: string | null; last_seen: string | null }>(env, `SELECT lower(email) AS email, blocked, sign_ins, first_seen, last_seen FROM hub_users WHERE ${notTester('email')}`),
    rows<{ email: string; first_at: string; last_at: string }>(env, `SELECT lower(email) AS email, min(created_at) AS first_at, max(last_seen) AS last_at FROM hub_sessions WHERE ${notTester('email')} GROUP BY lower(email)`),
    rows<{ email: string; first_at: string }>(env, `SELECT lower(email) AS email, min(at) AS first_at FROM hub_auth_log WHERE event = 'signed_in' AND email <> '' GROUP BY lower(email)`),
    rows<{ email: string; day: string; area: string; n: number; last_at: string }>(env, `SELECT email, day, area, n, last_at FROM hub_usage WHERE day >= ?`, dayMinus(today, 400)),
    rows<{ email: string; n: number; last_at: string }>(env, `SELECT lower(email) AS email, count(*) AS n, max(at) AS last_at FROM mcp_audit WHERE tool = 'ask' AND email <> '' GROUP BY lower(email)`),
    rows<{ email: string; n: number }>(env, `SELECT lower(email) AS email, count(*) AS n FROM brain_feedback WHERE email <> '' GROUP BY lower(email)`),
    rows<{ email: string; n: number }>(env, `SELECT lower(created_by) AS email, count(*) AS n FROM hub_tasks WHERE created_by <> '' GROUP BY lower(created_by)`),
    rows<{ email: string; n: number }>(env, `SELECT lower(email) AS email, count(DISTINCT meeting_id) AS n FROM hub_meeting_presence WHERE email <> '' AND role <> 'guest' GROUP BY lower(email)`),
    rows<{ email: string; n: number }>(env, `SELECT lower(actor_email) AS email, count(*) AS n FROM act_events WHERE actor_email <> '' AND ${ACT_KINDS} GROUP BY lower(actor_email)`),
    rows<{ actor: string; n: number }>(env, `SELECT lower(actor) AS actor, count(*) AS n FROM ge_event GROUP BY lower(actor)`),
    rows<Record<string, unknown>>(env, `SELECT id, at, email, name, source, rating, comment, question, page, status FROM brain_feedback WHERE ${notTester('email')} ORDER BY id DESC LIMIT 60`),
    rows<{ email: string; day: string }>(env, traceSql[0], from, from, from),
    rows<{ email: string; day: string }>(env, traceSql[1], from, from, from, from),
  ]);

  const userBy = new Map(users.map((u) => [u.email, u]));
  const sessBy = new Map(sessions.map((s) => [s.email, s]));
  const authBy = new Map(authFirst.map((a) => [a.email, a.first_at]));
  const num = (list: Array<{ email: string; n: number }>) => new Map(list.map((r) => [r.email, Number(r.n) || 0]));
  const brainBy = new Map(brainQ.map((r) => [r.email, r]));
  const fbBy = num(fb);
  const taskBy = num(tasks);
  const meetBy = num(meets);
  const workBy = num(work);
  const giftBy = new Map(gifts.map((g) => [g.actor, Number(g.n) || 0]));

  // Days each person was active, from page visits and from every other trace.
  const days = new Map<string, Set<string>>();
  const addDay = (email: string, day: string) => {
    if (!email || !day) return;
    let s = days.get(email);
    if (!s) days.set(email, (s = new Set()));
    s.add(day);
  };
  for (const r of [...traceA, ...traceB]) addDay(r.email, r.day);
  const areasBy = new Map<string, Map<string, number>>();
  const lastUse = new Map<string, string>();
  for (const u of usage) {
    if (u.day >= from) addDay(u.email, u.day);
    if (u.day >= d30 && u.area !== 'signin') {
      const m = areasBy.get(u.email) || new Map<string, number>();
      m.set(u.area, (m.get(u.area) || 0) + Number(u.n));
      areasBy.set(u.email, m);
    }
    lastUse.set(u.email, maxIso(lastUse.get(u.email), u.last_at));
  }

  const people: PersonRow[] = [];
  const never: Array<{ email: string; name: string; team: string }> = [];
  for (const p of dir) {
    const u = userBy.get(p.email);
    if (u?.blocked) continue;
    const s = sessBy.get(p.email);
    const signed = !!(s || (u && (Number(u.sign_ins) > 0 || u.first_seen)));
    if (!signed) {
      never.push({ email: p.email, name: p.name, team: p.team });
      continue;
    }
    const mine = days.get(p.email) || new Set<string>();
    people.push({
      email: p.email,
      name: p.name,
      team: p.team,
      you: p.email === me,
      firstSignin: minIso(u?.first_seen, s?.first_at, authBy.get(p.email)),
      lastActive: maxIso(u?.last_seen, s?.last_at, lastUse.get(p.email), brainBy.get(p.email)?.last_at),
      activeDays30: [...mine].filter((d) => d >= d30).length,
      areas: [...(areasBy.get(p.email) || new Map<string, number>())].map(([area, n]) => ({ area, n })).sort((a, b) => b.n - a.n).slice(0, 4),
      brain: Number(brainBy.get(p.email)?.n) || 0,
      feedback: fbBy.get(p.email) || 0,
      tasks: taskBy.get(p.email) || 0,
      meetings: meetBy.get(p.email) || 0,
      work: workBy.get(p.email) || 0,
      // Gift entry records the person's name, not their address.
      gifts: (giftBy.get(lower(p.name)) || 0) + (giftBy.get(p.email) || 0),
    });
  }

  const counted = people.filter((p) => !p.you);
  const activeSince = (since: string) =>
    counted.filter((p) => [...(days.get(p.email) || [])].some((x) => x >= since) || (!!p.lastActive && easternDay(new Date(p.lastActive)) >= since)).length;
  const weekly: Array<{ week: string; people: number }> = [];
  for (let i = 0; i < weeks; i++) {
    const start = dayMinus(firstWeek, -7 * i);
    const end = dayMinus(start, -6);
    let n = 0;
    for (const p of counted) if ([...(days.get(p.email) || [])].some((d) => d >= start && d <= end)) n++;
    weekly.push({ week: start, people: n });
  }
  const pageDays = usage.filter((u) => !['signin', 'brain', 'tasks', 'meet'].includes(u.area)).map((u) => u.day).sort();
  return {
    today,
    summary: {
      withAccount: counted.length + never.filter((p) => p.email !== me).length,
      signedInEver: counted.length,
      active7: activeSince(d7),
      active30: activeSince(d30),
      neverSignedIn: never.filter((p) => p.email !== me).length,
      trackingSince: pageDays[0] || '',
    },
    weekly,
    people,
    never,
    teams: [...new Set(dir.map((p) => p.team).filter(Boolean))].sort(),
    feedback: feed.map((f) => ({ id: f.id, at: f.at, email: f.email, name: f.name || '', source: f.source, rating: f.rating || '', comment: f.comment || '', question: f.question || '', page: f.page || '', status: f.status })),
  };
}

export async function personLog(env: Db, email: string, now = new Date()) {
  const e = lower(email);
  const shift = easternShift(now);
  const from = dayMinus(easternDay(now), 89);
  const d = (col: string) => `date(${col}, '${shift}')`;
  const [usage, signins, brain, fb, tasks, meets, work, dir] = await Promise.all([
    rows<{ day: string; area: string; n: number }>(env, `SELECT day, area, n FROM hub_usage WHERE email = ? AND day >= ? ORDER BY day DESC`, e, from),
    rows<{ day: string; n: number }>(env, `SELECT ${d('at')} AS day, count(*) AS n FROM hub_auth_log WHERE event = 'signed_in' AND lower(email) = ? AND ${d('at')} >= ? GROUP BY 1`, e, from),
    rows<{ day: string; n: number }>(env, `SELECT ${d('at')} AS day, count(*) AS n FROM mcp_audit WHERE tool = 'ask' AND lower(email) = ? AND ${d('at')} >= ? GROUP BY 1`, e, from),
    rows<Record<string, unknown>>(env, `SELECT id, at, ${d('at')} AS day, source, rating, comment, question, page, status FROM brain_feedback WHERE lower(email) = ? AND ${d('at')} >= ? ORDER BY id DESC`, e, from),
    rows<{ day: string; n: number }>(env, `SELECT ${d('created_at')} AS day, count(*) AS n FROM hub_tasks WHERE lower(created_by) = ? AND ${d('created_at')} >= ? GROUP BY 1`, e, from),
    rows<{ day: string; n: number }>(env, `SELECT date(joined_at / 1000, 'unixepoch', '${shift}') AS day, count(DISTINCT meeting_id) AS n FROM hub_meeting_presence WHERE lower(email) = ? AND role <> 'guest' AND date(joined_at / 1000, 'unixepoch', '${shift}') >= ? GROUP BY 1`, e, from),
    rows<{ day: string; n: number }>(env, `SELECT ${d('at')} AS day, count(*) AS n FROM act_events WHERE lower(actor_email) = ? AND ${ACT_KINDS} AND ${d('at')} >= ? GROUP BY 1`, e, from),
    staffDirectory(env),
  ]);
  const person = dir.find((p) => p.email === e);
  type Day = { day: string; areas: Array<{ area: string; n: number }>; signins: number; brain: number; feedback: number; tasks: number; meetings: number; work: number };
  const log = new Map<string, Day>();
  const at = (day: string) => {
    let r = log.get(day);
    if (!r) log.set(day, (r = { day, areas: [], signins: 0, brain: 0, feedback: 0, tasks: 0, meetings: 0, work: 0 }));
    return r;
  };
  for (const u of usage) if (u.area !== 'signin') at(u.day).areas.push({ area: u.area, n: Number(u.n) });
  for (const r of signins) at(r.day).signins += Number(r.n);
  for (const r of brain) at(r.day).brain += Number(r.n);
  for (const r of fb) at(String(r.day)).feedback += 1;
  for (const r of tasks) at(r.day).tasks += Number(r.n);
  for (const r of meets) at(r.day).meetings += Number(r.n);
  for (const r of work) at(r.day).work += Number(r.n);
  const out = [...log.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
  for (const r of out) r.areas.sort((a, b) => b.n - a.n);
  return {
    email: e,
    name: person?.name || e,
    team: person?.team || '',
    days: out,
    feedback: fb.map((f) => ({ at: f.at, question: f.question || '', rating: f.rating || '', comment: f.comment || '', status: f.status, page: f.page || '' })),
  };
}

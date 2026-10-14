// Meetings: the scheduling assistant. Who is busy when (Google free/busy plus FavorOS's own meetings), each person's working hours
// and time zone, suggested times that fit everyone with a buffer and travel time, conflict warnings, tentative holds, and templates.
// Free and busy only: nothing about what anyone's meeting is ever leaves Google.
import { accessToken, CAL_EVENTS, CAL_FREEBUSY, hasScopes } from './hub/google';
import { HttpError, nowIso } from './http';
import { clean, hex, type MeetEnv } from './meet';
import { calFetch, TZ, type Busy } from './meetcal';
import { cleanRule, wallOf } from './meetrecur';

const CAL_DEFAULT = 'https://www.googleapis.com/calendar/v3';
const cal = (env: MeetEnv) => env.MEET_CAL_URL || CAL_DEFAULT;
const READ_OWN = [CAL_FREEBUSY, 'https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar.events.readonly', CAL_EVENTS];

export interface Prefs { email: string; tz: string; dayStart: number; dayEnd: number; workDays: number[]; bufferMin: number }
export const DEFAULT_PREFS = (email: string): Prefs => ({ email, tz: TZ, dayStart: 9 * 60, dayEnd: 17 * 60, workDays: [1, 2, 3, 4, 5], bufferMin: 0 });

const validTz = (tz: string) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };

export async function prefsOf(env: MeetEnv, emails: string[]): Promise<Map<string, Prefs>> {
  const out = new Map<string, Prefs>();
  for (const e of emails) out.set(e, DEFAULT_PREFS(e));
  for (let i = 0; i < emails.length; i += 50) {
    const chunk = emails.slice(i, i + 50);
    const rows = await env.DB.prepare(`SELECT * FROM hub_sched_prefs WHERE email IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all<{ email: string; tz: string; day_start: number; day_end: number; work_days: string; buffer_min: number }>().catch(() => ({ results: [] }));
    for (const r of rows.results || []) {
      let days: number[] = [1, 2, 3, 4, 5];
      try { days = JSON.parse(r.work_days); } catch { /* default */ }
      out.set(r.email, { email: r.email, tz: validTz(r.tz) ? r.tz : TZ, dayStart: r.day_start, dayEnd: r.day_end, workDays: days, bufferMin: r.buffer_min });
    }
  }
  return out;
}

export async function savePrefs(env: MeetEnv, email: string, b: Record<string, unknown>): Promise<Prefs> {
  const tz = typeof b.tz === 'string' && validTz(b.tz) ? b.tz : TZ;
  const mins = (v: unknown, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 && n <= 1440 ? n : d; };
  const dayStart = mins(b.dayStart, 540), dayEnd = Math.max(dayStart + 30, mins(b.dayEnd, 1020));
  const workDays = Array.isArray(b.workDays) ? [...new Set((b.workDays as unknown[]).map(Number).filter((n) => n >= 0 && n <= 6))].sort() : [1, 2, 3, 4, 5];
  const bufferMin = Math.min(60, Math.max(0, Math.round(Number(b.bufferMin) || 0)));
  await env.DB.prepare(
    `INSERT INTO hub_sched_prefs (email, tz, day_start, day_end, work_days, buffer_min, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET tz = excluded.tz, day_start = excluded.day_start, day_end = excluded.day_end, work_days = excluded.work_days, buffer_min = excluded.buffer_min, updated_at = excluded.updated_at`
  ).bind(email.toLowerCase(), tz, dayStart, dayEnd, JSON.stringify(workDays), bufferMin, nowIso()).run();
  return { email: email.toLowerCase(), tz, dayStart, dayEnd, workDays, bufferMin };
}

/** FavorOS meetings each person hosts or is invited to in the window (scheduled or live). Works for people with no Google connection. */
export async function hubBusy(env: MeetEnv, emails: string[], from: string, to: string, skipId = ''): Promise<Record<string, Array<Busy & { id: string; title: string }>>> {
  const out: Record<string, Array<Busy & { id: string; title: string }>> = {};
  for (const e of emails) out[e] = [];
  const rows = ((await env.DB.prepare(
    `SELECT id, title, host_email, invitees, cohosts, starts_at, ends_at, duration_min FROM hub_meetings
      WHERE status IN ('scheduled', 'live') AND starts_at IS NOT NULL AND starts_at < ? AND COALESCE(ends_at, starts_at) > ? AND id != ? LIMIT 2000`
  ).bind(to, from, skipId).all<{ id: string; title: string; host_email: string; invitees: string; cohosts: string; starts_at: string; ends_at: string | null; duration_min: number }>()).results || []);
  const want = new Set(emails);
  for (const r of rows) {
    const on = new Set<string>([r.host_email.toLowerCase()]);
    for (const j of [r.invitees, r.cohosts]) {
      try { for (const x of JSON.parse(j) as Array<string | { email?: string }>) on.add(String(typeof x === 'string' ? x : x?.email || '').toLowerCase()); } catch { /* skip */ }
    }
    const end = r.ends_at || new Date(Date.parse(r.starts_at) + r.duration_min * 60000).toISOString();
    for (const e of on) if (want.has(e)) out[e].push({ start: r.starts_at, end, id: r.id, title: r.title });
  }
  return out;
}

/** Google busy times. Each person who connected their own Google is read with their own token; everyone else through the booker's. */
export async function googleBusy(env: MeetEnv, booker: string, emails: string[], from: string, to: string): Promise<{ busy: Record<string, Busy[]>; source: Record<string, 'own' | 'booker' | 'none'>; error: Record<string, string> }> {
  const busy: Record<string, Busy[]> = {}, source: Record<string, 'own' | 'booker' | 'none'> = {}, error: Record<string, string> = {};
  const ask = async (tok: string, ids: string[]) => {
    const r = await fetch(`${cal(env)}/freeBusy`, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify({ timeMin: from, timeMax: to, timeZone: TZ, items: ids.map((id) => ({ id })) }) });
    if (!r.ok) return null;
    return ((await r.json().catch(() => ({}))) as { calendars?: Record<string, { busy?: Busy[]; errors?: Array<{ reason?: string }> }> }).calendars || {};
  };
  const rest: string[] = [];
  for (const e of emails) {
    const t = await accessToken(env, e).catch(() => null);
    if (t && READ_OWN.some((s) => hasScopes(t.scopes, [s]))) {
      const c = await ask(t.token, [e]).catch(() => null);
      const own = c?.[e];
      if (own && !own.errors?.length) { busy[e] = own.busy || []; source[e] = 'own'; continue; }
    }
    rest.push(e);
  }
  if (rest.length) {
    const bt = await accessToken(env, booker).catch(() => null);
    if (bt && hasScopes(bt.scopes, [CAL_FREEBUSY])) {
      for (let i = 0; i < rest.length; i += 50) {
        const chunk = rest.slice(i, i + 50);
        const c = await ask(bt.token, chunk).catch(() => null);
        for (const e of chunk) {
          const x = c?.[e];
          if (x && !x.errors?.length) { busy[e] = x.busy || []; source[e] = 'booker'; }
          else { busy[e] = []; source[e] = 'none'; error[e] = x?.errors?.[0]?.reason || 'unavailable'; }
        }
      }
    } else for (const e of rest) { busy[e] = []; source[e] = 'none'; }
  }
  return { busy, source, error };
}

export interface Person { email: string; tz: string; dayStart: number; dayEnd: number; workDays: number[]; busy: Busy[]; optional?: boolean }
export interface Slot { start: string; end: string; free: string[]; busy: string[]; outside: string[]; score: number; local: Record<string, string> }

/**
 * Times in [from, to) on a step grid where the meeting fits. A person counts as free when the meeting plus the buffer (and travel
 * time on both sides) overlaps none of their busy times, and as inside hours when it starts and ends within their working day.
 * Slots everyone required can make come first; the rest follow with who cannot come.
 */
export function suggest(people: Person[], o: { durationMin: number; from: number; to: number; stepMin?: number; bufferMin?: number; travelMin?: number; limit?: number; now?: number; perDay?: number }): Slot[] {
  const step = (o.stepMin || 30) * 60000, dur = o.durationMin * 60000, pad = ((o.bufferMin || 0) + (o.travelMin || 0)) * 60000;
  const now = o.now ?? Date.now();
  const start0 = Math.ceil(Math.max(o.from, now + 15 * 60000) / step) * step;
  const out: Slot[] = [];
  const spans = people.map((p) => p.busy.map((b) => [Date.parse(b.start), Date.parse(b.end)] as const).filter(([a, b]) => b > a));
  for (let t = start0; t + dur <= o.to && out.length < 4000; t += step) {
    const free: string[] = [], busy: string[] = [], outside: string[] = [];
    let ok = true, score = 0;
    people.forEach((p, i) => {
      const ws = wallOf(t, p.tz), we = wallOf(t + dur, p.tz);
      const sMin = ws.h * 60 + ws.mi, eMin = (we.d === ws.d ? we.h * 60 + we.mi : 1440 + we.h * 60 + we.mi);
      const inHours = p.workDays.includes(ws.wd) && sMin >= p.dayStart && eMin <= p.dayEnd;
      const clash = spans[i].some(([a, b]) => a < t + dur + pad && b > t - pad);
      if (clash) { busy.push(p.email); if (!p.optional) ok = false; }
      else if (!inHours) { outside.push(p.email); if (!p.optional) ok = false; }
      else free.push(p.email);
      // Mid-morning and early afternoon in each person's own day score best; the edges of the day score lowest.
      const mid = (p.dayStart + p.dayEnd) / 2;
      score -= Math.abs(sMin - mid) / 60;
    });
    if (!ok && people.every((p) => p.optional)) ok = true;
    score += free.length * 10 - (busy.length + outside.length) * 25;
    const local: Record<string, string> = {};
    for (const p of people) local[p.email] = new Date(t).toLocaleString('en-US', { timeZone: p.tz, weekday: 'short', hour: 'numeric', minute: '2-digit' });
    out.push({ start: new Date(t).toISOString(), end: new Date(t + dur).toISOString(), free, busy, outside, score: ok ? score + 1000 : score, local });
  }
  // Spread the picks: at most perDay per day (Eastern), the best of each day first, then in time order.
  const perDay = o.perDay ?? 3;
  const byDay = new Map<string, Slot[]>();
  for (const s of out) {
    const k = new Date(s.start).toLocaleDateString('en-CA', { timeZone: TZ });
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(s);
  }
  const picked: Slot[] = [];
  for (const list of byDay.values()) {
    const good = list.filter((s) => s.score >= 1000).sort((a, b) => b.score - a.score);
    const chosen: Slot[] = [];
    for (const s of good) {
      if (chosen.length >= perDay) break;
      if (chosen.some((c) => Math.abs(Date.parse(c.start) - Date.parse(s.start)) < Math.max(dur, 60 * 60000))) continue;
      chosen.push(s);
    }
    picked.push(...chosen);
  }
  picked.sort((a, b) => a.start.localeCompare(b.start));
  const limit = o.limit || 12;
  if (picked.length >= limit) return picked.slice(0, limit);
  // Nothing fits everyone often enough: add the best partial times so the booker sees who would miss.
  const partial = out.filter((s) => s.score < 1000 && s.free.length > 0).sort((a, b) => b.score - a.score);
  const more: Slot[] = [];
  for (const s of partial) {
    if (picked.length + more.length >= limit) break;
    if ([...picked, ...more].some((c) => Math.abs(Date.parse(c.start) - Date.parse(s.start)) < 60 * 60000)) continue;
    more.push(s);
  }
  return [...picked, ...more];
}

/** The assistant's answer for a set of people: suggested times, everyone's busy blocks, their hours and zones, and where the busy data came from. */
export async function assistant(env: MeetEnv, booker: string, b: Record<string, unknown>) {
  const emails = [...new Set([booker, ...((Array.isArray(b.emails) ? b.emails : []) as unknown[]).map((x) => String(x).toLowerCase().trim())])].filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)).slice(0, 40);
  const optional = new Set(((Array.isArray(b.optional) ? b.optional : []) as unknown[]).map((x) => String(x).toLowerCase()));
  const from = Date.parse(String(b.from || '')) || Date.now();
  const to = Math.min(Date.parse(String(b.to || '')) || from + 14 * 86400_000, from + 42 * 86400_000);
  const durationMin = Math.min(480, Math.max(10, Number(b.durationMin) || 30));
  const fromIso = new Date(from).toISOString(), toIso = new Date(to).toISOString();
  const [prefs, g, h] = await Promise.all([prefsOf(env, emails), googleBusy(env, booker, emails, fromIso, toIso), hubBusy(env, emails, fromIso, toIso, clean(b.skipId, 30))]);
  const people: Person[] = emails.map((e) => {
    const p = prefs.get(e)!;
    return { email: e, tz: p.tz, dayStart: p.dayStart, dayEnd: p.dayEnd, workDays: p.workDays, busy: [...(g.busy[e] || []), ...(h[e] || [])], optional: optional.has(e) };
  });
  const bufferMin = b.bufferMin == null ? prefs.get(booker)!.bufferMin : Math.min(60, Math.max(0, Number(b.bufferMin) || 0));
  const travelMin = Math.min(180, Math.max(0, Number(b.travelMin) || 0));
  const slots = suggest(people, { durationMin, from, to, bufferMin, travelMin, stepMin: Number(b.stepMin) || 30, limit: Math.min(30, Number(b.limit) || 12) });
  return {
    ok: true, slots, bufferMin, travelMin,
    people: people.map((p) => ({ email: p.email, tz: p.tz, dayStart: p.dayStart, dayEnd: p.dayEnd, workDays: p.workDays, optional: !!p.optional, busy: p.busy.map(({ start, end }) => ({ start, end })), source: g.source[p.email] || 'none', error: g.error[p.email] || '' })),
  };
}

/** Before booking or moving: who is already busy at that time, from Google and from FavorOS. */
export async function conflicts(env: MeetEnv, booker: string, b: Record<string, unknown>) {
  const s = Date.parse(String(b.startsAt || '')), e = Date.parse(String(b.endsAt || '')) || s + (Number(b.durationMin) || 30) * 60000;
  if (!s || e <= s) throw new HttpError(400, 'bad_time', 'Pick a time.');
  const emails = [...new Set([booker, ...((Array.isArray(b.emails) ? b.emails : []) as unknown[]).map((x) => String(x).toLowerCase().trim())])].filter((x) => x.includes('@')).slice(0, 40);
  const from = new Date(s).toISOString(), to = new Date(e).toISOString();
  const [g, h, prefs] = await Promise.all([googleBusy(env, booker, emails, from, to), hubBusy(env, emails, from, to, clean(b.skipId, 30)), prefsOf(env, emails)]);
  const out: Array<{ email: string; why: 'busy' | 'meeting' | 'outside'; title?: string }> = [];
  const skipCal = clean(b.skipEventId, 200);
  for (const em of emails) {
    const mine = h[em] || [];
    if (mine.length) { out.push({ email: em, why: 'meeting', title: em === booker ? mine[0].title : '' }); continue; }
    // A Google busy block that is this same meeting (moving it) is not a conflict: FavorOS's own row was already skipped.
    if ((g.busy[em] || []).some((x) => Date.parse(x.start) < e && Date.parse(x.end) > s) && !skipCal) { out.push({ email: em, why: 'busy' }); continue; }
    const p = prefs.get(em)!;
    const ws = wallOf(s, p.tz), we = wallOf(e, p.tz);
    const sm = ws.h * 60 + ws.mi, emn = we.d === ws.d ? we.h * 60 + we.mi : 1440;
    if (!p.workDays.includes(ws.wd) || sm < p.dayStart || emn > p.dayEnd) out.push({ email: em, why: 'outside' });
  }
  return { ok: true, conflicts: out, checked: emails.length, google: Object.values(g.source).some((x) => x !== 'none') };
}

// ---------------------------------------------------------------- holds

export async function makeHolds(env: MeetEnv, owner: string, b: Record<string, unknown>) {
  const title = clean(b.title, 120) || 'Meeting';
  const slots = (Array.isArray(b.slots) ? b.slots : []).slice(0, 6) as Array<{ startsAt?: string; endsAt?: string }>;
  if (!slots.length) throw new HttpError(400, 'slots', 'Pick the times to hold.');
  const grp = hex(8);
  const made: Array<{ id: string; startsAt: string; endsAt: string; onCalendar: boolean }> = [];
  for (const s of slots) {
    const a = Date.parse(String(s.startsAt)), z = Date.parse(String(s.endsAt));
    if (!a || !z || z <= a) continue;
    const id = hex(8);
    let evId = '';
    const r = await calFetch(env, owner, '/events?sendUpdates=none', { method: 'POST', body: { summary: `Hold: ${title}`, description: 'A tentative hold from FavorOS Meetings. It comes off when one of the held times is booked.', start: { dateTime: new Date(a).toISOString(), timeZone: TZ }, end: { dateTime: new Date(z).toISOString(), timeZone: TZ }, transparency: 'opaque', status: 'tentative', reminders: { useDefault: false } } }).catch(() => null);
    if (r?.ok) evId = String(((await r.json()) as { id?: string }).id || '');
    await env.DB.prepare('INSERT INTO hub_meeting_holds (id, grp, owner_email, title, starts_at, ends_at, calendar_event_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, grp, owner.toLowerCase(), title, new Date(a).toISOString(), new Date(z).toISOString(), evId, 'held', nowIso()).run();
    made.push({ id, startsAt: new Date(a).toISOString(), endsAt: new Date(z).toISOString(), onCalendar: !!evId });
  }
  return { ok: true, grp, holds: made };
}

/** Take a group of holds off the calendar. keepStart marks the one that was booked. */
export async function releaseHolds(env: MeetEnv, owner: string, grp: string, keepStart = ''): Promise<number> {
  const rows = ((await env.DB.prepare(`SELECT * FROM hub_meeting_holds WHERE grp = ? AND owner_email = ? AND status = 'held'`).bind(grp, owner.toLowerCase()).all<{ id: string; starts_at: string; calendar_event_id: string }>()).results || []);
  for (const h of rows) {
    if (h.calendar_event_id) await calFetch(env, owner, `/events/${encodeURIComponent(h.calendar_event_id)}?sendUpdates=none`, { method: 'DELETE' }).catch(() => null);
    await env.DB.prepare('UPDATE hub_meeting_holds SET status = ? WHERE id = ?').bind(keepStart && h.starts_at === keepStart ? 'booked' : 'released', h.id).run();
  }
  return rows.length;
}

export async function listHolds(env: MeetEnv, owner: string) {
  const rows = ((await env.DB.prepare(`SELECT id, grp, title, starts_at, ends_at, calendar_event_id FROM hub_meeting_holds WHERE owner_email = ? AND status = 'held' AND ends_at > ? ORDER BY starts_at`).bind(owner.toLowerCase(), nowIso()).all()).results || []);
  return { ok: true, holds: rows };
}

// ---------------------------------------------------------------- templates

export interface TemplateRow { id: string; owner_email: string; name: string; title: string; agenda: string; duration_min: number; rec_mode: string; access: string; invitees: string; team: string; drive_folder: string; rule: string; shared: number; created_at: string; updated_at: string }

const tplOut = (t: TemplateRow, me: string) => {
  let invitees: unknown = [];
  try { invitees = JSON.parse(t.invitees); } catch { /* none */ }
  let rule: unknown = null;
  try { rule = t.rule ? cleanRule(JSON.parse(t.rule)) : null; } catch { /* none */ }
  return { id: t.id, name: t.name, title: t.title, agenda: t.agenda, durationMin: t.duration_min, rec: t.rec_mode, access: t.access, invitees, team: t.team, driveFolder: t.drive_folder, rule, shared: !!t.shared, mine: t.owner_email === me };
};

export async function listTemplates(env: MeetEnv, email: string) {
  const me = email.toLowerCase();
  const rows = ((await env.DB.prepare('SELECT * FROM hub_meeting_templates WHERE owner_email = ? OR shared = 1 ORDER BY name').bind(me).all<TemplateRow>()).results || []);
  return { ok: true, templates: rows.map((t) => tplOut(t, me)) };
}

export async function saveTemplate(env: MeetEnv, email: string, b: Record<string, unknown>) {
  const me = email.toLowerCase();
  const id = typeof b.id === 'string' && /^[0-9a-f]{16}$/.test(b.id) ? b.id : hex(8);
  const have = await env.DB.prepare('SELECT owner_email FROM hub_meeting_templates WHERE id = ?').bind(id).first<{ owner_email: string }>();
  if (have && have.owner_email !== me) throw new HttpError(403, 'not_yours', 'Only the person who made this template can change it.');
  const name = clean(b.name, 80);
  if (!name) throw new HttpError(400, 'name', 'Name the template.');
  const invitees = Array.isArray(b.invitees) ? (b.invitees as Array<Record<string, unknown>>).slice(0, 200).map((i) => ({ email: clean(i.email, 200).toLowerCase(), name: clean(i.name, 120), team: clean(i.team, 80), guest: !!i.guest })).filter((i) => i.email.includes('@')) : [];
  const rule = cleanRule(b.rule);
  const driveFolder = clean(b.driveFolder, 200).replace(/^https:\/\/drive\.google\.com\/drive\/(u\/\d+\/)?folders\//, '').replace(/[?#].*$/, '');
  await env.DB.prepare(
    `INSERT INTO hub_meeting_templates (id, owner_email, name, title, agenda, duration_min, rec_mode, access, invitees, team, drive_folder, rule, shared, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, title = excluded.title, agenda = excluded.agenda, duration_min = excluded.duration_min, rec_mode = excluded.rec_mode,
       access = excluded.access, invitees = excluded.invitees, team = excluded.team, drive_folder = excluded.drive_folder, rule = excluded.rule, shared = excluded.shared, updated_at = excluded.updated_at`
  ).bind(id, me, name, clean(b.title, 140), clean(b.agenda, 2000), Math.min(480, Math.max(10, Number(b.durationMin) || 60)), ['off', 'notes', 'video'].includes(String(b.rec)) ? String(b.rec) : 'video',
    ['invited', 'staff', 'guests'].includes(String(b.access)) ? String(b.access) : 'invited', JSON.stringify(invitees), clean(b.team, 80), /^[A-Za-z0-9_-]{10,}$/.test(driveFolder) ? driveFolder : '',
    rule ? JSON.stringify(rule) : '', b.shared ? 1 : 0, nowIso(), nowIso()).run();
  return { ok: true, id };
}

export async function deleteTemplate(env: MeetEnv, email: string, id: string) {
  const r = await env.DB.prepare('DELETE FROM hub_meeting_templates WHERE id = ? AND owner_email = ?').bind(id, email.toLowerCase()).run();
  if (!r.meta?.changes) throw new HttpError(404, 'not_found', 'That template is not yours or is gone.');
  return { ok: true };
}

/** Whether this person's Google connection lets FavorOS read their own free and busy times and add to their calendar. */
export async function googleState(env: MeetEnv, email: string) {
  const t = await accessToken(env, email).catch(() => null);
  return { connected: !!t, freebusy: !!t && hasScopes(t.scopes, [CAL_FREEBUSY]), events: !!t && hasScopes(t.scopes, [CAL_EVENTS]) };
}

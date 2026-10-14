// Meetings: booking pages. A staff member sets up meeting types (a 30-minute partner call, a 60-minute visit) with hours, buffer,
// notice and questions; a partner opens /meet/with/?u=<handle>, picks a time the owner is free, answers the questions and books.
// The booking becomes a FavorOS meeting with the partner as a guest, a hold on the owner's Google Calendar (no Google invite to
// the partner), a confirmation email with a calendar file and a link to cancel or move it, and the usual reminders.
// Public routes live under /api/book/ (functions/api/book/[[path]].ts); the owner's routes under /api/meet/meetings/booking/.
import { HttpError, nowIso } from './http';
import { clean, guestsOn, hex, sha, type MeetEnv } from './meet';
import { calFetch, sendReminder, TZ } from './meetcal';
import { buildIcs } from './meetics';
import { googleBusy, hubBusy, prefsOf } from './meetsched';
import { wallOf, instantOf } from './meetrecur';
import { isTester } from './testuser';

export interface BookingType {
  id: string; owner_email: string; owner_name: string; handle: string; slug: string; title: string; about: string; duration_min: number; audience: string;
  avail: string; tz: string; buffer_min: number; travel_min: number; notice_min: number; horizon_days: number; max_per_day: number; step_min: number;
  questions: string; location: string; place: string; rec_mode: string; active: number; created_at: string; updated_at: string;
}
interface Booking { id: string; type_id: string; meeting_id: string; owner_email: string; name: string; email: string; phone: string; answers: string; starts_at: string; ends_at: string; tz: string; status: string; manage_hash: string }

const DAY = 86400_000;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const EMAIL_RE = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;
const validTz = (tz: string) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };
function safe<T>(j: string, d: T): T { try { return (JSON.parse(j) as T) ?? d; } catch { return d; } }
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'meeting';

const LOC_LABEL: Record<string, string> = { video: 'Video call in FavorOS', phone: 'Phone call', in_person: 'In person' };

export function typeOut(t: BookingType, withPrivate = false) {
  return {
    id: withPrivate ? t.id : undefined, handle: t.handle, slug: t.slug, title: t.title, about: t.about, durationMin: t.duration_min, audience: withPrivate ? t.audience : undefined,
    location: t.location, locationLabel: LOC_LABEL[t.location] || 'Video call', place: t.location === 'in_person' && withPrivate ? t.place : t.location === 'in_person' ? t.place : '',
    questions: safe<Array<{ q: string; required: boolean }>>(t.questions, []), tz: t.tz,
    ...(withPrivate ? { avail: safe(t.avail, {}), bufferMin: t.buffer_min, travelMin: t.travel_min, noticeMin: t.notice_min, horizonDays: t.horizon_days, maxPerDay: t.max_per_day, stepMin: t.step_min, rec: t.rec_mode, active: !!t.active } : {}),
  };
}

// ---------------------------------------------------------------- the owner's side

/** The owner's page name: taken from the email, made unique. Kept once chosen. */
export async function handleOf(env: MeetEnv, email: string): Promise<string> {
  const me = email.toLowerCase();
  const have = await env.DB.prepare('SELECT handle FROM hub_booking_types WHERE owner_email = ? LIMIT 1').bind(me).first<{ handle: string }>();
  if (have) return have.handle;
  const base = slugify(me.split('@')[0].replace(/[._]+/g, '-'));
  for (let i = 0; i < 50; i++) {
    const h = i ? `${base}-${i + 1}` : base;
    const used = await env.DB.prepare('SELECT 1 AS x FROM hub_booking_types WHERE handle = ? AND owner_email != ? LIMIT 1').bind(h, me).first();
    if (!used) return h;
  }
  return `${base}-${hex(2)}`;
}

export async function myTypes(env: MeetEnv, email: string) {
  const me = email.toLowerCase();
  const rows = ((await env.DB.prepare('SELECT * FROM hub_booking_types WHERE owner_email = ? ORDER BY created_at').bind(me).all<BookingType>()).results || []);
  const handle = await handleOf(env, me);
  const upcoming = ((await env.DB.prepare(
    `SELECT b.id, b.name, b.email, b.phone, b.answers, b.starts_at, b.ends_at, b.status, b.meeting_id, t.title FROM hub_bookings b JOIN hub_booking_types t ON t.id = b.type_id
      WHERE b.owner_email = ? AND b.status = 'booked' AND b.ends_at > ? ORDER BY b.starts_at LIMIT 100`
  ).bind(me, nowIso()).all()).results || []);
  return { ok: true, handle, types: rows.map((t) => typeOut(t, true)), bookings: upcoming.map((b) => ({ ...b, answers: safe((b as { answers: string }).answers, []) })) };
}

/** Hours per weekday ({ "1": [[540, 1020]] }), each window in minutes after midnight in the type's zone. */
function cleanAvail(v: unknown): Record<string, Array<[number, number]>> {
  const out: Record<string, Array<[number, number]>> = {};
  const days = (v && typeof v === 'object' ? (v as { days?: unknown }).days ?? v : {}) as Record<string, unknown>;
  for (const k of ['0', '1', '2', '3', '4', '5', '6']) {
    const w = days[k];
    if (!Array.isArray(w)) continue;
    const list = (w as unknown[]).filter(Array.isArray).map((x) => [Math.round(Number((x as unknown[])[0])), Math.round(Number((x as unknown[])[1]))] as [number, number]).filter(([a, b]) => a >= 0 && b <= 1440 && b - a >= 15).slice(0, 4);
    if (list.length) out[k] = list;
  }
  return out;
}

export async function saveType(env: MeetEnv, user: { email: string; name: string }, b: Record<string, unknown>) {
  const me = user.email.toLowerCase();
  const id = typeof b.id === 'string' && /^[0-9a-f]{16}$/.test(b.id) ? b.id : '';
  const prev = id ? await env.DB.prepare('SELECT * FROM hub_booking_types WHERE id = ?').bind(id).first<BookingType>() : null;
  if (id && (!prev || prev.owner_email !== me)) throw new HttpError(404, 'not_found', 'That meeting type is not yours.');
  const title = clean(b.title, 80);
  if (!title) throw new HttpError(400, 'title', 'Name the meeting type.');
  const handle = await handleOf(env, me);
  let slug = typeof b.slug === 'string' && SLUG_RE.test(b.slug) ? b.slug : prev?.slug || slugify(title);
  const clash = await env.DB.prepare('SELECT id FROM hub_booking_types WHERE handle = ? AND slug = ? AND id != ?').bind(handle, slug, id || '-').first();
  if (clash) slug = `${slug}-${hex(2)}`;
  const n = (v: unknown, lo: number, hi: number, d: number) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
  const questions = (Array.isArray(b.questions) ? b.questions : []).slice(0, 8).map((q) => ({ q: clean((q as Record<string, unknown>)?.q, 200), required: !!(q as Record<string, unknown>)?.required })).filter((q) => q.q);
  const row = {
    id: id || hex(8), title, about: clean(b.about, 600), duration_min: n(b.durationMin, 10, 240, 30), audience: b.audience === 'staff' ? 'staff' : 'partners',
    avail: JSON.stringify({ days: cleanAvail(b.avail) }), tz: typeof b.tz === 'string' && validTz(b.tz) ? b.tz : TZ, buffer_min: n(b.bufferMin, 0, 120, 10), travel_min: n(b.travelMin, 0, 240, 0),
    notice_min: n(b.noticeMin, 0, 14 * 1440, 240), horizon_days: n(b.horizonDays, 1, 120, 30), max_per_day: n(b.maxPerDay, 1, 20, 4), step_min: [15, 20, 30, 60].includes(Number(b.stepMin)) ? Number(b.stepMin) : 30,
    questions: JSON.stringify(questions), location: ['video', 'phone', 'in_person'].includes(String(b.location)) ? String(b.location) : 'video', place: clean(b.place, 200),
    rec_mode: ['off', 'notes', 'video'].includes(String(b.rec)) ? String(b.rec) : 'off', active: b.active === false ? 0 : 1,
  };
  await env.DB.prepare(
    `INSERT INTO hub_booking_types (id, owner_email, owner_name, handle, slug, title, about, duration_min, audience, avail, tz, buffer_min, travel_min, notice_min, horizon_days, max_per_day, step_min, questions, location, place, rec_mode, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET owner_name = excluded.owner_name, slug = excluded.slug, title = excluded.title, about = excluded.about, duration_min = excluded.duration_min, audience = excluded.audience,
       avail = excluded.avail, tz = excluded.tz, buffer_min = excluded.buffer_min, travel_min = excluded.travel_min, notice_min = excluded.notice_min, horizon_days = excluded.horizon_days,
       max_per_day = excluded.max_per_day, step_min = excluded.step_min, questions = excluded.questions, location = excluded.location, place = excluded.place, rec_mode = excluded.rec_mode,
       active = excluded.active, updated_at = excluded.updated_at`
  ).bind(row.id, me, user.name || '', handle, slug, row.title, row.about, row.duration_min, row.audience, row.avail, row.tz, row.buffer_min, row.travel_min, row.notice_min, row.horizon_days,
    row.max_per_day, row.step_min, row.questions, row.location, row.place, row.rec_mode, row.active, prev?.created_at || nowIso(), nowIso()).run();
  return { ok: true, id: row.id, handle, slug };
}

export async function deleteType(env: MeetEnv, email: string, id: string) {
  // Turned off rather than removed, so the bookings already made keep their type.
  const r = await env.DB.prepare('UPDATE hub_booking_types SET active = 0, updated_at = ? WHERE id = ? AND owner_email = ?').bind(nowIso(), id, email.toLowerCase()).run();
  if (!r.meta?.changes) throw new HttpError(404, 'not_found', 'That meeting type is not yours.');
  return { ok: true };
}

// ---------------------------------------------------------------- open times

async function typeBy(env: MeetEnv, handle: string, slug: string, signedIn: boolean): Promise<BookingType> {
  const t = await env.DB.prepare('SELECT * FROM hub_booking_types WHERE handle = ? AND slug = ? AND active = 1').bind(clean(handle, 60).toLowerCase(), clean(slug, 60).toLowerCase()).first<BookingType>();
  if (!t || (t.audience === 'staff' && !signedIn)) throw new HttpError(404, 'not_found', 'That booking page does not exist.');
  return t;
}

/** The owner's open start times for this type between from and to (ISO list), after hours, busy times, buffer, travel, notice and the daily cap. */
export async function openTimes(env: MeetEnv, t: BookingType, fromMs: number, toMs: number, now = Date.now(), skipMeeting = ''): Promise<string[]> {
  const start = Math.max(fromMs, now + t.notice_min * 60000);
  const end = Math.min(toMs, now + t.horizon_days * DAY);
  if (end <= start) return [];
  let avail = safe<{ days?: Record<string, Array<[number, number]>> }>(t.avail, {}).days || {};
  if (!Object.keys(avail).length) {
    const p = (await prefsOf(env, [t.owner_email])).get(t.owner_email)!;
    avail = Object.fromEntries(p.workDays.map((d) => [String(d), [[p.dayStart, p.dayEnd] as [number, number]]]));
  }
  const fromIso = new Date(start - DAY).toISOString(), toIso = new Date(end + DAY).toISOString();
  const [g, h, holds] = await Promise.all([
    googleBusy(env, t.owner_email, [t.owner_email], fromIso, toIso).catch(() => ({ busy: {} as Record<string, Array<{ start: string; end: string }>> })),
    hubBusy(env, [t.owner_email], fromIso, toIso, skipMeeting),
    env.DB.prepare(`SELECT starts_at AS start, ends_at AS end FROM hub_meeting_holds WHERE owner_email = ? AND status = 'held' AND ends_at > ? AND starts_at < ?`).bind(t.owner_email, fromIso, toIso).all<{ start: string; end: string }>(),
  ]);
  const busy = [...(g.busy[t.owner_email] || []), ...(h[t.owner_email] || []), ...(holds.results || [])].map((b) => [Date.parse(b.start), Date.parse(b.end)] as const);
  const perDay = new Map<string, number>();
  const counted = ((await env.DB.prepare(`SELECT starts_at FROM hub_bookings WHERE owner_email = ? AND status = 'booked' AND starts_at BETWEEN ? AND ? AND meeting_id != ?`).bind(t.owner_email, fromIso, toIso, skipMeeting).all<{ starts_at: string }>()).results || []);
  for (const c of counted) { const k = new Date(c.starts_at).toLocaleDateString('en-CA', { timeZone: t.tz }); perDay.set(k, (perDay.get(k) || 0) + 1); }
  const dur = t.duration_min * 60000, pad = (t.buffer_min + (t.location === 'in_person' ? t.travel_min : 0)) * 60000;
  const out: string[] = [];
  const w0 = wallOf(start, t.tz);
  for (let i = 0; i <= Math.ceil((end - start) / DAY) + 1 && out.length < 400; i++) {
    const day = new Date(Date.UTC(w0.y, w0.mo - 1, w0.d + i));
    const y = day.getUTCFullYear(), mo = day.getUTCMonth() + 1, d = day.getUTCDate();
    const key = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if ((perDay.get(key) || 0) >= t.max_per_day) continue;
    for (const [a, b] of avail[String(day.getUTCDay())] || []) {
      for (let m = a; m + t.duration_min <= b; m += t.step_min) {
        const s = instantOf(y, mo, d, Math.floor(m / 60), m % 60, t.tz);
        if (s < start || s + dur > end) continue;
        if (busy.some(([x, z]) => x < s + dur + pad && z > s - pad)) continue;
        out.push(new Date(s).toISOString());
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- the public side

export async function publicPage(env: MeetEnv, handle: string, signedIn: boolean) {
  const rows = ((await env.DB.prepare('SELECT * FROM hub_booking_types WHERE handle = ? AND active = 1 ORDER BY duration_min').bind(clean(handle, 60).toLowerCase()).all<BookingType>()).results || []).filter((t) => t.audience !== 'staff' || signedIn);
  if (!rows.length) throw new HttpError(404, 'not_found', 'That booking page does not exist.');
  return { ok: true, owner: { name: rows[0].owner_name || rows[0].owner_email.split('@')[0] }, types: rows.map((t) => typeOut(t)) };
}

export async function publicSlots(env: MeetEnv, q: URLSearchParams, signedIn: boolean) {
  const t = await typeBy(env, q.get('u') || '', q.get('t') || '', signedIn);
  const from = Date.parse(q.get('from') || '') || Date.now();
  const days = Math.min(31, Math.max(1, Number(q.get('days')) || 14));
  const times = await openTimes(env, t, from, from + days * DAY);
  return { ok: true, type: typeOut(t), owner: { name: t.owner_name }, slots: times };
}

const manageUrl = (origin: string, id: string, key: string) => `${origin}/meet/with/?b=${id}&k=${key}`;

function bookingIcs(t: BookingType, b: { id: string; starts_at: string; ends_at: string; name: string; email: string }, url: string, method: 'REQUEST' | 'CANCEL', seq: number) {
  return buildIcs({ uid: `booking-${b.id}@favoros`, method, sequence: seq, startsAt: b.starts_at, endsAt: b.ends_at, title: `${t.title} with ${t.owner_name || t.owner_email}`, url: t.location === 'video' ? url : undefined, location: t.location === 'in_person' ? t.place : t.location === 'phone' ? 'Phone call' : undefined, organizer: { name: t.owner_name || t.owner_email, email: t.owner_email }, attendees: [{ name: b.name, email: b.email }] });
}

/** Test accounts book only for test addresses, so a test never emails a partner or a staff member. */
function guardTest(t: BookingType, email: string) {
  if (isTester(t.owner_email) && !(isTester(email) || /@(example\.(com|org|test)|favor\.test)$/i.test(email))) throw new HttpError(400, 'test_only', 'A test booking page takes only test addresses.');
}

export async function book(env: MeetEnv, b: Record<string, unknown>, origin: string, ip: string, signedIn: boolean) {
  if (typeof b.website === 'string' && b.website) throw new HttpError(400, 'bad', 'Something went wrong. Try again.');
  const t = await typeBy(env, String(b.u || ''), String(b.t || ''), signedIn);
  const name = clean(b.name, 120), email = clean(b.email, 200).toLowerCase(), phone = clean(b.phone, 40);
  if (!name) throw new HttpError(400, 'name', 'Type your name.');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'email', 'Type your email address.');
  if (t.location === 'phone' && !phone) throw new HttpError(400, 'phone', 'Type the phone number to call.');
  guardTest(t, email);
  const qs = safe<Array<{ q: string; required: boolean }>>(t.questions, []);
  const given = Array.isArray(b.answers) ? (b.answers as unknown[]).map((a) => clean(a, 1000)) : [];
  const answers = qs.map((q, i) => ({ q: q.q, a: given[i] || '' }));
  const missing = qs.findIndex((q, i) => q.required && !answers[i].a);
  if (missing >= 0) throw new HttpError(400, 'answer', `Answer: ${qs[missing].q}`);
  const ipHash = (await sha('book:' + ip)).slice(0, 24);
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM hub_bookings WHERE ip = ? AND created_at > ?').bind(ipHash, new Date(Date.now() - 3600_000).toISOString()).first<{ n: number }>();
  if ((recent?.n || 0) >= 5) throw new HttpError(429, 'slow_down', 'Too many bookings from here in the last hour. Try again later.');
  const startMs = Date.parse(String(b.startsAt || ''));
  if (!startMs) throw new HttpError(400, 'time', 'Pick a time.');
  const open = await openTimes(env, t, startMs - 60000, startMs + t.duration_min * 60000 + 60000);
  if (!open.includes(new Date(startMs).toISOString())) throw new HttpError(409, 'taken', 'That time was just taken. Pick another.');
  const tz = typeof b.tz === 'string' && validTz(b.tz) ? b.tz : t.tz;
  const startsAt = new Date(startMs).toISOString(), endsAt = new Date(startMs + t.duration_min * 60000).toISOString();
  const id = hex(8), key = hex(16), mid = hex(12);
  const withGuests = guestsOn(env) && t.location === 'video';
  const gkey = withGuests ? hex(16) : '';
  const joinUrl = withGuests ? `${origin}/meet/g/?m=${mid}&k=${gkey}` : `${origin}/meet/room/?m=${mid}`;
  const agenda = [
    t.about,
    `Booked by ${name} (${email}${phone ? `, ${phone}` : ''}) from ${t.owner_name || 'the'} booking page.`,
    ...answers.filter((a) => a.a).map((a) => `${a.q}\n${a.a}`),
    t.location === 'in_person' && t.place ? `Where: ${t.place}` : '',
    t.location === 'phone' ? `Call ${name} at ${phone}.` : '',
  ].filter(Boolean).join('\n\n').slice(0, 2000);
  const invitees = [{ email, name, team: 'Partner', guest: true }];
  // The hold on the owner's calendar. No attendees, so Google sends the partner nothing; FavorOS's own email carries the calendar file.
  let eventId = '';
  const r = await calFetch(env, t.owner_email, '/events?sendUpdates=none', {
    method: 'POST',
    body: {
      summary: `${t.title}: ${name}`, description: `Join in FavorOS: ${origin}/meet/room/?m=${mid}\n\n${agenda}`, location: t.location === 'in_person' ? t.place : `${origin}/meet/room/?m=${mid}`,
      start: { dateTime: startsAt, timeZone: t.tz }, end: { dateTime: endsAt, timeZone: t.tz }, reminders: { useDefault: true },
    },
  }).catch(() => null);
  if (r?.ok) eventId = String(((await r.json()) as { id?: string }).id || '');
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO hub_meetings (id, title, agenda, host_email, host_name, starts_at, ends_at, duration_min, rec_mode, access, invitees, status, created_at, repeat, series_id, calendar_event_id, backup_link, remind, tz)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, 'none', '', ?, '', 1, ?)`
    ).bind(mid, `${t.title}: ${name}`.slice(0, 140), agenda, t.owner_email, t.owner_name, startsAt, endsAt, t.duration_min, t.rec_mode, withGuests ? 'guests' : 'invited', JSON.stringify(invitees), nowIso(), eventId, tz),
    ...(gkey ? [env.DB.prepare('INSERT OR REPLACE INTO hub_meeting_guest (meeting_id, gkey) VALUES (?, ?)').bind(mid, gkey)] : []),
    env.DB.prepare(
      `INSERT INTO hub_bookings (id, type_id, meeting_id, owner_email, name, email, phone, answers, starts_at, ends_at, tz, status, manage_hash, ip, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'booked', ?, ?, ?, ?)`
    ).bind(id, t.id, mid, t.owner_email, name, email, phone, JSON.stringify(answers), startsAt, endsAt, tz, await sha(key), ipHash, nowIso(), nowIso()),
  ]);
  const manage = manageUrl(origin, id, key);
  const host = t.owner_name || t.owner_email;
  await sendReminder(env, [email], {
    title: `${t.title} with ${host}`, startsAt, endsAt, durationMin: t.duration_min, roomUrl: t.location === 'video' ? joinUrl : manage, backup: '', rec: t.rec_mode, kind: 'link', host, hostEmail: t.owner_email, tz,
    note: `You're booked. ${t.location === 'phone' ? `${host} will call you at ${phone}.` : t.location === 'in_person' ? `Where: ${t.place || 'to be confirmed'}.` : 'Join from the button at the time.'} To cancel or pick another time: ${manage}`,
    sender: 'FavorOS', ics: bookingIcs(t, { id, starts_at: startsAt, ends_at: endsAt, name, email }, joinUrl, 'REQUEST', 0),
  }).catch(() => false);
  await sendReminder(env, [t.owner_email], {
    title: `${t.title}: ${name}`, startsAt, endsAt, durationMin: t.duration_min, roomUrl: `${origin}/meet/room/?m=${mid}`, backup: '', rec: t.rec_mode, kind: 'link', host, hostEmail: t.owner_email, agenda,
    note: `${name} booked ${t.title} from your booking page.${eventId ? ' It is on your Google Calendar.' : ''}`, sender: 'FavorOS',
  }).catch(() => false);
  return { ok: true, booking: { id, startsAt, endsAt, tz, title: t.title, owner: host, location: t.location, place: t.place, joinUrl: t.location === 'video' ? joinUrl : '' }, manageUrl: manage, calendar: !!eventId };
}

async function bookingBy(env: MeetEnv, id: string, key: string): Promise<{ bk: Booking; t: BookingType }> {
  if (!/^[0-9a-f]{16}$/.test(id) || !/^[0-9a-f]{32}$/.test(key)) throw new HttpError(404, 'not_found', 'That booking link does not work.');
  const bk = await env.DB.prepare('SELECT * FROM hub_bookings WHERE id = ?').bind(id).first<Booking>();
  if (!bk || bk.manage_hash !== (await sha(key))) throw new HttpError(404, 'not_found', 'That booking link does not work.');
  const t = await env.DB.prepare('SELECT * FROM hub_booking_types WHERE id = ?').bind(bk.type_id).first<BookingType>();
  if (!t) throw new HttpError(404, 'not_found', 'That booking link does not work.');
  return { bk, t };
}

export async function manageGet(env: MeetEnv, id: string, key: string) {
  const { bk, t } = await bookingBy(env, id, key);
  return { ok: true, booking: { id: bk.id, name: bk.name, startsAt: bk.starts_at, endsAt: bk.ends_at, tz: bk.tz, status: bk.status }, type: typeOut(t), owner: { name: t.owner_name }, past: Date.parse(bk.starts_at) < Date.now() };
}

/** The partner cancels or moves their booking from the link in their email. The owner hears about it either way. */
export async function manageAct(env: MeetEnv, b: Record<string, unknown>, origin: string) {
  const { bk, t } = await bookingBy(env, String(b.b || ''), String(b.k || ''));
  if (bk.status !== 'booked') throw new HttpError(400, 'done', 'This booking was already cancelled.');
  if (Date.parse(bk.starts_at) < Date.now()) throw new HttpError(400, 'past', 'This meeting has already started.');
  const m = await env.DB.prepare('SELECT calendar_event_id, invitees FROM hub_meetings WHERE id = ?').bind(bk.meeting_id).first<{ calendar_event_id: string }>();
  const host = t.owner_name || t.owner_email;
  const gk = (await env.DB.prepare('SELECT gkey FROM hub_meeting_guest WHERE meeting_id = ?').bind(bk.meeting_id).first<{ gkey: string }>())?.gkey || '';
  const joinUrl = gk ? `${origin}/meet/g/?m=${bk.meeting_id}&k=${gk}` : `${origin}/meet/room/?m=${bk.meeting_id}`;
  const seq = Math.floor(Date.now() / 1000);
  if (b.action === 'cancel') {
    const reason = clean(b.reason, 300);
    if (m?.calendar_event_id) await calFetch(env, t.owner_email, `/events/${encodeURIComponent(m.calendar_event_id)}?sendUpdates=none`, { method: 'DELETE' }).catch(() => null);
    await env.DB.batch([
      env.DB.prepare(`UPDATE hub_bookings SET status = 'cancelled', updated_at = ? WHERE id = ?`).bind(nowIso(), bk.id),
      env.DB.prepare(`UPDATE hub_meetings SET status = 'cancelled' WHERE id = ? AND status = 'scheduled'`).bind(bk.meeting_id),
    ]);
    await sendReminder(env, [bk.email], { title: `${t.title} with ${host}`, startsAt: bk.starts_at, endsAt: bk.ends_at, roomUrl: joinUrl, backup: '', rec: 'off', kind: 'cancelled', host: bk.name, tz: bk.tz, ics: bookingIcs(t, bk, joinUrl, 'CANCEL', seq) }).catch(() => false);
    await sendReminder(env, [t.owner_email], { title: `${t.title}: ${bk.name}`, startsAt: bk.starts_at, endsAt: bk.ends_at, roomUrl: `${origin}/meet/with/manage/`, backup: '', rec: 'off', kind: 'cancelled', host: bk.name, note: reason ? `${bk.name} cancelled: ${reason}` : `${bk.name} cancelled.`, sender: 'FavorOS' }).catch(() => false);
    return { ok: true, status: 'cancelled' };
  }
  if (b.action === 'move') {
    const s = Date.parse(String(b.startsAt || ''));
    if (!s) throw new HttpError(400, 'time', 'Pick a new time.');
    const open = await openTimes(env, t, s - 60000, s + t.duration_min * 60000 + 60000, Date.now(), bk.meeting_id);
    if (!open.includes(new Date(s).toISOString())) throw new HttpError(409, 'taken', 'That time is not open. Pick another.');
    const startsAt = new Date(s).toISOString(), endsAt = new Date(s + t.duration_min * 60000).toISOString();
    if (m?.calendar_event_id) await calFetch(env, t.owner_email, `/events/${encodeURIComponent(m.calendar_event_id)}?sendUpdates=none`, { method: 'PATCH', body: { start: { dateTime: startsAt, timeZone: t.tz }, end: { dateTime: endsAt, timeZone: t.tz } } }).catch(() => null);
    await env.DB.batch([
      env.DB.prepare(`UPDATE hub_bookings SET starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ?`).bind(startsAt, endsAt, nowIso(), bk.id),
      env.DB.prepare(`UPDATE hub_meetings SET starts_at = ?, ends_at = ? WHERE id = ?`).bind(startsAt, endsAt, bk.meeting_id),
      env.DB.prepare('DELETE FROM hub_meeting_reminders WHERE meeting_id = ?').bind(bk.meeting_id),
    ]);
    const nb = { ...bk, starts_at: startsAt, ends_at: endsAt };
    await sendReminder(env, [bk.email], { title: `${t.title} with ${host}`, startsAt, endsAt, roomUrl: t.location === 'video' ? joinUrl : `${origin}/meet/with/?b=${bk.id}&k=${String(b.k)}`, backup: '', rec: t.rec_mode, kind: 'moved', host, hostEmail: t.owner_email, tz: bk.tz, ics: bookingIcs(t, nb, joinUrl, 'REQUEST', seq) }).catch(() => false);
    await sendReminder(env, [t.owner_email], { title: `${t.title}: ${bk.name}`, startsAt, endsAt, roomUrl: `${origin}/meet/room/?m=${bk.meeting_id}`, backup: '', rec: t.rec_mode, kind: 'moved', host, note: `${bk.name} picked a new time.`, sender: 'FavorOS' }).catch(() => false);
    return { ok: true, status: 'booked', startsAt, endsAt };
  }
  throw new HttpError(400, 'action', 'Cancel or move.');
}

/** The owner cancels a booking from FavorOS: the partner gets the cancellation with a calendar file. */
export async function ownerCancel(env: MeetEnv, email: string, bookingId: string, origin: string, note = '') {
  const bk = await env.DB.prepare('SELECT * FROM hub_bookings WHERE id = ? AND owner_email = ?').bind(bookingId, email.toLowerCase()).first<Booking>();
  if (!bk || bk.status !== 'booked') throw new HttpError(404, 'not_found', 'That booking is not open.');
  const t = await env.DB.prepare('SELECT * FROM hub_booking_types WHERE id = ?').bind(bk.type_id).first<BookingType>();
  const m = await env.DB.prepare('SELECT calendar_event_id FROM hub_meetings WHERE id = ?').bind(bk.meeting_id).first<{ calendar_event_id: string }>();
  if (m?.calendar_event_id) await calFetch(env, bk.owner_email, `/events/${encodeURIComponent(m.calendar_event_id)}?sendUpdates=none`, { method: 'DELETE' }).catch(() => null);
  await env.DB.batch([
    env.DB.prepare(`UPDATE hub_bookings SET status = 'cancelled', updated_at = ? WHERE id = ?`).bind(nowIso(), bk.id),
    env.DB.prepare(`UPDATE hub_meetings SET status = 'cancelled' WHERE id = ? AND status = 'scheduled'`).bind(bk.meeting_id),
  ]);
  if (t) {
    const host = t.owner_name || t.owner_email;
    await sendReminder(env, [bk.email], { title: `${t.title} with ${host}`, startsAt: bk.starts_at, endsAt: bk.ends_at, roomUrl: `${origin}/meet/with/?u=${t.handle}`, backup: '', rec: 'off', kind: 'cancelled', host, tz: bk.tz, note: clean(note, 300) || `To pick another time, use ${origin}/meet/with/?u=${t.handle}`, sender: host, ics: bookingIcs(t, bk, '', 'CANCEL', Math.floor(Date.now() / 1000)) }).catch(() => false);
  }
  return { ok: true };
}

/** A booking's meeting was cancelled or moved from FavorOS (the day view or the meeting page): keep the booking row in step. */
export async function bookingFollows(env: MeetEnv, meetingId: string, change: { status?: 'cancelled'; startsAt?: string; endsAt?: string }) {
  if (change.status === 'cancelled') await env.DB.prepare(`UPDATE hub_bookings SET status = 'cancelled', updated_at = ? WHERE meeting_id = ? AND status = 'booked'`).bind(nowIso(), meetingId).run().catch(() => undefined);
  else if (change.startsAt && change.endsAt) await env.DB.prepare(`UPDATE hub_bookings SET starts_at = ?, ends_at = ?, updated_at = ? WHERE meeting_id = ? AND status = 'booked'`).bind(change.startsAt, change.endsAt, nowIso(), meetingId).run().catch(() => undefined);
}

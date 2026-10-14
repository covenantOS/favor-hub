// Meetings: send the link again, by email and by text, before or during a meeting, to everyone or to the people picked.
// The host (or a made host, or a hub admin) sends to anyone on the meeting and can add a person by name, email or phone.
// Anyone else who may join sends the link only to themselves ("Send to my phone"). Texts go through the GoHighLevel number
// only while Admin > Meetings > Meeting texts is on (each text is billed by GoHighLevel); it is off until Will turns it on.

import { clean, emailsOf, getMeeting, guestsOn, isHost, mayJoin, refuseJoin, GONE_MS, type Meeting, type MeetEnv } from './meet';
import { HttpError, nowIso } from './http';
import { addAttendees, sendReminder, TZ } from './meetcal';
import { matchPeople, normPhone, parseTarget, textInvite } from './meetinvite';
import { effective } from './admin/settings';
import { isTester } from './testuser';

type User = { email: string; name: string; role: string };
export interface SendDeps {
  /** The guest link for this meeting, made on first use. */
  guestUrl: (m: Meeting) => Promise<string>;
  /** The Favor staff list (meet_directory and hub users). */
  people: () => Promise<Array<{ email: string; name: string; team: string }>>;
}

export interface Recip {
  key: string; name: string; email: string; phone: string; host: boolean; guest: boolean; here: boolean; you: boolean;
  last: { email?: number; text?: number }; why: string;
}

const COOLDOWN_MS = 60_000;
const DAY_CAP = 300;
export const SENDER_DAY_CAP = 500;

export const textsOn = async (env: MeetEnv): Promise<boolean> => (await effective(env, 'meet.texts', undefined, 'off').catch(() => 'off')).toLowerCase() === 'on';
export const maskPhone = (p: string): string => (p ? `(***) ***-${p.slice(-4)}` : '');
const parse = <T,>(s: string, d: T): T => { try { return JSON.parse(s) as T; } catch { return d; } };
const fmtWhen = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const mayAll = (m: Meeting, u: User) => isHost(m, u.email) || u.role === 'admin';

/** Everyone on the meeting: the host, made hosts, invitees and people added by phone, with their numbers and the last sends. */
export async function recipients(env: MeetEnv, m: Meeting, user: User): Promise<Recip[]> {
  const me = user.email.toLowerCase();
  const inv = parse<Array<{ email?: string; name?: string; guest?: boolean }>>(m.invitees, []);
  const hosts = new Set([m.host_email.toLowerCase(), ...emailsOf(m.cohosts)]);
  const byEmail = new Map<string, Recip>();
  const blank = (email: string, name: string, guest: boolean): Recip => ({ key: email, name: name || email, email, phone: '', host: hosts.has(email), guest, here: false, you: email === me, last: {}, why: '' });
  byEmail.set(m.host_email.toLowerCase(), blank(m.host_email.toLowerCase(), m.host_name, false));
  for (const i of inv) {
    const e = String(i.email || '').toLowerCase();
    if (e && !byEmail.has(e)) byEmail.set(e, blank(e, String(i.name || ''), !!i.guest));
  }
  const [phones, own, here, sends] = await Promise.all([
    env.DB.prepare('SELECT phone, lower(email) AS email, name FROM hub_meeting_phones WHERE meeting_id = ? ORDER BY added_at').bind(m.id).all<{ phone: string; email: string; name: string }>().then((r) => r.results || []).catch(() => []),
    byEmail.size
      ? env.DB.prepare(`SELECT lower(email) AS email, phone FROM hub_user_phones WHERE lower(email) IN (${[...byEmail.keys()].map(() => '?').join(',')})`).bind(...byEmail.keys()).all<{ email: string; phone: string }>().then((r) => r.results || []).catch(() => [])
      : Promise.resolve([]),
    env.DB.prepare('SELECT lower(email) AS email FROM hub_meeting_presence WHERE meeting_id = ? AND left_at = 0 AND removed = 0 AND waiting = 0 AND seen > ?').bind(m.id, Date.now() - GONE_MS).all<{ email: string }>().then((r) => r.results || []).catch(() => []),
    env.DB.prepare(`SELECT to_key, channel, MAX(at) AS at FROM hub_meeting_sends WHERE meeting_id = ? AND status = 'sent' GROUP BY to_key, channel`).bind(m.id).all<{ to_key: string; channel: 'email' | 'text'; at: number }>().then((r) => r.results || []).catch(() => []),
  ]);
  for (const o of own) { const r = byEmail.get(o.email); if (r) r.phone = o.phone; }
  const out = [...byEmail.values()];
  for (const p of phones) {
    const r = p.email ? byEmail.get(p.email) : undefined;
    if (r) r.phone = p.phone; // a number the host typed for this meeting wins over the person's own
    else if (!p.email) out.push({ key: p.phone, name: p.name || p.phone, email: '', phone: p.phone, host: false, guest: true, here: false, you: false, last: {}, why: '' });
  }
  const hereSet = new Set(here.map((h) => h.email));
  const lastOf = new Map(sends.map((s) => [`${s.to_key}|${s.channel}`, s.at]));
  for (const r of out) {
    r.here = !!r.email && hereSet.has(r.email);
    r.last = { email: lastOf.get(`${r.key}|email`), text: lastOf.get(`${r.key}|text`) };
    if (r.guest && !guestsOn(env)) r.why = 'Guests are off, so there is no link for people outside Favor.';
  }
  return out;
}

/** The send sheet: who can be sent the link, and what this person may do. */
export async function sendState(env: MeetEnv, user: User, id: string) {
  const m = await getMeeting(env, id);
  if (!mayJoin(m, user)) throw refuseJoin(m);
  const all = mayAll(m, user);
  const people = await recipients(env, m, user);
  const mine = people.find((p) => p.you);
  const own = await env.DB.prepare('SELECT phone FROM hub_user_phones WHERE lower(email) = ?').bind(user.email.toLowerCase()).first<{ phone: string }>().catch(() => null);
  const show = (p: Recip) => ({ ...p, phone: maskPhone(p.phone), hasPhone: !!p.phone, key: p.key.startsWith('+') ? `tel:${p.key.slice(-4)}:${people.indexOf(p)}` : p.key });
  return {
    ok: true, mayAll: all, texts: await textsOn(env), guestsOn: guestsOn(env), status: m.status, title: m.title, startsAt: m.starts_at,
    myPhone: maskPhone(own?.phone || mine?.phone || ''),
    people: all ? people.map(show) : mine ? [show(mine)] : [],
  };
}

/** Save the person's own mobile for meeting texts. An empty value removes it. */
export async function setMyPhone(env: MeetEnv, user: User, b: Record<string, unknown>) {
  const raw = String(b.phone ?? '').trim();
  if (!raw) { await env.DB.prepare('DELETE FROM hub_user_phones WHERE lower(email) = ?').bind(user.email.toLowerCase()).run(); return { ok: true, phone: '' }; }
  const phone = normPhone(raw);
  if (!phone) throw new HttpError(400, 'bad_phone', 'Type a mobile number, like 404 555 0100.');
  await env.DB.prepare('INSERT INTO hub_user_phones (email, phone, updated_at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET phone = excluded.phone, updated_at = excluded.updated_at').bind(user.email.toLowerCase(), phone, Date.now()).run();
  return { ok: true, phone: maskPhone(phone) };
}

/** Add one person to the meeting by name, email or phone. A phone with `for` set is that invitee's number for this meeting. */
async function addPerson(env: MeetEnv, m: Meeting, user: User, b: Record<string, unknown>, deps: SendDeps): Promise<string> {
  const t = parseTarget(String(b.to ?? ''));
  if (!t) throw new HttpError(400, 'bad_target', 'Type a Favor name, an email address or a phone number.');
  const list = parse<Array<{ email?: string; name?: string; team?: string; guest?: boolean }>>(m.invitees, []);
  const onList = (e: string) => e === m.host_email.toLowerCase() || list.some((i) => String(i.email || '').toLowerCase() === e);
  const join = async (email: string, name: string, team: string, guest: boolean) => {
    if (guest && !guestsOn(env)) throw new HttpError(400, 'guests_off', 'Guests are not switched on yet, so only Favor staff can be added.');
    if (onList(email)) return;
    if (list.length >= 200) throw new HttpError(400, 'too_many', 'This meeting has 200 people on it.');
    list.push({ email, name, team, guest });
    await env.DB.prepare('UPDATE hub_meetings SET invitees = ? WHERE id = ?').bind(JSON.stringify(list), m.id).run();
    m.invitees = JSON.stringify(list);
    if (m.calendar_event_id && !m.series_id && m.status === 'scheduled') await addAttendees(env, m.host_email, m.calendar_event_id, [email]);
  };
  if (t.kind === 'phone') {
    const forEmail = clean(b.for, 200).toLowerCase();
    if (forEmail && !onList(forEmail)) throw new HttpError(400, 'not_on', 'That person is not on this meeting.');
    if (!forEmail && !guestsOn(env)) throw new HttpError(400, 'guests_off', 'Guests are not switched on yet. Add Favor staff by name, then give them a number.');
    await env.DB.prepare('INSERT OR REPLACE INTO hub_meeting_phones (meeting_id, phone, email, name, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(m.id, t.phone, forEmail, clean(b.name, 80), user.email.toLowerCase(), Date.now()).run();
    return forEmail || t.phone;
  }
  const dir = await deps.people();
  if (t.kind === 'name') {
    const hit = matchPeople(dir, t.query);
    if (!hit.length) throw new HttpError(404, 'no_match', `No one named ${t.query.slice(0, 60)} is on the Favor list. Use an email address or a phone number.`);
    if (hit.length > 1 && hit[0].name.toLowerCase() !== t.query.toLowerCase()) throw Object.assign(new HttpError(409, 'pick', 'More than one person matches. Pick one.'), { matches: hit.slice(0, 6).map((p) => ({ name: p.name, email: p.email })) });
    await join(hit[0].email.toLowerCase(), hit[0].name, hit[0].team, false);
    return hit[0].email.toLowerCase();
  }
  const d = dir.find((p) => p.email.toLowerCase() === t.email);
  const staff = !!d || t.email.endsWith('@favorintl.org');
  await join(t.email, d?.name || clean(b.name, 80) || '', d?.team || '', !staff);
  return t.email;
}

export type SendResult = { key: string; name: string; channel: 'email' | 'text'; status: 'sent' | 'failed' | 'skipped' | 'dry'; detail: string };

/**
 * Send the link. Body: to (keys from the sheet, or "all"), via (["email","text"]), note (one line, shown above the Join button),
 * add (a name, email or phone to put on the meeting first), dry (check only, nothing sent).
 */
export async function sendLink(env: MeetEnv, user: User, id: string, b: Record<string, unknown>, origin: string, deps: SendDeps) {
  const m = await getMeeting(env, id);
  if (!mayJoin(m, user)) throw refuseJoin(m);
  if (m.status === 'ended' || m.status === 'cancelled') throw new HttpError(400, 'over', m.status === 'ended' ? 'This meeting is over.' : 'This meeting was cancelled.');
  const all = mayAll(m, user);
  const dry = b.dry === true;
  let addedKey = '';
  if (b.add != null && String((b.add as Record<string, unknown>).to ?? '').trim()) {
    if (!all) throw new HttpError(403, 'host_only', 'Only a host can add people.');
    try { addedKey = await addPerson(env, m, user, b.add as Record<string, unknown>, deps); }
    catch (e) { if ((e as { matches?: unknown }).matches) return { ok: false, matches: (e as { matches: unknown }).matches }; throw e; }
  }
  const via = new Set((Array.isArray(b.via) ? b.via : ['email']).map(String).filter((v) => v === 'email' || v === 'text'));
  if (!via.size) throw new HttpError(400, 'no_channel', 'Pick email, text or both.');
  const texts = await textsOn(env);
  const people = await recipients(env, m, user);
  // The sheet hides phone numbers, so a phone-only person comes back as tel:<last four>:<index>.
  const keyOf = (p: Recip, i: number) => (p.key.startsWith('+') ? `tel:${p.key.slice(-4)}:${i}` : p.key);
  const want = b.to === 'all' ? null : new Set((Array.isArray(b.to) ? b.to : []).map((x) => String(x).toLowerCase()));
  if (addedKey) (want || new Set()).add(addedKey.startsWith('+') ? keyOf(people.find((p) => p.key === addedKey) as Recip, people.findIndex((p) => p.key === addedKey)) : addedKey);
  let picked = people.filter((p, i) => (want ? want.has(keyOf(p, i).toLowerCase()) : !p.you));
  if (!all) picked = picked.filter((p) => p.you);
  if (!picked.length) throw new HttpError(400, 'nobody', all ? 'Pick at least one person.' : 'You can send the link only to yourself.');
  const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM hub_meeting_sends WHERE meeting_id = ? AND at > ?').bind(id, Date.now() - 86400_000).first<{ n: number }>().catch(() => ({ n: 0 }));
  if (!dry && (used?.n || 0) + picked.length * via.size > DAY_CAP) throw new HttpError(429, 'too_many', `This meeting has sent ${used?.n || 0} links today. The limit is ${DAY_CAP} a day.`);
  // One person's links across every meeting, so new meetings cannot be used to send without end.
  const mine = dry ? { n: 0 } : await env.DB.prepare('SELECT COUNT(*) AS n FROM hub_meeting_sends WHERE by_email = ? AND at > ?').bind(user.email.toLowerCase(), Date.now() - 86400_000).first<{ n: number }>().catch(() => ({ n: 0 }));
  if (!dry && (mine?.n || 0) + picked.length * via.size > SENDER_DAY_CAP) throw new HttpError(429, 'too_many', `You have sent ${mine?.n || 0} meeting links today. The limit is ${SENDER_DAY_CAP} a day.`);

  const note = clean(b.note, 200).replace(/\s+/g, ' ');
  const sender = user.name || user.email;
  const live = m.status === 'live';
  const room = `${origin}/meet/room/?m=${id}`;
  let guestLink = '';
  const linkFor = async (p: Recip) => (p.guest ? (guestLink ||= dry ? `${origin}/meet/g/?m=${id}&k=...` : await deps.guestUrl(m)) : room);
  const people0 = (parse<Array<{ email?: string; name?: string }>>(m.invitees, [])).filter((i) => String(i.email || '').toLowerCase() !== m.host_email.toLowerCase()).map((i) => String(i.name || i.email));
  const recent = new Set(
    ((await env.DB.prepare(`SELECT to_key, channel FROM hub_meeting_sends WHERE meeting_id = ? AND status = 'sent' AND at > ?`).bind(id, Date.now() - COOLDOWN_MS).all<{ to_key: string; channel: string }>().catch(() => ({ results: [] }))).results || []).map((r) => `${r.to_key}|${r.channel}`)
  );
  const results: SendResult[] = [];
  const log: D1PreparedStatement[] = [];
  for (const p of picked) {
    const link = p.why ? '' : await linkFor(p);
    for (const ch of via) {
      const r: SendResult = { key: keyOf(p, people.indexOf(p)), name: p.name, channel: ch as 'email' | 'text', status: 'skipped', detail: '' };
      results.push(r);
      if (p.why) { r.detail = p.why; continue; }
      // The QA test users send only to test accounts and Will, so a test never reaches real staff or partners.
      if (isTester(user.email) && !(isTester(p.email) || p.email === 'will@favorintl.org')) { r.detail = 'The test user sends only to test accounts.'; continue; }
      if (ch === 'email' && !p.email) { r.detail = 'No email address.'; continue; }
      if (ch === 'text' && !texts) { r.detail = 'Meeting texts are off.'; continue; }
      if (ch === 'text' && !p.phone) { r.detail = 'No mobile number.'; continue; }
      if (recent.has(`${p.key}|${ch}`)) { r.detail = 'Sent less than a minute ago.'; continue; }
      if (dry) { r.status = 'dry'; r.detail = 'Ready to send.'; continue; }
      if (ch === 'email') {
        const ok = await sendReminder(env, [p.email], {
          title: m.title, startsAt: live || !m.starts_at ? nowIso() : m.starts_at, endsAt: live ? null : m.ends_at, durationMin: m.duration_min, agenda: m.agenda,
          people: people0, hostEmail: m.host_email, roomUrl: link, backup: m.backup_link, rec: m.rec_mode, kind: live || !m.starts_at ? 'now' : 'link',
          host: m.host_name || m.host_email, note, sender,
        }).catch(() => false);
        r.status = ok ? 'sent' : 'failed'; r.detail = ok ? 'Email sent.' : 'The email did not go.';
      } else {
        const when = live ? 'live now' : m.starts_at ? `${fmtWhen(m.starts_at)} ET` : 'now';
        const text = `${note ? `${sender}: ${note}\n` : `${sender} sent you the link. `}${m.title}, ${when}. Join: ${link}`;
        const s = await textInvite(env, p.phone, p.name, text).catch((e) => ({ ok: false, reason: String(e && e.message || e), text }));
        r.status = s.ok ? 'sent' : 'failed'; r.detail = s.ok ? 'Text sent.' : s.reason || 'The text did not go.';
      }
      log.push(env.DB.prepare('INSERT INTO hub_meeting_sends (meeting_id, at, by_email, to_key, channel, status, detail) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, Date.now(), user.email.toLowerCase(), p.key, ch, r.status, r.detail));
    }
  }
  if (log.length) await env.DB.batch(log);
  const sent = results.filter((r) => r.status === 'sent').length;
  return { ok: true, sent, failed: results.filter((r) => r.status === 'failed').length, skipped: results.filter((r) => r.status === 'skipped').length, results };
}

/** The 15 minute reminder by text, for people with a mobile number, while Meeting texts is on. Called by the reminder pass. */
export async function textSoon(env: MeetEnv, m: Meeting, origin: string, deps: SendDeps): Promise<number> {
  if (!(await textsOn(env))) return 0;
  const people = (await recipients(env, m, { email: '', name: '', role: 'staff' })).filter((p) => p.phone && !p.why);
  let n = 0;
  for (const p of people) {
    const link = p.guest ? await deps.guestUrl(m) : `${origin}/meet/room/?m=${m.id}`;
    const s = await textInvite(env, p.phone, p.name, `${m.title} starts at ${new Date(m.starts_at as string).toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })} ET. Join: ${link}`).catch(() => ({ ok: false }));
    await env.DB.prepare('INSERT INTO hub_meeting_sends (meeting_id, at, by_email, to_key, channel, status, detail) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(m.id, Date.now(), 'reminder', p.key, 'text', s.ok ? 'sent' : 'failed', 'Reminder').run().catch(() => undefined);
    if (s.ok) n++;
  }
  return n;
}

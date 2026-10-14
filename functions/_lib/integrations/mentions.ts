// A partner mentioned around FavorOS, for the partner page's timeline: "Mentioned in ..." lines from tasks, requests and meeting notes
// (Chat mentions come from the timeline's own Chat pass), each shown only to a person who can open where it was said. A mention is
// not a contact and is never logged by itself: each line carries a prefilled "Add to contact log" (date, type, summary) that opens the
// partner page's Log a contact, the Work Center's Blackbaud queue. Meetings with the partner and emails sent to them are real
// contacts; they are offered for the log the same way and never logged without the person pressing Save.
import type { Env } from '../http';
import { isTester, TESTERS } from '../testuser';
import { visibleTask } from '../projects/access';
import { mayReadNotes, ledPeople } from '../meet';

const lower = (s: unknown) => String(s || '').trim().toLowerCase();
const oneLine = (s: unknown) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '...' : s);
const DAY = 864e5;

export interface LogPrefill {
  /** The partner page's contact kinds: Phone call, Email, Meeting, Mailing, Task/Other. */
  type: string;
  date: string;
  summary: string;
  /** The timeline event id, kept with the log so the line shows as added. */
  source: string;
}

export interface MentionEvent {
  id: string;
  kind: 'mention' | 'meeting' | 'chat';
  at: string;
  title: string;
  text: string;
  by: string;
  href?: string;
  log?: LogPrefill;
  logged?: boolean;
}

/** The kind of contact a mention most likely describes, from its words. A plain mention starts as a phone call, the composer's own default. */
export function guessType(text: string): string {
  const t = lower(text);
  if (/\b(emailed|email|wrote|sent (him|her|them) a note)\b/.test(t)) return 'Email';
  if (/\b(met|meeting|lunch|coffee|dinner|visit|visited|stopped by|saw)\b/.test(t)) return 'Meeting';
  if (/\b(mailed|letter|card|package)\b/.test(t)) return 'Mailing';
  return 'Phone call';
}

/** The date in Eastern time for a stored timestamp. */
const etDay = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }));

export function prefill(source: string, at: string, text: string, where: string): LogPrefill {
  const body = oneLine(text);
  return { type: guessType(body), date: etDay(at), summary: clip(body || where, 200), source };
}

/** The partner's name and record link as SQL LIKE patterns, plus the Chat token. A name of one word or under 8 letters is not searched (too many false matches). */
export function patterns(cid: string, name: string): { phrase: string; link: string; token: string } {
  const n = name.trim();
  const words = n.split(/\s+/).filter(Boolean);
  return { phrase: words.length >= 2 && n.length >= 8 ? `%${n.toLowerCase()}%` : '', link: `%/work/partner/${cid}%`, token: `%<~p:${cid}|%` };
}

/** Mentions in tasks (title, description, comments), requests (title, details, comments) and meeting notes, for this person. */
export async function mentionEvents(env: Env, emailRaw: string, cid: string, name: string): Promise<MentionEvent[]> {
  const me = lower(emailRaw);
  const p = patterns(cid, name);
  const out: MentionEvent[] = [];
  const role = (await env.DB.prepare('SELECT role FROM hub_users WHERE lower(email) = ?').bind(me).first<{ role: string }>().catch(() => null))?.role || 'staff';
  const admin = role === 'admin';
  const since = new Date(Date.now() - 365 * DAY).toISOString();
  const like = (col: string) => `(lower(${col}) LIKE ?2 OR lower(${col}) LIKE ?3${p.phrase ? ` OR lower(${col}) LIKE ?4` : ''})`;
  const args = (first: unknown) => (p.phrase ? [first, p.link, p.token.toLowerCase(), p.phrase] : [first, p.link, p.token.toLowerCase()]);
  const names = new Map<string, string>();
  const nameOf = async (e: string) => {
    const k = lower(e);
    if (!names.has(k)) names.set(k, (await env.DB.prepare('SELECT name FROM meet_directory WHERE lower(email) = ? UNION ALL SELECT name FROM hub_users WHERE lower(email) = ? LIMIT 1').bind(k, k).first<{ name: string }>().catch(() => null))?.name || k.split('@')[0]);
    return names.get(k) as string;
  };
  const jobs: Array<Promise<unknown>> = [];

  // Tasks this person can see.
  jobs.push(
    (async () => {
      const vt = visibleTask({ email: me, name: me, admin }, 't');
      // visibleTask's condition uses plain ? slots, so every value here is bound in order.
      const tasks = (await env.DB.prepare(
        `SELECT t.id, t.title, t.description, t.created_by, t.updated_at FROM hub_tasks t
          WHERE t.status <> 'dropped' AND t.updated_at > ? AND (lower(t.title) LIKE ? OR lower(t.description) LIKE ? OR lower(t.description) LIKE ?${p.phrase ? ' OR lower(t.title) LIKE ? OR lower(t.description) LIKE ?' : ''})
            AND ${vt.sql} ORDER BY t.updated_at DESC LIMIT 12`
      ).bind(since, p.link, p.link, p.token.toLowerCase(), ...(p.phrase ? [p.phrase, p.phrase] : []), ...vt.args).all<{ id: string; title: string; description: string; created_by: string; updated_at: string }>().catch(() => ({ results: [] as never[] }))).results || [];
      for (const t of tasks) {
        const id = `task:${t.id}`;
        const text = clip(oneLine(t.description) || t.title, 220);
        out.push({ id, kind: 'mention', at: t.updated_at, title: `Mentioned in a task: ${clip(t.title, 90)}`, text, by: await nameOf(t.created_by), href: `/projects/?t=${encodeURIComponent(t.id)}`, log: prefill(id, t.updated_at, text, t.title) });
      }
      const comments = (await env.DB.prepare(
        `SELECT c.id, c.task_id, c.body, c.author_email, c.created_at, t.title FROM hub_task_comments c JOIN hub_tasks t ON t.id = c.task_id
          WHERE c.deleted_at IS NULL AND c.created_at > ? AND (lower(c.body) LIKE ? OR lower(c.body) LIKE ?${p.phrase ? ' OR lower(c.body) LIKE ?' : ''}) AND ${vt.sql}
          ORDER BY c.created_at DESC LIMIT 12`
      ).bind(since, p.link, p.token.toLowerCase(), ...(p.phrase ? [p.phrase] : []), ...vt.args).all<{ id: string; task_id: string; body: string; author_email: string; created_at: string; title: string }>().catch(() => ({ results: [] as never[] }))).results || [];
      for (const c of comments) {
        const id = `taskc:${c.id}`;
        const text = clip(oneLine(String(c.body).replace(/<~[pf]:\d+\|([^>]+)>/g, '$1').replace(/<@([^>|]+)>/g, '@$1')), 220);
        out.push({ id, kind: 'mention', at: c.created_at, title: `Mentioned on a task: ${clip(c.title, 90)}`, text, by: await nameOf(c.author_email), href: `/projects/?t=${encodeURIComponent(c.task_id)}`, log: prefill(id, c.created_at, text, c.title) });
      }
    })().catch((e) => console.warn('[mentions] tasks', String(e).slice(0, 160)))
  );

  // Requests: the board is open to all staff; declined requests only to admins. Test accounts' requests are left out for real staff.
  jobs.push(
    (async () => {
      const declined = admin ? '' : " AND q.status != 'declined'";
      const rows = (await env.DB.prepare(
        `SELECT q.id, q.title, q.body, q.submitter_name, q.created_at FROM requests q
          WHERE q.created_at > ?1 AND (${like('q.title')} OR ${like('q.body')})${declined} ORDER BY q.created_at DESC LIMIT 8`
      ).bind(...args(since)).all<{ id: string; title: string; body: string; submitter_name: string; created_at: string }>().catch(() => ({ results: [] as never[] }))).results || [];
      for (const q of rows) {
        const id = `req:${q.id}`;
        const text = clip(oneLine(q.body) || q.title, 220);
        out.push({ id, kind: 'mention', at: q.created_at, title: `Mentioned in a request: ${clip(q.title, 90)}`, text, by: q.submitter_name || '', href: `/requests/?r=${encodeURIComponent(q.id)}`, log: prefill(id, q.created_at, text, q.title) });
      }
      const cm = (await env.DB.prepare(
        `SELECT c.id, c.request_id, c.body, c.name, c.created_at, q.title FROM request_comments c JOIN requests q ON q.id = c.request_id
          WHERE c.deleted_at IS NULL AND c.created_at > ?1 AND ${like('c.body')}${declined} ORDER BY c.created_at DESC LIMIT 8`
      ).bind(...args(since)).all<{ id: string; request_id: string; body: string; name: string; created_at: string; title: string }>().catch(() => ({ results: [] as never[] }))).results || [];
      for (const c of cm) {
        const id = `reqc:${c.id}`;
        const text = clip(oneLine(String(c.body).replace(/<@([^>|]+)>/g, '@$1')), 220);
        out.push({ id, kind: 'mention', at: c.created_at, title: `Mentioned on a request: ${clip(c.title, 90)}`, text, by: c.name || '', href: `/requests/?r=${encodeURIComponent(c.request_id)}`, log: prefill(id, c.created_at, text, c.title) });
      }
    })().catch((e) => console.warn('[mentions] requests', String(e).slice(0, 160)))
  );

  // Meeting notes this person may read (the notes page's own rule), when the name is in the summary or the notes.
  if (p.phrase) {
    jobs.push(
      (async () => {
        const rows = (await env.DB.prepare(
          `SELECT * FROM hub_meetings WHERE status = 'ended' AND COALESCE(ended_at, starts_at, created_at) > ?1 AND (lower(summary) LIKE ?2 OR lower(notes_json) LIKE ?2)
            ORDER BY COALESCE(ended_at, starts_at, created_at) DESC LIMIT 20`
        ).bind(since, p.phrase).all<Record<string, unknown>>().catch(() => ({ results: [] as never[] }))).results || [];
        if (!rows.length) return;
        const led = await ledPeople(env as never, me).catch(() => new Set<string>());
        for (const m of rows) {
          const present = !!(await env.DB.prepare(`SELECT 1 AS x FROM hub_meeting_presence WHERE meeting_id = ? AND lower(email) = ? AND role != 'guest' LIMIT 1`).bind(m.id, me).first().catch(() => null));
          if (!mayReadNotes(m as never, { email: me, role: role as never }, led, present)) continue;
          if (!isTester(me) && TESTERS.includes(lower(m.host_email))) continue;
          const at = String(m.ended_at || m.starts_at || m.created_at || '');
          const id = `notes:${m.id}`;
          const sentence = (String(m.summary || '').split(/(?<=[.!?])\s+/).find((s) => s.toLowerCase().includes(name.trim().toLowerCase())) || String(m.summary || '')).trim();
          out.push({ id, kind: 'mention', at, title: `Mentioned in meeting notes: ${clip(String(m.title || 'Meeting'), 80)}`, text: clip(oneLine(sentence), 220), by: String(m.host_name || ''), href: `/meet/library/?m=${encodeURIComponent(String(m.id))}`, log: { ...prefill(id, at, sentence, String(m.title || 'Meeting')), type: 'Meeting' } });
        }
      })().catch((e) => console.warn('[mentions] notes', String(e).slice(0, 160)))
    );
  }
  await Promise.all(jobs);
  return out.filter((e) => e.at);
}

/** Marks which of these timeline lines were already added to the contact log from the partner page. */
export async function markLogged(env: Env, cid: string, events: Array<{ id: string; log?: LogPrefill; logged?: boolean }>): Promise<void> {
  const ids = events.filter((e) => e.log).map((e) => e.id);
  if (!ids.length) return;
  const r = await env.DB.prepare('SELECT source FROM hub_mention_logs WHERE cid = ? AND source IN (SELECT value FROM json_each(?))').bind(cid, JSON.stringify(ids)).all<{ source: string }>().catch(() => ({ results: [] as Array<{ source: string }> }));
  const done = new Set((r.results || []).map((x) => x.source));
  for (const e of events) if (e.log && done.has(e.id)) e.logged = true;
}

/** The person pressed Save on a contact the timeline prefilled: the line shows as added from now on. */
export async function noteLogged(env: Env, email: string, cid: string, source: string): Promise<void> {
  if (!/^\d{1,12}$/.test(cid) || !/^[a-z]{2,8}:[A-Za-z0-9_.-]{1,80}$/.test(source)) return;
  await env.DB.prepare('INSERT OR IGNORE INTO hub_mention_logs (cid, source, by_email, at) VALUES (?, ?, ?, ?)').bind(cid, source, lower(email), new Date().toISOString()).run();
}

/**
 * From this person's own Gmail (never anyone else's): emails exchanged with the partner, which are real contacts and are offered for
 * the log, and emails that name the partner, which are mentions. Read when the partner page asks, apart from the timeline, so the
 * page never waits on Gmail. Mail's own "logged" mark (hub_mail_logged) counts as already added.
 */
export async function mailEvents(env: Env, user: import('../session').HubUser, cid: string, fetcher: typeof fetch = fetch): Promise<{ events: MentionEvent[]; connected: boolean }> {
  if (!/^\d{1,12}$/.test(cid)) return { events: [], connected: false };
  const { mailboxOf } = await import('./mailbox');
  const box = await mailboxOf(env, user, fetcher);
  if (!box) return { events: [], connected: false };
  const { mirrorQ } = await import('../work/partner');
  const q = mirrorQ(env);
  const tester = isTester(user.email);
  const [emailRows, nameRows] = await Promise.all([
    tester ? Promise.resolve([] as Array<{ e: unknown }>) : (q(`SELECT lower(email_address) AS e FROM emails WHERE constituent_record_id = ?1 AND COALESCE(is_inactive, 0) = 0 LIMIT 6`, [cid]).catch(() => []) as Promise<Array<{ e: unknown }>>),
    q(`SELECT COALESCE(json_extract(raw_json, '$.name'), trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))) AS name FROM constituents WHERE id = ?1`, [cid]).catch(() => []) as Promise<Array<{ name: unknown }>>,
  ]);
  let emails = emailRows.map((r) => lower(r.e)).filter((e) => /^[^\s@]+@[^\s@]+$/.test(e));
  // The test accounts' sample mailbox carries made-up partner addresses.
  if (tester) emails = (await import('../mail/sample')).SAMPLE_PARTNER_EMAILS.slice(0, 1).map(lower);
  const name = oneLine(nameRows[0]?.name);
  const { idsFor, rowsFor } = await import('../mail/rows');
  const out: MentionEvent[] = [];
  const me = lower(user.email);
  if (emails.length) {
    const who = emails.map((e) => `"${e}"`).join(' OR ');
    // The test accounts' stored sample mailbox reads only simple searches, one address at a time.
    const queries = tester ? emails.flatMap((e) => [`from:${e}`, `to:${e}`]) : [`{from:(${who}) to:(${who})} newer_than:365d -in:chats -in:drafts`];
    const found = await Promise.all(queries.map((qq) => idsFor(box.gm, { q: qq }, 12).catch(() => ({ threads: [] as Array<{ id: string; historyId?: string }>, more: false }))));
    const seen = new Set<string>();
    const threads = found.flatMap((f) => f.threads).filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true))).slice(0, 12);
    const rows = await rowsFor(box.gm, me, threads, 6).catch(() => []);
    for (const r of rows) {
      const id = `mail:${r.id}`;
      const at = new Date(r.date).toISOString();
      const mine = r.fromMe;
      out.push({ id, kind: 'mention', at, title: mine ? `You emailed them: ${clip(r.subject || '(no subject)', 90)}` : `They emailed you: ${clip(r.subject || '(no subject)', 90)}`, text: clip(oneLine(r.snippet), 220), by: mine ? 'You' : name, href: `/mail/#/ALL/${encodeURIComponent(r.id)}`, log: { type: 'Email', date: etDay(at), summary: clip(`Email: ${r.subject || '(no subject)'}`, 200), source: id } });
    }
  }
  if (!tester && name && name.split(/\s+/).length >= 2 && name.length >= 8) {
    const not = emails.length ? ` -from:(${emails.join(' OR ')}) -to:(${emails.join(' OR ')})` : '';
    const list = await idsFor(box.gm, { q: `"${name.replace(/"/g, '')}"${not} newer_than:180d -in:chats -in:drafts` }, 8).catch(() => ({ threads: [] as Array<{ id: string; historyId?: string }>, more: false }));
    const rows = await rowsFor(box.gm, me, list.threads, 6).catch(() => []);
    for (const r of rows) {
      const id = `mailm:${r.id}`;
      const at = new Date(r.date).toISOString();
      out.push({ id, kind: 'mention', at, title: `Mentioned in an email: ${clip(r.subject || '(no subject)', 90)}`, text: clip(oneLine(r.snippet), 220), by: r.from?.name || r.from?.email || '', href: `/mail/#/ALL/${encodeURIComponent(r.id)}`, log: prefill(id, at, r.snippet, r.subject || 'Email') });
    }
  }
  await markLogged(env, cid, out).catch(() => undefined);
  // Mail's own Log as an action marks the conversation; that counts as added too.
  const ids = out.map((e) => e.id.split(':')[1]);
  if (ids.length) {
    const r = await env.DB.prepare('SELECT thread_id FROM hub_mail_logged WHERE email = ? AND thread_id IN (SELECT value FROM json_each(?))').bind(me, JSON.stringify(ids)).all<{ thread_id: string }>().catch(() => ({ results: [] as Array<{ thread_id: string }> }));
    const done = new Set((r.results || []).map((x) => x.thread_id));
    for (const e of out) if (done.has(e.id.split(':')[1])) e.logged = true;
  }
  return { events: out, connected: true };
}

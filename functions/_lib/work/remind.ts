// Reminders for due items: the bell in the header, Remind me on a task, Left a message, Plan calls. They live in the hub's own
// database (act_reminders). Blackbaud's reminder fields are unused, so nothing here goes to Blackbaud.
import { HttpError, newId, nowIso, type Env } from '../http';
import { etInstant, etParts } from '../actions/intake';

export type Later = 'hour' | 'afternoon' | 'tomorrow' | 'nextweek';
export const LATERS: Later[] = ['hour', 'afternoon', 'tomorrow', 'nextweek'];
export const KINDS = ['task', 'gift', 'partner', 'plan_call', 'message', 'cadence'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** The next weekday after today (tomorrow, or Monday from Friday through Sunday). */
export function nextWorkday(today: string): string {
  let d = addDays(today, 1);
  while ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) d = addDays(d, 1);
  return d;
}

/** When a Later choice or a picked date and time falls due. The clock is Eastern whatever the daylight saving offset is. */
export function dueFor(when: { code?: string; date?: string; time?: string }, now = new Date()): string {
  const e = etParts(now);
  if (when.code === 'hour') return new Date(now.getTime() + 3600000).toISOString();
  if (when.code === 'afternoon') {
    const t = etInstant(e.date, 14, 0);
    return (t.getTime() > now.getTime() + 15 * 60000 ? t : new Date(now.getTime() + 2 * 3600000)).toISOString();
  }
  if (when.code === 'tomorrow') return etInstant(nextWorkday(e.date), 9, 0).toISOString();
  if (when.code === 'nextweek') {
    let d = addDays(e.date, 1);
    while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1);
    return etInstant(d, 9, 0).toISOString();
  }
  if (when.date) {
    if (!DATE.test(when.date) || when.date < addDays(e.date, -1) || when.date > addDays(e.date, 800)) throw new HttpError(400, 'bad_date', 'Pick a real day from today on.');
    const m = TIME.exec(when.time || '09:00');
    if (!m) throw new HttpError(400, 'bad_time', 'Pick a real time.');
    return etInstant(when.date, Number(m[1]), Number(m[2])).toISOString();
  }
  throw new HttpError(400, 'bad_when', 'Pick when to be reminded.');
}

export interface ReminderRow {
  id: string;
  owner: string;
  kind: string;
  ref_id: string | null;
  cid: string | null;
  title: string;
  note: string | null;
  due_at: string;
  state: string;
  snoozed_until: string | null;
  source: string;
  created_at: string;
  done_at: string | null;
}

export interface ReminderInput {
  kind: string;
  ref_id?: string | null;
  cid?: string | null;
  title: string;
  note?: string | null;
  due_at: string;
  source?: string;
}

const clip = (s: unknown, n: number) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const IDN = /^\d{1,12}$/;

export function checkInput(i: Partial<ReminderInput>): ReminderInput {
  const kind = String(i.kind || 'task');
  if (!(KINDS as readonly string[]).includes(kind)) throw new HttpError(400, 'bad_kind', 'That is not a kind of reminder.');
  const title = clip(i.title, 160);
  if (!title) throw new HttpError(400, 'missing_field', 'Say what the reminder is for.');
  const ref = i.ref_id ? String(i.ref_id) : null;
  const cid = i.cid ? String(i.cid) : null;
  if (ref && !/^[A-Za-z0-9_-]{1,40}$/.test(ref)) throw new HttpError(400, 'bad_ref', 'That reminder points at something the hub does not know.');
  if (cid && !IDN.test(cid)) throw new HttpError(400, 'bad_partner', 'That partner number is not valid.');
  if (!i.due_at || Number.isNaN(Date.parse(i.due_at))) throw new HttpError(400, 'bad_when', 'Pick when to be reminded.');
  return { kind, ref_id: ref, cid, title, note: i.note ? clip(i.note, 200) : null, due_at: new Date(i.due_at).toISOString(), source: ['manual', 'plan_calls', 'message'].includes(String(i.source)) ? String(i.source) : 'manual' };
}

export async function addReminders(env: Env, owner: string, items: ReminderInput[]): Promise<string[]> {
  const ids: string[] = [];
  const stmts = items.map((i) => {
    const id = newId('wcr');
    ids.push(id);
    return env.DB.prepare('INSERT INTO act_reminders (id, owner, kind, ref_id, cid, title, note, due_at, state, source, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(
      id, owner.toLowerCase(), i.kind, i.ref_id ?? null, i.cid ?? null, i.title, i.note ?? null, i.due_at, 'open', i.source || 'manual', nowIso()
    );
  });
  for (let k = 0; k < stmts.length; k += 50) await env.DB.batch(stmts.slice(k, k + 50));
  return ids;
}

/** A person's open reminders, soonest first, with the bucket each falls in (now, today, tomorrow, later) by Eastern day. */
export async function listReminders(env: Env, owner: string, now = new Date()) {
  // A Plan calls reminder points at the batch that made the task (ref_id), so undoing the batch drops the reminder with it.
  const r = await env.DB.prepare(
    `SELECT r.* FROM act_reminders r WHERE r.owner = ? AND r.state = 'open'
       AND NOT (r.kind = 'plan_call' AND r.ref_id IS NOT NULL AND EXISTS (SELECT 1 FROM act_batches b WHERE b.id = r.ref_id AND b.state = 'undone'))
     ORDER BY COALESCE(r.snoozed_until, r.due_at) LIMIT 200`
  )
    .bind(owner.toLowerCase())
    .all<ReminderRow>();
  const today = etParts(now).date;
  const tomorrow = nextWorkday(today);
  const rows = r.results.map((x) => {
    const at = x.snoozed_until || x.due_at;
    const day = etParts(new Date(at)).date;
    const bucket = Date.parse(at) <= now.getTime() ? 'now' : day === today ? 'today' : day <= tomorrow ? 'tomorrow' : 'later';
    return { id: x.id, kind: x.kind, ref_id: x.ref_id, cid: x.cid, title: x.title, note: x.note, at, bucket, source: x.source };
  });
  return { rows, count: rows.filter((x) => x.bucket === 'now' || x.bucket === 'today').length, now: rows.filter((x) => x.bucket === 'now').length };
}

export async function finishReminder(env: Env, owner: string, id: string): Promise<boolean> {
  const out = await env.DB.prepare(`UPDATE act_reminders SET state = 'done', done_at = ? WHERE id = ? AND owner = ? AND state = 'open'`).bind(nowIso(), id, owner.toLowerCase()).run();
  return (out.meta?.changes ?? 0) > 0;
}

export async function laterReminder(env: Env, owner: string, id: string, at: string): Promise<boolean> {
  const out = await env.DB.prepare(`UPDATE act_reminders SET snoozed_until = ? WHERE id = ? AND owner = ? AND state = 'open'`).bind(at, id, owner.toLowerCase()).run();
  return (out.meta?.changes ?? 0) > 0;
}

/** Done reminders older than a month are dropped, so the table stays small. */
export async function trimReminders(env: Env): Promise<void> {
  const cut = new Date(Date.now() - 31 * 86400000).toISOString();
  await env.DB.prepare(`DELETE FROM act_reminders WHERE state = 'done' AND done_at < ?`).bind(cut).run();
}

// The health strip on Admin > Overview. Eight checks, each answering with a last run time and ok, late or failed ("unknown" when the
// place that holds the answer did not reply). Every probe reads only. The Blackbaud mirror answers the first four and iWave, the hub's
// own database answers the sender, the two extra D1 bindings answer the Drive job and the unsubscribe write-back, and the upkeep
// route's KV counter answers the call meter.
import type { Env } from '../http';
import { mirror } from '../foundations/blackbaud';
import { getSetting } from '../work/db';
import type { EnvPlus } from './settings';

export type Status = 'ok' | 'late' | 'failed' | 'unknown';

export interface Part {
  label: string;
  at: string | null;
  status: Status;
}

export interface Item {
  id: string;
  label: string;
  status: Status;
  /** ISO time of the last run, or null. */
  at: string | null;
  /** One short line of fact. */
  detail: string;
  parts?: Part[];
  /** The run time is known only to the day (the Drive job keeps a count a day). */
  dayOnly?: boolean;
  /** For a meter: how much and out of how much. */
  meter?: { used: number; of: number; share?: number; shareLabel?: string };
  link?: string;
}

type Ext = EnvPlus & { DRIVE_DB?: D1Database; MARKETING_DB?: D1Database };

const HOUR = 3600_000;
const ago = (iso: string | null, now: number): number | null => {
  if (!iso) return null;
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso.replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? now - t : null;
};
const iso = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : v.replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** The weekday morning the jobs last had to run by: 6:30 AM Eastern is about 10:30 UTC. Saturday and Sunday look back to Friday. */
export function lastDueMorning(now: number): number {
  const d = new Date(now);
  let day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 11, 0, 0);
  if (day > now) day -= 24 * HOUR;
  for (let i = 0; i < 4; i++) {
    const wd = new Date(day).getUTCDay();
    if (wd !== 0 && wd !== 6) break;
    day -= 24 * HOUR;
  }
  return day;
}

function grade(age: number | null, okMs: number, lateMs: number): Status {
  if (age === null) return 'unknown';
  return age <= okMs ? 'ok' : age <= lateMs ? 'late' : 'failed';
}

const worst = (list: Status[]): Status => (list.includes('failed') ? 'failed' : list.includes('late') ? 'late' : list.includes('unknown') && !list.includes('ok') ? 'unknown' : list.includes('unknown') ? 'late' : 'ok');

const first = async (env: Env, sql: string): Promise<Record<string, any> | null> => {
  const rows = await mirror(env, sql);
  return rows[0] || null;
};

async function copyProbe(env: Env, now: number): Promise<Item> {
  const row = await first(env, "SELECT MAX(run_at) AS at FROM sync_log WHERE table_name = '__complete__' AND sync_status = 'success'");
  const at = iso(row?.at);
  const age = ago(at, now);
  return { id: 'copy', label: 'Blackbaud copy', status: grade(age, 14 * HOUR, 26 * HOUR), at, detail: at ? 'Last complete sync' : 'No complete sync on record' };
}

async function morningProbe(env: Env, now: number): Promise<Item> {
  const due = lastDueMorning(now);
  const [docket, gift, review, credit] = await Promise.all([
    first(env, 'SELECT ran_at AS at, status AS st FROM dp_docket_runs ORDER BY ran_at DESC LIMIT 1'),
    first(env, 'SELECT finished_at AS at FROM gift_phase_runs ORDER BY started_at DESC LIMIT 1'),
    first(env, 'SELECT finished_at AS at FROM rnc_runs ORDER BY started_at DESC LIMIT 1'),
    first(env, 'SELECT at AS at, status AS st, note AS note FROM gift_phase_web_runs ORDER BY at DESC LIMIT 1'),
  ]);
  const one = (label: string, row: Record<string, any> | null, bad?: (s: string) => boolean): Part => {
    const at = iso(row?.at);
    if (!at) return { label, at: null, status: 'unknown' };
    const st = String(row?.st || '').toLowerCase();
    if (bad && bad(st)) return { label, at, status: 'failed' };
    const t = Date.parse(at);
    return { label, at, status: t >= due - 4 * HOUR ? 'ok' : t >= due - 28 * HOUR ? 'late' : 'failed' };
  };
  const parts = [
    one('Assignments', docket, (s) => /fail|error/.test(s)),
    one('Gift phase', gift),
    one('Record review', review),
    one('Credit', credit, (s) => /sign-in|fail|error/.test(s) || /sign-in needed/i.test(String(credit?.note || ''))),
  ];
  const times = parts.map((p) => p.at).filter((x): x is string => !!x).sort();
  return { id: 'morning', label: 'Morning jobs', status: worst(parts.map((p) => p.status)), at: times[0] || null, detail: 'Oldest of the four last runs', parts };
}

async function senderProbe(env: Env, now: number): Promise<Item> {
  const line = async (key: string) => {
    const raw = await getSetting(env, key, '');
    const [state, at, ...rest] = raw.split('|');
    return { state: state || '', at: iso(at), text: rest.join('|') };
  };
  const [called, last, waiting] = await Promise.all([
    line('drain:called'),
    line('drain:last'),
    env.DB.prepare("SELECT COUNT(*) AS n, MIN(queued_at) AS oldest FROM act_outbox WHERE state IN ('queued','sending')").first<{ n: number; oldest: string | null }>(),
  ]);
  const at = called.at;
  const n = Number(waiting?.n) || 0;
  const oldestAge = ago(waiting?.oldest ?? null, now);
  let status = grade(ago(at, now), 26 * HOUR, 50 * HOUR);
  if (/^err/i.test(called.state) || /^err/i.test(last.state)) status = 'failed';
  if (n > 0 && oldestAge !== null && oldestAge > 36 * HOUR && status === 'ok') status = 'late';
  const detail = n ? `${n} change${n === 1 ? '' : 's'} waiting` : last.text ? `Last pass: ${last.text}` : 'Nothing waiting';
  return { id: 'sender', label: 'Overnight sender', status, at, detail };
}

async function driveProbe(env: Ext, now: number): Promise<Item> {
  if (!env.DRIVE_DB) return { id: 'drive', label: 'Drive library job', status: 'unknown', at: null, detail: 'The library database is not connected' };
  const use = await env.DRIVE_DB.prepare('SELECT MAX(day) AS day FROM drive_usage').first<{ day: string | null }>();
  const done = await env.DRIVE_DB.prepare("SELECT v FROM drive_state WHERE k = 'enum_done' LIMIT 1").first<{ v: string }>().catch(() => null);
  const day = use?.day || null;
  const at = day ? day + 'T12:00:00.000Z' : null;
  const age = day ? now - Date.parse(day + 'T00:00:00Z') : null;
  return { id: 'drive', label: 'Drive library job', status: grade(age, 36 * HOUR, 4 * 24 * HOUR), at, dayOnly: true, detail: done?.v ? `Last full read ${done.v.slice(0, 10)}` : 'Last day with activity' };
}

async function skyProbe(env: Ext, now: number): Promise<Item> {
  const day = new Date(now).toISOString().slice(0, 10);
  const kv = env.BB_KV;
  if (!kv) return { id: 'sky', label: 'SKY calls today', status: 'unknown', at: null, detail: 'The call counter is not connected', meter: { used: 0, of: 25000 } };
  const [raw, capRaw, stop] = await Promise.all([kv.get(`bb:ops:count:${day}`), kv.get('bb:ops:cap'), kv.get('bb:ops:quota_stop')]);
  const used = Number(raw) || 0;
  const cap = Number(capRaw) || 3000;
  const pct = used / cap;
  const status: Status = stop ? 'failed' : pct >= 0.95 ? 'failed' : pct >= 0.8 ? 'late' : 'ok';
  const detail = stop ? 'Blackbaud stopped the key for today' : `Upkeep route used ${used.toLocaleString('en-US')} of its ${cap.toLocaleString('en-US')}`;
  return { id: 'sky', label: 'SKY calls today', status, at: new Date(now).toISOString(), detail, meter: { used, of: 25000, share: used, shareLabel: `Upkeep ${used.toLocaleString('en-US')} of ${cap.toLocaleString('en-US')}` } };
}

async function iwaveProbe(env: Env, now: number): Promise<Item> {
  const [st, floor] = await Promise.all([first(env, "SELECT value_json AS v, read_at AS at FROM iwave_status WHERE k = 'standing'"), first(env, "SELECT value AS v FROM dp_settings WHERE name = 'iwave_credit_floor'")]);
  let balance: number | null = null;
  try {
    balance = st?.v ? Number(JSON.parse(String(st.v)).balance) : null;
  } catch {
    balance = null;
  }
  const at = iso(st?.at);
  const fl = Number(floor?.v) || 100;
  if (balance === null || !Number.isFinite(balance)) return { id: 'iwave', label: 'iWave credits', status: 'unknown', at, detail: 'The balance has not been read' };
  const status: Status = balance <= fl ? 'failed' : balance <= fl * 3 ? 'late' : 'ok';
  return { id: 'iwave', label: 'iWave credits', status, at, detail: `${balance.toLocaleString('en-US')} credits left, floor ${fl}` };
}

async function aiProbe(env: Env, now: number): Promise<Item> {
  const day = new Date(now).toISOString().slice(0, 10);
  const rows = await env.DB.prepare('SELECT day, calls FROM hub_ai_use WHERE day >= ? ORDER BY day DESC').bind(new Date(now - 2 * 24 * HOUR).toISOString().slice(0, 10)).all<{ day: string; calls: number }>();
  const today = (rows.results || []).find((r) => r.day === day);
  const yday = (rows.results || []).find((r) => r.day !== day);
  const n = Number(today?.calls) || 0;
  return { id: 'ai', label: 'Workers AI', status: 'ok', at: n ? new Date(now).toISOString() : null, detail: `${n.toLocaleString('en-US')} calls today${yday ? `, ${Number(yday.calls).toLocaleString('en-US')} yesterday` : ''}` };
}

async function unsubProbe(env: Ext, now: number): Promise<Item> {
  if (!env.MARKETING_DB) return { id: 'unsub', label: 'Unsubscribe write-back', status: 'unknown', at: null, detail: 'The marketing database is not connected' };
  const [p, l] = await Promise.all([
    env.MARKETING_DB.prepare('SELECT COUNT(*) AS n, MIN(unsubscribed_at) AS oldest FROM consent WHERE email_subscribed = 0 AND bb_synced = 0').first<{ n: number; oldest: string | null }>(),
    env.MARKETING_DB.prepare('SELECT MAX(updated_at) AS at FROM consent WHERE bb_synced = 1').first<{ at: string | null }>(),
  ]);
  const n = Number(p?.n) || 0;
  const age = ago(p?.oldest ?? null, now);
  const status: Status = n === 0 ? 'ok' : age !== null && age > 72 * HOUR ? 'failed' : age !== null && age > 24 * HOUR ? 'late' : 'ok';
  return { id: 'unsub', label: 'Unsubscribe write-back', status, at: iso(l?.at), detail: n ? `${n} pending` : 'None pending' };
}

/** Runs every probe, each on its own, so one dead source never blanks the strip. */
export async function healthStrip(env: Env, nowMs = Date.now()): Promise<Item[]> {
  const probes: Array<[string, string, () => Promise<Item>]> = [
    ['copy', 'Blackbaud copy', () => copyProbe(env, nowMs)],
    ['morning', 'Morning jobs', () => morningProbe(env, nowMs)],
    ['sender', 'Overnight sender', () => senderProbe(env, nowMs)],
    ['drive', 'Drive library job', () => driveProbe(env as Ext, nowMs)],
    ['sky', 'SKY calls today', () => skyProbe(env as Ext, nowMs)],
    ['iwave', 'iWave credits', () => iwaveProbe(env, nowMs)],
    ['ai', 'Workers AI', () => aiProbe(env, nowMs)],
    ['unsub', 'Unsubscribe write-back', () => unsubProbe(env as Ext, nowMs)],
  ];
  return Promise.all(
    probes.map(async ([id, label, run]) => {
      try {
        return await run();
      } catch {
        return { id, label, status: 'unknown' as Status, at: null, detail: 'This check did not answer' };
      }
    })
  );
}

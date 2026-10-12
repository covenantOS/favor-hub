// Practice mode: one invented partner record where a new person enters a gift and logs a call. The entries are saved to the
// practice_entries table in the hub's own database and nowhere else. This file never imports the Work Center, the Blackbaud
// client or the outbox, so a practice entry cannot reach a real record.
import { HttpError, newId, nowIso, type Env } from '../http';

type Db = Pick<Env, 'DB'>;
const lower = (s: unknown) => String(s || '').trim().toLowerCase();
const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const ET = 'America/New_York';
export const todayEt = (now = new Date()) => now.toLocaleDateString('en-CA', { timeZone: ET });
const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T12:00:00Z'));

export const PARTNER = {
  id: 'PRACTICE-0001',
  name: 'Pat Sample',
  household: 'Pat and Robin Sample',
  salutation: 'Pat and Robin',
  address: '100 Example Street, Exampleville, ST 00000',
  phone: '(000) 555-0100',
  email: 'pat.sample@example.invalid',
  since: '2023-04-10',
  history: [
    { date: '2026-08-14', amount: 50, fund: 'Wells', type: 'One-time gift' },
    { date: '2026-03-09', amount: 50, fund: 'Wells', type: 'One-time gift' },
    { date: '2025-11-20', amount: 100, fund: 'Where Needed Most', type: 'One-time gift' },
    { date: '2025-04-02', amount: 25, fund: 'Greatest Need', type: 'One-time gift' },
  ],
  notes: [
    { date: '2026-08-15', text: 'Thanked by phone. Asked about the next well project in Chad.' },
    { date: '2025-11-21', text: 'Mailed the year-end receipt. Prefers paper receipts.' },
  ],
};

/** Fund and appeal names are Favor's real ones (the gift entry catalog, active records, 2026-10-12). The partner is made up. */
export const FUNDS = ['Where Needed Most', 'Wells', 'Greatest Need', 'Sponsorship', 'Education', 'Bibles', 'SS Wells', 'UG wells'];
export const APPEALS = ['L26A-AD', 'L26A-WS', 'L269-AD', 'L268-AD', 'M268-SGA1', 'N200-UNID'];
/** The form's own choices, in Blackbaud's words. */
export const GIFT_TYPES = ['One-time gift', 'Recurring gift'];
export const PAYMENT_METHODS = ['Cash', 'Check', 'Credit card', 'Direct debit', 'Other', 'PayPal', 'Venmo'];
/** The Work Center's Log a contact kinds: the stored value and the button label. */
export const CONTACT_KINDS: Array<[string, string]> = [['Phone call', 'Call'], ['Email', 'Email'], ['Meeting', 'Meeting'], ['Mailing', 'Mailing'], ['Task/Other', 'Task']];
export const CONTACT_TAGS = ['Thanked', 'Stewardship', 'Scheduling'];

export const SCENARIOS = {
  gift: {
    title: 'Add a gift',
    story: 'A check came in the mail from Pat and Robin Sample, in the reply envelope for the October 2026 appeal (L26A-AD). It is for $75.00, check number 2041, dated today, and the memo line says "wells". Press Add gift on the record and fill in the form.',
    steps: ['Enter the amount and the gift date.', 'Leave the gift type as One-time gift and set the payment method to Check.', 'Enter the check number and the check date.', 'Pick the appeal and the fund the memo names.'],
  },
  call: {
    title: 'Log a contact',
    story: "Pat called. Pat and Robin plan to give again in November and asked for a copy of last year's receipt. Press Log a contact, then Add a task so the receipt does not get lost.",
    steps: ['Log a contact: pick Call, write what happened and set the date.', 'Add a task: pick Task, write what to do and set when it is due, within two weeks.'],
  },
};

export interface Check { label: string; ok: boolean; hint: string }

/** MM/DD/YYYY (what Blackbaud's form takes) or YYYY-MM-DD to YYYY-MM-DD; '' when it is not a date. */
export function toIsoDate(raw: string): string {
  const t = raw.trim();
  let y = '', m = '', d = '';
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (us) [, m, d, y] = us;
  else if (iso) [, y, m, d] = iso;
  else return '';
  const out = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return isDate(out) && new Date(out + 'T12:00:00Z').getUTCDate() === Number(d) ? out : '';
}

export function checkGift(b: Record<string, unknown>, now = new Date()) {
  const f = {
    amount: clip(b.amount, 14).replace(/[$,\s]/g, ''),
    date: toIsoDate(clip(b.date, 10)),
    type: clip(b.type, 20),
    method: clip(b.method, 20),
    check: clip(b.check, 20),
    checkDate: toIsoDate(clip(b.checkDate, 10)),
    appeal: clip(b.appeal, 30),
    fund: clip(b.fund, 60),
  };
  const today = todayEt(now);
  const amt = Number(f.amount);
  const checks: Check[] = [
    { label: 'Amount', ok: f.amount !== '' && Number.isFinite(amt) && Math.abs(amt - 75) < 0.005, hint: 'The amount is what is written on the check, $75.00.' },
    {
      label: 'Gift date',
      ok: f.date !== '' && f.date <= today && f.date >= addDays(today, -30),
      hint: !f.date ? 'Use the format MM/DD/YYYY.' : f.date > today ? 'A gift cannot be dated in the future.' : "The check arrived today, so use today's date.",
    },
    { label: 'Gift type', ok: f.type === 'One-time gift', hint: 'One check is a one-time gift.' },
    { label: 'Payment method', ok: f.method === 'Check', hint: 'This gift came by check.' },
    { label: 'Check number', ok: f.check === '2041', hint: 'The check number is printed in the top right corner of the check, 2041.' },
    { label: 'Check date', ok: f.checkDate !== '' && f.checkDate === today, hint: f.checkDate ? 'The check is dated today.' : 'Use the format MM/DD/YYYY.' },
    { label: 'Appeal', ok: f.appeal === 'L26A-AD', hint: 'The reply envelope is for the October 2026 appeal, L26A-AD.' },
    { label: 'Fund', ok: f.fund === 'Wells', hint: 'The memo says "wells", which is the Wells fund.' },
  ];
  return { fields: f, checks, ok: checks.every((c) => c.ok) };
}

export function checkContact(b: Record<string, unknown>, now = new Date()) {
  const tags = (Array.isArray(b.tags) ? b.tags : []).map((t) => clip(t, 20)).filter((t) => CONTACT_TAGS.includes(t));
  const f = { kind: clip(b.kind, 20), what: clip(b.what, 255), date: toIsoDate(clip(b.date, 10)), tags: tags.join(', ') };
  const today = todayEt(now);
  const checks: Check[] = [
    { label: 'Kind', ok: f.kind === 'Phone call', hint: 'Pat called, so pick Call.' },
    { label: 'What happened', ok: f.what.length >= 20, hint: 'Say what happened so the next person knows without asking you, in a sentence.' },
    { label: 'Date', ok: f.date !== '' && f.date <= today && f.date >= addDays(today, -7), hint: 'Pat called today.' },
  ];
  return { fields: f, checks, ok: checks.every((c) => c.ok) };
}

export function checkTask(b: Record<string, unknown>, now = new Date()) {
  const f = { kind: clip(b.kind, 20), what: clip(b.what, 255), due: toIsoDate(clip(b.due, 10)) };
  const today = todayEt(now);
  const checks: Check[] = [
    { label: 'Kind', ok: f.kind === 'Task/Other', hint: 'This is a to-do, so pick Task.' },
    { label: 'What to do', ok: /receipt/i.test(f.what), hint: "Pat asked for last year's receipt, so the task is to send it." },
    { label: 'Due', ok: f.due !== '' && f.due >= today && f.due <= addDays(today, 14), hint: 'Set a date within the next two weeks.' },
  ];
  return { fields: f, checks, ok: checks.every((c) => c.ok) };
}

const KINDS = { gift: checkGift, call: checkContact, task: checkTask } as const;
export type Kind = keyof typeof KINDS;

interface Row { id: string; kind: string; data: string; ok: number; created_at: string }

async function entries(env: Db, email: string) {
  const r = await env.DB.prepare('SELECT id, kind, data, ok, created_at FROM practice_entries WHERE email = ? ORDER BY created_at DESC LIMIT 60').bind(lower(email)).all<Row>();
  return (r.results || []).map((x) => ({ id: x.id, kind: x.kind as Kind, fields: JSON.parse(x.data || '{}') as Record<string, string>, ok: !!x.ok, at: x.created_at }));
}

export async function practiceState(env: Db, email: string) {
  let list: Awaited<ReturnType<typeof entries>> = [];
  let ready = true;
  try {
    list = await entries(env, email);
  } catch {
    ready = false;
  }
  const done = { gift: list.some((e) => e.kind === 'gift' && e.ok), call: list.some((e) => e.kind === 'call' && e.ok), task: list.some((e) => e.kind === 'task' && e.ok) };
  return {
    ready,
    partner: PARTNER,
    funds: FUNDS,
    appeals: APPEALS.map((c) => ({ code: c })),
    giftTypes: GIFT_TYPES,
    methods: PAYMENT_METHODS,
    kinds: CONTACT_KINDS,
    tags: CONTACT_TAGS,
    scenarios: SCENARIOS,
    entries: list.slice(0, 20),
    done: { ...done, all: done.gift && done.call && done.task },
  };
}

export async function savePractice(env: Db, email: string, kind: Kind, body: Record<string, unknown>, now = new Date()) {
  const res = KINDS[kind](body, now);
  const mine = await env.DB.prepare('SELECT COUNT(*) AS n FROM practice_entries WHERE email = ?').bind(lower(email)).first<{ n: number }>().catch(() => null);
  if ((Number(mine?.n) || 0) >= 200) throw new HttpError(429, 'practice_full', 'Reset the practice record to start fresh.');
  try {
    await env.DB.prepare('INSERT INTO practice_entries (id, email, kind, data, ok, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(newId('prc'), lower(email), kind, JSON.stringify(res.fields), res.ok ? 1 : 0, nowIso()).run();
  } catch {
    throw new HttpError(503, 'practice_off', 'Practice mode is not switched on yet.');
  }
  return { checks: res.checks, passed: res.ok, state: await practiceState(env, email) };
}

export async function resetPractice(env: Db, email: string) {
  await env.DB.prepare('DELETE FROM practice_entries WHERE email = ?').bind(lower(email)).run().catch(() => null);
  return practiceState(env, email);
}

export async function practiceDone(env: Db, email: string): Promise<boolean> {
  try {
    return (await practiceState(env, email)).done.all;
  } catch {
    return false;
  }
}

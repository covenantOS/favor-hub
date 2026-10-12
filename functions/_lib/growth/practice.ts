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
    { date: '2026-08-14', amount: 50, fund: 'Water and Sanitation', type: 'Card' },
    { date: '2026-03-09', amount: 50, fund: 'Water and Sanitation', type: 'Card' },
    { date: '2025-11-20', amount: 100, fund: 'Where Most Needed', type: 'Check' },
    { date: '2025-04-02', amount: 25, fund: 'Child Sponsorship', type: 'Card' },
  ],
  notes: [
    { date: '2026-08-15', text: 'Thanked by phone. Asked about the next well project in Chad.' },
    { date: '2025-11-21', text: 'Mailed the year-end receipt. Prefers paper receipts.' },
  ],
};

export const FUNDS = ['Where Most Needed', 'Water and Sanitation', 'Child Sponsorship', 'Church Planting', 'Emergency Relief'];
export const GIFT_TYPES = ['Cash', 'Check', 'Card', 'Stock', 'Other'];
export const CHANNELS = ['Phone call', 'Voicemail', 'Email', 'Meeting', 'Letter'];
export const NEXT_STEPS = ['Nothing more', 'Send a receipt', 'Send a thank-you', 'Call again', 'Send information'];

export const SCENARIOS = {
  gift: {
    title: 'Enter a gift',
    story: 'A check came in the mail from Pat and Robin Sample. It is for $75.00, check number 2041, and the memo line says "wells". It arrived today.',
    steps: ['Pick the date the gift came in.', 'Enter the amount exactly as written on the check.', 'Pick the type, then the check number.', 'Pick the fund the memo names.'],
  },
  call: {
    title: 'Log a call',
    story: "Pat called. Pat and Robin plan to give again in November and asked for a copy of last year's receipt. Log the call and set the next step.",
    steps: ['Pick how you were in contact.', 'Write what was said in a sentence or two.', 'Pick the next step and the date it is due.'],
  },
};

export interface Check { label: string; ok: boolean; hint: string }

export function checkGift(b: Record<string, unknown>, now = new Date()): { fields: Record<string, string>; checks: Check[]; ok: boolean } {
  const f = { date: clip(b.date, 10), amount: clip(b.amount, 14).replace(/[$,\s]/g, ''), type: clip(b.type, 20), check: clip(b.check, 20), fund: clip(b.fund, 60) };
  const today = todayEt(now);
  const amt = Number(f.amount);
  const checks: Check[] = [
    {
      label: 'Date',
      ok: isDate(f.date) && f.date <= today && f.date >= addDays(today, -30),
      hint: !isDate(f.date) ? 'Pick the date.' : f.date > today ? 'A gift cannot be dated in the future.' : "The check arrived today, so use today's date.",
    },
    { label: 'Amount', ok: f.amount !== '' && Number.isFinite(amt) && Math.abs(amt - 75) < 0.005, hint: 'The amount is what is written on the check, $75.00.' },
    { label: 'Type', ok: f.type === 'Check', hint: 'This gift came by check.' },
    { label: 'Check number', ok: f.check === '2041', hint: 'The check number is printed in the top right corner of the check, 2041.' },
    { label: 'Fund', ok: f.fund === 'Water and Sanitation', hint: 'The memo says "wells", which is the Water and Sanitation fund.' },
  ];
  return { fields: f, checks, ok: checks.every((c) => c.ok) };
}

export function checkCall(b: Record<string, unknown>, now = new Date()): { fields: Record<string, string>; checks: Check[]; ok: boolean } {
  const f = { channel: clip(b.channel, 20), summary: clip(b.summary, 600), next: clip(b.next, 30), due: clip(b.due, 10) };
  const today = todayEt(now);
  const checks: Check[] = [
    { label: 'Contact type', ok: f.channel === 'Phone call', hint: 'Pat called, so this is a phone call.' },
    { label: 'Summary', ok: f.summary.length >= 25, hint: 'Write what was said so the next person knows without asking you, at least a sentence.' },
    { label: 'Next step', ok: f.next === 'Send a receipt', hint: "Pat asked for last year's receipt, so the next step is to send a receipt." },
    { label: 'Due date', ok: isDate(f.due) && f.due >= today && f.due <= addDays(today, 30), hint: 'Set the date you will send it, within the next 30 days.' },
  ];
  return { fields: f, checks, ok: checks.every((c) => c.ok) };
}

interface Row { id: string; kind: string; data: string; ok: number; created_at: string }

async function entries(env: Db, email: string) {
  const r = await env.DB.prepare('SELECT id, kind, data, ok, created_at FROM practice_entries WHERE email = ? ORDER BY created_at DESC LIMIT 60').bind(lower(email)).all<Row>();
  return (r.results || []).map((x) => ({ id: x.id, kind: x.kind as 'gift' | 'call', fields: JSON.parse(x.data || '{}') as Record<string, string>, ok: !!x.ok, at: x.created_at }));
}

export async function practiceState(env: Db, email: string) {
  let list: Awaited<ReturnType<typeof entries>> = [];
  let ready = true;
  try {
    list = await entries(env, email);
  } catch {
    ready = false;
  }
  const done = { gift: list.some((e) => e.kind === 'gift' && e.ok), call: list.some((e) => e.kind === 'call' && e.ok) };
  return {
    ready,
    partner: PARTNER,
    funds: FUNDS,
    giftTypes: GIFT_TYPES,
    channels: CHANNELS,
    nextSteps: NEXT_STEPS,
    scenarios: SCENARIOS,
    entries: list.slice(0, 20),
    done: { ...done, all: done.gift && done.call },
  };
}

export async function savePractice(env: Db, email: string, kind: 'gift' | 'call', body: Record<string, unknown>, now = new Date()) {
  const res = kind === 'gift' ? checkGift(body, now) : checkCall(body, now);
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

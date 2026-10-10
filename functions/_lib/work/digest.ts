// The morning email: what a person has due, built from the same lists the Work Center shows. Settings are per person
// (act_mail_prefs). Who gets it, and from which day, is the rollout setting an admin changes in the Work Center.
// Nothing here is sent from a test: a dry run goes to an admin address only, and a send to staff happens only through run().
import { nowIso, type Env } from '../http';
import { etParts } from '../actions/intake';
import { blackbaudRepo } from './repo';
import { getSetting, listStaff, logEvent, setSetting, type StaffRow } from './db';
import { loadPortfolio, type PortfolioRow } from './portfolio';
import { mirrorQ } from './partner';
import { listReminders } from './remind';
import { scopeFor } from './role';
import { currentBoard, type Ctx } from './service';

export const SECTION_KEYS = ['gifts', 'due', 'sent_back', 'quiet', 'reminders'] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export const SECTION_LABEL: Record<SectionKey, string> = {
  gifts: 'Gifts to thank',
  due: 'Due today and late',
  sent_back: 'Sent back by Support',
  quiet: 'Quiet partners, top 3',
  reminders: 'Reminders',
};

export interface Prefs {
  sections: Record<SectionKey, boolean>;
  send_time: '7:30' | '8:00' | 'off';
  skip_empty: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  sections: { gifts: true, due: true, sent_back: true, quiet: true, reminders: true },
  send_time: '7:30',
  skip_empty: true,
};

export async function getPrefs(env: Env, owner: string): Promise<Prefs> {
  const r = await env.DB.prepare('SELECT sections, send_time, skip_empty FROM act_mail_prefs WHERE owner = ?').bind(owner.toLowerCase()).first<{ sections: string; send_time: string; skip_empty: number }>().catch(() => null);
  if (!r) return { ...DEFAULT_PREFS, sections: { ...DEFAULT_PREFS.sections } };
  let s: Record<string, unknown> = {};
  try {
    s = JSON.parse(r.sections);
  } catch {
    s = {};
  }
  const sections = { ...DEFAULT_PREFS.sections };
  for (const k of SECTION_KEYS) if (k in s) sections[k] = !!s[k];
  return { sections, send_time: r.send_time === '8:00' ? '8:00' : r.send_time === 'off' ? 'off' : '7:30', skip_empty: r.skip_empty !== 0 };
}

export async function savePrefs(env: Env, owner: string, p: Partial<Prefs>): Promise<Prefs> {
  const cur = await getPrefs(env, owner);
  const next: Prefs = {
    sections: { ...cur.sections },
    send_time: p.send_time === '8:00' || p.send_time === 'off' || p.send_time === '7:30' ? p.send_time : cur.send_time,
    skip_empty: p.skip_empty === undefined ? cur.skip_empty : !!p.skip_empty,
  };
  if (p.sections) for (const k of SECTION_KEYS) if (k in p.sections) next.sections[k] = !!p.sections[k];
  await env.DB.prepare(
    `INSERT INTO act_mail_prefs (owner, sections, send_time, skip_empty, updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT(owner) DO UPDATE SET sections = excluded.sections, send_time = excluded.send_time, skip_empty = excluded.skip_empty, updated_at = excluded.updated_at`
  )
    .bind(owner.toLowerCase(), JSON.stringify(next.sections), next.send_time, next.skip_empty ? 1 : 0, nowIso())
    .run();
  return next;
}

/* ------------------------------------------------------------------ the rollout: who gets it, and from which day */

export const GROUPS: { key: string; label: string; teams: string[] }[] = [
  { key: 'rdd', label: 'Regional directors', teams: ['rdd'] },
  { key: 'support', label: 'Support Team', teams: ['support'] },
  { key: 'partner_care', label: 'Partner Care', teams: ['partner_care'] },
  { key: 'church', label: 'Church engagement and executives', teams: ['church', 'exec'] },
  { key: 'grants', label: 'Grants writers', teams: ['grants'] },
];

/** The first day each group gets the email, or null while it is off. */
export type Rollout = Record<string, string | null>;

/**
 * Regional directors start Monday 2026-10-12. Support and Partner Care start a week later, 2026-10-19. The rest stay off until an
 * admin sets a day. An admin changes any of these in Work Center settings (act_settings digest_rollout).
 */
export const DEFAULT_ROLLOUT: Rollout = { rdd: '2026-10-12', support: '2026-10-19', partner_care: '2026-10-19', church: null, grants: null };

export async function getRollout(env: Env): Promise<Rollout> {
  const raw = await getSetting(env, 'digest_rollout', '').catch(() => '');
  let saved: Record<string, unknown> = {};
  try {
    saved = raw ? JSON.parse(raw) : {};
  } catch {
    saved = {};
  }
  const out: Rollout = { ...DEFAULT_ROLLOUT };
  for (const g of GROUPS) if (g.key in saved) out[g.key] = typeof saved[g.key] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(String(saved[g.key])) ? String(saved[g.key]) : null;
  return out;
}

export async function setRollout(env: Env, patch: Rollout): Promise<Rollout> {
  const cur = await getRollout(env);
  for (const g of GROUPS) if (g.key in patch) cur[g.key] = patch[g.key] && /^\d{4}-\d{2}-\d{2}$/.test(String(patch[g.key])) ? String(patch[g.key]) : null;
  await setSetting(env, 'digest_rollout', JSON.stringify(cur));
  return cur;
}

export const groupOf = (team: string): string | null => GROUPS.find((g) => g.teams.includes(team))?.key ?? null;
export const groupIsLive = (r: Rollout, group: string | null, today: string): boolean => !!group && !!r[group] && String(r[group]) <= today;

/* ------------------------------------------------------------------ what goes in it */

export interface DigestData {
  today: string;
  board: Awaited<ReturnType<typeof currentBoard>>;
  portfolios: Map<string, PortfolioRow[]>;
}

const sysCtx = (env: Env): Ctx => ({ env, repo: blackbaudRepo(env), actor: 'Morning email', email: 'morning-email@favorintl.org' });

export async function gather(env: Env, people: StaffRow[], now = new Date()): Promise<DigestData> {
  const today = etParts(now).date;
  const board = await currentBoard(sysCtx(env));
  const portfolios = new Map<string, PortfolioRow[]>();
  const q = mirrorQ(env);
  for (const p of people) {
    const fid = p.bb_fundraiser_id ? String(p.bb_fundraiser_id) : '';
    if (!fid || !['rdd', 'church', 'exec'].includes(p.team) || portfolios.has(fid)) continue;
    portfolios.set(fid, (await loadPortfolio(q, fid, today)).rows);
  }
  return { today, board, portfolios };
}

export interface Line {
  text: string;
  amount?: string;
  late?: string;
  link: string;
  verb: string;
}

export interface Built {
  subject: string;
  html: string;
  text: string;
  empty: boolean;
  counts: { gifts: number; due: number; late: number; sent_back: number; quiet: number; reminders: number };
}

const BASE = 'https://dash.favorintl.org';
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const short = (v: number) => (v >= 1e6 ? '$' + (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : v >= 1000 ? '$' + (v / 1000).toFixed(v < 1e5 ? 1 : 0).replace(/\.0$/, '') + 'K' : money(v));
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const plural = (n: number, one: string, many?: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many || one + 's'}`;
const dayWord = (n: number) => (n === 1 ? '1 day' : `${n} days`);
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Build one person's email from the gathered data. Pure: no network. */
export async function buildFor(env: Env, person: StaffRow, data: DigestData, prefs: Prefs, now = new Date()): Promise<Built> {
  const { today, board, portfolios } = data;
  const fid = person.bb_fundraiser_id ? String(person.bb_fundraiser_id) : '';
  const scope = await scopeFor(env, person.email, false);
  const fids = scope ? scope.fids : new Set<string>(fid ? [fid] : []);
  const mine = (r: { fundraisers: string[]; holders: string[] }) => r.fundraisers.some((f) => fids.has(f)) || r.holders.some((f) => fids.has(f));
  const own = (r: { fundraisers: string[] }) => !!fid && r.fundraisers.includes(fid);

  // Gifts to thank: open thank-you tasks, the largest gift first.
  const owed = board.rows.filter((r) => r.ty && mine(r) && !r.later && !r.deceased).sort((a, b) => (b.gift?.amount || 0) - (a.gift?.amount || 0));
  const gifts: Line[] = owed.slice(0, 5).map((r) => {
    const age = r.gift ? days(r.gift.date, today) : 0;
    return { text: r.partner, amount: r.gift ? money(r.gift.amount) : undefined, late: age >= 2 ? dayWord(age) : undefined, link: `${BASE}/work/partner/${r.cid}`, verb: 'Thank' };
  });

  // Due today and late: the person's own actions, thank-you tasks left to the list above.
  const dueRows = board.rows.filter((r) => !r.ty && own(r) && r.due <= today && !r.deceased).sort((a, b) => (a.due < b.due ? -1 : 1));
  const dueToday = dueRows.filter((r) => r.due === today).length;
  const lateN = dueRows.length - dueToday;
  const due: Line[] = dueRows.slice(0, 5).map((r) => {
    const n = days(r.due, today);
    return { text: r.summary ? `${r.summary}${r.partner ? ` (${r.partner})` : ''}` : r.partner, late: n > 0 ? `${dayWord(n)} late` : undefined, link: `${BASE}/work/?action=${r.id}`, verb: 'Open' };
  });

  // Sent back by Support (Entry submissions a director logged and Support returned). Empty until directors log their own contacts.
  const sent: Line[] = [];
  let sentN = 0;
  if (fid) {
    const r = await env.DB.prepare(`SELECT * FROM act_submissions WHERE source = 'rdd' AND state = 'sent_back' AND owner_fid = ? ORDER BY created_at DESC LIMIT 20`).bind(fid).all<Record<string, any>>().catch(() => ({ results: [] as Record<string, any>[] }));
    sentN = r.results.length;
    for (const s of r.results.slice(0, 3)) sent.push({ text: String(s.sent_back_note || s.summary || 'A contact Support sent back').slice(0, 140), link: `${BASE}/work/?view=contacts`, verb: 'Fix' });
  }

  // Quiet partners: the three the person has gone longest without, by giving. Directors only.
  const pf = portfolios.get(fid) || [];
  const quietAll = pf.filter((r) => r.quiet === null || r.quiet >= 90).sort((a, b) => b.l12 - a.l12);
  const quiet: Line[] = quietAll.slice(0, 3).map((r) => ({
    text: `${r.name}, ${short(r.l12)} a year${r.quiet === null ? ', no contact on record' : `, ${dayWord(r.quiet)} quiet`}`,
    link: `${BASE}/work/?view=mine`,
    verb: 'Plan a call',
  }));

  const rem = await listReminders(env, person.email, now);
  const remDue = rem.rows.filter((x) => x.bucket === 'now' || x.bucket === 'today');
  const reminders: Line[] = remDue.slice(0, 4).map((x) => ({ text: x.title, link: x.cid ? `${BASE}/work/partner/${x.cid}` : `${BASE}/work/`, verb: 'Open' }));

  const S = prefs.sections;
  const counts = { gifts: owed.length, due: dueToday, late: lateN, sent_back: sentN, quiet: quietAll.length, reminders: remDue.length };
  const shown = {
    gifts: S.gifts ? owed.length : 0,
    due: S.due ? dueRows.length : 0,
    sent_back: S.sent_back ? sentN : 0,
    quiet: S.quiet ? quietAll.length : 0,
    reminders: S.reminders ? remDue.length : 0,
  };
  // Something is due when a section other than quiet partners has lines. Quiet partners are a nudge, not a due item.
  const empty = shown.gifts + shown.due + shown.sent_back + shown.reminders === 0;

  const bits: string[] = [];
  if (shown.gifts) bits.push(`${plural(counts.gifts, 'gift')} to thank`);
  if (S.due && dueToday) bits.push(`${dueToday} due today`);
  if (S.due && lateN) bits.push(`${lateN} late`);
  if (shown.sent_back) bits.push(`${sentN} sent back`);
  if (shown.reminders) bits.push(plural(remDue.length, 'reminder'));
  const subject = bits.length ? bits.join(', ') : shown.quiet ? `${plural(counts.quiet, 'quiet partner')} to call` : 'Nothing due this morning';

  const first = (person.name || '').split(/\s+/)[0] || 'there';
  const weekday = WEEKDAY[etParts(now).dow];
  const sections: { title: string; n: number; lines: Line[]; more?: string }[] = [];
  if (S.gifts && gifts.length) sections.push({ title: 'Gifts to thank', n: counts.gifts, lines: gifts, more: counts.gifts > gifts.length ? `${counts.gifts - gifts.length} more in the Work Center` : undefined });
  if (S.due && due.length) sections.push({ title: 'Due today and late', n: dueRows.length, lines: due, more: dueRows.length > due.length ? `${dueRows.length - due.length} more in the Work Center` : undefined });
  if (S.sent_back && sent.length) sections.push({ title: 'Sent back by Support', n: sentN, lines: sent });
  if (S.quiet && quiet.length) sections.push({ title: 'Quiet the longest, by giving', n: counts.quiet, lines: quiet });
  if (S.reminders && reminders.length) sections.push({ title: 'Reminders', n: remDue.length, lines: reminders });

  const body = sections
    .map(
      (s) => `<div style="border-top:1px solid #e4dfd2;padding:16px 0 4px">
        <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7b8470;font-weight:600;margin:0 0 6px">${esc(s.title)} &middot; ${s.n}</div>
        ${s.lines
          .map(
            (l) => `<table role="presentation" width="100%" style="border-collapse:collapse"><tr>
            <td style="padding:7px 0;border-bottom:1px solid #f0ece1;font-size:14.5px;color:#1c1d1a;line-height:1.4"><b style="font-weight:600">${esc(l.text)}</b>${l.amount ? `, ${esc(l.amount)}` : ''}${l.late ? ` <span style="color:#a8441f;font-weight:600">${esc(l.late)}</span>` : ''}</td>
            <td style="padding:7px 0 7px 12px;border-bottom:1px solid #f0ece1;text-align:right;white-space:nowrap"><a href="${l.link}" style="color:#2f5d2c;font-weight:700;font-size:14px;text-decoration:none">${esc(l.verb)}</a></td></tr></table>`
          )
          .join('')}
        ${s.more ? `<p style="margin:8px 0 0;font-size:13px;color:#7b8470">${esc(s.more)}</p>` : ''}
      </div>`
    )
    .join('');

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f1eee5;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;padding:20px 12px">
    <div style="max-width:560px;margin:0 auto;background:#fffdf8;border-radius:14px;padding:26px 26px 22px">
      <img src="${BASE}/images/favor-logo-color.png" alt="Favor International" width="120" style="display:block;margin:0 0 18px;height:auto" />
      <h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:25px;line-height:1.2;color:#1c1d1a;margin:0 0 4px">Good morning, ${esc(first)}.</h1>
      <p style="margin:0 0 16px;font-size:15px;color:#3c3d37">Here is your ${weekday}.</p>
      ${body || `<div style="border-top:1px solid #e4dfd2;padding:16px 0"><p style="margin:0;font-size:14.5px;color:#3c3d37">Nothing is due this morning.</p></div>`}
      <p style="margin:18px 0 6px"><a href="${BASE}/work/" style="display:inline-block;background:#2f5d2c;color:#fffdf8;text-decoration:none;font-weight:700;font-size:14.5px;padding:12px 22px;border-radius:999px">Open the Work Center</a></p>
    </div>
    <p style="max-width:560px;margin:12px auto 0;text-align:center;font-size:12px;color:#7b8470">Favor International &middot; <a href="${BASE}/work/?morning=1" style="color:#7b8470">Change this email</a></p>
  </body></html>`;

  const text = [
    `Good morning, ${first}.`,
    `Here is your ${weekday}.`,
    '',
    ...sections.flatMap((s) => [`${s.title.toUpperCase()} (${s.n})`, ...s.lines.map((l) => `- ${l.text}${l.amount ? ', ' + l.amount : ''}${l.late ? ' ' + l.late : ''}: ${l.link}`), ...(s.more ? [s.more] : []), '']),
    sections.length ? '' : 'Nothing is due this morning.',
    `Open the Work Center: ${BASE}/work/`,
    `Change this email: ${BASE}/work/?morning=1`,
  ].join('\n');

  return { subject, html, text, empty, counts };
}

/* ------------------------------------------------------------------ sending */

async function resend(env: Env, to: string[], subject: string, html: string, text: string): Promise<{ ok: boolean; detail: string }> {
  const key = env.RESEND_API_KEY;
  if (!key) return { ok: false, detail: 'RESEND_API_KEY is not set' };
  const from = env.RESEND_FROM || 'Favor International <noreply@mail.favorintl.org>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html, text }),
  });
  const out = await res.text();
  return { ok: res.ok, detail: res.ok ? out.slice(0, 80) : `${res.status} ${out.slice(0, 160)}` };
}

/** Addresses a dry run may go to. Never a staff member. */
export function adminAddresses(env: Env): string[] {
  return (env.HUB_ADMINS || 'will@favorintl.org').split(',').map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z0-9._-]+@favorintl\.org$/.test(s));
}

/**
 * A dry run: the email as this person would get it, sent to an admin address with the person's name in the subject.
 * Only an admin address can be the recipient, so a test never reaches staff.
 */
export async function dryRun(env: Env, asEmail: string, to: string, now = new Date()): Promise<{ ok: boolean; subject: string; detail: string; to: string; empty: boolean }> {
  const admins = adminAddresses(env);
  if (!admins.includes(to.toLowerCase())) throw new Error('A dry run goes to an admin address only.');
  const staff = await listStaff(env);
  const person = staff.find((s) => s.email === asEmail.toLowerCase());
  if (!person) throw new Error('No one on the staff list has that address.');
  const data = await gather(env, [person], now);
  const prefs = await getPrefs(env, person.email);
  const b = await buildFor(env, person, data, prefs, now);
  const subject = `[Dry run for ${person.name}] ${b.subject}`;
  const sent = await resend(env, [to.toLowerCase()], subject, b.html, b.text);
  return { ok: sent.ok, subject, detail: sent.detail, to, empty: b.empty };
}

/** A person's own test: the email to themselves, never to anyone else. */
export async function selfTest(env: Env, person: StaffRow, now = new Date()): Promise<{ ok: boolean; subject: string; detail: string }> {
  const data = await gather(env, [person], now);
  const prefs = await getPrefs(env, person.email);
  const b = await buildFor(env, person, data, prefs, now);
  const subject = `[Test] ${b.subject}`;
  const sent = await resend(env, [person.email], subject, b.html, b.text);
  return { ok: sent.ok, subject, detail: sent.detail };
}

export interface RunResult {
  day: string;
  sent: number;
  skipped: number;
  failed: number;
  waiting: number;
  notes: string[];
}

/**
 * The scheduled run. For each person in a group the rollout has switched on, who wants it at the time now, and has not had it
 * today: build it and send it. The once-a-day lock is a row in act_digest_log taken before the send, so a retry or a second cron
 * never sends twice. Nothing goes out before the person's time (7:30 or 8:00 Eastern) or after 10:30 AM, and never on a weekend.
 */
export async function run(env: Env, now = new Date()): Promise<RunResult> {
  const e = etParts(now);
  const out: RunResult = { day: e.date, sent: 0, skipped: 0, failed: 0, waiting: 0, notes: [] };
  if (e.dow === 0 || e.dow === 6) {
    out.notes.push('weekend');
    return out;
  }
  const minutes = e.hour * 60 + e.minute;
  if (minutes > 10 * 60 + 30) {
    out.notes.push('after 10:30 AM');
    return out;
  }
  const rollout = await getRollout(env);
  const staff = (await listStaff(env)).filter((s) => s.active === 1 && s.work_center === 1 && /@favorintl\.org$/.test(s.email));
  const due: { p: StaffRow; prefs: Prefs }[] = [];
  for (const p of staff) {
    const g = groupOf(p.team);
    if (!groupIsLive(rollout, g, e.date)) continue;
    const prefs = await getPrefs(env, p.email);
    if (prefs.send_time === 'off') continue;
    const at = prefs.send_time === '8:00' ? 8 * 60 : 7 * 60 + 30;
    if (minutes < at) {
      out.waiting++;
      continue;
    }
    due.push({ p, prefs });
  }
  if (!due.length) return out;
  const data = await gather(env, due.map((x) => x.p), now);
  for (const { p, prefs } of due) {
    const lock = await env.DB.prepare(`INSERT INTO act_digest_log (owner, day, state, at) VALUES (?, ?, 'sending', ?)
       ON CONFLICT(owner, day) DO UPDATE SET state = 'sending', at = excluded.at WHERE act_digest_log.state = 'failed' AND COALESCE(act_digest_log.detail, '') NOT LIKE 'err:%'`).bind(p.email, e.date, nowIso()).run();
    if ((lock.meta?.changes ?? 0) === 0) {
      out.skipped++;
      continue;
    }
    try {
      const b = await buildFor(env, p, data, prefs, now);
      if (b.empty && prefs.skip_empty) {
        await env.DB.prepare(`UPDATE act_digest_log SET state = 'skipped', subject = ?, n = 0, detail = 'nothing due' WHERE owner = ? AND day = ?`).bind(b.subject, p.email, e.date).run();
        out.skipped++;
        continue;
      }
      const sent = await resend(env, [p.email], b.subject, b.html, b.text);
      await env.DB.prepare(`UPDATE act_digest_log SET state = ?, subject = ?, n = ?, detail = ?, at = ? WHERE owner = ? AND day = ?`)
        .bind(sent.ok ? 'sent' : 'failed', b.subject, b.counts.gifts + b.counts.due + b.counts.late + b.counts.reminders, sent.detail, nowIso(), p.email, e.date)
        .run();
      await logEvent(env, { actor: 'Morning email', actor_email: 'morning-email@favorintl.org', kind: sent.ok ? 'digest_sent' : 'digest_failed', detail: `${p.email} ${b.subject}`.slice(0, 200), ok: sent.ok });
      if (sent.ok) out.sent++;
      else out.failed++;
    } catch (err) {
      // A thrown error may have come after the mail left, so it is never retried (the double-send lock). A refusal from the mail service is.
      await env.DB.prepare(`UPDATE act_digest_log SET state = 'failed', detail = ?, at = ? WHERE owner = ? AND day = ?`).bind('err:' + String((err as Error).message || err).slice(0, 200), nowIso(), p.email, e.date).run();
      out.failed++;
    }
  }
  return out;
}


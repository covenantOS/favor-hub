// Giving statements, start to finish: a single statement for one partner, and the January year-end run from the
// annual tax receipt lists. Reads the Blackbaud copy, builds print files, records who was issued, ties every total.
import { mirror } from '../foundations/blackbaud';
import { HttpError, newId, type Env } from '../http';
import { saToken } from '../work/sheetsa';
import taxDef from '../reports/defs/tax';
import { compare, kpiFigures, noTie, round2 } from '../reports/tieout';
import type { ReportContext, Row, TieOut } from '../reports/types';
import { fill, type StatementCopy } from './copy';
import { loadGifts, loadPartners, type Sql } from './data';
import { buildPdf } from './pdf';
import { composeStatement, dollars, LEFT_TEXT, periodLabel, rangeOf, type Statement } from './rules';
import {
  batchSize, driveFolder, dropLock, emailOn, getBatch, getCopy, issuedFor, logEvent, openYearEnd, recentBatches, saveBatch, summary, takeLock,
  type BatchRow, type PartnerEntry,
} from './store';

export const LISTS = ['mail', 'email', 'other'] as const;
export type ListKey = (typeof LISTS)[number];

export const mirrorSql = (env: Env): Sql => ((sql: string, params?: unknown[]) => mirror(env, sql, params ?? [])) as Sql;

export const todayEastern = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/* ---------------------------------------------------------------- assets */

async function asset(env: Env, path: string): Promise<Uint8Array | null> {
  try {
    const res = await env.ASSETS.fetch(new Request(`https://hub.local${path}`));
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

export async function pdfAssets(env: Env): Promise<{ fonts: { sans: Uint8Array }; logo?: Uint8Array }> {
  const sans = await asset(env, '/receipts/fonts/Arimo-Regular.ttf');
  if (!sans) throw new HttpError(500, 'asset', 'A font the statements need is missing from FavorOS.');
  const logo = await asset(env, '/images/favor-logo-color.png');
  return { fonts: { sans }, logo: logo || undefined };
}

/* ------------------------------------------------------------- the page's view */

export interface LineJson {
  gift: string;
  date: string;
  amount: number;
  kind: string;
  fund: string;
  flags: string[];
  from?: string;
}

export function statementJson(st: Statement): Record<string, unknown> {
  const lines = (l: Statement['gifts']): LineJson[] => l.map((x) => ({ gift: x.lookup, date: x.date, amount: dollars(x.cents), kind: x.kind, fund: x.fund, flags: x.flags, from: x.from }));
  return {
    partner: { id: st.partner.id, lookup: st.partner.lookup, name: st.partner.addressee, address: [...st.partner.addressLines, [st.partner.city, st.partner.state, st.partner.zip].filter(Boolean).join(' ')].filter(Boolean), email: st.partner.email },
    from: st.from,
    to: st.to,
    period: periodLabel(st.from, st.to),
    gifts: lines(st.gifts),
    notDeductible: lines(st.notDeductible),
    soft: lines(st.soft),
    refunds: lines(st.refunds),
    left: st.left.map((l) => ({ gift: l.lookup, date: l.date, amount: dollars(l.cents), reason: l.reason, why: LEFT_TEXT[l.reason] })),
    totals: {
      gifts: dollars(st.totals.gifts),
      giftCount: st.totals.giftCount,
      notDeductible: dollars(st.totals.notDeductible),
      soft: dollars(st.totals.soft),
      refunds: dollars(st.totals.refunds),
      net: dollars(st.totals.net),
      taxBasis: dollars(st.totals.taxBasis),
    },
    byFund: st.byFund.map((f) => ({ fund: f.fund, amount: dollars(f.cents) })),
    notes: st.notes,
  };
}

/* ------------------------------------------------------------ one partner */

export interface AskOne {
  cid: string;
  year: string;
  from: string;
  to: string;
  includeSoft: boolean;
}

export async function statementFor(sql: Sql, ask: AskOne): Promise<Statement> {
  if (!/^\d{1,12}$/.test(ask.cid)) throw new HttpError(400, 'bad_partner', 'Pick a partner first.');
  let range: { from: string; to: string };
  try {
    range = rangeOf(ask.year, ask.from, ask.to);
  } catch (err) {
    throw new HttpError(400, 'bad_dates', (err as Error).message);
  }
  const partners = await loadPartners(sql, [ask.cid]);
  const partner = partners.get(ask.cid);
  if (!partner) throw new HttpError(404, 'no_partner', 'That partner is not in the Blackbaud copy.');
  const { gifts, names } = await loadGifts(sql, [ask.cid], range.from, range.to);
  return composeStatement(partner, gifts, range.from, range.to, names, { includeSoft: ask.includeSoft });
}

export async function makeSingle(env: Env, sql: Sql, actor: string, ask: AskOne): Promise<{ batch: BatchRow; statement: Statement }> {
  const st = await statementFor(sql, ask);
  const copy = await getCopy(env);
  const pdf = await buildPdf({ statements: [st], copy, yearEnd: false, issued: todayEastern(), ...(await pdfAssets(env)), title: `Giving statement ${st.partner.lookup}, ${periodLabel(st.from, st.to)}` });
  const batch = await saveBatch(env, {
    kind: 'single',
    list: '',
    year: null,
    from: st.from,
    to: st.to,
    includeSoft: ask.includeSoft,
    count: 1,
    gifts: st.totals.giftCount,
    amountCents: st.totals.net,
    basisCents: st.totals.taxBasis,
    skipped: 0,
    seq: 1,
    pdf,
    partners: [{ id: st.partner.id, lookup: st.partner.lookup, name: st.partner.addressee, cents: st.totals.net, basis: st.totals.taxBasis, email: st.partner.email }],
    copy,
    actor,
  });
  await logEvent(env, actor, 'single', batch.id, `partner ${st.partner.lookup}, ${periodLabel(st.from, st.to)}, ${st.totals.giftCount} gifts`);
  const folder = await driveFolder(env);
  if (folder && env.GOOGLE_SA_JSON) {
    try {
      const file = await saveToDrive(env, folder, `Giving statement ${st.partner.lookup} ${periodLabel(st.from, st.to)}.pdf`, pdf);
      await env.DB.prepare('UPDATE stm_batches SET drive_file = ? WHERE id = ?').bind(file, batch.id).run();
      batch.drive_file = file;
    } catch (err) {
      console.error('statements: the copy to US Team Files failed', err);
      await logEvent(env, actor, 'drive_failed', batch.id, String((err as Error).message || err));
    }
  }
  return { batch, statement: st };
}

/** A copy in the folder inside US Team Files named in Admin. Only the Blackbaud ID and the dates go in the file name. */
export async function saveToDrive(env: Env, folder: string, name: string, pdf: Uint8Array, fetchFn: typeof fetch = fetch): Promise<string> {
  const token = await saToken(env, fetchFn, 'https://www.googleapis.com/auth/drive');
  const boundary = 'stm' + Math.random().toString(36).slice(2);
  const enc = new TextEncoder();
  const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folder] })}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`);
  const tail = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + pdf.length + tail.length);
  body.set(head, 0);
  body.set(pdf, head.length);
  body.set(tail, head.length + pdf.length);
  const res = await fetchFn('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const out = (await res.json().catch(() => null)) as { id?: string; error?: { message?: string } } | null;
  if (!res.ok || !out?.id) throw new Error(`drive ${res.status} ${out?.error?.message || ''}`.trim());
  return out.id;
}

/* ------------------------------------------------------------- the year-end lists */

export interface TaxPartner {
  lookup: string;
  addressee: string;
  list: ListKey | 'none';
  total: number;
  zip: string;
  email: string;
  why: string;
}

interface TaxExtra {
  year: string;
  groups: Record<string, { count: number; total: number }>;
  all: number;
}

/** The annual tax receipt lists, read through the report that builds them, so the statements and the lists never disagree. */
export async function taxLists(env: Env, sql: Sql, user: { email: string; name: string }, year: number): Promise<{ partners: TaxPartner[]; extra: TaxExtra }> {
  const ctx: ReportContext = {
    env,
    user,
    sql: sql as ReportContext['sql'],
    kpi: () => kpiFigures(env),
    edits: {},
    today: todayEastern(),
    filters: { year: String(year), list: 'all', through: '' },
  };
  const loaded = await taxDef.load(ctx, { year: String(year), list: 'all', through: '' });
  const partners = loaded.rows.map((r: Row): TaxPartner => ({
    lookup: String(r.lookup ?? ''),
    addressee: String(r.addressee ?? ''),
    list: (['mail', 'email', 'other'].includes(String(r.key)) ? String(r.key) : 'none') as TaxPartner['list'],
    total: Number(r.total) || 0,
    zip: String(r.zip ?? ''),
    email: String(r.email ?? ''),
    why: String(r.why ?? ''),
  }));
  return { partners, extra: loaded.extra as TaxExtra };
}

export interface PlanList {
  count: number;
  total: number;
  issued: number;
  issuedTotal: number;
  remaining: number;
}

export interface Tie {
  label: string;
  mine: number;
  other: number | null;
  kind: 'money' | 'count';
  status: TieOut['status'];
  note?: string;
}

const tieOf = (t: TieOut, mine?: number): Tie => ({ label: t.label, mine: mine ?? t.mine, other: t.kpi, kind: t.kind, status: t.status, note: t.note });

export async function yearEndPlan(env: Env, sql: Sql, user: { email: string; name: string }, year: number): Promise<Record<string, unknown>> {
  const { partners, extra } = await taxLists(env, sql, user, year);
  const issued = await issuedFor(env, year);
  const ids = await idsByLookup(sql, partners.filter((p) => p.list !== 'none').map((p) => p.lookup));
  const lists = {} as Record<ListKey, PlanList>;
  for (const k of LISTS) {
    const rows = partners.filter((p) => p.list === k);
    const done = rows.filter((p) => issued.has(ids.get(p.lookup) || ''));
    lists[k] = {
      count: rows.length,
      total: round2(rows.reduce((t, p) => t + p.total, 0)),
      issued: done.length,
      issuedTotal: round2(done.reduce((t, p) => t + p.total, 0)),
      remaining: rows.length - done.length,
    };
  }
  const none = { count: extra.groups.none.count, total: extra.groups.none.total };
  const onLists = new Set(partners.filter((p) => p.list !== 'none').map((p) => ids.get(p.lookup) || ''));
  const orphan = [...issued.keys()].filter((cid) => !onLists.has(cid)).length;

  // Independent read of the year's giving: the same gifts, summed without the lists.
  const direct = await sql<{ s: number; c: number }>(
    `SELECT ROUND(COALESCE(SUM(gift_amount), 0), 2) AS s, COUNT(*) AS c FROM gifts WHERE substr(gift_date, 1, 10) >= ?1 AND substr(gift_date, 1, 10) <= ?2 AND gift_type <> 'RecurringGift' AND gift_amount > 0`,
    [`${year}-01-01`, `${year}-12-31`]
  );
  const ties: Tie[] = [];
  const listed = round2(LISTS.reduce((t, k) => t + lists[k].total, 0));
  const kpi = await kpiFigures(env);
  ties.push({ label: 'Mail, email, other and no receipt together, against every gift of the year in the Blackbaud copy', mine: extra.all, other: round2(Number(direct[0]?.s) || 0), kind: 'money', status: Math.abs(extra.all - round2(Number(direct[0]?.s) || 0)) < 0.005 ? 'match' : 'differs' });
  if (year === Number(todayEastern().slice(0, 4))) {
    const sum = (kpi?.monthlyGiving || []).reduce((t, v) => t + (v || 0), 0);
    ties.push(tieOf(compare('KPI dashboard, giving for the year to date', extra.all, kpi ? round2(sum) : null, 'money', 'Every gift except recurring gift setups.')));
  } else {
    ties.push({ label: 'KPI dashboard', mine: extra.all, other: null, kind: 'money', status: 'none', note: 'The KPI dashboard shows this year only.' });
  }
  ties.push({ label: 'Mail, email and other lists together, partners', mine: LISTS.reduce((t, k) => t + lists[k].count, 0), other: partners.filter((p) => p.list !== 'none').length, kind: 'count', status: 'match', note: `$${listed.toLocaleString('en-US')} in total` });
  if (orphan) ties.push({ label: 'Partners issued a statement who are no longer on a list', mine: orphan, other: 0, kind: 'count', status: 'differs', note: 'Their gifts or record changed after the file was made.' });

  const open = await openYearEnd(env);
  const batches = (await recentBatches(env, 200)).filter((b) => b.kind === 'yearend' && b.year === year);
  return {
    year,
    asOf: new Date().toISOString(),
    lists,
    none,
    grandTotal: extra.all,
    open: open ? summary(open) : null,
    batches: batches.map(summary),
    ties,
    size: await batchSize(env),
  };
}

async function idsByLookup(sql: Sql, lookups: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const clean = [...new Set(lookups.filter(Boolean))];
  for (let i = 0; i < clean.length; i += 400) {
    const rows = await sql<{ id: string; lookup: string }>(`SELECT id AS id, constituent_lookup_id AS lookup FROM constituents WHERE constituent_lookup_id IN (SELECT value FROM json_each(?1))`, [JSON.stringify(clean.slice(i, i + 400))]);
    for (const r of rows) out.set(String(r.lookup), String(r.id));
  }
  // A list row whose lookup was missing carries the system id itself.
  for (const l of clean) if (!out.has(l) && /^\d+$/.test(l)) out.set(l, l);
  return out;
}

/** Mail goes in ZIP order so the stacks sort at the post office; email and other go by name. */
export const printOrder = (list: ListKey) => (a: Statement, b: Statement): number =>
  (list === 'mail' ? a.partner.zip.slice(0, 5).localeCompare(b.partner.zip.slice(0, 5)) : 0) ||
  a.partner.sortName.localeCompare(b.partner.sortName, 'en', { sensitivity: 'base' });

export interface MakeYearEnd {
  year: number;
  list: ListKey;
  includeSoft: boolean;
  size?: number;
}

/** The next print file for one list: the next partners not yet issued, one statement each. */
export async function makeYearEnd(env: Env, sql: Sql, user: { email: string; name: string }, ask: MakeYearEnd): Promise<{ batch: BatchRow; mismatches: number }> {
  if (!LISTS.includes(ask.list)) throw new HttpError(400, 'bad_list', 'Pick mail, email or other.');
  if (!(await takeLock(env, user.name))) throw new HttpError(409, 'busy', 'Someone is making a print file right now. Wait a minute and reload.');
  try {
    const open = await openYearEnd(env);
    if (open) throw new HttpError(409, 'open_file', 'A print file is waiting to be marked printed. Mark it printed, or throw it away, before making the next one.');
    const size = Math.min(Math.max(ask.size || (await batchSize(env)), 10), 500);
    const { partners } = await taxLists(env, sql, user, ask.year);
    const rows = partners.filter((p) => p.list === ask.list);
    const ids = await idsByLookup(sql, rows.map((p) => p.lookup));
    const issued = await issuedFor(env, ask.year);
    const next = rows.filter((p) => ids.get(p.lookup) && !issued.has(ids.get(p.lookup) as string)).slice(0, size);
    if (!next.length) throw new HttpError(409, 'none_left', 'Every partner on this list already has a statement in a print file.');
    const cids = next.map((p) => ids.get(p.lookup) as string);
    const people = await loadPartners(sql, cids);
    const from = `${ask.year}-01-01`;
    const to = `${ask.year}-12-31`;
    const { gifts, names } = await loadGifts(sql, cids, from, to);
    const copy = await getCopy(env);
    const out: Statement[] = [];
    const entries: PartnerEntry[] = [];
    let mismatches = 0;
    for (const p of next) {
      const cid = ids.get(p.lookup) as string;
      const partner = people.get(cid);
      if (!partner) {
        entries.push({ id: cid, lookup: p.lookup, name: p.addressee, cents: 0, basis: 0, skipped: 'Record not found' });
        continue;
      }
      const mine = gifts.filter((g) => g.giverId === cid || g.soft.some((s) => s.id === cid));
      const st = composeStatement(partner, mine, from, to, names, { includeSoft: ask.includeSoft });
      if (Math.abs(st.totals.taxBasis / 100 - p.total) >= 0.005) mismatches += 1;
      if (st.gifts.length === 0 && st.refunds.length === 0) {
        entries.push({ id: cid, lookup: partner.lookup, name: partner.addressee, cents: 0, basis: st.totals.taxBasis, skipped: 'Nothing tax-deductible to list' });
        continue;
      }
      out.push(st);
      entries.push({ id: cid, lookup: partner.lookup, name: partner.addressee, cents: st.totals.net, basis: st.totals.taxBasis, email: partner.email });
    }
    out.sort(printOrder(ask.list));
    const seq = (await recentBatches(env, 500)).filter((b) => b.kind === 'yearend' && b.year === ask.year && b.list === ask.list).length + 1;
    const pdf = await buildPdf({
      statements: out,
      copy,
      yearEnd: true,
      issued: todayEastern(),
      ...(await pdfAssets(env)),
      title: `Year-end giving statements ${ask.year}, ${ask.list} ${seq}`,
    });
    const batch = await saveBatch(env, {
      kind: 'yearend',
      list: ask.list,
      year: ask.year,
      from,
      to,
      includeSoft: ask.includeSoft,
      count: out.length,
      gifts: out.reduce((t, s) => t + s.totals.giftCount, 0),
      amountCents: out.reduce((t, s) => t + s.totals.net, 0),
      basisCents: entries.reduce((t, e) => t + e.basis, 0),
      skipped: entries.filter((e) => e.skipped).length,
      seq,
      pdf,
      partners: entries,
      copy,
      actor: user.name,
    });
    await logEvent(env, user.name, 'made', batch.id, `${ask.year} ${ask.list} file ${seq}: ${out.length} statements, ${mismatches} differ from the tax list`);
    return { batch, mismatches };
  } finally {
    await dropLock(env);
  }
}

/* ----------------------------------------------------------------------- email */

export interface MailOut {
  to: string;
  subject: string;
  html: string;
  filename: string;
  pdf: Uint8Array;
}

function b64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);

export async function sendMail(env: Env, m: MailOut, fetchFn: typeof fetch = fetch): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
  const res = await fetchFn('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.RESEND_FROM || 'Favor International <noreply@mail.favorintl.org>',
      reply_to: 'info@favorintl.org',
      to: [m.to],
      subject: m.subject,
      html: m.html,
      attachments: [{ filename: m.filename, content: b64(m.pdf) }],
    }),
  });
  return res.ok;
}

/**
 * Emails statements to partners. Contacts partners, so it answers only while Admin has Emailing statements switched on,
 * and each call sends a handful, one per partner, never twice for the same file.
 */
export async function emailStatements(
  env: Env,
  sql: Sql,
  actor: string,
  batchId: string,
  only: string[] = [],
  fetchFn: typeof fetch = fetch
): Promise<{ sent: number; failed: number; skipped: number }> {
  if (!(await emailOn(env))) throw new HttpError(403, 'email_off', 'Emailing statements is switched off in Admin, Giving statements.');
  const b = await getBatch(env, batchId);
  if (b.status === 'discarded') throw new HttpError(409, 'closed', 'That print file was thrown away.');
  const entries = (JSON.parse(b.partners) as PartnerEntry[]).filter((p) => p.email && !p.skipped && (only.length === 0 || only.includes(p.id)));
  const done = await env.DB.prepare("SELECT cid FROM stm_emails WHERE batch_id = ? AND status = 'sent'").bind(batchId).all<{ cid: string }>();
  const have = new Set((done.results || []).map((r) => String(r.cid)));
  const todo = entries.filter((p) => !have.has(p.id)).slice(0, 25);
  const copy = JSON.parse(b.copy) as StatementCopy;
  const assets = await pdfAssets(env);
  let sent = 0;
  let failed = 0;
  for (const p of todo) {
    const st = await statementFor(sql, { cid: p.id, year: '', from: b.from_date, to: b.to_date, includeSoft: !!b.include_soft });
    const pdf = await buildPdf({ statements: [st], copy, yearEnd: b.kind === 'yearend', issued: todayEastern(), ...assets, title: `Giving statement ${st.partner.lookup}` });
    const period = periodLabel(b.from_date, b.to_date);
    const ok = await sendMail(
      env,
      {
        to: p.email as string,
        subject: `Your Favor International giving statement, ${period}`,
        html: `<p>${esc(fill(copy.intro, { period, from: b.from_date, to: b.to_date, year: b.from_date.slice(0, 4) }))}</p><p>Your statement is attached.</p><p>${esc(copy.contact)}</p>`,
        filename: `Favor-giving-statement-${st.partner.lookup}-${period.replace(/[^0-9A-Za-z]+/g, '-')}.pdf`,
        pdf,
      },
      fetchFn
    ).catch(() => false);
    await env.DB.prepare('INSERT INTO stm_emails (id, batch_id, cid, to_email, status, detail, sent_by, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(newId('se'), batchId, p.id, p.email, ok ? 'sent' : 'failed', '', actor, new Date().toISOString())
      .run();
    if (ok) sent += 1;
    else failed += 1;
  }
  await logEvent(env, actor, 'email', batchId, `${sent} sent, ${failed} failed`);
  return { sent, failed, skipped: entries.length - todo.length };
}

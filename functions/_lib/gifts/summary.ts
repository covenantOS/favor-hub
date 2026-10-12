// The day's summary: what was entered against the deposit total (the adding-machine tape) for every deposit dated that day, who approved,
// what is held or rejected, and whether the day ties. Reads only the hub's own tables.
import type { Env } from '../http';
import { notTesterSql } from '../testuser';

export interface DepositSummary {
  id: string;
  name: string;
  status: string;
  batch: string | null;
  tapeCents: number;
  tapeCount: number;
  enteredCents: number;
  enteredCount: number;
  approvedCents: number;
  approvedCount: number;
  sentCents: number;
  sentCount: number;
  heldCount: number;
  heldCents: number;
  rejectedCount: number;
  rejectedCents: number;
  byHandCount: number;
  diffCents: number;
  diffCount: number;
  ties: boolean;
  enteredBy: string;
  approvers: string[];
  committedAt: string | null;
}

export interface DaySummary {
  date: string;
  deposits: DepositSummary[];
  totals: Omit<DepositSummary, 'id' | 'name' | 'status' | 'batch' | 'enteredBy' | 'approvers' | 'committedAt' | 'ties'>;
  ties: boolean;
  open: string[];
}

export async function daySummary(env: Env, date: string, withTesters = false): Promise<DaySummary> {
  const deps = (
    await env.DB.prepare(`SELECT * FROM ge_deposit WHERE deposit_date = ? AND status <> 'removed' ${withTesters ? '' : `AND ${notTesterSql('created_by_email')}`} ORDER BY created_at`).bind(date).all<any>()
  ).results;
  const out: DepositSummary[] = [];
  for (const d of deps) {
    const gifts = (await env.DB.prepare('SELECT status, amount_cents, confirmed_by, approved2_by, reject_reason FROM ge_gift WHERE deposit_id = ?').bind(d.id).all<any>()).results;
    const live = gifts.filter((g) => g.status !== 'removed');
    const sum = (list: any[]) => list.reduce((s, g) => s + (g.amount_cents || 0), 0);
    const approved = live.filter((g) => g.confirmed_by);
    const sent = live.filter((g) => g.status === 'sent');
    const held = live.filter((g) => g.status === 'held');
    const rejected = gifts.filter((g) => g.status === 'removed' && g.reject_reason);
    const enteredCents = sum(live);
    const diffCents = enteredCents - d.tape_cents;
    const diffCount = live.length - d.tape_count;
    out.push({
      id: d.id, name: d.name, status: d.status, batch: d.bb_batch_number,
      tapeCents: d.tape_cents, tapeCount: d.tape_count,
      enteredCents, enteredCount: live.length,
      approvedCents: sum(approved), approvedCount: approved.length,
      sentCents: sum(sent), sentCount: sent.length,
      heldCount: held.length, heldCents: sum(held),
      rejectedCount: rejected.length, rejectedCents: sum(rejected),
      byHandCount: live.filter((g) => g.status === 'by_hand').length,
      diffCents, diffCount, ties: diffCents === 0 && diffCount === 0 && held.length === 0 && approved.length === live.length,
      enteredBy: d.created_by,
      approvers: [...new Set([...approved.map((g) => g.confirmed_by), ...live.map((g) => g.approved2_by).filter(Boolean)])].map((x) => String(x)),
      committedAt: d.committed_at,
    });
  }
  const t = (k: keyof DepositSummary) => out.reduce((s, d) => s + (Number(d[k]) || 0), 0);
  const open: string[] = [];
  for (const d of out) {
    if (d.diffCount !== 0 || d.diffCents !== 0) open.push(`${d.name} is off the tape by ${Math.abs(d.diffCount)} ${Math.abs(d.diffCount) === 1 ? 'item' : 'items'} and $${(Math.abs(d.diffCents) / 100).toFixed(2)}.`);
    if (d.heldCount) open.push(`${d.name} has ${d.heldCount} on hold.`);
    if (d.approvedCount < d.enteredCount) open.push(`${d.name} has ${d.enteredCount - d.approvedCount} not approved.`);
  }
  return {
    date,
    deposits: out,
    totals: {
      tapeCents: t('tapeCents'), tapeCount: t('tapeCount'), enteredCents: t('enteredCents'), enteredCount: t('enteredCount'),
      approvedCents: t('approvedCents'), approvedCount: t('approvedCount'), sentCents: t('sentCents'), sentCount: t('sentCount'),
      heldCount: t('heldCount'), heldCents: t('heldCents'), rejectedCount: t('rejectedCount'), rejectedCents: t('rejectedCents'),
      byHandCount: t('byHandCount'), diffCents: t('diffCents'), diffCount: t('diffCount'),
    },
    ties: out.length > 0 && out.every((d) => d.ties),
    open,
  };
}

export async function recentDates(env: Env, withTesters = false): Promise<string[]> {
  const rows = (await env.DB.prepare(`SELECT DISTINCT deposit_date AS d FROM ge_deposit WHERE status <> 'removed' ${withTesters ? '' : `AND ${notTesterSql('created_by_email')}`} ORDER BY deposit_date DESC LIMIT 14`).all<{ d: string }>()).results;
  return rows.map((r) => r.d);
}

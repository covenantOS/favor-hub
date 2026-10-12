// The Daily Revenue Report from a gift entry deposit itself, the moment its batch is in Blackbaud, so nobody waits for the mirror (up to
// 12 hours behind). The gifts are the deposit's own rows; the partners, appeals, funds, assignments and lifetime giving come from the
// mirror, and the post is built by the same code the Reports page uses (reports/defs/b1-shared.ts), line for line. Read only.
import type { Env } from '../http';
import { mirror } from '../foundations/blackbaud';
import { assertReadOnly } from '../reports/engine';
import { buildPost, easternHour, loadGrid, longDate, round2, type RawGift } from '../reports/defs/b1-shared';
import type { ReportContext } from '../reports/types';
import { getDeposit, giftsOf, type GiftRow } from './store';

/** Rows that are revenue for the day: everything still in the deposit except held and rejected rows. */
const COUNTED = (g: GiftRow) => !['removed', 'held', 'rejected'].includes(g.status);

export interface DepositRevenue {
  depositId: string;
  date: string;
  dateLabel: string;
  status: string;
  total: number;
  count: number;
  recurring: number;
  consistent: number;
  highlights: number;
  blocks: { name: string; total: number; entries: number }[];
  /** The WhatsApp post, ready to copy. */
  text: string;
  /** Rows with no partner picked yet are left out of the post and counted here. */
  noPartner: number;
}

/** The deposit's rows as the mirror's gift shape, for the shared grid. */
export function asRawGifts(rows: GiftRow[], depositDate: string): RawGift[] {
  return rows
    .filter((g) => COUNTED(g) && g.partner_id && (g.amount_cents || 0) > 0)
    .map((g) => {
      const amount = round2((g.amount_cents || 0) / 100);
      return {
        id: `ge:${g.id}`,
        lid: g.bb_gift_id || `ge:${g.id}`,
        pname: g.partner_name || g.payer || '',
        cid: String(g.partner_id),
        amount,
        d: (g.gift_date || depositDate).slice(0, 10),
        gtype: 'Donation',
        pm: g.kind === 'cash' ? 'Cash' : 'PersonalCheck',
        splits: JSON.stringify([{ amount: { value: amount }, appeal_id: g.appeal_id || undefined, fund_id: g.fund_id || undefined }]),
        soft: g.soft_partner_id ? JSON.stringify([{ constituent_id: g.soft_partner_id }]) : null,
      };
    });
}

export async function depositRevenue(env: Env, depositId: string, sql?: ReportContext['sql']): Promise<DepositRevenue | null> {
  const d = await getDeposit(env, depositId);
  if (!d) return null;
  const rows = await giftsOf(env, depositId);
  const given = asRawGifts(rows, d.deposit_date);
  const ctx = {
    env,
    user: { email: '', name: '' },
    sql: async (s: string, p: unknown[] = []) => {
      assertReadOnly(s);
      return (sql ? sql(s, p) : mirror(env, s, p)) as Promise<never>;
    },
    kpi: async () => null,
    edits: {},
    today: d.deposit_date,
    filters: {},
  } as unknown as ReportContext;
  const grid = given.length ? await loadGrid(ctx, d.deposit_date, d.deposit_date, 5000, given) : [];
  const post = buildPost(grid, easternHour());
  return {
    depositId,
    date: d.deposit_date,
    dateLabel: longDate(d.deposit_date),
    status: d.status,
    total: post.total,
    count: post.count,
    recurring: post.recurring,
    consistent: post.consistent,
    highlights: post.highlights.length,
    blocks: post.blocks,
    text: post.text,
    noPartner: rows.filter((g) => COUNTED(g) && !g.partner_id && (g.amount_cents || 0) > 0).length,
  };
}

// A partner's giving before the gift on the deposit screen (functions/api/gift-entry/history.ts reads the rows).
export interface GiftHistory {
  count: number;
  lifetimeCents: number;
  last: { cents: number; date: string } | null;
  first: boolean;
}

/** Pure: the panel's numbers from the rows the copy returns. */
export function historyOf(rows: Array<{ amt: number | null; d: string | null }>): GiftHistory {
  const gifts = rows.filter((r) => Number(r.amt) > 0 && r.d);
  gifts.sort((a, b) => String(b.d).localeCompare(String(a.d)));
  const lifetimeCents = Math.round(gifts.reduce((t, r) => t + Number(r.amt) * 100, 0));
  return { count: gifts.length, lifetimeCents, last: gifts[0] ? { cents: Math.round(Number(gifts[0].amt) * 100), date: String(gifts[0].d).slice(0, 10) } : null, first: gifts.length === 0 };
}


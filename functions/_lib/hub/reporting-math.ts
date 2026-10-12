// Reporting: the arithmetic and the plain-language sentences behind goal pacing, click-to-explain and the weekly
// highlights. No network and no database in this file. The route code (reporting.ts) reads the KPI dashboard and the
// Favor Brain, hands the answers here, and shows what comes back. Every dollar figure in a sentence is a figure the
// KPI dashboard or the gift rows already hold; nothing here estimates a past number. The one estimate is the year-end
// projection, and it says so.

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const money0 = (n: number): string => (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US');

/** "$9.5M", "$412K", "$830". For headlines on a card; the full figure sits beside it. */
export function moneyShort(n: number): string {
  const a = Math.abs(n);
  const s = a >= 1e6 ? '$' + (Math.round(a / 1e5) / 10).toFixed(1).replace(/\.0$/, '') + 'M' : a >= 1e4 ? '$' + Math.round(a / 1e3) + 'K' : '$' + Math.round(a).toLocaleString('en-US');
  return n < 0 ? '-' + s : s;
}

const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

export interface DayInfo {
  year: number;
  month: number;
  day: number;
  daysInMonth: number;
  dayOfYear: number;
  daysInYear: number;
  daysLeft: number;
  /** The share of the year that has passed, counting the as-of day. */
  yearFrac: number;
}

export function dayInfo(asOf: string): DayInfo {
  const [year, month, day] = asOf.slice(0, 10).split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const leap = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1;
  const daysInYear = leap ? 366 : 365;
  const dayOfYear = Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 864e5) + 1;
  return { year, month, day, daysInMonth, dayOfYear, daysInYear, daysLeft: daysInYear - dayOfYear, yearFrac: dayOfYear / daysInYear };
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const monthKey = (day: string): string => day.slice(0, 7);

export function prevMonthKey(asOf: string): string {
  const { year, month } = dayInfo(asOf);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

export const monthName = (key: string): string => MONTH_NAMES[Number(key.slice(5, 7)) - 1] || key;
export const dayLabel = (day: string): string => `${monthName(day.slice(0, 7)).slice(0, 3)} ${Number(day.slice(8, 10))}`;
export const lastDayOf = (key: string): string => {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  return `${key}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

// ---- Goal pacing ------------------------------------------------------------------------------------

export type PaceStatus = 'ahead' | 'close' | 'behind';

export interface Pace {
  key: string;
  name: string;
  measure: 'raised' | 'awarded';
  raised: number;
  goal: number;
  /** Share of the goal reached, in percent. */
  pctGoal: number;
  /** Share of the year gone, in percent. */
  pctYear: number;
  /** Where the line sits today: the goal times last year's share by now, or the straight line. */
  expected: number;
  /** Raised minus expected; negative means behind. */
  aheadBy: number;
  /** The year-end range. Equal when the basis is a straight line. */
  projectedLow: number;
  projectedHigh: number;
  basis: 'last-year' | 'straight-line';
  status: PaceStatus;
  toGo: number;
  weeksLeft: number;
  perWeekNeeded: number;
  lyToDate: number | null;
  lyTotal: number | null;
}

export interface PaceInput {
  key: string;
  name: string;
  measure?: 'raised' | 'awarded';
  raised: number;
  goal: number;
  asOf: string;
  /** Last year's twelve monthly totals (nulls count as zero), the whole year. */
  lastYearMonthly?: Array<number | null> | null;
  /** Last year's total on this date and for the whole year, when the source gives them directly. */
  lyToDate?: number | null;
  lyTotal?: number | null;
}

/** Last year's total up to the as-of day, from twelve monthly totals: whole months, then a share of the current month. */
export function lastYearToDate(monthly: Array<number | null>, d: DayInfo): number {
  let sum = 0;
  for (let i = 0; i < d.month - 1; i++) sum += Number(monthly[i]) || 0;
  return sum + (Number(monthly[d.month - 1]) || 0) * (d.day / d.daysInMonth);
}

export function pace(i: PaceInput): Pace {
  const d = dayInfo(i.asOf);
  let lyToDate = i.lyToDate ?? null;
  let lyTotal = i.lyTotal ?? null;
  if (lyToDate == null && lyTotal == null && i.lastYearMonthly && i.lastYearMonthly.length >= 12) {
    lyTotal = i.lastYearMonthly.reduce<number>((s, v) => s + (Number(v) || 0), 0);
    lyToDate = lastYearToDate(i.lastYearMonthly, d);
  }
  const seasonal = lyToDate != null && lyTotal != null && lyTotal > 0 && lyToDate > 0 && lyToDate / lyTotal >= 0.05 && i.measure !== 'awarded';
  const goal = Number(i.goal) || 0;
  const raised = Number(i.raised) || 0;
  let low: number;
  let high: number;
  let expected: number;
  if (seasonal) {
    const share = (lyToDate as number) / (lyTotal as number);
    // Two readings of the same pattern: the rest of the year brings in what it brought last year, or the year keeps its
    // pace relative to last year. The headline is the range between them.
    const sameRemainder = raised + Math.max(0, (lyTotal as number) - (lyToDate as number));
    const samePace = raised / share;
    low = Math.min(sameRemainder, samePace);
    high = Math.max(sameRemainder, samePace);
    expected = goal * share;
  } else {
    const line = d.yearFrac > 0 ? raised / d.yearFrac : raised;
    low = high = line;
    expected = goal * d.yearFrac;
  }
  let status: PaceStatus;
  if (low === high) status = high >= goal ? 'ahead' : high >= goal * 0.95 ? 'close' : 'behind';
  else status = low >= goal ? 'ahead' : high < goal ? 'behind' : 'close';
  const toGo = Math.max(0, goal - raised);
  const weeksLeft = Math.max(d.daysLeft / 7, 0);
  return {
    key: i.key,
    name: i.name,
    measure: i.measure || 'raised',
    raised,
    goal,
    pctGoal: goal ? (raised / goal) * 100 : 0,
    pctYear: d.yearFrac * 100,
    expected,
    aheadBy: raised - expected,
    projectedLow: low,
    projectedHigh: high,
    basis: seasonal ? 'last-year' : 'straight-line',
    status,
    toGo,
    weeksLeft,
    perWeekNeeded: weeksLeft > 0 ? toGo / weeksLeft : toGo,
    lyToDate: seasonal ? lyToDate : null,
    lyTotal: seasonal ? lyTotal : null,
  };
}

export const STATUS_LABEL: Record<PaceStatus, string> = { ahead: 'On pace to pass the goal', close: 'Close, it depends on the fourth quarter', behind: 'Behind pace' };

/** One line a person can read: where the year ends at this pace. */
export function paceSentence(p: Pace): string {
  const range = p.projectedLow === p.projectedHigh ? `about ${money0(p.projectedHigh)}` : `between ${money0(p.projectedLow)} and ${money0(p.projectedHigh)}`;
  const verb = p.measure === 'awarded' ? 'awarded' : 'raised';
  const basis = p.basis === 'last-year' ? " Based on how last year's giving was spread across its months." : ' A straight line from the amount so far, because last year does not give a pattern to follow.';
  return `The year ends ${range} ${verb} at this pace, against a ${money0(p.goal)} goal.${basis}`;
}

/** How the projection was made, for the panel behind the number. */
export function paceMethod(p: Pace): string {
  const lines: string[] = [];
  if (p.basis === 'last-year' && p.lyToDate != null && p.lyTotal != null) {
    lines.push(`Last year ${money0(p.lyToDate)} had come in by this date, out of ${money0(p.lyTotal)} for the whole year, so ${(p.lyToDate / p.lyTotal * 100).toFixed(1)}% of the year's giving had arrived.`);
    lines.push(`Low end ${money0(p.projectedLow)}: this year's ${money0(p.raised)} plus the ${money0(Math.max(0, p.lyTotal - p.lyToDate))} that came in after this date last year.`);
    lines.push(`High end ${money0(p.projectedHigh)}: this year's ${money0(p.raised)} divided by last year's ${(p.lyToDate / p.lyTotal * 100).toFixed(1)}%.`);
    lines.push(`Where the line sits today: ${(p.lyToDate / p.lyTotal * 100).toFixed(1)}% of the ${money0(p.goal)} goal is ${money0(p.expected)}.`);
  } else {
    lines.push(`${p.pctYear.toFixed(1)}% of the year has passed and ${money0(p.raised)} is in, so a straight line gives ${money0(p.projectedHigh)} by December 31.`);
    lines.push(`Where the line sits today: ${p.pctYear.toFixed(1)}% of the ${money0(p.goal)} goal is ${money0(p.expected)}.`);
  }
  lines.push(`${money0(p.toGo)} is left to the goal, ${money0(p.perWeekNeeded)} a week for ${Math.round(p.weeksLeft)} weeks.`);
  return lines.join('\n');
}

// ---- Gift rows and the "what is in it" answer --------------------------------------------------------

export interface GiftRow {
  date: string;
  partner: string;
  /** What counts toward the number. */
  amount: number;
  gift_amount?: number;
}

export interface SliceMonth {
  slice: string;
  label: string;
  month: string;
  rows: GiftRow[];
  total: number;
  count: number;
}

const sum = (rows: GiftRow[]) => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
const within = (rows: GiftRow[], from: string, to: string) => rows.filter((r) => r.date >= from && r.date <= to);

export interface ChangeLine {
  label: string;
  amount: number;
  note?: string;
}

export interface Change {
  key: string;
  label: string;
  asOf: string;
  /** The number on the page, tied to the KPI dashboard. */
  shown: number;
  /** One short sentence. */
  headline: string;
  /** Plain sentences, in reading order. */
  story: string[];
  from: { label: string; amount: number } | null;
  delta: number | null;
  /** What this month's gifts came from, largest first. */
  lines: ChangeLine[];
  linesLabel: string;
  top: Array<{ date: string; partner: string; amount: number }>;
  topLabel: string;
}

const topGifts = (rows: GiftRow[], n = 5) =>
  [...rows]
    .sort((a, b) => b.amount - a.amount || (a.date < b.date ? 1 : -1))
    .slice(0, n)
    .map((r) => ({ date: r.date, partner: r.partner, amount: r.amount }));

export interface ExplainInput {
  key: string;
  label: string;
  asOf: string;
  /** The figure the KPI dashboard shows for this number. */
  shown: number;
  /** The same number at the end of last month, from the KPI dashboard (the year's month-end series or the team's months). */
  endLastMonth: number | null;
  /** This month's and last month's gifts by slice. */
  thisMonth: SliceMonth[];
  lastMonth: SliceMonth[];
  /** A month the KPI dashboard reported at close and has changed since (closing figure, figure now). */
  restated?: { month: string; reported: number; now: number } | null;
}

export function explain(i: ExplainInput): Change {
  const d = dayInfo(i.asOf);
  const thisKey = monthKey(i.asOf);
  const prevKey = prevMonthKey(i.asOf);
  const thisRows = i.thisMonth.flatMap((s) => s.rows);
  const lastRows = i.lastMonth.flatMap((s) => s.rows);
  const thisTotal = sum(thisRows);
  const lastTotal = sum(lastRows);
  const sameDay = `${prevKey}-${String(Math.min(d.day, Number(lastDayOf(prevKey).slice(8)))).padStart(2, '0')}`;
  const lastSoFar = sum(within(lastRows, `${prevKey}-01`, sameDay));
  const story: string[] = [];
  const delta = i.endLastMonth == null ? null : i.shown - i.endLastMonth;
  const endLabel = dayLabel(lastDayOf(prevKey));
  let headline: string;
  if (delta == null) headline = `${money0(i.shown)} so far this year.`;
  else if (Math.abs(delta) < 0.5) headline = `No change since ${endLabel}. It was ${money0(i.endLastMonth as number)} then and is ${money0(i.shown)} now.`;
  else headline = `${delta > 0 ? 'Up' : 'Down'} ${money0(Math.abs(delta))} since ${endLabel}, from ${money0(i.endLastMonth as number)} to ${money0(i.shown)}.`;

  if (thisRows.length) {
    story.push(`${monthName(thisKey)} has ${plural(thisRows.length, 'gift')} totaling ${money0(thisTotal)} after ${plural(d.day, 'day')}.`);
  } else {
    story.push(`No gifts are dated in ${monthName(thisKey)} yet.`);
  }
  if (lastRows.length) {
    const cmp = lastSoFar > 0 ? ` By the same day, ${monthName(prevKey)} had ${money0(lastSoFar)}.` : '';
    story.push(`${monthName(prevKey)} closed at ${money0(lastTotal)} from ${plural(lastRows.length, 'gift')}.${cmp}`);
  }
  if (delta != null && Math.abs(Math.abs(delta) - thisTotal) > 1) {
    const gap = delta - thisTotal;
    story.push(`The change since ${endLabel} is ${money0(Math.abs(gap))} ${gap > 0 ? 'more' : 'less'} than the ${monthName(thisKey)} gifts alone. The difference is gifts dated before ${monthName(thisKey)} that were entered, changed or moved to another team after ${endLabel}.`);
  }
  if (i.restated && Math.abs(i.restated.now - i.restated.reported) >= 1) {
    const r = i.restated;
    story.push(`${monthName(r.month)} was reported at ${money0(r.reported)} when it closed and reads ${money0(r.now)} now, ${money0(Math.abs(r.now - r.reported))} ${r.now > r.reported ? 'more' : 'less'} after late entries.`);
  }

  const lines = i.thisMonth
    .filter((s) => s.rows.length)
    .map((s) => ({ label: s.label, amount: sum(s.rows), note: plural(s.rows.length, 'gift') }))
    .sort((a, b) => b.amount - a.amount);
  return {
    key: i.key,
    label: i.label,
    asOf: i.asOf,
    shown: i.shown,
    headline,
    story,
    from: i.endLastMonth == null ? null : { label: endLabel, amount: i.endLastMonth },
    delta,
    lines,
    linesLabel: `${monthName(thisKey)} so far, by where the gifts came from`,
    top: topGifts(thisRows),
    topLabel: `Largest gifts in ${monthName(thisKey)}`,
  };
}

// ---- Weekly highlights ---------------------------------------------------------------------------------

export interface HighlightInput {
  key: string;
  name: string;
  asOf: string;
  /** Gifts from this month and last month for the team's slices. */
  rows: GiftRow[];
  pace: Pace | null;
  /** The team's month totals from the KPI dashboard: this month so far and last month in full. */
  monthSoFar?: number | null;
  lastMonthTotal?: number | null;
  /** Extra sentences the team has that gifts do not give (Grants awards). */
  extra?: string[];
  /** What a row is called: "gift" by default, "grant payment" for Grants. */
  noun?: string;
}

export interface Highlight {
  key: string;
  name: string;
  from: string;
  to: string;
  gifts: number;
  amount: number;
  prevGifts: number;
  prevAmount: number;
  headline: string;
  lines: string[];
  status: PaceStatus | null;
}

export function weeklyHighlight(i: HighlightInput): Highlight {
  const to = i.asOf.slice(0, 10);
  const noun = i.noun || 'gift';
  const from = addDays(to, -6);
  const prevTo = addDays(to, -7);
  const prevFrom = addDays(to, -13);
  const now = within(i.rows, from, to);
  const before = within(i.rows, prevFrom, prevTo);
  const amount = sum(now);
  const prevAmount = sum(before);
  const lines: string[] = [];
  let headline: string;
  if (!now.length) {
    headline = `No ${noun}s landed ${dayLabel(from)} to ${dayLabel(to)}.`;
  } else {
    const diff = amount - prevAmount;
    headline = `${plural(now.length, noun)} for ${money0(amount)} in the last 7 days.`;
    if (before.length || prevAmount > 0) {
      lines.push(
        Math.abs(diff) < 1
          ? `That matches the week before, ${money0(prevAmount)} from ${plural(before.length, 'gift')}.`
          : `That is ${money0(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than the week before, which had ${plural(before.length, noun)} for ${money0(prevAmount)}.`,
      );
    } else {
      lines.push(`The week before had no ${noun}s.`);
    }
    const big = topGifts(now, 1)[0];
    if (big) lines.push(`The largest was ${money0(big.amount)} from ${big.partner} on ${dayLabel(big.date)}.`);
  }
  if (!now.length && (before.length || prevAmount > 0)) lines.push(`The week before had ${plural(before.length, noun)} for ${money0(prevAmount)}.`);
  if (i.monthSoFar != null && i.lastMonthTotal != null) {
    lines.push(`${monthName(monthKey(to))} is at ${money0(i.monthSoFar)} so far. ${monthName(prevMonthKey(to))} closed at ${money0(i.lastMonthTotal)}.`);
  }
  for (const e of i.extra || []) lines.push(e);
  if (i.pace && i.pace.goal > 0) {
    const p = i.pace;
    lines.push(`${money0(p.toGo)} is left to the ${money0(p.goal)} goal, ${money0(p.perWeekNeeded)} a week for ${Math.round(p.weeksLeft)} weeks. ${STATUS_LABEL[p.status]}.`);
  }
  return { key: i.key, name: i.name, from, to, gifts: now.length, amount, prevGifts: before.length, prevAmount, headline, lines, status: i.pace ? i.pace.status : null };
}

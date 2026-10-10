import type { ActionRecord } from './types.ts';
import type { Params } from './params.ts';
import { DEFAULTS } from './params.ts';
import type { Obligation } from './obligations.ts';
import { contactTypeSet, HQTY_TYPE } from './contact-types.ts';
import { statusOf } from './status.ts';
import { daysBetween } from './dates.ts';

// matchSatisfier: which later completed action satisfies a task or an obligation (spec 5.4 mechanic 3).
// adoptTask: which obligation an existing Blackbaud task belongs to (spec 5.4 mechanic 4).

export interface SatisfierTarget {
  partnerIds: string[]; // the credited partner and the giver
  anchorDate: string; // the gift entered date, or the task's own date added
  excludeIds?: string[]; // the task itself and its duplicates
  giftAmounts?: number[]; // the gift or gifts this answers; a candidate that names a different amount is not its answer
}

export type MatchLevel = 'strict' | 'loose' | 'none';

export interface SatisfierResult {
  level: MatchLevel;
  action: ActionRecord | null; // the earliest action at that level
  signals: string[]; // why it matched, for the report
  strictCount: number;
  looseCount: number;
}

/** The words that make a completed action a thank-you (spec 5.4.3). Summary first, then the optional signals. */
export function strictSignals(c: ActionRecord, p: Params): string[] {
  const out: string[] = [];
  if (c.type === HQTY_TYPE) out.push('hqty_type');
  if (p.STRICT_SUMMARY_PATTERN.test(c.summary)) out.push('summary_wording');
  if (p.STRICT_USE_THANKED_TAG && c.thanked) out.push('thanked_tag');
  if (p.STRICT_USE_DESCRIPTION && p.STRICT_SUMMARY_PATTERN.test(c.description)) out.push('description_wording');
  return out;
}

function isLooseContact(c: ActionRecord, p: Params, contactTypes: Set<string>): boolean {
  if (c.type && contactTypes.has(c.type)) return true;
  return p.LOOSE_COUNTS_NON_TASK_CATEGORIES && c.category !== null && c.category !== 'Task/Other';
}

function namesOtherAmount(c: ActionRecord, giftAmounts: number[], p: Params): boolean {
  const named = parseTaskText(c.summary).amounts;
  if (!named.length) return false;
  return !named.some((n) => giftAmounts.some((g) => amountMatches(n, g, p)));
}

const earlier =(a: ActionRecord, b: ActionRecord) => (a.dateAdded < b.dateAdded ? -1 : a.dateAdded > b.dateAdded ? 1 : Number(a.id) - Number(b.id));

export function matchSatisfier(
  target: SatisfierTarget,
  candidates: ActionRecord[],
  p: Params = DEFAULTS,
  contactTypes: Set<string> = contactTypeSet('counts_for_portfolio'),
): SatisfierResult {
  const exclude = new Set(target.excludeIds ?? []);
  const partners = new Set(target.partnerIds);
  const strict: { a: ActionRecord; why: string[] }[] = [];
  const loose: ActionRecord[] = [];
  for (const c of candidates) {
    if (exclude.has(c.id) || !partners.has(c.constituentId)) continue;
    if (statusOf(c, '9999-12-31').status !== 'completed') continue;
    const when = p.SATISFIER_DATE_FIELD === 'dueDate' ? c.dueDate : c.dateAdded;
    if (when < target.anchorDate) continue; // earlier than the gift or task: cannot be its answer
    const why = strictSignals(c, p);
    // A thank-you that names an amount that fits none of this obligation's gifts answers a different gift.
    const conflicts = p.SATISFIER_AMOUNT_CONFLICT && target.giftAmounts && target.giftAmounts.length > 0 && namesOtherAmount(c, target.giftAmounts, p);
    if (why.length && !conflicts) strict.push({ a: c, why });
    if (isLooseContact(c, p, contactTypes)) loose.push(c);
  }
  strict.sort((x, y) => earlier(x.a, y.a));
  loose.sort(earlier);
  if (strict.length) return { level: 'strict', action: strict[0].a, signals: strict[0].why, strictCount: strict.length, looseCount: loose.length };
  if (loose.length) return { level: 'loose', action: loose[0], signals: ['completed_contact'], strictCount: 0, looseCount: loose.length };
  return { level: 'none', action: null, signals: [], strictCount: 0, looseCount: 0 };
}

// ---------------------------------------------------------------------------------------------------------
// Reading a typed task summary. Partner Care and Support type free text: "TY for $42 gift on 9/5",
// "Thank for $500 recurring on 10/1", "New $200 gift rec'd", "ty rec gift $1000 9/15/26". The worker writes
// "Gift of $200.00 on 8/16/2026." (gift-follow-up-notes.js:62).

export interface ParsedText {
  amounts: number[];
  dates: { month: number; day: number; year: number | null }[];
}

export function parseTaskText(text: string): ParsedText {
  const amounts: number[] = [];
  const dates: ParsedText['dates'] = [];
  // A k or m suffix is a thousand or a million: "$10K" is 10,000 (engine audit 4, satisfier item 1).
  for (const m of text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s?([kKmM])?(?![a-zA-Z])/g)) {
    const base = Number(m[1].replace(/,/g, '') + (m[2] ? '.' + m[2] : ''));
    amounts.push(m[3] ? base * (m[3].toLowerCase() === 'k' ? 1000 : 1000000) : base);
  }
  for (const m of text.matchAll(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/g)) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    let year: number | null = null;
    if (m[3]) year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    dates.push({ month, day, year });
  }
  return { amounts, dates };
}

function amountMatches(typed: number, actual: number, p: Params): boolean {
  if (Math.abs(typed - actual) < 0.005) return true;
  // A typed whole dollar names the gift with cents: "$42" for $42.49 (actions 121282 and 121284).
  return p.AMOUNT_WHOLE_DOLLAR_MATCH && Number.isInteger(typed) && (typed === Math.floor(actual) || typed === Math.round(actual));
}

function dateMatches(d: { month: number; day: number; year: number | null }, iso: string): boolean {
  const [y, m, day] = iso.split('-').map(Number);
  return d.month === m && d.day === day && (d.year === null || d.year === y);
}

export type AdoptHow = 'amount_date' | 'date_window' | 'ambiguous' | 'none';

export interface AdoptResult {
  obligationKey: string | null;
  how: AdoptHow;
  giftId: string | null;
  tied: string[]; // keys that tied, when ambiguous
}

/**
 * Link one open task to an obligation.
 * 1. The summary or description names an amount and a date that match a gift in the obligation: amount_date.
 * 2. Else the task's date is within ADOPT_DATE_WINDOW_DAYS of a gift entered date on the same partner: date_window.
 *    A named amount that matches no gift rules the obligation out. Several candidates: prefer an amount match, then
 *    the nearest date; a tie is ambiguous and is left unlinked for a "Which gift?" chip (spec 5.4.4).
 * 3. Else none.
 */
export function adoptTask(task: ActionRecord, obligations: Obligation[], p: Params = DEFAULTS): AdoptResult {
  const wanted = task.type === HQTY_TYPE ? ['hq_letter'] : ['personal_thanks', 'cadence'];
  const mine = obligations.filter((o) => wanted.includes(o.kind) && (o.partnerId === task.constituentId || o.giverIds.includes(task.constituentId)));
  if (!mine.length) return { obligationKey: null, how: 'none', giftId: null, tied: [] };

  const text = parseTaskText(`${task.summary} ${task.description}`);

  // Step 1: amount and date both named.
  if (text.amounts.length && text.dates.length) {
    const hits: { o: Obligation; giftId: string }[] = [];
    for (const o of mine) {
      for (const g of o.gifts) {
        const amountOk = text.amounts.some((a) => amountMatches(a, g.amount, p));
        const dateOk = text.dates.some((d) => dateMatches(d, g.giftDate) || dateMatches(d, g.enteredDate));
        if (amountOk && dateOk) hits.push({ o, giftId: g.id });
      }
    }
    if (hits.length === 1 || (hits.length > 1 && new Set(hits.map((h) => h.o.key)).size === 1)) {
      return { obligationKey: hits[0].o.key, how: 'amount_date', giftId: hits[0].giftId, tied: [] };
    }
    if (hits.length > 1) {
      return { obligationKey: null, how: 'ambiguous', giftId: null, tied: [...new Set(hits.map((h) => h.o.key))] };
    }
    // Named an amount and a date and nothing matched: fall through to the date window, which still refuses a wrong amount.
  }

  // Step 2: date window around a gift entered date.
  const scored: { o: Obligation; giftId: string; amountHit: boolean; gap: number }[] = [];
  for (const o of mine) {
    for (const g of o.gifts) {
      const gap = Math.abs(daysBetween(g.enteredDate, task.dueDate));
      if (gap > p.ADOPT_DATE_WINDOW_DAYS) continue;
      const amountHit = text.amounts.some((a) => amountMatches(a, g.amount, p));
      if (text.amounts.length && !amountHit) continue;
      scored.push({ o, giftId: g.id, amountHit, gap });
    }
  }
  if (!scored.length) return { obligationKey: null, how: 'none', giftId: null, tied: [] };
  scored.sort((a, b) => Number(b.amountHit) - Number(a.amountHit) || a.gap - b.gap);
  const best = scored.filter((s) => s.amountHit === scored[0].amountHit && s.gap === scored[0].gap);
  const keys = [...new Set(best.map((b) => b.o.key))];
  if (keys.length > 1) return { obligationKey: null, how: 'ambiguous', giftId: null, tied: keys };
  return { obligationKey: keys[0], how: 'date_window', giftId: best[0].giftId, tied: [] };
}

export type LinkKind = 'adopted' | 'duplicate' | 'unlinked';

export interface TaskLink {
  taskId: string;
  link: LinkKind;
  obligationKey: string | null;
  how: AdoptHow;
  giftId: string | null;
}

/**
 * Link a batch of tasks. The earliest task on an obligation is adopted; each further task on the same obligation
 * is a duplicate, linked now and closed with the first (spec 5.4.4, rule S5).
 */
export function linkTasks(tasks: ActionRecord[], obligations: Obligation[], p: Params = DEFAULTS): TaskLink[] {
  const results = tasks.map((t) => ({ t, r: adoptTask(t, obligations, p) }));
  const first = new Map<string, string>();
  const ordered = results.slice().sort((a, b) => earlier(a.t, b.t));
  for (const { t, r } of ordered) if (r.obligationKey && !first.has(r.obligationKey)) first.set(r.obligationKey, t.id);
  return results.map(({ t, r }) => {
    if (!r.obligationKey) return { taskId: t.id, link: 'unlinked' as const, obligationKey: null, how: r.how, giftId: null };
    return {
      taskId: t.id,
      link: first.get(r.obligationKey) === t.id ? ('adopted' as const) : ('duplicate' as const),
      obligationKey: r.obligationKey,
      how: r.how,
      giftId: r.giftId,
    };
  });
}

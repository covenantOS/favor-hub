// Proposing the appeal and fund for a gift. A check never carries an appeal code, so the appeal is known only from what came with it or
// from context (Will, 2026-10-12). Evidence, strongest first:
//   1. a reply slip or business reply envelope in the envelope (it carries the code)   2. a letter or note in the envelope
//   3. an expected gift someone logged for this partner (opportunity or action), matched on amount and timing
//   4. what Favor recently sent the partner (no send list is in the mirror yet, so this gives nothing today)
//   5. the memo line, which names a fund or purpose, not an appeal   6. the partner's usual appeal, a weak hint
// Only 1 and 2 set the appeal. Everything else is a suggestion with its reason. With no slip or letter the gift is coded White Mail by
// the decision table and goes on the needs-coding list. The fund comes from the slip, the letter, an expected gift, then the memo.
// Pure functions: the caller supplies the catalog and the evidence. A proposal is never final; a person approves the row.
import { WHERE_NEEDED_MOST } from './store';
import type { AppealOpt, FundOpt } from './match';

export type AppealSource = 'slip' | 'memo' | 'history' | 'white_mail' | '';
export type FundSource = 'slip' | 'memo' | 'default';

export interface Expected {
  id: string;
  kind: 'opportunity' | 'action';
  date: string;
  amountCents: number | null;
  purpose: string | null;
  text: string;
}

export interface CodingInput {
  slipAppeal: string | null;
  slipDesignation: string | null;
  letterAppeal: string | null;
  letterPurpose: string | null;
  memo: string | null;
  lastGift: { fundId: string; appealId: string } | null;
  expected: Expected[];
  funds: FundOpt[];
  appeals: AppealOpt[];
  partnerName: string | null;
  payer: string | null;
  amountCents: number | null;
  /** Donations from this partner in the 12 months before the gift, not counting recurring ones. */
  recentGifts: number;
}

export interface Suggestion {
  appealId: string;
  code: string;
  name: string;
  source: 'memo' | 'expected' | 'history';
  reason: string;
}

export interface Coding {
  appeal: AppealOpt | null;
  /** slip, letter, or white_mail (the table's code when nothing came with the gift). */
  appealSource: 'slip' | 'letter' | 'white_mail' | '';
  /** The reason in plain words, shown beside the appeal. */
  reason: string;
  needsCoding: boolean;
  suggestions: Suggestion[];
  fund: FundOpt | null;
  fundSource: 'slip' | 'letter' | 'expected' | 'memo' | 'default';
  fundReason: string;
}

const norm = (s: string | null | undefined) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const compact = (s: string | null | undefined) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function findAppealByCode(appeals: AppealOpt[], code: string | null | undefined): AppealOpt | null {
  const c = compact(code);
  if (c.length < 3) return null;
  return appeals.find((a) => compact(a.code) === c) || null;
}

/** A code that looks like Favor's scheme (L26B-AD, N269-EMW3, W200-CH) found anywhere in the memo. */
export function codeInText(appeals: AppealOpt[], text: string | null | undefined): AppealOpt | null {
  const hits = String(text || '').toUpperCase().match(/\b[A-Z]\d{2}[0-9A-C]-?[A-Z0-9]{1,6}\b/g) || [];
  for (const h of hits) {
    const a = findAppealByCode(appeals, h);
    if (a) return a;
  }
  return null;
}

export const CHURCH_WORDS = /\b(church|chapel|ministr(?:y|ies)|congregation|fellowship|baptist|methodist|presbyterian|lutheran|cathedral|parish|temple|synagogue|mission)\b/i;
export const FOUNDATION_WORDS = /\b(foundation|trust|fund|charitable|giving fund|donor.?advised|daf|fidelity|schwab|endowment|grant)\b/i;

/** The White Mail evergreen code (W200-xxxx) the decision table points to. Null when the catalog lacks it. */
export function whiteMailCode(i: Pick<CodingInput, 'partnerName' | 'payer' | 'amountCents' | 'recentGifts'>): string {
  const name = `${i.partnerName || ''} ${i.payer || ''}`;
  const frequent = i.recentGifts >= 3;
  const big = (i.amountCents || 0) >= 100000;
  if (CHURCH_WORDS.test(name)) return frequent ? 'W200-LTCH' : 'W200-CH';
  if (FOUNDATION_WORDS.test(name)) return 'W200-GRAN';
  if (frequent) return 'W200-LTAD';
  return big ? 'W200-UNMG' : 'W200-UNID';
}

/** A fund the text names: its description appears in the text, or the text is its description. The longest, unambiguous one wins. */
export function fundInText(funds: FundOpt[], text: string | null | undefined): FundOpt | null {
  const t = ` ${norm(text)} `;
  if (t.trim().length < 4) return null;
  let best: FundOpt | null = null;
  let bestLen = 0;
  let tie = false;
  for (const f of funds) {
    const n = norm(f.name);
    if (n.length < 4) continue;
    if (t.includes(` ${n} `)) {
      if (n.length > bestLen) {
        best = f;
        bestLen = n.length;
        tie = false;
      } else if (n.length === bestLen && best && best.id !== f.id) tie = true;
    }
  }
  return tie ? null : best;
}

const dollars = (c: number | null) => (c == null ? '' : '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const monthDay = (iso: string) => new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** An expected gift fits when its amount is within a fifth of the gift (or unstated) and the date is within six weeks of it. */
export function expectedFits(e: Expected, amountCents: number | null, giftDate: string): boolean {
  const days = Math.abs(Date.parse(e.date.slice(0, 10) + 'T12:00:00Z') - Date.parse(giftDate + 'T12:00:00Z')) / 86400000;
  if (!(days <= 42)) return false;
  if (e.amountCents == null || !amountCents) return true;
  return Math.abs(e.amountCents - amountCents) <= Math.max(amountCents, e.amountCents) * 0.2;
}

export function proposeCoding(i: CodingInput): Coding {
  const suggestions: Suggestion[] = [];
  const sug = (a: AppealOpt | null, source: Suggestion['source'], reason: string) => {
    if (a && !suggestions.some((x) => x.appealId === a.id)) suggestions.push({ appealId: a.id, code: a.code, name: a.name, source, reason });
  };
  let appeal: AppealOpt | null = null;
  let appealSource: Coding['appealSource'] = '';
  let reason = '';
  const slip = findAppealByCode(i.appeals, i.slipAppeal);
  const letter = findAppealByCode(i.appeals, i.letterAppeal);
  if (slip) {
    appeal = slip; appealSource = 'slip'; reason = `Reply slip ${slip.code}`;
  } else if (letter) {
    appeal = letter; appealSource = 'letter'; reason = `Letter in the envelope names ${letter.code}`;
  }

  // Context that suggests but never decides.
  const expectedText = i.expected.map((e) => `${e.purpose || ''} ${e.text}`).join(' ');
  for (const e of i.expected) {
    const said = e.kind === 'opportunity' ? 'an expected gift' : 'a note';
    const why = `${monthDay(e.date)}: ${said}${e.amountCents != null ? ' of ' + dollars(e.amountCents) : ''} was logged${e.purpose ? ' for ' + e.purpose : ''}`;
    const a = codeInText(i.appeals, `${e.purpose || ''} ${e.text}`);
    if (a) sug(a, 'expected', why);
  }
  const m = codeInText(i.appeals, i.memo);
  sug(m, 'memo', m ? `The memo reads ${m.code}` : '');
  if (i.lastGift) {
    const h = i.appeals.find((a) => a.id === i.lastGift!.appealId);
    sug(h || null, 'history', h ? `The partner's last gift used ${h.code}` : '');
  }

  if (!appeal) {
    const w = findAppealByCode(i.appeals, whiteMailCode(i));
    if (w) { appeal = w; appealSource = 'white_mail'; reason = 'No slip or note: White Mail'; }
  }

  // The fund: the slip, the letter, an expected gift, then the memo.
  let fund: FundOpt | null = null;
  let fundSource: Coding['fundSource'] = 'default';
  let fundReason = '';
  const tryFund = (text: string | null | undefined, source: Coding['fundSource'], why: string) => {
    if (fund) return;
    const f = fundInText(i.funds, text);
    if (f) { fund = f; fundSource = source; fundReason = why; }
  };
  tryFund(i.slipDesignation, 'slip', 'Ticked on the reply slip');
  tryFund(i.letterPurpose, 'letter', 'Named in the letter');
  tryFund(expectedText, 'expected', 'Named in an expected gift');
  tryFund(i.memo, 'memo', 'Named in the memo');
  if (!fund) fund = i.funds.find((f) => f.id === WHERE_NEEDED_MOST) || { id: WHERE_NEEDED_MOST, code: '', name: 'Where Needed Most' };
  return { appeal, appealSource, reason, needsCoding: appealSource !== 'slip' && appealSource !== 'letter', suggestions, fund, fundSource, fundReason };
}

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
  /** An action's category (Phone call, Meeting, Email), for the reason line. */
  category?: string | null;
  /** The staff member on the action: a gift that follows their contact suggests their personal contact appeal. */
  who?: string | null;
  /** The sentence in the note that says a gift is coming. */
  said?: string | null;
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

/** Words in a fund name that do not tell one fund from another. */
const FUND_STOP = new Set(['of', 'the', 'for', 'and', 'in', 'a', 'an', 'any', 'to', 'at', 'general', 'project', 'program', 'campaign', 'match', 'purpose', 'only', 'fund']);
const stem = (w: string): string => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const words = (s: string | null | undefined): string[] => norm(s).split(' ').filter(Boolean);

/**
 * A fund the text describes without naming it word for word: every telling word of the fund's name is in the text ("the Chad wells"
 * is the fund 2025/2026 Chad Wells Match). The fund with the most words in the text wins; a tie names no fund. A fund of one word
 * counts only when the word has five letters or more.
 */
export function fundByWords(funds: FundOpt[], text: string | null | undefined): FundOpt | null {
  const have = new Set(words(text).map(stem));
  if (have.size < 1) return null;
  let best: FundOpt | null = null;
  let bestN = 0;
  let tie = false;
  for (const f of funds) {
    const raw = words(f.name).filter((w) => !FUND_STOP.has(w) && !/^\d+$/.test(w));
    if (!raw.length || (raw.length === 1 && raw[0].length < 5)) continue;
    const sig = [...new Set(raw.map(stem))];
    if (!sig.every((w) => have.has(w))) continue;
    if (sig.length > bestN) {
      best = f;
      bestN = sig.length;
      tie = false;
    } else if (sig.length === bestN && best && best.id !== f.id) tie = true;
  }
  return tie ? null : best;
}

const telling = (f: FundOpt): number => new Set(words(f.name).filter((w) => !FUND_STOP.has(w) && !/^\d+$/.test(w)).map(stem)).size;
/** The fund a text points to: named word for word or described by its words, whichever says more ("Chad wells" over "Wells"). */
export function fundFor(funds: FundOpt[], text: string | null | undefined): FundOpt | null {
  const a = fundInText(funds, text);
  const b = fundByWords(funds, text);
  if (a && b) return telling(b) > telling(a) ? b : a;
  return a || b;
}

/** The appeal a staff member's own contact brings in: "Gift due to personal contact, Celeste Paul". */
export function personalContactAppeal(appeals: AppealOpt[], who: string | null | undefined): AppealOpt | null {
  const n = norm(who);
  if (n.length < 4) return null;
  const hits = appeals.filter((a) => /personal contact/i.test(a.name) && !/partner care/i.test(a.name) && ` ${norm(a.name)} `.includes(` ${n} `));
  return hits.length === 1 ? hits[0] : null;
}

/** An appeal whose own title is written out in the text: the last part of its description, eight letters or more ("Turning Nations Webinar"). */
export function appealNamedIn(appeals: AppealOpt[], text: string | null | undefined): AppealOpt | null {
  const t = ` ${norm(text)} `;
  if (t.trim().length < 8) return null;
  let best: AppealOpt | null = null;
  let bestLen = 0;
  let tie = false;
  for (const a of appeals) {
    if (a.category === 'White Mail' || a.category === 'Portfolio') continue;
    const parts = String(a.name || '').split(',');
    const title = norm(parts[parts.length - 1]);
    if (parts.length < 2 || title.length < 8 || title.split(' ').length < 2 || /^(unidentified|gift after|email|sb|ad)\b/.test(title)) continue;
    if (!t.includes(` ${title} `)) continue;
    if (title.length > bestLen) {
      best = a;
      bestLen = title.length;
      tie = false;
    } else if (title.length === bestLen && best && best.id !== a.id) tie = true;
  }
  return tie ? null : best;
}

const GIFT_NOUN = String.raw`(?:\b(?:gifts?|checks?|cheques?|donations?|contributions?|money orders?|wire|stock gift)\b|\$\s?\d[\d,.]*k?)`;
const COMING = [
  // "a gift for the wells is on its way", "a check is in the mail", "$5,000 coming next week"
  new RegExp(String.raw`${GIFT_NOUN}[^.!?\n]{0,90}\b(?:is coming|are coming|coming (?:soon|next|this|in)|on (?:its|the|their) way|in the mail|will (?:be )?(?:sent|mailed|coming|arriving|here)|should (?:arrive|come|be here)|next (?:week|month)|by (?:the )?end of)\b`, 'i'),
  // "he will be sending two checks", "she plans to give $5,000", "they are going to mail a check"
  new RegExp(String.raw`\b(?:(?:will|would like to|going to|plans? to|planning to|wants? to|intends? to|promised to|committed to)\b[^.!?\n]{0,40}\b(?:send\w*|mail\w*|giv\w*|donat\w*|contribut\w*|wir\w*)|(?:is|are) (?:sending|mailing|wiring))\b[^.!?\n]{0,60}(?:${GIFT_NOUN}|\b(?:toward|towards|for the|to the|via|through|by check)\b)`, 'i'),
  // "pledged $10,000", "a pledge of", "expecting a gift"
  /\b(?:pledged|a pledge (?:of|for|toward)|expect\w* (?:a |the |their |his |her |another )?(?:gift|check|donation))\b/i,
  // "she will give as soon as she is back", "he plans to donate"
  /\b(?:will|plans? to|planning to|going to(?: be)?|intends? to)\s+(?:give|donate|be giving|be donating|donating)\b(?! (?:a talk|talks|me|us|you|him|her|them|it|an update|a call))/i,
];
// A sentence about a gift already in hand, a question about one, or something staff will send is not a gift on its way.
const NOT_COMING = /\b(?:received|thank(?:ed|ing| you)?|already (?:sent|gave|given|mailed)|did (?:we|you) (?:get|receive)|wanting to know|cancel\w*|refund\w*|declin\w*|follow[- ]?up|condolence|info(?:rmation)? pack|send (?:a |an )?(?:text|email|info\w*|update|mailer|card|letter|link)|pray about)\b/i;

/** The sentence of a note that says a gift is coming, or null when the note does not say so. */
export function comingGift(text: string | null | undefined): string | null {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length < 8) return null;
  for (const sentence of t.split(/(?<=[.!?])\s+/)) {
    if (sentence.length > 400 || NOT_COMING.test(sentence)) continue;
    if (COMING.some((re) => re.test(sentence))) return sentence.replace(/[.\s]+$/, '').trim();
  }
  return null;
}

const clip = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…');
const KIND: Record<string, string> = { 'phone call': 'call', meeting: 'meeting', email: 'email', mailing: 'letter', 'task/other': 'note' };

const dollars = (c: number | null) => (c == null ? '' : '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const monthDay = (iso: string) => new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * An expected gift fits when the amount and the timing agree. An opportunity: within a fifth of the gift (or unstated) and six weeks of
 * its expected date. A note that said a gift was coming: written in the two months before the gift, and the gift is no more than a
 * fifth over the amount said and at least a fifth of it (two checks toward one promise both fit).
 */
export function expectedFits(e: Expected, amountCents: number | null, giftDate: string): boolean {
  const days = Math.abs(Date.parse(e.date.slice(0, 10) + 'T12:00:00Z') - Date.parse(giftDate + 'T12:00:00Z')) / 86400000;
  if (!(days <= (e.kind === 'action' ? 62 : 42))) return false;
  if (e.amountCents == null || !amountCents) return true;
  if (e.kind === 'action') return amountCents <= e.amountCents * 1.2 && amountCents >= e.amountCents * 0.2;
  return Math.abs(e.amountCents - amountCents) <= Math.max(amountCents, e.amountCents) * 0.2;
}

/** The dollar amount a sentence states: "$5,000", "$50k", "$1.5 million". Null when it states none. */
export function amountIn(text: string | null | undefined): number | null {
  const m = String(text || '').match(/\$\s?([\d,]+(?:\.\d+)?)\s?(k|thousand|m|million)?\b/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = (m[2] || '').toLowerCase();
  return Math.round(n * (unit === 'k' || unit === 'thousand' ? 1000 : unit === 'm' || unit === 'million' ? 1000000 : 1) * 100);
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
  // Each expected gift with its reason line: "Sep 28 call: a gift for the Chad wells is on its way".
  const whyOf = (e: Expected): string => {
    if (e.kind === 'action' && e.said) return `${monthDay(e.date)} ${KIND[String(e.category || '').toLowerCase()] || 'note'}: ${clip(e.said, 110)}`;
    const said = e.kind === 'opportunity' ? 'an expected gift' : 'a note';
    return `${monthDay(e.date)}: ${said}${e.amountCents != null ? ' of ' + dollars(e.amountCents) : ''} was logged${e.purpose ? ' for ' + e.purpose : ''}`;
  };
  for (const e of i.expected) {
    const why = whyOf(e);
    const all = `${e.purpose || ''} ${e.text}`;
    // The appeal the note points to: a code written in it, an appeal named in it, then the personal contact appeal of whoever made the contact.
    const a = codeInText(i.appeals, all) || appealNamedIn(i.appeals, e.said || all) || (e.kind === 'action' ? personalContactAppeal(i.appeals, e.who) : null);
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
    if (w) {
      appeal = w; appealSource = 'white_mail';
      const unread = (i.slipAppeal || '').trim() ? `Slip reads ${i.slipAppeal!.trim()}, not in the appeal list` : (i.letterAppeal || '').trim() ? `Letter names ${i.letterAppeal!.trim()}, not in the appeal list` : '';
      reason = unread ? `${unread}: White Mail` : 'No slip or note: White Mail';
    }
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
  // An expected gift: the fund named word for word, then the fund its words describe. The sentence about the gift is read before the whole note.
  for (const e of i.expected) {
    if (fund) break;
    const all = `${e.purpose || ''} ${e.text}`;
    const f = fundFor(i.funds, `${e.purpose || ''} ${e.said || ''}`) || fundFor(i.funds, all);
    if (f) { fund = f; fundSource = 'expected'; fundReason = whyOf(e); }
  }
  tryFund(i.memo, 'memo', 'Named in the memo');
  if (!fund) fund = i.funds.find((f) => f.id === WHERE_NEEDED_MOST) || { id: WHERE_NEEDED_MOST, code: '', name: 'Where Needed Most' };
  return { appeal, appealSource, reason, needsCoding: appealSource !== 'slip' && appealSource !== 'letter', suggestions, fund, fundSource, fundReason };
}

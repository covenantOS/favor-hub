// Reading a check or reply slip from its photo. Two readers run on every photo (Workers AI, so the image stays inside Cloudflare)
// and the page highlights a field when they disagree. P0 (2026-10-10, 55 real check faces) picked Llama 4 Scout and Gemma 4:
// amount 94.5% each, check number 82% and 86%, and when both agreed on the amount they were right 96% of the time. Names scored
// 64 to 73% against the partner's record name, so the matcher and a person choose the partner, never the reader.
//
// Rules that live here, in code, not in a model's answer:
//  - a card number is found by a pattern check (13 to 19 digits that pass the Luhn test), never by a reader's flag;
//  - the routing and account line is never asked for and never stored;
//  - a date more than 45 days before the deposit, or after it, is highlighted (the readers drift on handwritten years).
import type { Env } from '../http';
import { aiFor, isAiPaused } from '../ai/guard';

/** The reader error when today's model allowance is used up or reading is switched off: the photo is kept for a person to type. */
export const READ_PAUSED = 'Reading is paused for today.';

export const READERS = [
  { key: 'scout', model: '@cf/meta/llama-4-scout-17b-16e-instruct', extra: {} as Record<string, unknown> },
  { key: 'gemma', model: '@cf/google/gemma-4-26b-a4b-it', extra: { max_tokens: 1500, chat_template_kwargs: { enable_thinking: false } } as Record<string, unknown> },
] as const;

export const PROMPT =
  'You are reading a photo of a mailed donation item: a check, cash note, or reply slip. Return ONLY a JSON object with these keys: ' +
  'doc_type (check, reply_slip, letter, other), amount_numeric (number from the box beside the dollar sign, no symbols), amount_words (the written-out amount), ' +
  'check_date (YYYY-MM-DD or null), payer_name (name printed at top left of the check, the account holder), payee (pay to the order of), ' +
  'check_number (the number at the top right of the check, not the bank routing line), memo (text on the memo or for line, or null), ' +
  'payer_address (street, city, state and ZIP printed under the name at top left of the check, or null), ' +
  'slip_appeal (an appeal or campaign code printed on a reply slip, or null), ' +
  'slip_designation (the fund or purpose the giver ticked or wrote on a reply slip, or null), ' +
  'purpose (on a letter or note: what the giver says the gift is for or which mailing it answers, as one short phrase, or null). ' +
  'Use null for anything you cannot read. Do not read or return the routing or account numbers.';

export interface ReaderFields {
  docType: string | null;
  amountCents: number | null;
  wordsCents: number | null;
  checkDate: string | null;
  payer: string | null;
  checkNumber: string | null;
  memo: string | null;
  slipAppeal: string | null;
  address: string | null;
  slipDesignation: string | null;
  purpose: string | null;
}

export interface ReaderResult {
  reader: string;
  model: string;
  fields: ReaderFields | null;
  secs: number;
  error: string | null;
  /** True when the raw answer held a number that looks like a card number. The answer is then dropped. */
  card: boolean;
}

/** 13 to 19 digits, allowing spaces and dashes between groups, that pass the Luhn test. */
export function hasCardNumber(text: string): boolean {
  const runs = String(text || '').match(/\d(?:[ -]?\d){12,18}/g) || [];
  for (const run of runs) {
    const digits = run.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) continue;
    let sum = 0;
    let dbl = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let d = digits.charCodeAt(i) - 48;
      if (dbl) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
      dbl = !dbl;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** "Five thousand two hundred and 50/100" -> 520050 cents. Null when it cannot be read as an amount. */
export function wordsToCents(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  let s = raw.toLowerCase().replace(/dollars?/g, ' ').replace(/[-,*]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  let cents = 0;
  const frac = s.match(/(\d{1,2})\s*\/\s*100/);
  if (frac) {
    cents = Number(frac[1]);
    s = s.replace(frac[0], ' ');
  }
  const cm = s.match(/(?:and\s+)?(\d{1,2})\s*cents?/);
  if (cm) {
    cents = Number(cm[1]);
    s = s.replace(cm[0], ' ');
  }
  let total = 0;
  let cur = 0;
  let seen = false;
  for (const w of s.split(' ')) {
    if (!w || w === 'and' || w === 'only' || w === 'no') continue;
    if (w in UNITS) {
      cur += UNITS[w];
      seen = true;
    } else if (w in TENS) {
      cur += TENS[w];
      seen = true;
    } else if (w === 'hundred') {
      cur = (cur || 1) * 100;
      seen = true;
    } else if (w === 'thousand') {
      total += (cur || 1) * 1000;
      cur = 0;
      seen = true;
    } else if (w === 'million') {
      total += (cur || 1) * 1_000_000;
      cur = 0;
      seen = true;
    } else if (/^\d+$/.test(w)) {
      return null;
    } else if (w !== 'xx') {
      return null;
    }
  }
  if (!seen) return null;
  return (total + cur) * 100 + cents;
}

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s && !/^(null|none|n\/a|unknown|unreadable)$/i.test(s) ? s : null;
};

function toCents(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n <= 0 || n > 10_000_000) return null;
  return Math.round(n * 100);
}

function toDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let y: number, m: number, d: number;
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else {
    const us = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
    if (!us) return null;
    [m, d, y] = [Number(us[1]), Number(us[2]), Number(us[3])];
    if (y < 100) y += 2000;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Pull the first JSON object out of a model answer, with or without a code fence. */
export function parseAnswer(text: string): Record<string, unknown> | null {
  const t = String(text || '');
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : t;
  const a = body.indexOf('{');
  const b = body.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    const o = JSON.parse(body.slice(a, b + 1));
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function normalizeFields(o: Record<string, unknown>): ReaderFields {
  const num = str(o.check_number);
  return {
    docType: str(o.doc_type),
    amountCents: toCents(o.amount_numeric),
    wordsCents: wordsToCents(o.amount_words),
    checkDate: toDate(o.check_date),
    payer: str(o.payer_name),
    checkNumber: num ? num.replace(/[^0-9A-Za-z]/g, '').slice(0, 12) || null : null,
    memo: str(o.memo) ? String(o.memo).slice(0, 200) : null,
    slipAppeal: str(o.slip_appeal) ? String(o.slip_appeal).slice(0, 40) : null,
    address: str(o.payer_address) ? String(o.payer_address).replace(/\s+/g, ' ').slice(0, 160) : null,
    slipDesignation: str(o.slip_designation) ? String(o.slip_designation).slice(0, 80) : null,
    purpose: str(o.purpose) ? String(o.purpose).slice(0, 120) : null,
  };
}

export function toDataUrl(bytes: Uint8Array, mime = 'image/jpeg'): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

/** The text of a Workers AI answer, whether the model returns chat choices or a plain response field. */
export function answerText(out: any): string {
  if (!out) return '';
  if (typeof out === 'string') return out;
  const c = out.choices && out.choices[0] && out.choices[0].message && out.choices[0].message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p: any) => (p && p.text) || '').join('');
  if (typeof out.response === 'string') return out.response;
  if (out.response && typeof out.response === 'object') return JSON.stringify(out.response);
  return '';
}

type Runner = (model: string, input: unknown) => Promise<unknown>;

export async function readWith(run: Runner, reader: (typeof READERS)[number], dataUrl: string): Promise<ReaderResult> {
  const started = Date.now();
  const base = { reader: reader.key, model: reader.model };
  try {
    let text = '';
    for (let attempt = 0; attempt < 2 && !text; attempt++) {
      const out = await run(reader.model, {
        messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: dataUrl } }] }],
        max_tokens: 600,
        temperature: 0,
        ...reader.extra,
      });
      text = answerText(out);
    }
    const secs = (Date.now() - started) / 1000;
    if (!text) return { ...base, fields: null, secs, error: 'no answer', card: false };
    const card = hasCardNumber(text);
    const obj = parseAnswer(text);
    if (!obj) return { ...base, fields: null, secs, error: 'answer was not readable', card };
    return { ...base, fields: card ? null : normalizeFields(obj), secs, error: null, card };
  } catch (e: any) {
    if (isAiPaused(e)) return { ...base, fields: null, secs: 0, error: READ_PAUSED, card: false };
    return { ...base, fields: null, secs: (Date.now() - started) / 1000, error: String(e && e.message ? e.message : e).slice(0, 200), card: false };
  }
}

export async function readPhoto(env: Pick<Env, 'AI'>, dataUrl: string): Promise<ReaderResult[]> {
  const ai = env.AI;
  if (!ai) return READERS.map((r) => ({ reader: r.key, model: r.model, fields: null, secs: 0, error: 'The reader is not connected.', card: false }));
  const tagged = aiFor(ai, 'check-reading');
  const run: Runner = (m, i) => tagged.run(m, i);
  return Promise.all(READERS.map((r) => readWith(run, r, dataUrl)));
}

// ---------------------------------------------------------------- comparing the two readers

export type FieldName = 'amount' | 'number' | 'date' | 'payer' | 'memo';
/** How sure the page is of a field: high when both readers agree and the checks pass, low when they disagree or nothing was read. */
export type Confidence = 'high' | 'medium' | 'low';
export type ConfKey = FieldName | 'address' | 'appeal' | 'designation';

export interface Merged {
  amountCents: number | null;
  checkNumber: string | null;
  checkDate: string | null;
  payer: string | null;
  memo: string | null;
  slipAppeal: string | null;
  address: string | null;
  slipDesignation: string | null;
  purpose: string | null;
  docType: string | null;
  /** Confidence per field, from the two readers and the rules below. */
  conf: Record<ConfKey, Confidence>;
  /** Fields where the readers disagree, or where a rule says look again. The page highlights each one. */
  flags: FieldName[];
  /** Why each field is flagged, in words a person reads. */
  why: Partial<Record<FieldName, string>>;
  /** What each reader said, for the drawer. */
  readers: { reader: string; fields: ReaderFields | null; error: string | null; secs: number }[];
  card: boolean;
  unreadable: boolean;
}

const sameText = (a: string | null, b: string | null) => (a || '').toLowerCase().replace(/[^a-z0-9]/g, '') === (b || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const dayNum = (iso: string) => Math.round(Date.parse(iso + 'T12:00:00Z') / 86400000);

export function mergeReads(results: ReaderResult[], depositDate: string): Merged {
  const ok = results.filter((r) => r.fields);
  const f = ok.map((r) => r.fields!);
  const flags = new Set<FieldName>();
  const why: Partial<Record<FieldName, string>> = {};
  const flag = (n: FieldName, msg: string) => {
    flags.add(n);
    if (!why[n]) why[n] = msg;
  };
  const pick = <T,>(get: (x: ReaderFields) => T | null): T | null => {
    for (const x of f) {
      const v = get(x);
      if (v != null) return v;
    }
    return null;
  };
  const card = results.some((r) => r.card);
  const unreadable = ok.length === 0;

  // amount: the readers must agree, and the figures must match the written words
  const amounts = f.map((x) => x.amountCents);
  let amount = pick((x) => x.amountCents);
  const paused = results.length > 0 && results.every((r) => r.error === READ_PAUSED);
  if (unreadable) flag('amount', paused ? 'Reading is paused for today. Type the amount.' : 'The photo could not be read. Type the amount.');
  else if (ok.length < 2) flag('amount', 'Only one reader answered. Check the amount.');
  else if (amounts[0] !== amounts[1]) flag('amount', `The readers disagree: ${money(amounts[0])} and ${money(amounts[1])}.`);
  for (const x of f) {
    if (x.amountCents != null && x.wordsCents != null && x.amountCents !== x.wordsCents) {
      flag('amount', `The figures say ${money(x.amountCents)} and the words say ${money(x.wordsCents)}.`);
      break;
    }
  }
  if (amount == null && !unreadable) flag('amount', 'No amount was read. Type it.');

  const nums = f.map((x) => x.checkNumber);
  const number = pick((x) => x.checkNumber);
  if (!unreadable) {
    if (ok.length >= 2 && !sameText(nums[0], nums[1])) flag('number', `The readers disagree: ${nums[0] || 'blank'} and ${nums[1] || 'blank'}.`);
    else if (number == null) flag('number', 'No check number was read.');
  }

  const dates = f.map((x) => x.checkDate);
  const date = pick((x) => x.checkDate);
  if (!unreadable) {
    if (ok.length >= 2 && dates[0] !== dates[1]) flag('date', `The readers disagree: ${dates[0] || 'blank'} and ${dates[1] || 'blank'}.`);
    else if (date) {
      const diff = dayNum(depositDate) - dayNum(date);
      if (diff < 0) flag('date', 'The check date is after the deposit date.');
      else if (diff > 45) flag('date', `The check date is ${diff} days before the deposit. Readers often miss the year.`);
    } else flag('date', 'No check date was read.');
  }

  const payers = f.map((x) => x.payer);
  const payer = pick((x) => x.payer);
  if (!unreadable && ok.length >= 2 && !sameText(payers[0], payers[1])) flag('payer', `The readers disagree: ${payers[0] || 'blank'} and ${payers[1] || 'blank'}.`);

  const memos = f.map((x) => x.memo);
  const memo = pick((x) => x.memo);
  if (!unreadable && ok.length >= 2 && !sameText(memos[0], memos[1]) && (memos[0] || memos[1])) flag('memo', 'The readers disagree on the memo line.');

  const addrs = f.map((x) => x.address);
  const address = pick((x) => x.address);
  const appeal = pick((x) => x.slipAppeal);
  const designation = pick((x) => x.slipDesignation);
  const two = ok.length >= 2;
  const agree = (a: unknown, b: unknown) => (typeof a === 'string' || typeof b === 'string' ? sameText(a as string | null, b as string | null) : a === b);
  const grade = (v: unknown, a: unknown, b: unknown, extraOk = true): Confidence => (v == null || unreadable ? 'low' : two ? (agree(a, b) && extraOk ? 'high' : agree(a, b) ? 'medium' : 'low') : 'medium');
  const wordsOk = f.every((x) => x.wordsCents == null || x.amountCents == null || x.wordsCents === x.amountCents);
  const wordsSeen = f.some((x) => x.wordsCents != null);
  const dateOk = !flags.has('date');
  const conf: Record<ConfKey, Confidence> = {
    amount: flags.has('amount') ? 'low' : grade(amount, amounts[0], amounts[1], wordsOk && wordsSeen),
    number: flags.has('number') ? 'low' : grade(number, nums[0], nums[1]),
    date: flags.has('date') ? (date && two && agree(dates[0], dates[1]) ? 'medium' : 'low') : grade(date, dates[0], dates[1], dateOk),
    payer: grade(payer, payers[0], payers[1]),
    memo: memo == null ? (unreadable ? 'low' : 'high') : two && sameText(memos[0], memos[1]) ? 'high' : 'medium',
    address: address == null ? 'low' : two && sameText(addrs[0], addrs[1]) ? 'high' : 'medium',
    appeal: appeal == null ? 'low' : two && sameText(f[0].slipAppeal, f[1].slipAppeal) ? 'high' : 'medium',
    designation: designation == null ? 'low' : two && sameText(f[0].slipDesignation, f[1].slipDesignation) ? 'high' : 'medium',
  };

  return {
    amountCents: amount,
    checkNumber: number,
    checkDate: date,
    payer,
    memo,
    slipAppeal: appeal,
    address,
    slipDesignation: designation,
    purpose: pick((x) => x.purpose),
    conf,
    docType: pick((x) => x.docType),
    flags: [...flags],
    why,
    readers: results.map((r) => ({ reader: r.reader, fields: r.fields, error: r.error, secs: Math.round(r.secs * 10) / 10 })),
    card,
    unreadable,
  };
}

function money(c: number | null): string {
  if (c == null) return 'blank';
  return '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

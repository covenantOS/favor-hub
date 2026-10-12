// Online gifts: what the partner wrote with the gift and the designation it asks for.
// Rules first. A model reads a comment only when no rule matched and the comment reads like a request for a fund
// (wantsModel), and only through the daily AI budget guard; when the guard holds the call, the rules' answer stands.
// Pure functions, no imports, so the node test runner loads this file directly.

export interface Fund {
  /** Blackbaud's system id for the fund (the gift split's fund_id). */
  id: string;
  /** The fund code (Blackbaud "Fund ID"), e.g. "Trauma Counseling". */
  code: string;
  /** The fund's description, e.g. "Uganda Wells". */
  name: string;
}

export interface Parsed {
  /** website: the favorintl.org giving form. form: a Blackbaud donation form batch. other: anything else. */
  source: 'website' | 'form' | 'other';
  /** The fund the giving form's dropdown named, from "Designation: X". */
  formDesignation: string;
  /** What the partner typed. On the giving form, the "Donor note"; elsewhere the whole comment. */
  note: string;
  monthly: boolean;
  tribute: boolean;
}

const WEBSITE = /via favorintl\.org/i;

export function parseReference(ref: string | null | undefined, opts: { fromForm?: boolean } = {}): Parsed {
  const text = String(ref || '').trim();
  if (WEBSITE.test(text)) {
    const parts = text.split(' | ');
    const des = parts.find((p) => /^Designation: /.test(p));
    const noteAt = text.indexOf('Donor note: ');
    const note = noteAt >= 0 ? text.slice(noteAt + 'Donor note: '.length).trim() : '';
    return { source: 'website', formDesignation: des ? des.slice('Designation: '.length).trim() : '', note, monthly: /^Monthly /i.test(text), tribute: TRIBUTE.test(note) };
  }
  return { source: opts.fromForm ? 'form' : 'other', formDesignation: '', note: text, monthly: false, tribute: TRIBUTE.test(text) };
}

const TRIBUTE = /\b(in (loving )?memory of|in hono(u)?r of|dedicated to)\b/i;

/** One rule: words in the comment, and the fund code they point to. Order matters: the more specific rule comes first. */
interface Rule {
  re: RegExp;
  code: string;
  word: string;
}

const near = (a: string, b: string) => new RegExp(`\\b(${a})\\b[^.!?]{0,60}\\b(${b})\\b|\\b(${b})\\b[^.!?]{0,60}\\b(${a})\\b`, 'i');
const word = (w: string) => new RegExp(`\\b(${w})\\b`, 'i');

export const RULES: Rule[] = [
  { re: near('chad', 'wells?'), code: '25/26 Chad Wells Mtc', word: 'Chad wells' },
  { re: near('uganda|ugandan', 'wells?'), code: 'UG wells', word: 'Uganda wells' },
  { re: near('south sudan|juba', 'wells?'), code: 'SS Wells', word: 'South Sudan wells' },
  { re: word('wells?|boreholes?|clean water'), code: 'Wells', word: 'wells' },
  { re: word('trauma|counseling|counselling'), code: 'Trauma Counseling', word: 'trauma counseling' },
  { re: near('chad', 'portable [a-z]+ schools?|pbs|bible schools?'), code: 'PBS Chad', word: 'Bible schools in Chad' },
  { re: word('portable [a-z]+ schools?|pbs|bible schools?'), code: 'PBS', word: 'Portable Bible Schools' },
  { re: word('bibles'), code: 'Bibles', word: 'Bibles' },
  { re: word('widows?|orphans?'), code: 'Widows and Orphans', word: 'widows and orphans' },
  { re: word('kotido|herbert'), code: 'Kotido HOP', word: 'Kotido' },
  { re: near('gulu', 'house of prayer|hop'), code: 'Gulu HOP', word: 'Gulu House of Prayer' },
  { re: near('chad', 'house of prayer'), code: 'HOP Chad', word: 'House of Prayer Chad' },
  { re: near('chad', 'radio'), code: 'Chad Radio', word: 'Chad radio' },
  { re: near('gulu', 'radio'), code: 'Radio- UG (Gulu)', word: 'Gulu radio' },
  { re: near('juba|south sudan', 'radio'), code: 'Radio- SS', word: 'South Sudan radio' },
  { re: word('destiny youth|youth revival'), code: 'Destiny Youth', word: 'Destiny Youth' },
  { re: word('sponsorship|sponsor a (child|student|youth)'), code: 'Sponsorship', word: 'sponsorship' },
  { re: word('sewing machines?|sewing'), code: 'Sewing Machines', word: 'sewing machines' },
  { re: word("women'?s empowerment|empowering women|women empowerment"), code: 'Women Empowerment', word: 'women' },
  { re: word('goats?'), code: 'Goats', word: 'goats' },
  { re: word('poultry|chickens?'), code: 'Poultry Project', word: 'poultry' },
  { re: word('bicycles?|bikes?'), code: 'Bicycles', word: 'bicycles' },
  { re: word('motorcycles?|motorbikes?'), code: 'Motorcycles Campaign', word: 'motorcycles' },
  { re: word('shoes'), code: 'Shoes for Africa', word: 'shoes' },
  { re: word('prisons?|prisoners?|inmates?'), code: 'Prisoners', word: 'prisoners' },
  { re: word('medical|clinics?|medicine'), code: 'Medical Supplies', word: 'medical' },
  { re: near('karamoja', 'food|hunger|feed'), code: 'Food for Karamoja', word: 'food for Karamoja' },
  { re: word('food|hunger|feed the hungry'), code: 'Food for Africa', word: 'food' },
  { re: word('vehicles?|trucks?'), code: 'Vehicle Purchase', word: 'vehicle' },
  { re: word('reep|rural evangelism'), code: 'REEP', word: 'REEP' },
  { re: word('missions? trip'), code: 'Missions Trip 2026', word: 'missions trip' },
  { re: word('missionary training'), code: 'Missionary Training', word: 'missionary training' },
  { re: word('mission station'), code: 'Mission Station', word: 'mission station' },
  { re: word('schools?|education|students?|uniforms?|tuition'), code: 'Education', word: 'education' },
  { re: word('economic empowerment'), code: 'Economic Empowerment', word: 'economic empowerment' },
  { re: word('evangelism|discipleship|crusades?'), code: 'E&Discp', word: 'evangelism' },
  { re: word('where (it is |it.s )?needed most|greatest need|wherever (it is )?needed'), code: 'Where Needed Most', word: 'where needed most' },
];

export interface Reading {
  fundId: string;
  /** comment: a rule matched the partner's words. model: the model read them. form: the giving form's own designation. none: nothing to go on. */
  by: 'comment' | 'model' | 'form' | 'none';
  /** The words that matched, for the row ("trauma counseling"). */
  word: string;
  /** Other funds the comment also named, most specific first. */
  also: string[];
}

export const fundByCode = (funds: Fund[], code: string): Fund | undefined => {
  const c = code.trim().toLowerCase();
  return funds.find((f) => f.code.toLowerCase() === c) || funds.find((f) => f.name.toLowerCase() === c);
};

/** The funds a comment names, by the rules, in rule order. Only funds that exist and are active count. */
export function rulesRead(note: string, funds: Fund[]): Array<{ fund: Fund; word: string }> {
  const out: Array<{ fund: Fund; word: string }> = [];
  if (!note) return out;
  for (const r of RULES) {
    if (!r.re.test(note)) continue;
    const f = fundByCode(funds, r.code);
    if (f && !out.some((x) => x.fund.id === f.id)) out.push({ fund: f, word: r.word });
  }
  return out;
}

/** A comment the rules could not place that still reads like a request for a fund. Only these go to the model. */
export function wantsModel(note: string): boolean {
  const n = note.trim();
  if (n.length < 12 || n.length > 600) return false;
  return /\b(designat\w*|towards?|specifically|exclusively|earmark\w*|go(es)? to|use (this|it) for|for the|for your)\b/i.test(n);
}

/**
 * The designation FavorOS reads for a gift. The comment wins over the form: a partner who picked "Where Needed Most" in the
 * dropdown and wrote "for the trauma care ministry" is read as Trauma Counseling. With no comment rule, the giving form's
 * designation (or the fund already on the gift) stands.
 */
export function readDesignation(p: Parsed, currentFundId: string, funds: Fund[], model?: { fundId: string } | null): Reading {
  const hits = rulesRead(p.note, funds);
  // "Where needed most" written in a comment that also names a fund ("where needed most, especially the widows") gives way to the fund.
  const real = hits.filter((h) => h.fund.code !== 'Where Needed Most');
  const pick = real[0] || hits[0];
  if (pick) return { fundId: pick.fund.id, by: 'comment', word: pick.word, also: (real.length ? real : hits).slice(1).map((h) => h.fund.id) };
  if (model && funds.some((f) => f.id === model.fundId)) return { fundId: model.fundId, by: 'model', word: '', also: [] };
  const form = p.formDesignation ? fundByCode(funds, p.formDesignation) : undefined;
  if (form) return { fundId: form.id, by: 'form', word: '', also: [] };
  return { fundId: currentFundId, by: currentFundId ? 'form' : 'none', word: '', also: [] };
}

/** The model's prompt: the fund list and the comment. The answer must be one code from the list or NONE. */
export function modelPrompt(note: string, funds: Fund[]): { system: string; user: string } {
  const list = funds.map((f) => `${f.code} = ${f.name}`).join('\n');
  return {
    system: 'You read a comment a partner wrote with a gift to Favor International and say which fund it asks the gift to go to. Answer with exactly one fund code from the list, or NONE when the comment does not ask for a fund (a prayer, a greeting, a tribute). No other words.\n\nFunds (code = name):\n' + list,
    user: note.slice(0, 600),
  };
}

/** The fund a model answer names, or null. */
export function fundFromAnswer(answer: unknown, funds: Fund[]): Fund | null {
  const raw = typeof answer === 'string' ? answer : answer && typeof answer === 'object' ? String((answer as { response?: unknown }).response ?? '') : '';
  const line = raw.trim().split('\n')[0].replace(/^["'`]|["'`.]$/g, '').trim();
  if (!line || /^none$/i.test(line)) return null;
  const code = line.split(' = ')[0].trim();
  return fundByCode(funds, code) || null;
}

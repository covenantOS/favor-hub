// Proposing the appeal and fund for a gift from its photo, in Favor's order:
//   appeal  1. the reply slip's code   2. a code written in the memo   3. the appeal on the partner's last gift (Admin Desk SOP)
//           4. White Mail by the decision table in the Appeal Codes note (church, foundation, frequent, size) when there is no history
//   fund    1. the designation on the slip   2. a fund named in the memo   3. Where Needed Most
// Pure functions: the caller supplies the catalog and the partner's history. A proposal is never final; a person approves the row.
import { WHERE_NEEDED_MOST } from './store';
import type { AppealOpt, FundOpt } from './match';

export type AppealSource = 'slip' | 'memo' | 'history' | 'white_mail' | '';
export type FundSource = 'slip' | 'memo' | 'default';

export interface CodingInput {
  slipAppeal: string | null;
  slipDesignation: string | null;
  memo: string | null;
  lastGift: { fundId: string; appealId: string } | null;
  funds: FundOpt[];
  appeals: AppealOpt[];
  partnerName: string | null;
  payer: string | null;
  amountCents: number | null;
  /** Donations from this partner in the 12 months before the gift, not counting recurring ones. */
  recentGifts: number;
}

export interface Coding {
  appeal: AppealOpt | null;
  appealSource: AppealSource;
  fund: FundOpt | null;
  fundSource: FundSource;
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

export function proposeCoding(i: CodingInput): Coding {
  let appeal: AppealOpt | null = null;
  let appealSource: AppealSource = '';
  const slip = findAppealByCode(i.appeals, i.slipAppeal);
  if (slip) {
    appeal = slip;
    appealSource = 'slip';
  }
  if (!appeal) {
    const m = codeInText(i.appeals, i.memo);
    if (m) {
      appeal = m;
      appealSource = 'memo';
    }
  }
  if (!appeal && i.lastGift) {
    const h = i.appeals.find((a) => a.id === i.lastGift!.appealId);
    if (h) {
      appeal = h;
      appealSource = 'history';
    }
  }
  if (!appeal) {
    const w = findAppealByCode(i.appeals, whiteMailCode(i));
    if (w) {
      appeal = w;
      appealSource = 'white_mail';
    }
  }

  let fund: FundOpt | null = null;
  let fundSource: FundSource = 'default';
  const fromSlip = fundInText(i.funds, i.slipDesignation);
  if (fromSlip) {
    fund = fromSlip;
    fundSource = 'slip';
  }
  if (!fund) {
    const fromMemo = fundInText(i.funds, i.memo);
    if (fromMemo) {
      fund = fromMemo;
      fundSource = 'memo';
    }
  }
  if (!fund) fund = i.funds.find((f) => f.id === WHERE_NEEDED_MOST) || { id: WHERE_NEEDED_MOST, code: '', name: 'Where Needed Most' };
  return { appeal, appealSource, fund, fundSource };
}

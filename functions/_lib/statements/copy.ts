// The words on a giving statement. Each field is an Admin setting (Admin, Giving statements), so wording changes
// never need a deploy. The starting text is the year-end statement the Partner Portal already issues (EIN, the IRS
// acknowledgment, "no goods or services") and the letterhead footer line in US Team Files. Michael Hinton and
// Favor's CPA approve the final wording.
//
// Marks: {from} {to} {period} {year} fill in on the page.

export interface WordingField {
  key: keyof StatementCopy;
  /** Admin setting id. */
  id: string;
  label: string;
  hint: string;
  max: number;
}

export interface StatementCopy {
  title: string;
  titleYearEnd: string;
  intro: string;
  goods: string;
  tax: string;
  notDeductible: string;
  noncash: string;
  soft: string;
  refund: string;
  closing: string;
  signer: string;
  signerTitle: string;
  contact: string;
  footer: string;
}

export const DEFAULT_COPY: StatementCopy = {
  title: 'Giving statement',
  titleYearEnd: 'Year-end giving statement',
  intro: 'Thank you for your generosity to Favor International. This statement lists the gifts we received from you for {period}.',
  goods: 'No goods or services were provided in exchange for these contributions.',
  tax: 'Favor International, Inc. is a tax-exempt organization under Section 501(c)(3) of the Internal Revenue Code, EIN 47-5225697. Your gifts are tax-deductible to the fullest extent allowed by law. Please keep this statement with your tax records.',
  notDeductible: 'These payments are not tax-deductible contributions. They are not counted in the total above.',
  noncash: 'A gift marked with an asterisk was stock or another non-cash item. The amount shown is the value Favor recorded. Favor does not appraise property, and the value you claim is your responsibility.',
  soft: 'These gifts were made through a fund, foundation or business on your recommendation. The organization that made each gift received its own acknowledgment, so they are not counted in your total.',
  refund: 'Refunds and returned gifts are subtracted from your total.',
  closing: 'With gratitude,',
  signer: 'Favor International',
  signerTitle: '',
  contact: 'Questions about this statement? Call 941-444-9940 or email info@favorintl.org.',
  footer: 'Favor International   ·   3433 Lithia Pinecrest Rd #356, Valrico, FL 33596   ·   941-444-9940   ·   favorintl.org',
};

export const WORDING: WordingField[] = [
  { key: 'title', id: 'statements.w.title', label: 'Title, single statement', hint: 'The heading on a statement made on request.', max: 80 },
  { key: 'titleYearEnd', id: 'statements.w.title_year_end', label: 'Title, year-end statement', hint: 'The heading on the January tax statements.', max: 80 },
  { key: 'intro', id: 'statements.w.intro', label: 'Opening line', hint: '{period} becomes the year or the dates.', max: 500 },
  { key: 'goods', id: 'statements.w.goods', label: 'Goods or services', hint: 'The IRS acknowledgment line. Change it only with the CPA.', max: 500 },
  { key: 'tax', id: 'statements.w.tax', label: 'Tax-exempt status and EIN', hint: 'Prints under the total.', max: 700 },
  { key: 'notDeductible', id: 'statements.w.not_deductible', label: 'Under the not-deductible list', hint: 'Prints when a statement lists payments that are not tax-deductible.', max: 400 },
  { key: 'noncash', id: 'statements.w.noncash', label: 'Stock and in-kind note', hint: 'Prints when a statement lists a non-cash gift.', max: 600 },
  { key: 'soft', id: 'statements.w.soft', label: 'Under the through-a-fund list', hint: 'Prints when a statement lists gifts made through a fund or foundation.', max: 600 },
  { key: 'refund', id: 'statements.w.refund', label: 'Refund note', hint: 'Prints when a statement has a refund.', max: 300 },
  { key: 'closing', id: 'statements.w.closing', label: 'Closing', hint: '', max: 60 },
  { key: 'signer', id: 'statements.w.signer', label: 'Signed by', hint: '', max: 80 },
  { key: 'signerTitle', id: 'statements.w.signer_title', label: 'Title under the name', hint: 'Blank prints the name only.', max: 80 },
  { key: 'contact', id: 'statements.w.contact', label: 'Contact line', hint: '', max: 300 },
  { key: 'footer', id: 'statements.w.footer', label: 'Letterhead footer', hint: 'The line at the foot of every page.', max: 220 },
];

/** Saved text where it is a clean single paragraph, the default everywhere else. */
export function cleanCopy(saved: Partial<Record<keyof StatementCopy, unknown>> | null | undefined): StatementCopy {
  const out = { ...DEFAULT_COPY };
  for (const f of WORDING) {
    const v = saved ? saved[f.key] : undefined;
    if (typeof v === 'string') {
      const t = v.replace(/\s+/g, ' ').trim().slice(0, f.max);
      // A blank signer title is allowed; every other field falls back to its default when blank.
      if (t || f.key === 'signerTitle') out[f.key] = t;
    }
  }
  return out;
}

export function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

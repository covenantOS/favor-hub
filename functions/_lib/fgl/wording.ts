// The words of the first-gift letter, kept in one place. A partner whose first gift came from an Acquisition mailing gets a modified
// thank-you letter (Thank you letter strategy 2025: "a slightly altered version of the regular thank you letter"). Partner Care's own
// template is an InDesign file on Drive that cannot be read as text, so the default below is the regular thank-you letter's body (the
// copy in use since March 2025, functions/_lib/receipts/letter.ts) with a welcome added to the first sentence. Partner Care edits it on
// the page; the saved copy replaces this one and every batch keeps the wording it was made with.
import { HQTY_SIGNERS, merge, paragraphsOf, longDate, type LetterDoc } from '../work/letters';
import type { Letter } from '../receipts/rules';

export const SIGNER_KEYS = ['carole', 'terry', 'rachel', 'michael'] as const;
export type SignerKey = (typeof SIGNER_KEYS)[number];

export interface Wording {
  /** Paragraphs separated by a blank line. Fields: {amount}, {fund}, {date}. */
  text: string;
  closing: string;
  /** 'full' prints "Dear Linda Hertzman,". 'first' prints "Dear Linda,". */
  greeting: 'full' | 'first';
  /** The signer a new print file starts with. */
  signer: SignerKey;
}

export const DEFAULT_WORDING: Wording = {
  text: `Welcome to the Favor International family, and thank you for your first gift of {amount}! Your kindness makes an impact in the lives of people across Africa.

Our missionaries travel to remote areas in South Sudan, Uganda, Chad, and seven other nations to share the Gospel through our Portable Bible Schools (PBSs). Over the course of 3-4 months, students receive biblical teachings, discipleship, trauma counseling, their own Bibles, and so much more!

Through our GIFT children’s home (GIFT), we’re able to rescue hundreds of street children from homelessness and hunger. Your support provides these vulnerable kids with a place of belonging. They receive education, meals, a place to sleep, and the love of Jesus.

We can’t thank you enough for your compassion for God’s people. We love and pray for you every day.`,
  closing: 'With Joy,',
  greeting: 'full',
  signer: 'carole',
};

export const MAX_TEXT = 2500;

const known = (k: unknown): k is SignerKey => (SIGNER_KEYS as readonly string[]).includes(String(k));

/** Keep a saved copy only where it is well formed; anything else falls back to the default. */
export function cleanWording(value: unknown): Wording {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<Wording>;
  const text = String(v.text ?? '').replace(/\r\n/g, '\n').trim().slice(0, MAX_TEXT).replace(/\{(?!amount\}|fund\}|date\})[^}\n]{0,30}\}/g, '');
  const closing = String(v.closing ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return {
    text: paragraphsOf(text).length ? text : DEFAULT_WORDING.text,
    closing: closing || DEFAULT_WORDING.closing,
    greeting: v.greeting === 'first' ? 'first' : 'full',
    signer: known(v.signer) ? v.signer : DEFAULT_WORDING.signer,
  };
}

export function signerOf(key: string): { key: SignerKey; name: string; title: string } {
  const k: SignerKey = known(key) ? key : DEFAULT_WORDING.signer;
  return { key: k, name: HQTY_SIGNERS[k].name, title: HQTY_SIGNERS[k].title };
}

export const SIGNER_CHOICES = SIGNER_KEYS.map((k) => ({ key: k, label: HQTY_SIGNERS[k].label, title: HQTY_SIGNERS[k].title }));

/** One page: the receipts engine's Letter (name, address, gifts) in the saved wording. */
export function docFor(l: Letter, w: Wording, letterDate: string, signer: SignerKey): LetterDoc {
  const s = signerOf(signer);
  const greetName = w.greeting === 'first' ? l.greetingFirst : l.greetingFull;
  return {
    dateLine: longDate(letterDate),
    addressLines: [l.addressee, ...l.addressLines, l.cityLine].filter(Boolean),
    greeting: `Dear ${greetName},`,
    paragraphs: paragraphsOf(merge(w.text, { amount: l.amount, date: l.giftDate, fund: l.fund })),
    closing: w.closing,
    signerName: s.name,
    signerTitle: s.title,
  };
}

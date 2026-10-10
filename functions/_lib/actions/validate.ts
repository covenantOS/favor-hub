import type { Params } from './params.ts';
import { DEFAULTS } from './params.ts';
import { contactTypeSet } from './contact-types.ts';

// validateAction: the save-time checks of spec 5.2 (rules baked into the model) and 5.6 (Support intake validation).
// Staff-facing wording: "partner", never "donor". Nothing here mentions how a message was produced.

export interface ActionDraft {
  category: string | null;
  type: string | null;
  status: 'open' | 'completed' | 'canceled';
  dueDate: string;
  summary?: string | null;
  description?: string | null;
  askAmount?: number | string | null; // the Amount of Ask field
  askType?: 'special' | 'recurring' | 'increase' | 'host' | 'referrals' | null; // spec 5.2 ask_type
  referrals?: number | null; // Number of Referrals
  thanked?: boolean;
  fundraisers?: string[];
}

export interface Issue {
  code: string;
  field: string;
  message: string;
}

export interface Validation {
  ok: boolean; // no errors
  errors: Issue[]; // save is blocked
  warnings: Issue[]; // save is allowed, the person sees it
  confirms: Issue[]; // save needs an explicit "yes, that is right"
  split: { purpose: string; text: string }[] | null; // proposed one-action-per-purpose rows
}

// The "ask" purposes in spec 5.2 ask_type: special, recurring, increase, host, referrals.
// (The spec calls them the Four Asks and lists five.) Patterns are mine; the owner confirms them.
const PURPOSES: { purpose: string; re: RegExp }[] = [
  { purpose: 'special', re: /special gift|one[- ]time gift/i },
  { purpose: 'recurring', re: /recurring|monthly gift|monthly partner/i },
  { purpose: 'increase', re: /\bincrease|upgrade/i },
  { purpose: 'host', re: /\bhost(?:ing|ed)?\b|house party/i },
  { purpose: 'referrals', re: /referral/i },
];
const THANK_PURPOSE = { purpose: 'thanks', re: /thank|\bty\b/i };

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const bare = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, '').trim();

function purposesIn(text: string, p: Params) {
  const list = p.ONE_PURPOSE_COUNT_THANKS ? [...PURPOSES, THANK_PURPOSE] : PURPOSES;
  return list.filter((x) => x.re.test(text)).map((x) => x.purpose);
}

/** Split "special gift and recurring gift" into one row per purpose. Returns null when there is only one. */
export function splitPurposes(summary: string, p: Params = DEFAULTS): { purpose: string; text: string }[] | null {
  const found = purposesIn(summary, p);
  if (found.length < 2) return null;
  const pieces = summary.split(/\s*(?:,|;|\band\b|&|\+)\s*/i).map((s) => s.trim()).filter(Boolean);
  const out: { purpose: string; text: string }[] = [];
  for (const purpose of found) {
    const piece = pieces.find((t) => (PURPOSES.concat([THANK_PURPOSE]).find((x) => x.purpose === purpose)!).re.test(t));
    out.push({ purpose, text: piece ?? summary });
  }
  return out;
}

export function validateAction(d: ActionDraft, p: Params = DEFAULTS): Validation {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const confirms: Issue[] = [];
  const add = (list: Issue[], code: string, field: string, message: string) => list.push({ code, field, message });
  const summary = (d.summary ?? '').trim();
  const description = (d.description ?? '').trim();
  const contactTypes = contactTypeSet('counts_for_portfolio');
  const isContact = (d.type !== null && contactTypes.has(d.type)) || (d.category !== null && d.category !== 'Task/Other');

  if (!/^\d{4}-\d{2}-\d{2}/.test(d.dueDate ?? '')) add(errors, 'due_date_required', 'dueDate', 'Add the date of the contact or the date the task is due.');

  // Summary rules (spec 5.2 rules; 255 is the Blackbaud limit, spec 2.1 and 4.12).
  if (summary.length > p.SUMMARY_MAX_LENGTH) add(errors, 'summary_too_long', 'summary', `The summary is ${summary.length} characters. The limit is ${p.SUMMARY_MAX_LENGTH}. Move the detail to the note.`);
  if (d.status === 'completed' && isContact && !summary) add(description ? warnings : errors, 'summary_required', 'summary', 'Say what happened in a sentence a stranger could read in five years.');
  if (summary && p.BARE_CHANNEL_WORDS.includes(bare(summary))) add(description ? warnings : errors, 'summary_bare_channel', 'summary', `"${summary}" names the channel and nothing else. Say what was discussed.`);
  if (summary && !description && !p.BARE_CHANNEL_WORDS.includes(bare(summary)) && words(summary).length < p.SUMMARY_MIN_WORDS_WITHOUT_DESCRIPTION) {
    add(warnings, 'summary_short', 'summary', `Fewer than ${p.SUMMARY_MIN_WORDS_WITHOUT_DESCRIPTION} words and no note. Add a line so the record stands alone.`);
  }

  // Ask amount (spec 5.2: numeric, 0 to a ceiling; warn above 100,000, confirm above 1,000,000).
  if (d.askAmount !== undefined && d.askAmount !== null && d.askAmount !== '') {
    const n = typeof d.askAmount === 'number' ? d.askAmount : Number(String(d.askAmount).replace(/[$,\s]/g, ''));
    if (!Number.isFinite(n) || n < 0) add(errors, 'ask_not_numeric', 'askAmount', 'The ask must be a number, zero or more.');
    else if (n > p.ASK_CONFIRM_ABOVE) add(confirms, 'ask_confirm', 'askAmount', `An ask of $${n.toLocaleString('en-US')} is above $${p.ASK_CONFIRM_ABOVE.toLocaleString('en-US')}. Confirm the amount.`);
    else if (n > p.ASK_WARN_ABOVE) add(warnings, 'ask_high', 'askAmount', `An ask of $${n.toLocaleString('en-US')} is above $${p.ASK_WARN_ABOVE.toLocaleString('en-US')}. Check the zeros.`);
  } else if (d.askAmount === '') {
    add(errors, 'ask_empty_string', 'askAmount', 'Leave the ask blank or enter a number. An empty entry is not stored.'); // 323 rows hold '' today (spec 2.1)
  }
  if (d.askType && d.askType !== 'referrals' && (d.askAmount === undefined || d.askAmount === null || d.askAmount === '')) {
    add(errors, 'ask_needs_amount', 'askAmount', 'An ask needs an amount.'); // spec 5.6
  }

  // Referrals (spec 5.6, VID-040 05:12-06:46): a count in the field and the names in the note.
  if (d.askType === 'referrals' && !(d.referrals && d.referrals > 0)) add(errors, 'referrals_need_count', 'referrals', 'Enter how many referrals the partner gave.');
  if (d.referrals && d.referrals > 0 && !description) add(errors, 'referrals_need_names', 'description', 'Put the names of the referrals in the note.');

  // Thank types require the Thanked field (spec 5.6). A thank-you in the wording without the field is a warning.
  if (d.type && p.THANK_TYPES.includes(d.type) && !d.thanked) add(errors, 'thanked_required', 'thanked', 'This type records a thank-you. Mark Thanked.');
  else if (!d.thanked && d.status === 'completed' && p.STRICT_SUMMARY_PATTERN.test(summary) && /thank|\bty\b/i.test(summary)) {
    add(warnings, 'thanked_missing', 'thanked', 'The summary says thank. Mark Thanked so the thank-you counts.');
  }

  // One purpose per action (spec 5.6, VID-040).
  const split = summary ? splitPurposes(summary, p) : null;
  if (split) add(confirms, 'one_purpose', 'summary', `This reads as ${split.length} purposes (${split.map((s) => s.purpose).join(', ')}). Save one action for each.`);

  // Owner (spec 6, ACT-078).
  if (p.REQUIRE_OWNER !== 'off' && !(d.fundraisers && d.fundraisers.length)) {
    add(p.REQUIRE_OWNER === 'error' ? errors : warnings, 'owner_missing', 'fundraisers', 'No one is assigned, so this action shows on nobody\'s list.');
  }

  return { ok: errors.length === 0, errors, warnings, confirms, split };
}

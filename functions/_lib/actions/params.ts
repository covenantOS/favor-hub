// Every threshold and switch in this package is named here, with the value the spec proposes, where the
// spec says so, and the open question with the person to ask. Nothing is hard-coded in the functions.
// Spec = Q:\work\favor-bb-audit\specs\actions-and-work-center.md. Q numbers are its section 8.

export interface Params {
  GROUP_WINDOW_DAYS: number;
  CADENCE_WINDOW_DAYS: number;
  ADOPT_DATE_WINDOW_DAYS: number;
  AMOUNT_WHOLE_DOLLAR_MATCH: boolean;
  SATISFIER_AMOUNT_CONFLICT: boolean;
  HQ_LETTER_MIN_AMOUNT: number;
  PERSONAL_THANKS_MIN_AMOUNT: number;
  STRICT_SUMMARY_PATTERN: RegExp;
  STRICT_USE_THANKED_TAG: boolean;
  STRICT_USE_DESCRIPTION: boolean;
  SATISFIER_DATE_FIELD: 'dateAdded' | 'dueDate';
  LOOSE_COUNTS_NON_TASK_CATEGORIES: boolean;
  STALE_DAYS: number;
  CLOSE_PROPOSAL_DAYS: number;
  ESCALATE_AFTER_DAYS: number;
  OVER_YEAR_DAYS: number;
  REVIEW_ESCALATE_DAYS: number;
  NEVER_AUTOCLOSE_GIFT_AMOUNT: number;
  ASSIGNMENT_TYPE_ORDER: string[];
  FALLBACK_TEAM: string;
  ASK_WARN_ABOVE: number;
  ASK_CONFIRM_ABOVE: number;
  SUMMARY_MAX_LENGTH: number;
  SUMMARY_MIN_WORDS_WITHOUT_DESCRIPTION: number;
  BARE_CHANNEL_WORDS: string[];
  THANK_TYPES: string[];
  REQUIRE_OWNER: 'error' | 'warn' | 'off';
  ONE_PURPOSE_COUNT_THANKS: boolean;
}

export const DEFAULTS: Params = {
  GROUP_WINDOW_DAYS: 0,
  CADENCE_WINDOW_DAYS: 90,
  ADOPT_DATE_WINDOW_DAYS: 3,
  AMOUNT_WHOLE_DOLLAR_MATCH: true,
  SATISFIER_AMOUNT_CONFLICT: true,
  HQ_LETTER_MIN_AMOUNT: 5000,
  PERSONAL_THANKS_MIN_AMOUNT: 0,
  STRICT_SUMMARY_PATTERN: /thank|\bty\b|\bsent\b/i,
  STRICT_USE_THANKED_TAG: true,
  STRICT_USE_DESCRIPTION: false,
  SATISFIER_DATE_FIELD: 'dateAdded',
  LOOSE_COUNTS_NON_TASK_CATEGORIES: true,
  STALE_DAYS: 30,
  CLOSE_PROPOSAL_DAYS: 90,
  ESCALATE_AFTER_DAYS: 14,
  OVER_YEAR_DAYS: 365,
  REVIEW_ESCALATE_DAYS: 14,
  NEVER_AUTOCLOSE_GIFT_AMOUNT: 1000,
  ASSIGNMENT_TYPE_ORDER: ['Regional Development Director (RDD)', 'Partner Care', 'Prospect Steward'],
  FALLBACK_TEAM: 'Partner Care',
  ASK_WARN_ABOVE: 100000,
  ASK_CONFIRM_ABOVE: 1000000,
  SUMMARY_MAX_LENGTH: 255,
  SUMMARY_MIN_WORDS_WITHOUT_DESCRIPTION: 3,
  BARE_CHANNEL_WORDS: ['text', 'texts', 'texted', 'txt', 'call', 'called', 'email', 'emailed', 'mailed', 'voicemail', 'vm', 'letter', 'card', 'met', 'meeting', 'sent'],
  THANK_TYPES: ['RESERVED (HQTY Letter)'],
  REQUIRE_OWNER: 'warn',
  ONE_PURPOSE_COUNT_THANKS: false,
};

export interface ParamDoc {
  spec: string; // where the value comes from
  question: string; // what is still open
  ask: string; // who answers it
}

export const PARAM_DOCS: Record<keyof Params, ParamDoc> = {
  GROUP_WINDOW_DAYS: {
    spec: 'Spec 5.4.6: window default 0 days until Q4 is answered. Read here as 0 = grouping off (see DECISIONS.md D-GROUP-0).',
    question: 'Q14: how many days apart can two one-time gifts from one partner be and still get one letter?',
    ask: 'Leadership',
  },
  CADENCE_WINDOW_DAYS: {
    spec: 'Spec 5.4.6 and Department Manuals L116: monthly partners under $1,000 get a call and card every three months. 90 days is that reading.',
    question: 'Does a recurring payment owe a per-payment letter, a quarterly cadence touch, or both? UNKNOWN in the spec.',
    ask: 'Leadership',
  },
  ADOPT_DATE_WINDOW_DAYS: {
    spec: 'Spec 5.4.4: task date within three days of a gift entered date.',
    question: 'Is three days right for tasks Support enters after the fact?',
    ask: 'Leadership',
  },
  AMOUNT_WHOLE_DOLLAR_MATCH: {
    spec: 'Not in the spec. Actions 121282 ("$42") and 121284 ("$42.49") name one $42.49 gift, so a typed whole dollar has to match the cents.',
    question: 'Keep whole-dollar matching?',
    ask: 'Will',
  },
  SATISFIER_AMOUNT_CONFLICT: {
    spec: 'Engine audit 4, satisfier item 2: a later thank-you that names a different amount than the gift does not answer that gift (task 125295 against a $100 thank-you).',
    question: 'Keep the amount check?',
    ask: 'Will',
  },
  HQ_LETTER_MIN_AMOUNT: {
    spec: 'Spec 5.4.2 and Department Manuals L61: $5,000 and over.',
    question: 'Q3: do $5,000 and over gifts owe both the HQTY letter and the RDD thank-you?',
    ask: 'Leadership',
  },
  PERSONAL_THANKS_MIN_AMOUNT: {
    spec: 'Spec Q1 asks for the cutoff. 0 = every gift owes a thank-you (the RDD manual says every gift within 24 hours, L125).',
    question: 'Q1: is there a dollar floor, and who owes the letter for an RDD-credited gift?',
    ask: 'Leadership',
  },
  STRICT_SUMMARY_PATTERN: {
    spec: 'Spec 5.4.3: /thank|\\bty\\b|sent/i on the summary. "sent" is now a whole word, so present, consent and Presented no longer match (engine audit 4).',
    question: 'None.',
    ask: 'Leadership',
  },
  STRICT_USE_THANKED_TAG: {
    spec: 'Spec 5.4.3 lists "carries Thanked" as a strict signal. The 84 in the spec reproduces without it; with it the count is 97.',
    question: 'Does the Thanked tag prove a thank-you for the gift in question, or only the call it sits on?',
    ask: 'Leadership',
  },
  STRICT_USE_DESCRIPTION: {
    spec: 'Not in the spec (summary only). Searching the description raises the strict count from 84 to 113 in D1.',
    question: 'Should the description count as thank wording?',
    ask: 'Leadership',
  },
  SATISFIER_DATE_FIELD: {
    spec: 'Spec 5.4.3 says "dated on or after the gift entered date". dateAdded reproduces the spec counts and follows followups.js:198; dueDate is the contact date Support backdates.',
    question: 'Which date proves the contact came after the gift?',
    ask: 'Will',
  },
  LOOSE_COUNTS_NON_TASK_CATEGORIES: {
    spec: 'Spec says "any completed contact". The 125 loose matches reproduce only when a call, email, mailing or meeting counts even if its type is not a contact type.',
    question: 'Is a completed call, email, mailing or meeting of any type a contact?',
    ask: 'Leadership',
  },
  STALE_DAYS: { spec: 'Spec 5.5 S3: past due over 30 days is Stale.', question: 'Q6: are 30, 90 and 14 days right?', ask: 'Leadership' },
  CLOSE_PROPOSAL_DAYS: { spec: 'Spec 5.5 S3: over 90 days gets a weekly close proposal.', question: 'Q6.', ask: 'Leadership' },
  ESCALATE_AFTER_DAYS: { spec: 'Spec 5.5 S3: an owner who does not answer in 14 days escalates to the team lead.', question: 'Q6, and who answers for a departed RDD.', ask: 'Leadership' },
  OVER_YEAR_DAYS: { spec: 'Spec 2.5: true open and due more than a year ago (14 today).', question: 'None. A reporting cut, not a rule.', ask: 'none' },
  REVIEW_ESCALATE_DAYS: { spec: 'Spec 5.5 S7: a review task open over 14 days goes to Will.', question: 'Q6.', ask: 'Leadership' },
  NEVER_AUTOCLOSE_GIFT_AMOUNT: { spec: 'Spec 5.5 S3: tasks tied to a gift of $1,000 or more never auto-close.', question: 'Q6.', ask: 'Leadership' },
  ASSIGNMENT_TYPE_ORDER: {
    spec: 'Not in the spec. followups.js assigns every current holder. This order picks one primary owner and lists the rest as also-owners (DECISIONS.md D-OWNER-1).',
    question: 'When a partner has an RDD, a Partner Care holder and a steward, who owns the letter?',
    ask: 'Leadership',
  },
  FALLBACK_TEAM: { spec: 'Spec 5.4.2: owner falls back to Partner Care.', question: 'Q1.', ask: 'Leadership' },
  ASK_WARN_ABOVE: { spec: 'Spec 5.2: warn above $100,000.', question: 'Who owns the ceiling? 246 asks sit at $100,000 or more today.', ask: 'Leadership' },
  ASK_CONFIRM_ABOVE: { spec: 'Spec 5.2: confirm above $1,000,000 (15 asks at or above that today).', question: 'Same.', ask: 'Leadership' },
  SUMMARY_MAX_LENGTH: { spec: 'Spec 2.1 and 4.12: 255 characters, the Blackbaud limit.', question: 'None.', ask: 'none' },
  SUMMARY_MIN_WORDS_WITHOUT_DESCRIPTION: { spec: 'Spec 5.2: warning for fewer than three words without a description.', question: 'Who owns the exact note rule (All Staff 2026 L52)?', ask: 'Leadership' },
  BARE_CHANNEL_WORDS: { spec: 'Spec 5.2: a summary must not equal a bare channel word ("Texted" is not a note). The list is mine, built from D1 summaries.', question: 'Which words belong on the list?', ask: 'Leadership' },
  THANK_TYPES: { spec: 'Spec 5.6: "every Thank type requires Thanked". The catalog has no type named Thank; HQTY Letter is the closest.', question: 'Which types are thank types?', ask: 'Leadership' },
  REQUIRE_OWNER: { spec: 'Spec 6 and ACT-078: Assign To is required in the form, optional in the API. 419 actions have none.', question: 'Does the new model allow ownerless actions?', ask: 'Leadership' },
  ONE_PURPOSE_COUNT_THANKS: { spec: 'Spec 5.6: one action per purpose. Counting a thank-you as a purpose flags "thanked for the recurring gift", so it is off.', question: 'Is a thank-you plus an ask in one call two purposes?', ask: 'Leadership' },
};

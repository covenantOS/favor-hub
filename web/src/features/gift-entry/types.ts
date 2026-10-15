// The answers of /api/gift-entry/* as the page reads them. Types only (no schema in browser code); the server shapes are in
// functions/_lib/gifts/view.ts, store.ts, month.ts, summary.ts and history.ts.

export interface DepositListItem {
  id: string;
  kind: 'regular' | 'acquisition' | 'grant';
  name: string;
  status: string;
  gifts: number;
  cents: number;
  tape_count: number;
  tape_cents: number;
  created_by: string;
  needsFix: number;
}

export interface GeIndex {
  deposits: DepositListItem[];
  me: { name: string; email: string; admin: boolean; canPost: boolean };
  today: string;
  second: number;
}

export interface MonthDeposit {
  batch: string;
  giftDate: string;
  addedDate: string;
  items: number;
  cash: number;
  checks: number;
  totalCents: number;
  enteredBy: string;
  approved: boolean;
  kind: string;
  source: 'favoros' | 'blackbaud';
  favorosId: string | null;
  status: string;
}

export interface GeMonth {
  ym: string;
  deposits: MonthDeposit[];
  totals: { deposits: number; items: number; totalCents: number };
  asOf: string | null;
}

export interface DepositSummary {
  id: string;
  name: string;
  status: string;
  batch: string | null;
  tapeCents: number;
  tapeCount: number;
  enteredCents: number;
  enteredCount: number;
  approvedCents: number;
  approvedCount: number;
  heldCount: number;
  rejectedCount: number;
  rejectedCents: number;
  enteredBy: string;
  approvers: string[];
}

export interface GeSummary {
  summary: {
    date: string;
    deposits: DepositSummary[];
    totals: { tapeCents: number; tapeCount: number; enteredCents: number; enteredCount: number; approvedCents: number; approvedCount: number; diffCents: number; diffCount: number };
    ties: boolean;
    open: string[];
  };
  dates: string[];
}

export interface NeedsItem {
  id: string;
  seq: number;
  partner: string | null;
  amountCents: number | null;
  reason: string;
  suggestions: { code: string; reason: string }[];
  deposit: { id: string; name: string; status: string };
}

export interface GeOverview {
  receipts: { left: number; lastFile: { at: string; gifts: number; marked: number } | null } | null;
  letters: { month: number } | null;
}

export interface Candidate {
  cid: string;
  lookup: string;
  name: string;
  place: string;
  exact?: boolean;
  addr?: boolean;
}

export interface Suggestion {
  appealId: string;
  code: string;
  name: string;
  reason: string;
}

export interface ReaderFields {
  payer?: string | null;
  amountCents?: number | null;
  checkNumber?: string | null;
  checkDate?: string | null;
  memo?: string | null;
  slipAppeal?: string | null;
}

export interface ReaderResult {
  reader: string;
  fields?: ReaderFields | null;
  error?: string;
}

export type FieldName = 'amount' | 'number' | 'date' | 'payer' | 'memo';

export interface GiftImage {
  id: string;
  kind: string;
  copyToBb: boolean;
  attached: boolean;
  attachError: string | null;
}

export interface Row {
  id: string;
  seq: number;
  status: string;
  kind: 'check' | 'cash';
  partner: { id: string | null; lookup: string | null; name: string | null; place: string | null } | null;
  candidates: Candidate[];
  amountCents: number | null;
  giftDate: string | null;
  checkNumber: string | null;
  checkDate: string | null;
  payer: string | null;
  memo: string | null;
  fund: { id: string; name: string } | null;
  appeal: { id: string; name: string } | null;
  soft: { id: string | null; name: string | null } | null;
  rule: string;
  ruleLabel: string;
  prayer: boolean;
  flags: FieldName[];
  why: Partial<Record<FieldName, string>>;
  conf: Record<string, 'high' | 'medium' | 'low'>;
  address: string | null;
  coding: { needs: boolean; source?: string; reason?: string; fundReason?: string; suggestions?: Suggestion[] };
  readers: ReaderResult[];
  defaults: { fundSource?: string };
  card: boolean;
  unreadable: boolean;
  dup: { kind: string; message: string; decision: 'keep' | 'remove' | null } | null;
  blockers: string[];
  confirmed: boolean;
  confirmedBy: string | null;
  confirmedAt: string | null;
  needsSecond: boolean;
  secondDone: boolean;
  secondBy: string | null;
  held: { reason: string | null; by: string | null; at: string | null } | null;
  review: { needsFix: boolean; comments: number };
  thread: { id: string; author: string; email: string; kind: 'comment' | 'needs_fix' | 'resolved'; body: string; at: string }[];
  error: string | null;
  images: GiftImage[];
}

export interface Tape {
  tapeCents: number;
  tapeCount: number;
  cents: number;
  count: number;
  diffCents: number;
  diffCount: number;
  needLook: number;
  matches: boolean;
}

export interface Deposit {
  id: string;
  kind: string;
  name: string;
  date: string;
  tapeCents: number;
  tapeCount: number;
  status: string;
  createdBy: string;
  createdAt: string;
  batchNumber: string | null;
  committedAt: string | null;
  lastPolledAt: string | null;
  note: string | null;
  undoneAt: string | null;
  undoneBy: string | null;
  undoneReason: string | null;
}

export interface DepositView {
  deposit: Deposit;
  second: number;
  rejected: { id: string; seq: number; payer: string | null; amountCents: number | null; reason: string; by: string | null; at: string }[];
  rows: Row[];
  tape: Tape;
  canSend: { ok: boolean; why: string[] };
  steps: { status: string; steps: { op: string; status: string; attempts: number; next_try_at: string | null; error: string | null }[]; waiting: string | null } | null;
  attachments: { planned: number; done: number; failed: number };
  watch?: { mismatch: string | null } | null;
}

export interface History {
  count: number;
  lifetimeCents: number;
  last: { cents: number; date: string; through: string } | null;
  first: boolean;
  source: string;
  passesOn: boolean;
}

export interface Revenue {
  dateLabel: string;
  total: number;
  count: number;
  highlights: number;
  blocks: { name: string; total: number; entries: number }[];
  text: string;
  noPartner: number;
}

export interface Catalog {
  funds: { id: string; code: string; name: string }[];
  appeals: { id: string; code: string; name: string; category: string }[];
}

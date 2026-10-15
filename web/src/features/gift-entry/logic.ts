// Gift entry's pure rules, ported from public/js/gift-entry.js: the state dots, the tie-out band, the list filters, the key moves,
// the money and date words. No React and no browser objects, so a node test runs them. Relative imports only.
import type { DepositView, MonthDeposit, Row } from './types';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ET = 'America/New_York';

/** $1,234.50 from cents; empty for null. */
export const money = (c: number | null | undefined): string => (c == null ? '' : '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
/** The same with a leading minus for a negative figure. */
export const moneyS = (c: number): string => (c < 0 ? '-' : '') + money(Math.abs(c));

/** "Oct 9" from a YYYY-MM-DD day (or the first ten characters of a longer stamp). */
export function short(ymd: string | null | undefined): string {
  if (!ymd) return '';
  const [, mm, dd] = String(ymd).slice(0, 10).split('-').map(Number);
  return MON[mm - 1] + ' ' + dd;
}

/** FavorUI.day: "Oct 9", with the year when it is not this year (today is the server's Eastern day). */
export function dayText(iso: string, today: string): string {
  const key = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : new Date(iso).toLocaleDateString('en-CA', { timeZone: ET });
  const p = key.split('-').map(Number);
  if (!p[1]) return '';
  return MON[p[1] - 1] + ' ' + p[2] + (String(p[0]) !== String(today).slice(0, 4) ? ', ' + p[0] : '');
}

/** FavorUI.when: "Today 3:04 PM", "Yesterday 9:10 AM" or "Oct 9 3:04 PM", Eastern. */
export function whenText(iso: string, today: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const k = d.toLocaleDateString('en-CA', { timeZone: ET });
  const y = new Date(Date.parse(today + 'T12:00:00Z') - 864e5).toLocaleDateString('en-CA', { timeZone: 'UTC' });
  const t = d.toLocaleTimeString('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' });
  return (k === today ? 'Today' : k === y ? 'Yesterday' : dayText(k, today)) + ' ' + t;
}

/** "Oct 9, 3:04 PM" in Eastern time, the stamp the status steps use. */
export const etTime = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString('en-US', { timeZone: ET, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

/** "Oct 9, 2026" from a YYYY-MM-DD day, for the giving history's last gift. */
export const longDay = (ymd: string): string => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** "ada.lovelace@favorintl.org" becomes "Ada Lovelace" (FavorUI.person with no staff list). */
export function nameOf(email: string | null | undefined): string {
  const e = String(email || '').toLowerCase();
  if (e === 'brain') return 'Favor Brain';
  return e.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export const KIND: Record<string, string> = { Regular: 'Regular Mail', Acquisition: 'Acquisition Mail', Grant: 'Grant Mail', regular: 'Regular Mail', acquisition: 'Acquisition Mail', grant: 'Grant Mail' };
export const STEPS = ['Count and tape', 'Photograph', 'Review', 'Send to Blackbaud', 'Approved in Blackbaud'];
export const KINDS: [string, string][] = [['regular', 'Regular'], ['acquisition', 'Acquisition'], ['grant', 'Grant']];

const STATUS: Record<string, [string, string]> = {
  open: ['Taking photos', 'warn'],
  sending: ['Sending', 'warn'],
  created: ['Waiting for approval in Blackbaud', ''],
  committed: ['Approved in Blackbaud', 'ok'],
  needs_person: ['Needs a person', 'bad'],
};
/** The words and tone of a deposit's status pill. */
export const pillOf = (s: string): { text: string; tone: string } => {
  const [text, tone] = STATUS[s] || [s, ''];
  return { text, tone };
};

/** "Monday is a pickup day" on the mail pickup days (Monday, Wednesday, Friday), from the server's Eastern day. */
export function pickupText(today: string): string {
  if (!today) return '';
  const wd = new Date(today + 'T12:00:00Z').getUTCDay();
  return [1, 3, 5].includes(wd) ? DOW[wd] + ' is a pickup day' : '';
}

export const isInBlackbaud = (x: Pick<MonthDeposit, 'source' | 'status'>): boolean => x.source === 'blackbaud' || x.status === 'committed';

/** The month list under the filter chips: all, still open here, or in Blackbaud. */
export function filterMonth(list: MonthDeposit[], f: string): MonthDeposit[] {
  return list.filter((x) => f === 'all' || (f === 'bb' ? isInBlackbaud(x) : x.source === 'favoros' && x.status !== 'committed'));
}

/** Deposits dated 2026-10-09 read "Regular Mail 2026-10-09"; the breadcrumb says "Regular Mail, Oct 9". */
export const crumbName = (name: string | null | undefined): string =>
  String(name || 'Deposit').replace(/\s*(\d{4})-(\d{2})-(\d{2})$/, (_m, _y, mo, d) => ', ' + MON[Number(mo) - 1] + ' ' + Number(d));

export type RowState = 'ok' | 'look' | 'bad' | 'hold';

/** A row's state for the rail: ok (approved), look (needs a look), bad (a problem), hold. */
export function stateOf(r: Row): RowState {
  if (r.status === 'held') return 'hold';
  if (r.status === 'failed' || r.card || (r.dup && r.dup.decision === null)) return 'bad';
  if (r.status === 'sent' || r.status === 'by_hand') return 'ok';
  if (r.confirmed && !r.blockers.length) return 'ok';
  return 'look';
}
export const needsLook = (r: Row): boolean => stateOf(r) !== 'ok';

export const LISTF: [string, string][] = [['all', 'All'], ['look', 'To review'], ['hold', 'Held'], ['ok', 'Approved']];

/** The gift list under a filter chip. "look" includes the rows with a problem. */
export function filterRows(rows: Row[], f: string): { r: Row; i: number }[] {
  return rows.map((r, i) => ({ r, i })).filter(({ r }) => f === 'all' || stateOf(r) === f || (f === 'look' && stateOf(r) === 'bad'));
}
export const countFor = (rows: Row[], k: string): number => (k === 'all' ? rows.length : rows.filter((r) => stateOf(r) === k || (k === 'look' && stateOf(r) === 'bad')).length);

export interface Band {
  tapeCents: number;
  tapeCount: number;
  cents: number;
  count: number;
  ties: boolean;
  tied: boolean;
  off: string;
  approved: number;
  total: number;
  held: number;
  look: number;
  needs: number;
  pct: { a: string; h: string; x: string };
  why: string;
  canSend: boolean;
}

/** The tie-out band across the top of an open deposit. `canPost` is the person's Send to Blackbaud switch. */
export function bandOf(v: DepositView, canPost: boolean): Band {
  const t = v.tape;
  const rows = v.rows;
  const approved = rows.filter((r) => stateOf(r) === 'ok').length;
  const held = rows.filter((r) => r.status === 'held').length;
  const look = rows.length - approved - held;
  const off = t.diffCount !== 0 ? Math.abs(t.diffCount) + (t.diffCount < 0 ? ' short' : ' over') : moneyS(t.diffCents);
  const pct = (n: number) => (rows.length ? ((n / rows.length) * 100).toFixed(1) : 0) + '%';
  const ok = v.canSend.ok;
  const why = !canPost ? 'Posting is not switched on for you' : ok ? '' : rows.length && approved < rows.length ? `Opens when all ${rows.length} are approved` : v.canSend.why.slice(0, 1).join(' ');
  return {
    tapeCents: t.tapeCents, tapeCount: t.tapeCount, cents: t.cents, count: t.count, ties: t.matches, tied: t.matches, off,
    approved, total: rows.length, held, look, needs: look + held, pct: { a: pct(approved), h: pct(look), x: pct(held) }, why, canSend: ok && canPost,
  };
}

/** After an approve, hold or reject: the next row that needs a look, after this one first, then from the top. '' when none. */
export function nextLook(rows: Row[], fromId: string): string {
  const i = rows.findIndex((x) => x.id === fromId);
  const after = rows.slice(i + 1).find(needsLook) || rows.find((x) => x.id !== fromId && needsLook(x));
  return after ? after.id : '';
}

/** J and K move the current row by one, staying inside the list. */
export function moveTo(rows: Row[], cur: string, delta: number): string {
  if (!rows.length) return cur;
  let i = rows.findIndex((x) => x.id === cur);
  i = Math.max(0, Math.min(rows.length - 1, (i < 0 ? 0 : i) + delta));
  return rows[i].id;
}

/** Which row is current when the deposit opens: the first one that needs a look, else the first. */
export const firstRow = (rows: Row[]): string => (rows.find(needsLook) || rows[0] || ({ id: '' } as Row)).id;

/** Dollars typed by a person ("$1,234.50") to cents. NaN when it is not a number. */
export const toCents = (v: string): number => Math.round(Number(String(v).replace(/[$,\s]/g, '')) * 100);

/** The cash row amount: cents, or 0 when the entry is not a positive number of cents. */
export function cashCents(v: string): number {
  const c = toCents(v);
  return !c || c < 1 ? 0 : c;
}

/** The setup form's tape total as the server takes it: dollars with the symbols stripped. */
export const tapeTotalParam = (v: unknown): string => String(v == null ? '' : v).replace(/[$,\s]/g, '');

/** The photo kinds a person can add to a check row. */
export const ENCLOSURES: [string, string][] = [['slip', 'Reply slip'], ['envelope', 'Reply envelope'], ['letter', 'Letter']];

/** The words under a queued photo. */
export function queueWord(x: { state: string; err?: string }): string {
  return x.state === 'error' ? (x.err || '') + ' (tap to retry)' : x.state === 'sending' ? 'reading' : 'waiting';
}

/** The sharpest the camera will accept: below this variance the shot is called blurry. */
export const BLUR_MIN = 25;
/** The long side of an uploaded photo, in pixels. */
export const MAX_SIDE = 1600;
/** The scale applied so the long side is at most MAX_SIDE. */
export const photoScale = (w: number, h: number): number => Math.min(1, MAX_SIDE / Math.max(w, h));

/** What a gift row shows as its first line in the list. */
export const rowName = (r: Row): string => (r.partner ? r.partner.name || '' : r.payer || 'Gift ' + r.seq);

export interface TimelineStep {
  t: string;
  s: string;
  k: '' | 'done' | 'now' | 'bad';
}

/** The five steps shown for a deposit that has been sent: approved here, the batch, the gifts, approval in Blackbaud, the photos. */
export function timelineOf(v: DepositView): TimelineStep[] {
  const d = v.deposit;
  const gifts = v.rows.filter((r) => r.status !== 'by_hand');
  const steps = (v.steps && v.steps.steps) || [];
  const batchStep = steps.find((s) => s.op === 'batch');
  const giftSteps = steps.filter((s) => s.op.startsWith('gifts:'));
  const failed = v.rows.filter((r) => r.status === 'failed');
  const waitStep = steps.find((s) => s.status === 'waiting');
  const retrying = steps.find((s) => s.status === 'queued' && s.attempts > 0);
  const sentAll = giftSteps.length > 0 && giftSteps.every((s) => s.status === 'done');
  const created = ['created', 'committed'].includes(d.status);
  const committed = d.status === 'committed';
  const a = v.attachments;
  const batchDone = !!batchStep && batchStep.status === 'done';
  return [
    { t: 'Gifts approved', s: `${v.rows.length} gifts · ${money(v.tape.cents)} · entered by ${d.createdBy}`, k: 'done' },
    {
      t: d.batchNumber ? 'Batch ' + d.batchNumber : 'Batch in Blackbaud',
      s: batchDone ? 'Created unapproved' : waitStep ? 'Waiting for the daily limit to reset' : retrying ? 'Trying again at ' + etTime(retrying.next_try_at) : 'Creating',
      k: batchDone ? 'done' : d.status === 'needs_person' ? 'bad' : 'now',
    },
    {
      t: 'Gifts in the batch',
      s: sentAll ? `${v.rows.filter((r) => r.status === 'sent').length} of ${gifts.length}${failed.length ? ' · ' + failed.length + ' need a person' : ''}` : 'Sending',
      k: sentAll && !failed.length ? 'done' : failed.length ? 'bad' : batchDone ? 'now' : '',
    },
    {
      t: committed ? 'Approved in Blackbaud' : 'Approval in Blackbaud',
      s: committed ? etTime(d.committedAt) : created ? 'Unapproved' + (d.lastPolledAt ? ' · checked ' + etTime(d.lastPolledAt) : '') : '',
      k: committed ? 'done' : created ? 'now' : '',
    },
    {
      t: 'Photos on the gifts',
      s: a.planned ? `${a.done} of ${a.planned}${a.failed ? ' · ' + a.failed + ' failed' : ''}` : 'None needed',
      k: committed && a.done === a.planned ? 'done' : committed && a.planned ? 'now' : '',
    },
  ];
}

/** The words after a gift on the sent deposit's list. */
export const sentStatus = (s: string): string => (s === 'sent' ? 'In the batch' : s === 'failed' ? 'Needs a person' : s === 'by_hand' ? 'Enter by hand' : s);

/** Whether a sent deposit may be taken back: same-day batch still unapproved, and the person may post. */
export const canUndoBatch = (status: string, canPost: boolean): boolean => canPost && status !== 'committed' && ['created', 'needs_person', 'sending'].includes(status);

/** Statuses where the page reads the batch from Blackbaud again every minute. */
export const polls = (status: string): boolean => ['sending', 'created', 'committed'].includes(status);

/** Statuses where the Daily Revenue Report is built from the batch. */
export const hasRevenue = (status: string): boolean => ['created', 'committed', 'needs_person'].includes(status);

export interface Primary {
  act: 'approve' | 'approve2' | 'unconfirm';
  /** Approve is disabled while something blocks the row; the second approval is disabled for the first approver. */
  disabled: boolean;
  /** The words of the first block, shown beside the buttons. */
  block: string;
  needs2: boolean;
}

/** The main button of a row's action bar: Approve, Approve as second, or Undo approval. */
export function primaryOf(r: Row, second: boolean, me: string): Primary {
  const needs2 = r.confirmed && second && !r.secondDone;
  const blocks = r.blockers.filter((b) => !/Looks right|second person/.test(b));
  const block = blocks[0] || '';
  if (needs2) return { act: 'approve2', disabled: !!r.confirmedBy && r.confirmedBy.toLowerCase() === me, block, needs2 };
  if (r.confirmed && !r.blockers.length) return { act: 'unconfirm', disabled: false, block, needs2 };
  return { act: 'approve', disabled: blocks.length > 0, block, needs2 };
}

// Review comments on a gift entry row: a thread per row, a "needs a fix" state with a required note, and a bell reminder for the
// person who entered the deposit. Only ge_comment and act_reminders are written. No amount, fund, appeal, status or Blackbaud call
// is touched here.
import { HttpError, newId, nowIso, type Env } from '../http';
import { addReminders } from '../work/remind';
import { getDeposit, logEvent, type GiftRow } from './store';

export const COMMENT_KINDS = ['comment', 'needs_fix', 'resolved'] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];
export const COMMENT_MAX = 1000;

export interface CommentRow {
  id: string;
  gift_id: string;
  deposit_id: string;
  author_email: string;
  author_name: string;
  body: string;
  kind: CommentKind;
  created_at: string;
}

export interface ReviewState {
  needsFix: boolean;
  comments: number;
}

/** The kind and text a person posted. A comment needs text, a needs-a-fix mark needs text, and a resolved mark may be bare. */
export function checkComment(input: { kind?: unknown; body?: unknown }): { kind: CommentKind; body: string } {
  const kind = input.kind == null || input.kind === '' ? 'comment' : String(input.kind);
  if (!(COMMENT_KINDS as readonly string[]).includes(kind)) throw new HttpError(400, 'bad_kind', 'Pick comment, needs a fix, or resolved.');
  const raw = String(input.body == null ? '' : input.body).replace(/\r\n/g, '\n').trim();
  if (raw.length > COMMENT_MAX) throw new HttpError(400, 'too_long', `Keep the note under ${COMMENT_MAX} characters.`);
  if (kind === 'needs_fix' && !raw) throw new HttpError(400, 'needs_fix_text', 'Say what needs fixing before you mark the row.');
  if (kind === 'comment' && !raw) throw new HttpError(400, 'missing_text', 'Write the comment first.');
  return { kind: kind as CommentKind, body: raw };
}

export async function commentsOf(env: Env, giftId: string): Promise<CommentRow[]> {
  const r = await env.DB.prepare('SELECT * FROM ge_comment WHERE gift_id = ? ORDER BY created_at, id').bind(giftId).all<CommentRow>();
  return r.results;
}

/** Every thread in one deposit, keyed by gift id. One query per deposit view. */
export async function commentsForDeposit(env: Env, depositId: string): Promise<Map<string, CommentRow[]>> {
  const r = await env.DB.prepare('SELECT * FROM ge_comment WHERE deposit_id = ? ORDER BY created_at, id').bind(depositId).all<CommentRow>();
  const out = new Map<string, CommentRow[]>();
  for (const c of r.results) out.set(c.gift_id, [...(out.get(c.gift_id) || []), c]);
  return out;
}

/** A row needs a fix when its latest needs-a-fix or resolved mark is a needs-a-fix mark. Plain comments do not change it. */
export function reviewState(thread: Pick<CommentRow, 'kind'>[]): ReviewState {
  let needsFix = false;
  for (const c of thread) if (c.kind === 'needs_fix') needsFix = true; else if (c.kind === 'resolved') needsFix = false;
  return { needsFix, comments: thread.length };
}

/** Deposit id to the number of its rows that currently need a fix. Feeds the deposit list. */
export async function needsFixByDeposit(env: Env): Promise<Record<string, number>> {
  const r = await env.DB.prepare("SELECT deposit_id, gift_id, kind FROM ge_comment WHERE kind IN ('needs_fix', 'resolved') ORDER BY created_at, id").all<{ deposit_id: string; gift_id: string; kind: CommentKind }>();
  const last = new Map<string, { deposit: string; kind: CommentKind }>();
  for (const c of r.results) last.set(c.gift_id, { deposit: c.deposit_id, kind: c.kind });
  const out: Record<string, number> = {};
  for (const v of last.values()) if (v.kind === 'needs_fix') out[v.deposit] = (out[v.deposit] || 0) + 1;
  return out;
}

/** Write one comment and tell the person who entered the deposit, unless that person wrote it. */
export async function addComment(env: Env, g: Pick<GiftRow, 'id' | 'deposit_id'>, who: { email: string; name: string }, input: { kind?: unknown; body?: unknown }): Promise<CommentRow> {
  const c = checkComment(input);
  const row: CommentRow = {
    id: newId('gc'), gift_id: g.id, deposit_id: g.deposit_id, author_email: who.email.toLowerCase(), author_name: who.name,
    body: c.body, kind: c.kind, created_at: nowIso(),
  };
  await env.DB.prepare('INSERT INTO ge_comment (id, gift_id, deposit_id, author_email, author_name, body, kind, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(row.id, row.gift_id, row.deposit_id, row.author_email, row.author_name, row.body, row.kind, row.created_at).run();
  await logEvent(env, { deposit_id: g.deposit_id, gift_id: g.id, kind: `comment_${c.kind}`, actor: who.name });

  const dep = await getDeposit(env, g.deposit_id);
  const submitter = dep ? dep.created_by_email.toLowerCase() : '';
  if (submitter && submitter !== row.author_email) {
    const what = c.kind === 'needs_fix' ? 'a row needs a fix' : c.kind === 'resolved' ? 'a fix is marked done' : 'a new comment on a row';
    await addReminders(env, submitter, [{
      kind: 'message', title: `Gift entry, ${dep!.name}: ${what}`, note: c.body ? c.body.slice(0, 200) : null,
      due_at: row.created_at, source: 'message',
    }]);
  }
  return row;
}

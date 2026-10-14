// The person's own Gmail, opened the way Mail opens it, for Today's Inbox and Waiting on. Nothing here decides what counts as
// "needs you" or "waiting on a reply": those stay Mail's rules (functions/_lib/mail/smart.ts), read from here only.
import type { Env } from '../http';
import type { HubUser } from '../session';
import { groupMembers } from '../access';
import { effective } from '../admin/settings';
import { accessToken, mailLevel } from '../hub/google';
import { gmail, type Gmail } from '../mail/gmail';
import { mailMode, mayUseMail } from '../mail/route';
import { SAMPLE_TOKEN, sampleFetcher, samplePartners } from '../mail/sample';
import { useRowStore } from '../mail/rows';
import type { SmartCtx } from '../mail/smart';
import { isTester } from '../testuser';

const lower = (s: unknown) => String(s || '').trim().toLowerCase();

export interface Mailbox {
  gm: Gmail;
  ctx: SmartCtx;
  write: boolean;
}

/** Null when Mail is not open to this person, or they have not connected Google. A tester gets the stored sample mailbox. */
export async function mailboxOf(env: Env, user: HubUser, fetcher: typeof fetch = fetch): Promise<Mailbox | null> {
  const mode = await mailMode(env);
  if (!mayUseMail(mode, user, mode === 'group' ? await groupMembers(env, 'mail') : null)) return null;
  const me = lower(user.email);
  const tester = isTester(me);
  const tok = tester ? SAMPLE_TOKEN : await accessToken(env, me).catch(() => null);
  if (!tok) return null;
  const level = mailLevel(tok.scopes);
  if (!level.read) return null;
  useRowStore(env.DB as never);
  let partners: SmartCtx['partners'];
  if (tester) partners = (emails) => samplePartners(env, emails);
  else {
    // Partner matches are Work Center data (the privacy rule Mail follows).
    const { workAccessFor } = await import('../work/gate');
    const wc = await workAccessFor(env as never, me, user.role === 'admin').catch(() => ({ ok: false }));
    if (!wc.ok) partners = async () => ({});
  }
  const writeOn = (await effective(env, 'mail.write', undefined, 'on').catch(() => 'on')).toLowerCase() !== 'off';
  const gm = gmail(tok.token, tester ? sampleFetcher(env, me) : fetcher);
  return { gm, write: writeOn && level.write, ctx: { env, me, name: user.name || me, ai: env.AI as never, partners } };
}

// @Favor Brain in a channel or thread. The question goes to the Brain through the same server path the hub's Brain page uses
// (POST <BRAIN_URL>/hub/ask with the hub's key and the asker's email, so the asker's own access rules apply) and the answer
// comes back into the thread as a message from the Brain, its answer blocks intact.
import { nowIso, type Env } from '../http';
import * as store from './db';
import { BRAIN_ID, brainQuestion } from './text';
import { publish, type LiveEnv } from './live';

const BRAIN_URL = 'https://mcp.favorintl.org';
// Blocks that need a click handler the chat does not have (choices, confirmations, consent, sheet exports) are left out;
// the follow-up questions come back as buttons that ask the Brain again.
const DRAWABLE = new Set(['text', 'tiles', 'table', 'team', 'chart', 'partner', 'coverage', 'steps', 'note', 'sources', 'files']);

export interface BrainAnswer {
  status: 'done';
  blocks: unknown[];
  follow: string[];
  asked_as: string;
  error?: undefined;
}

export function readAnswer(d: any): BrainAnswer | { error: string } {
  if (!d || d.ok === false) return { error: String((d && d.message) || 'The Brain did not answer. Ask again.') };
  const raw: any[] = Array.isArray(d.blocks) ? d.blocks : [];
  let blocks = raw
    .filter((b) => b && DRAWABLE.has(String(b.type)))
    // A long table keeps its preview rows, like the stored form on the Brain page.
    .map((b) => (b.type === 'table' && Array.isArray(b.rows) ? { ...b, rows: b.rows.slice(0, b.preview || 8) } : b));
  if (!blocks.length) {
    const asked = raw.find((b) => b && b.type === 'choice');
    const md = String(d.markdown || d.text || (asked && (asked.q || asked.md || asked.question)) || '').trim();
    if (md) blocks = [{ type: 'text', md }];
  }
  if (!blocks.length) return { error: 'The Brain had no answer to that. Try asking it another way.' };
  const follow = (Array.isArray(d.follow) ? d.follow : []).filter((x: unknown) => typeof x === 'string' && x.trim()).slice(0, 4) as string[];
  return { status: 'done', blocks, follow, asked_as: String(d.asked_as || '') };
}

export interface AskInput {
  channel_id: string;
  root_id: number;
  /** The thread the question was asked in, or null for a top level question. */
  thread_id?: number | null;
  asker: { email: string; name: string };
  text: string;
}

/**
 * Posts "thinking", asks the Brain, then fills the same message in with the answer. Every step is pushed live to the channel's
 * members. Meant for waitUntil: it never throws.
 */
export async function askInThread(env: LiveEnv & { BRAIN_HUB_KEY?: string; BRAIN_URL?: string }, input: AskInput, fetcher: typeof fetch = fetch): Promise<void> {
  try {
    const question = brainQuestion(input.text);
    // In a channel, group or conversation with anyone else in it the answer is for the asker alone ("Only visible to you"):
    // stored with visible_to, pushed only to the asker's sockets, and top level when the question was top level. In a
    // conversation with only the asker (and the Brain) it stays a normal thread reply, as before.
    const asker = input.asker.email.toLowerCase();
    const priv = await store.brainIsPrivate(env, input.channel_id, asker);
    const placeholder = await store.post(env, { channel_id: input.channel_id, email: BRAIN_ID, body: '', thread_id: priv ? input.thread_id ?? null : input.root_id, brain: { status: 'thinking' }, visible_to: priv ? asker : null });
    const live = async (id: number, type: 'message' | 'edit') => {
      const row = await store.getMessage(env, id);
      if (!row) return;
      const [msg] = await store.shape(env, [row]);
      await publish(env, store.audienceOf(row, placeholder.members), { type, message: msg });
    };
    await live(placeholder.message.id, 'message');
    let answer: BrainAnswer | { error: string };
    if (!question) answer = { error: 'Ask the Brain a question after its name.' };
    else if (!env.BRAIN_HUB_KEY) answer = { error: 'The Brain is not connected to the hub yet.' };
    else {
      try {
        const res = await fetcher(`${(env.BRAIN_URL || BRAIN_URL).replace(/\/$/, '')}/hub/ask`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.BRAIN_HUB_KEY}`,
            'X-Acting-Email': input.asker.email,
            'X-Acting-Name': encodeURIComponent(input.asker.name || input.asker.email).replace(/%20/g, ' '),
            'Content-Type': 'application/json',
            'User-Agent': 'favor-hub',
          },
          body: JSON.stringify({ question, v: 2, conv: 'chat_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20) }),
          signal: AbortSignal.timeout(90000),
        });
        answer = readAnswer(await res.json().catch(() => null));
      } catch {
        answer = { error: 'The Brain did not answer. Ask again.' };
      }
    }
    if ('error' in answer && answer.error) await store.patch(env, placeholder.message.id, { body: answer.error, brain: null });
    else await store.patch(env, placeholder.message.id, { body: '', brain: answer });
    await live(placeholder.message.id, 'edit');
    // The person who asked gets a bell entry when the answer lands.
    await env.DB.prepare('INSERT OR IGNORE INTO chat_mentions (message_id, channel_id, email, kind, created_at) VALUES (?, ?, ?, ?, ?)').bind(placeholder.message.id, input.channel_id, input.asker.email.toLowerCase(), 'reply', nowIso()).run();
  } catch (err) {
    console.warn('[chat] brain', err);
  }
}

export type { Env };

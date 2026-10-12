// @Favor Brain in a channel or thread. The question goes to the Brain through the same server path the hub's Brain page uses
// (POST <BRAIN_URL>/hub/ask with the hub's key and the asker's email, so the asker's own access rules apply) and the answer
// comes back into the thread as a message from the Brain, its answer blocks intact.
import { nowIso, type Env } from '../http';
import * as store from './db';
import { BRAIN_ID, brainQuestion } from './text';
import { publish, type LiveEnv } from './live';

const BRAIN_URL = 'https://mcp.favorintl.org';
// Every block the Brain page draws is kept: Chat runs the same block code (public/js/brain-blocks.js), presses included, so
// option buttons, confirm cards and sheet cards work in a message as they do on the Brain page.
export const DRAWABLE = new Set(['text', 'tiles', 'table', 'team', 'chart', 'partner', 'coverage', 'steps', 'note', 'sources', 'files', 'choice', 'confirm', 'sheet']);

export interface BrainAnswer {
  status: 'done';
  blocks: unknown[];
  follow: string[];
  asked_as: string;
  /** The question as the person typed it, for "Ask again" and the note a sheet carries. */
  q?: string;
  /** The lists behind the answer ({ token, title }), read again by token for Show all and Open in Google Sheets. */
  lists?: unknown[];
  error?: undefined;
}

export function readAnswer(d: any): BrainAnswer | { error: string } {
  if (!d || d.ok === false) return { error: String((d && d.message) || 'The Brain did not answer. Ask again.') };
  const raw: any[] = Array.isArray(d.blocks) ? d.blocks : [];
  let blocks = raw
    .filter((b) => b && DRAWABLE.has(String(b.type)))
    // A long table keeps its preview rows, like the stored form on the Brain page, and how many rows the whole list has,
    // so Show all knows there is more to read.
    .map((b) => (b.type === 'table' && Array.isArray(b.rows) ? { ...b, count: Number(b.count) > 0 ? Number(b.count) : b.rows.length, rows: b.rows.slice(0, b.preview || 8) } : b));
  if (!blocks.length) {
    const md = String(d.markdown || d.text || '').trim();
    if (md) blocks = [{ type: 'text', md }];
  }
  if (!blocks.length) return { error: 'The Brain had no answer to that. Try asking it another way.' };
  const follow = (Array.isArray(d.follow) ? d.follow : []).filter((x: unknown) => typeof x === 'string' && x.trim()).slice(0, 4) as string[];
  const lists = (Array.isArray(d.lists) ? d.lists : []).filter((l: any) => l && typeof l.token === 'string').slice(0, 6).map((l: any) => ({ token: String(l.token), title: String(l.title || l.label || '').slice(0, 160) }));
  return { status: 'done', blocks, follow, asked_as: String(d.asked_as || ''), ...(lists.length ? { lists } : {}) };
}

export interface AskInput {
  channel_id: string;
  root_id: number;
  /** The thread the question was asked in, or null for a top level question. */
  thread_id?: number | null;
  asker: { email: string; name: string; role?: string };
  text: string;
  /** What kind of answer a pressed option or a name in a list asks for (the Brain page sends the same word). */
  intent?: string;
  /** The messages above the question in its thread, as plain lines, so the Brain can read what "this" is. */
  context?: string;
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
    else if (!env.BRAIN_HUB_KEY) answer = { error: 'The Brain is not connected to FavorOS yet.' };
    else {
      try {
        const res = await fetcher(`${(env.BRAIN_URL || BRAIN_URL).replace(/\/$/, '')}/hub/ask`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.BRAIN_HUB_KEY}`,
            'X-Acting-Email': input.asker.email,
            ...(input.asker.role === 'field' ? { 'X-Acting-Scope': 'field' } : {}),
            'X-Acting-Name': encodeURIComponent(input.asker.name || input.asker.email).replace(/%20/g, ' '),
            'Content-Type': 'application/json',
            'User-Agent': 'favor-hub',
          },
          body: JSON.stringify({ question: input.context ? `Messages in this Chat conversation, oldest first:
${input.context}

Question from ${input.asker.name || 'the asker'}: ${question}` : question, v: 2, conv: 'chat_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20), ...(input.intent ? { intent: input.intent } : {}) }),
          signal: AbortSignal.timeout(90000),
        });
        answer = readAnswer(await res.json().catch(() => null));
        if (!('error' in answer && answer.error)) (answer as BrainAnswer).q = question;
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

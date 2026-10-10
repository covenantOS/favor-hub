// Favor Brain chat titles. A small Workers AI model writes a 2 to 5 word title after a chat's first answer and
// again every third turn after that, when the topic has moved. A title the person typed by hand is never touched.
import type { Env } from '../http';
import { titleOf } from './chat';

export const TITLE_MODEL = '@cf/meta/llama-3.2-1b-instruct';
const TITLE_TIMEOUT_MS = 6000;

/** Turn 1 gets a title. After that the topic is checked at turns 4, 7, 10 and so on. */
export const shouldTitle = (n: number) => n === 1 || (n >= 4 && (n - 1) % 3 === 0);

/** The model's reply as a title, or null when it says KEEP, is off-shape, or has dashes. */
export function cleanTitle(raw: string): string | null {
  const line = String(raw || '').split('\n')[0].trim();
  if (!line || /^keep\b/i.test(line)) return null;
  const t = line.replace(/^["'`*#\s]+|["'`*#\s.!?;:,]+$/g, '').replace(/\s+/g, ' ');
  if (/[\u2013\u2014]/.test(t)) return null;
  const words = t.split(' ').filter(Boolean).length;
  if (words < 2 || words > 5) return null;
  return t.length > 44 ? null : t;
}

export function titlePrompt(questions: string[], current: string) {
  return [
    {
      role: 'system',
      content:
        'You name chats. Reply with only a plain 2 to 5 word title in sentence case, such as "2026 giving by team" or "Lookup 15032, Twila Adams". No quotes, no closing punctuation, no dashes. Keep names and numbers exactly as written. If the questions are still on the topic of the current title, reply KEEP.',
    },
    { role: 'user', content: `Current title: ${current || '(none)'}\nQuestions, oldest first:\n${questions.map((q, i) => `${i + 1}. ${q.slice(0, 300)}`).join('\n')}` },
  ];
}

/** Asks the model for a title. Returns null when the model is missing, slow, says KEEP, or the reply is unusable. */
export async function makeTitle(ai: Env['AI'] | undefined, questions: string[], current: string): Promise<string | null> {
  if (!ai || !questions.length) return null;
  const run = ai.run(TITLE_MODEL, { messages: titlePrompt(questions, current), max_tokens: 16, temperature: 0.2 }) as Promise<{ response?: string }>;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TITLE_TIMEOUT_MS));
  try {
    const out = await Promise.race([run, timeout]);
    return cleanTitle(String(out?.response || ''));
  } catch (err) {
    console.error('[brain] title', err);
    return null;
  }
}

/** A title is the person's own when they typed it. Before the title_by column, a title equal to the first question's default is still ours to change. */
export const editable = (th: { title: string; title_by: string | null }, firstQuestion: string) =>
  th.title_by === 'auto' || (th.title_by == null && th.title === titleOf(firstQuestion));

/** Titles a chat after a finished answer when its turn calls for it. Never throws: the answer does not wait on a title. */
export async function retitle(env: Env, email: string, conv: string, n: number): Promise<void> {
  if (!shouldTitle(n)) return;
  try {
    const { titleInputs, setAutoTitle } = await import('./chat');
    const th = await titleInputs(env, email, conv);
    if (!th || !editable(th, th.first)) return;
    const t = await makeTitle(env.AI, th.questions, th.title);
    if (t) await setAutoTitle(env, email, conv, t);
  } catch (err) {
    console.error('[brain] retitle', err);
  }
}

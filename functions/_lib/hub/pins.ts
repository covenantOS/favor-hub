// My dashboard: answers pinned from Favor Brain. Private to the person who pinned them. A pin keeps the Brain's blocks
// (a table keeps only its preview rows) and the question, so Refresh can ask again and replace the answer.
import { HttpError, nowIso, type Env } from '../http';
import { dropScratch, newConvId } from './chat';

export const MAX_PINS = 24;
const MAX_ANSWER = 180_000;
const BRAIN_URL = 'https://mcp.favorintl.org';
const KEEP_ROWS = 25;
const SKIP_BLOCKS = ['confirm', 'consent', 'choice', 'sheet', 'steps'];

export interface PinAnswer {
  blocks: unknown[];
  reading?: unknown[];
  markdown?: string;
}

export interface Pin {
  id: string;
  title: string;
  question: string;
  answer: PinAnswer;
  asked_at: string;
  pos: number;
}

interface PinRow {
  id: string;
  title: string;
  question: string;
  answer: string;
  asked_at: string;
  pos: number;
}

const newId = () => `p_${Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10)}`;

export function cleanTitle(v: unknown, fallback: string): string {
  const t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 120);
  return t || fallback.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Pinned answer';
}

/** What a pin keeps of an answer: the blocks that show figures and words, tables cut to their preview. */
export function keepAnswer(raw: unknown): PinAnswer {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const blocks = (Array.isArray(d.blocks) ? d.blocks : [])
    .filter((b) => b && typeof b === 'object' && !SKIP_BLOCKS.includes(String((b as { type?: unknown }).type)))
    .map((b) => {
      const x = b as Record<string, unknown>;
      if (x.type === 'table' && Array.isArray(x.rows)) {
        const all = x.rows as unknown[];
        const rows = all.slice(0, Math.min(KEEP_ROWS, Number(x.preview) || KEEP_ROWS));
        // A kept table never points at a download link that expires.
        const rest = { ...x };
        delete rest.csv;
        delete rest.tokens;
        return { ...rest, rows, count: Number(x.count) || all.length };
      }
      return x;
    });
  const out: PinAnswer = { blocks };
  if (Array.isArray(d.reading)) out.reading = d.reading.slice(0, 8);
  if (typeof d.markdown === 'string') out.markdown = d.markdown.slice(0, 6000);
  return out;
}

const parse = (row: PinRow): Pin => {
  let answer: PinAnswer = { blocks: [] };
  try {
    answer = JSON.parse(row.answer);
  } catch {
    // an unreadable answer shows as empty and Refresh replaces it
  }
  return { id: row.id, title: row.title, question: row.question, answer, asked_at: row.asked_at, pos: row.pos };
};

const COLS = 'id, title, question, answer, asked_at, pos';

export async function listPins(env: Env, email: string): Promise<Pin[]> {
  const rows = await env.DB.prepare(`SELECT ${COLS} FROM report_pins WHERE email = ? ORDER BY pos, created_at`).bind(email.toLowerCase()).all<PinRow>();
  return (rows.results || []).map(parse);
}

export async function addPin(env: Env, email: string, input: { question: unknown; title?: unknown; answer: unknown }): Promise<Pin> {
  const question = String(input.question == null ? '' : input.question).replace(/\s+/g, ' ').trim().slice(0, 600);
  if (!question) throw new HttpError(400, 'no_question', 'Pin an answer that has a question.');
  const answer = keepAnswer(input.answer);
  if (!answer.blocks.length && !answer.markdown) throw new HttpError(400, 'no_answer', 'There is no answer to pin yet.');
  const text = JSON.stringify(answer);
  if (text.length > MAX_ANSWER) throw new HttpError(413, 'too_big', 'That answer is too large to pin.');
  const who = email.toLowerCase();
  const dup = await env.DB.prepare('SELECT id FROM report_pins WHERE email = ? AND question = ?').bind(who, question).first<{ id: string }>();
  const at = nowIso();
  let id = dup?.id || '';
  if (dup) {
    await env.DB.prepare('UPDATE report_pins SET answer = ?, asked_at = ? WHERE id = ? AND email = ?').bind(text, at, id, who).run();
  } else {
    const count = await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(pos), -1) AS top FROM report_pins WHERE email = ?').bind(who).first<{ n: number; top: number }>();
    if ((count?.n || 0) >= MAX_PINS) throw new HttpError(409, 'full', `My dashboard holds ${MAX_PINS} pins. Unpin one first.`);
    id = newId();
    await env.DB.prepare('INSERT INTO report_pins (id, email, title, question, answer, asked_at, pos, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, who, cleanTitle(input.title, question), question, text, at, (count?.top ?? -1) + 1, at)
      .run();
  }
  const row = await env.DB.prepare(`SELECT ${COLS} FROM report_pins WHERE id = ?`).bind(id).first<PinRow>();
  return parse(row as PinRow);
}

export async function renamePin(env: Env, email: string, id: string, title: string): Promise<boolean> {
  const r = await env.DB.prepare('UPDATE report_pins SET title = ? WHERE id = ? AND email = ?').bind(cleanTitle(title, ''), id, email.toLowerCase()).run();
  return (r.meta?.changes || 0) > 0;
}

export async function removePin(env: Env, email: string, id: string): Promise<boolean> {
  const r = await env.DB.prepare('DELETE FROM report_pins WHERE id = ? AND email = ?').bind(id, email.toLowerCase()).run();
  return (r.meta?.changes || 0) > 0;
}

/** Move one pin up or down; positions are renumbered so they stay 0..n-1. */
export async function movePin(env: Env, email: string, id: string, dir: 'up' | 'down'): Promise<boolean> {
  const pins = await listPins(env, email);
  const i = pins.findIndex((p) => p.id === id);
  if (i < 0) return false;
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j >= 0 && j < pins.length) [pins[i], pins[j]] = [pins[j], pins[i]];
  await env.DB.batch(pins.map((p, n) => env.DB.prepare('UPDATE report_pins SET pos = ? WHERE id = ? AND email = ?').bind(n, p.id, email.toLowerCase())));
  return true;
}

type BrainEnv = Env & { BRAIN_HUB_KEY?: string; BRAIN_URL?: string };

/** Ask the Brain the pin's question again, as the person, without leaving a chat behind; keep the new answer. */
export async function refreshPin(env: BrainEnv, user: { email: string; name?: string }, id: string): Promise<Pin> {
  const who = user.email.toLowerCase();
  const row = await env.DB.prepare(`SELECT ${COLS} FROM report_pins WHERE id = ? AND email = ?`).bind(id, who).first<PinRow>();
  if (!row) throw new HttpError(404, 'not_found', 'That pin is not on your dashboard.');
  if (!env.BRAIN_HUB_KEY) throw new HttpError(503, 'not_set_up', 'The Favor Brain is not connected to FavorOS yet.');
  const scratch = newConvId();
  let d: Record<string, unknown> = {};
  let ok = false;
  try {
    const res = await fetch(`${(env.BRAIN_URL || BRAIN_URL).replace(/\/$/, '')}/hub/ask`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.BRAIN_HUB_KEY}`,
        'X-Acting-Email': user.email,
        'X-Acting-Name': encodeURIComponent(user.name || user.email).replace(/%20/g, ' '),
        'Content-Type': 'application/json',
        'User-Agent': 'favor-hub',
      },
      body: JSON.stringify({ question: row.question, conv: scratch }),
    });
    d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    ok = res.ok && d.ok !== false;
  } finally {
    await dropScratch(env, scratch);
  }
  if (!ok) throw new HttpError(502, 'ask', String(d.message || 'The Brain did not answer. Try again in a minute.'));
  const answer = keepAnswer(d);
  if (!answer.blocks.length && !answer.markdown) throw new HttpError(502, 'empty', 'The Brain answered with nothing to show. The old answer stays.');
  const text = JSON.stringify(answer);
  if (text.length > MAX_ANSWER) throw new HttpError(413, 'too_big', 'That answer is too large to pin.');
  const at = nowIso();
  await env.DB.prepare('UPDATE report_pins SET answer = ?, asked_at = ? WHERE id = ? AND email = ?').bind(text, at, id, who).run();
  return parse({ ...row, answer: text, asked_at: at });
}

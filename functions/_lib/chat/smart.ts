// Chat's smarter side, one module so route.ts only delegates:
//   prefs        each person's reading language
//   translate    messages in that language, kept per message and language, original untouched
//   catchup      a summary of what a person has not read in a channel or thread
//   remind       a message turned into a reminder (act_reminders, the same list the bell reads)
//   entities     partner and fund search for the composer, and the hover card for a chip
//   owners       whose contacts this person may log in Blackbaud (the Blackbaud action from a message is confirmed on the page)
//   voice        Whisper transcripts for voice notes
//   context      the recent messages the Favor Brain reads when it is asked something in a thread
import { HttpError, json, nowIso, type Env } from '../http';
import type { HubUser } from '../session';
import * as store from './db';
import { chatMode } from './gate';
import { directory } from './users';
import { plainLine, BRAIN_ID, SYSTEM_VOICES } from './text';
import { LANGS, detectLang, langName, langOk, textHash, translateText, type Ai } from './translate';
import { addReminders, checkInput, dueFor } from '../work/remind';
import { parseAiJson } from '../clipChapters';
const WHISPER = '@cf/openai/whisper-large-v3-turbo';
/** Plain text for the page: no em dashes, no line breaks. */
const noDashes = (s: unknown, max: number): string => String(s ?? '').replace(/\s*[—–]\s*/g, ', ').replace(/\s+/g, ' ').trim().slice(0, max);

export type SmartEnv = Env & { UPLOADS: R2Bucket; BB_KV?: KVNamespace };
const lower = (s: unknown) => String(s || '').trim().toLowerCase();

/* ------------------------------------------------------------------ prefs */

export async function getLang(env: Env, email: string): Promise<string> {
  const r = await env.DB.prepare('SELECT lang FROM chat_prefs WHERE email = ?').bind(lower(email)).first<{ lang: string }>().catch(() => null);
  return r && langOk(r.lang) ? r.lang : '';
}

export async function setLang(env: Env, email: string, lang: unknown): Promise<string> {
  const code = lang === '' || lang == null ? '' : String(lang);
  if (code && !langOk(code)) throw new HttpError(400, 'bad_lang', 'Pick a language from the list.');
  await env.DB.prepare('INSERT INTO chat_prefs (email, lang, updated_at) VALUES (?, ?, ?) ON CONFLICT (email) DO UPDATE SET lang = excluded.lang, updated_at = excluded.updated_at').bind(lower(email), code, nowIso()).run();
  return code;
}

/* ------------------------------------------------------------------ translate */

export interface Translated {
  /** The message in the reader's language. Absent when it needs no translation. */
  text?: string;
  src: string;
  same?: boolean;
  failed?: boolean;
  /** Voice notes in the message: transcript translated, by file id. */
  voice?: Record<string, { text: string; src: string }>;
}

interface Job {
  ref: string;
  text: string;
  force: boolean;
}
interface Cached {
  ref: string;
  h: string;
  src: string;
  text: string;
}

/** The text of a message a reader can translate: its words. A message of attachments alone has none. */
function wordsOf(row: store.MessageRow): string {
  if (row.email === BRAIN_ID || SYSTEM_VOICES.has(row.email)) return '';
  return row.body || '';
}

function voicesOf(row: store.MessageRow): string[] {
  try {
    return (JSON.parse(row.attachments || '[]') as Array<{ type?: string; voice?: boolean; id?: string }>).filter((a) => a.type === 'file' && a.voice && a.id).map((a) => String(a.id));
  } catch {
    return [];
  }
}

/**
 * Translates up to 24 messages into the reader's language. Each translation is kept per message and language, so a message the
 * whole channel reads in French is translated once. An edited message translates again (the kept row carries a hash of its text).
 */
export async function translateMessages(env: SmartEnv, me: string, input: { lang: string; ids: number[]; force?: boolean }, ai: Ai | undefined): Promise<Record<string, Translated>> {
  if (!ai) throw new HttpError(503, 'not_set_up', 'Translation is not set up here.');
  const lang = input.lang;
  const rows: store.MessageRow[] = [];
  const okChannel = new Map<string, boolean>();
  for (const id of [...new Set(input.ids)].slice(0, 24)) {
    const row = await store.getMessage(env, id);
    if (!row || row.deleted_at || !store.canSee(row, me)) continue;
    if (!okChannel.has(row.channel_id)) okChannel.set(row.channel_id, await store.readableChannel(env, row.channel_id, me).then(() => true, () => false));
    if (okChannel.get(row.channel_id)) rows.push(row);
  }
  const voiceText = new Map<string, string>();
  const vids = rows.flatMap(voicesOf);
  if (vids.length) {
    const q = vids.map(() => '?').join(',');
    const v = await env.DB.prepare(`SELECT file_id, transcript FROM chat_voice WHERE status = 'ready' AND file_id IN (${q})`).bind(...vids).all<{ file_id: string; transcript: string }>().catch(() => ({ results: [] as Array<{ file_id: string; transcript: string }> }));
    for (const x of v.results || []) if (x.transcript) voiceText.set(x.file_id, x.transcript);
  }
  const jobs: Job[] = [];
  for (const r of rows) {
    const t = wordsOf(r);
    if (t.trim()) jobs.push({ ref: `m:${r.id}`, text: t, force: !!input.force });
    for (const f of voicesOf(r)) if (voiceText.has(f)) jobs.push({ ref: `v:${f}`, text: voiceText.get(f)!, force: !!input.force });
  }
  const done = new Map<string, Translated>();
  if (jobs.length) {
    const q = jobs.map(() => '?').join(',');
    const kept = await env.DB.prepare(`SELECT ref, h, src, text FROM chat_translations WHERE lang = ? AND ref IN (${q})`).bind(lang, ...jobs.map((j) => j.ref)).all<Cached>().catch(() => ({ results: [] as Cached[] }));
    const have = new Map((kept.results || []).map((k) => [k.ref, k]));
    const todo: Job[] = [];
    for (const j of jobs) {
      const k = have.get(j.ref);
      if (k && k.h === textHash(j.text)) done.set(j.ref, { text: k.text === j.text ? undefined : k.text, src: k.src, same: k.text === j.text || undefined });
      else todo.push(j);
    }
    let next = 0;
    const work = async () => {
      while (next < todo.length) {
        const j = todo[next++];
        let src = detectLang(j.text);
        if (!src && j.force) src = 'en';
        if (!src || src === lang) {
          done.set(j.ref, { src: src || '', same: true });
          continue;
        }
        if (!langOk(src)) {
          done.set(j.ref, { src, same: true });
          continue;
        }
        const out = await translateText(ai, j.text, src, lang);
        if (out == null) {
          done.set(j.ref, { src, failed: true });
          continue;
        }
        await env.DB.prepare('INSERT OR REPLACE INTO chat_translations (ref, lang, h, src, text, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(j.ref, lang, textHash(j.text), src, out, nowIso()).run().catch(() => undefined);
        done.set(j.ref, { text: out, src });
      }
    };
    await Promise.all([work(), work(), work(), work()]);
  }
  const result: Record<string, Translated> = {};
  for (const r of rows) {
    const own = done.get(`m:${r.id}`);
    const voice: Record<string, { text: string; src: string }> = {};
    for (const f of voicesOf(r)) {
      const v = done.get(`v:${f}`);
      if (v && v.text) voice[f] = { text: v.text, src: v.src };
    }
    if (!own && !Object.keys(voice).length) continue;
    result[String(r.id)] = { ...(own || { src: '', same: true }), ...(Object.keys(voice).length ? { voice } : {}) };
  }
  return result;
}

/* ------------------------------------------------------------------ catch me up */

export interface CatchUp {
  count: number;
  people: number;
  from: number;
  to: number;
  headline: string;
  points: Array<{ text: string; ids: number[] }>;
  for_you: Array<{ text: string; ids: number[] }>;
  mentions: number;
  empty?: boolean;
}

const CATCHUP_MODELS = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct-fast'];

/** What a person missed in a channel (or one thread) since a message id, as a short list with the messages behind each line. */
export async function catchUp(env: SmartEnv, user: HubUser, channelId: string, input: { from: number; thread?: number }, ai: Ai | undefined): Promise<CatchUp> {
  const me = lower(user.email);
  await store.readableChannel(env, channelId, me);
  const from = Math.max(0, Math.floor(Number(input.from) || 0));
  const threadId = Math.floor(Number(input.thread) || 0);
  const sql = threadId
    ? `SELECT id, email, body, attachments, created_at, thread_id FROM chat_messages WHERE channel_id = ? AND (id = ? OR thread_id = ?) AND id > ? AND deleted_at IS NULL AND (visible_to IS NULL OR visible_to = ?) ORDER BY id DESC LIMIT 120`
    : `SELECT id, email, body, attachments, created_at, thread_id FROM chat_messages WHERE channel_id = ? AND ? = ? AND id > ? AND deleted_at IS NULL AND (visible_to IS NULL OR visible_to = ?) ORDER BY id DESC LIMIT 120`;
  const r = await env.DB.prepare(sql).bind(channelId, threadId || 0, threadId || 0, from, me).all<{ id: number; email: string; body: string; attachments: string; created_at: string; thread_id: number | null }>();
  const rows = (r.results || []).filter((x) => x.email !== me && x.email !== BRAIN_ID).reverse();
  const people = new Set(rows.map((x) => x.email));
  const base = { count: rows.length, people: people.size, from, to: rows.length ? rows[rows.length - 1].id : from, headline: '', points: [], for_you: [], mentions: rows.filter((x) => x.body.includes(`<@${me}>`) || x.body.includes('<@channel>') || x.body.includes('<@all>')).length };
  if (rows.length < 3) return { ...base, empty: true };
  if (!ai) throw new HttpError(503, 'not_set_up', 'Catch me up is not set up here.');
  const dir = await directory(env, await chatMode(env), user);
  const nm = (id: string) => (dir[id]?.name || id.split('@')[0]).split(' ')[0];
  const voice = new Map<string, string>();
  const vids = rows.flatMap((x) => voicesOf(x as unknown as store.MessageRow));
  if (vids.length) {
    const v = await env.DB.prepare(`SELECT file_id, transcript FROM chat_voice WHERE status = 'ready' AND file_id IN (${vids.map(() => '?').join(',')})`).bind(...vids).all<{ file_id: string; transcript: string }>().catch(() => ({ results: [] as Array<{ file_id: string; transcript: string }> }));
    for (const x of v.results || []) voice.set(x.file_id, x.transcript);
  }
  let budget = 14000;
  const lines: string[] = [];
  for (const x of rows) {
    const spoken = voicesOf(x as unknown as store.MessageRow).map((f) => voice.get(f)).filter(Boolean).join(' ');
    const said = plainLine(x.body, (id) => nm(id), 420) || (spoken ? `(voice note) ${spoken.slice(0, 420)}` : '(shared a file)');
    const line = `[${x.id}] ${nm(x.email)}${x.thread_id ? ' (in a thread)' : ''}: ${said}`;
    if (budget - line.length < 0) break;
    budget -= line.length;
    lines.push(line);
  }
  const lang = (await getLang(env, me)) || 'en';
  const first = nm(me);
  const sys =
    `You write a catch-up for ${first} on the team chat messages ${first} has not read. Write in ${langName(lang)}. Reply with JSON only, in this shape: ` +
    `{"headline": one sentence under 140 characters, "points": [{"text": one sentence, "ids": [message numbers behind it]}] (3 to 6 points in the order things happened), ` +
    `"for_you": [{"text": one sentence, "ids": []}] (questions put to ${first}, work given to ${first}, decisions that change ${first}'s work; an empty list when none)}. ` +
    `Use first names. Use only what the messages say and never add facts. Do not use dashes as punctuation. Message numbers are the numbers in square brackets.`;
  let j: { headline?: unknown; points?: unknown; for_you?: unknown } | null = null;
  let lastErr: unknown = null;
  const usable = (v: any) => v && typeof v === 'object' && Array.isArray(v.points) && v.points.length ? v : null;
  for (const model of CATCHUP_MODELS) {
    try {
      const out = (await ai.run(model, { messages: [{ role: 'system', content: sys }, { role: 'user', content: lines.join('\n') }], max_tokens: 900 })) as { response?: unknown } | null;
      // Some models hand back the JSON already parsed, others a string, sometimes inside a code fence.
      const r = out && out.response;
      j = usable(r && typeof r === 'object' ? r : parseAiJson(String(r || '')));
      if (j) break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!j) {
    console.warn('[chat] catch up', lastErr);
    throw new HttpError(502, 'busy', 'Catch me up could not read the messages just now. Try again in a minute.');
  }
  const valid = new Set(rows.map((x) => x.id));
  const clean = (v: unknown): Array<{ text: string; ids: number[] }> =>
    (Array.isArray(v) ? v : [])
      .map((p: any) => ({ text: noDashes(p && p.text, 220), ids: (Array.isArray(p && p.ids) ? p.ids : []).map(Number).filter((n: number) => valid.has(n)).slice(0, 4) }))
      .filter((p) => p.text)
      .slice(0, 6);
  const points = clean(j.points);
  if (!points.length) throw new HttpError(502, 'busy', 'Catch me up could not read the messages just now. Try again in a minute.');
  return { ...base, headline: noDashes(j.headline, 160), points, for_you: clean(j.for_you) };
}

/* ------------------------------------------------------------------ reminders */

/** "Remind me about this message": a row in the same reminders list the bell reads. Returns when it falls due. */
export async function remindAbout(env: Env, user: HubUser, messageId: number, input: { when?: { code?: string; date?: string; time?: string } }): Promise<{ due_at: string; id: string }> {
  const me = lower(user.email);
  const row = await store.getMessage(env, messageId);
  if (!row || row.deleted_at || !store.canSee(row, me)) throw new HttpError(404, 'not_found', 'That message is gone.');
  const ch = await store.readableChannel(env, row.channel_id, me);
  const dir = await directory(env, await chatMode(env), user);
  const who = row.email === BRAIN_ID ? 'Favor Brain' : dir[row.email]?.name || row.email.split('@')[0];
  const said = plainLine(row.body, (id) => dir[id]?.name || id.split('@')[0], 120) || 'a message with an attachment';
  const where = ch.kind === 'public' || ch.kind === 'private' ? `#${ch.name}` : 'a direct message';
  const due = dueFor(input.when || {});
  const long = `chat-${row.channel_id}-${row.id}`;
  const item = checkInput({ kind: 'message', ref_id: long.length <= 40 ? long : `chat-${row.id}`, title: `Chat: ${said}`, note: `${who} in ${where}`, due_at: due, source: 'message' });
  const [id] = await addReminders(env, me, [item]);
  return { due_at: due, id };
}

/* ------------------------------------------------------------------ partners and funds */

export interface EntityHit {
  kind: 'p' | 'f';
  id: string;
  name: string;
  sub: string;
}

type Q = <T = Record<string, any>>(sql: string, params?: unknown[]) => Promise<T[]>;

/** Partners (the Work Center's own type-ahead) and funds, for the composer's @ list. */
export async function searchEntities(q: Q, partners: (term: string) => Promise<Array<{ cid: string; name: string; place: string; deceased: boolean }>>, term: string): Promise<EntityHit[]> {
  const t = String(term || '').trim().slice(0, 60);
  if (t.length < 3) return [];
  const [p, f] = await Promise.all([
    partners(t).catch(() => []),
    q<{ id: string; code: string; name: string }>(
      `SELECT id AS id, fund_id AS code, fund_description AS name FROM funds WHERE COALESCE(fund_inactive, 0) = 0 AND (lower(fund_description) LIKE ?1 OR lower(fund_id) LIKE ?1) ORDER BY fund_description LIMIT 4`,
      ['%' + t.toLowerCase().replace(/[%_\\]/g, ' ') + '%']
    ).catch(() => []),
  ]);
  return [
    ...p.slice(0, 5).map((x) => ({ kind: 'p' as const, id: String(x.cid), name: x.name, sub: x.place || 'Partner' })),
    ...f.map((x) => ({ kind: 'f' as const, id: String(x.id), name: String(x.name || x.code), sub: x.code ? `Fund ${x.code}` : 'Fund' })),
  ];
}

/* ------------------------------------------------------------------ voice notes */

const MAX_VOICE_BYTES = 6 * 1024 * 1024;

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Marks a voice note as being transcribed. Called when the message is posted. */
export async function startVoice(env: Env, fileId: string, messageId: number, secs: number): Promise<void> {
  await env.DB.prepare(`INSERT OR REPLACE INTO chat_voice (file_id, message_id, status, transcript, lang, secs, created_at) VALUES (?, ?, 'working', '', '', ?, ?)`).bind(fileId, messageId, secs, nowIso()).run();
}

/** Whisper turns a voice note into words. Returns true when a transcript was stored. Never throws. */
export async function transcribe(env: SmartEnv, fileId: string, ai: Ai | undefined): Promise<boolean> {
  const fail = async () => void (await env.DB.prepare(`UPDATE chat_voice SET status = 'failed' WHERE file_id = ?`).bind(fileId).run().catch(() => undefined));
  try {
    if (!ai) return await fail(), false;
    const f = await env.DB.prepare('SELECT r2_key, size FROM chat_files WHERE id = ?').bind(fileId).first<{ r2_key: string; size: number }>();
    if (!f || f.size > MAX_VOICE_BYTES) return await fail(), false;
    const obj = await env.UPLOADS.get(f.r2_key);
    if (!obj) return await fail(), false;
    const buf = new Uint8Array(await obj.arrayBuffer());
    const res = (await ai.run(WHISPER, { audio: b64(buf), task: 'transcribe' })) as { text?: string; transcription_info?: { language?: string } } | null;
    const text = String(res?.text || '').replace(/\s+/g, ' ').trim();
    if (!text) {
      // Nothing said: the card shows "No speech heard" instead of an empty transcript.
      await env.DB.prepare(`UPDATE chat_voice SET status = 'ready', transcript = '' WHERE file_id = ?`).bind(fileId).run();
      return false;
    }
    await env.DB.prepare(`UPDATE chat_voice SET status = 'ready', transcript = ?, lang = ? WHERE file_id = ?`).bind(text.slice(0, 6000), String(res?.transcription_info?.language || '').slice(0, 8), fileId).run();
    return true;
  } catch (err) {
    console.warn('[chat] voice transcript', err);
    await fail();
    return false;
  }
}

/* ------------------------------------------------------------------ the Favor Brain reads the thread */

const DEICTIC = /\b(this|that|these|those|above|here|thread|conversation|summari[sz]e|recap|they|them|he|she|it)\b/i;

/** The recent messages a question in a thread (or one that points at "this") should be read with, oldest first. Empty when none apply. */
export async function brainContext(env: Env, user: HubUser, channelId: string, threadId: number | null, beforeId: number, question: string): Promise<string> {
  if (!threadId && !DEICTIC.test(question)) return '';
  const me = lower(user.email);
  const r = threadId
    ? await env.DB.prepare(`SELECT id, email, body FROM chat_messages WHERE channel_id = ? AND (id = ? OR thread_id = ?) AND id < ? AND deleted_at IS NULL AND visible_to IS NULL ORDER BY id DESC LIMIT 14`).bind(channelId, threadId, threadId, beforeId).all<{ id: number; email: string; body: string }>()
    : await env.DB.prepare(`SELECT id, email, body FROM chat_messages WHERE channel_id = ? AND thread_id IS NULL AND id < ? AND deleted_at IS NULL AND visible_to IS NULL ORDER BY id DESC LIMIT 10`).bind(channelId, beforeId).all<{ id: number; email: string; body: string }>();
  const rows = (r.results || []).reverse();
  if (!rows.length) return '';
  const dir = await directory(env, await chatMode(env), user);
  const nm = (id: string) => (id === me ? 'Me' : id === BRAIN_ID ? 'Favor Brain' : (dir[id]?.name || id.split('@')[0]));
  let budget = 3000;
  const out: string[] = [];
  for (const x of rows) {
    const t = plainLine(x.body, nm, 320);
    if (!t) continue;
    const line = `${nm(x.email)}: ${t}`;
    if (budget - line.length < 0) break;
    budget -= line.length;
    out.push(line);
  }
  return out.join('\n');
}

export { LANGS, json };

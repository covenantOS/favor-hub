// Meetings: moving a recording from the private R2 bucket to Google Drive, and the notes made from it.
// The recorder's browser leaves one second pieces in R2 (meet/<id>/<epoch>/<seq>.webm). When the meeting ends the pieces of each
// epoch are joined, in order, into one Drive file with a resumable upload in 8 MiB parts, one part per call. The R2 copy is deleted
// only after Drive reports the full size. Sound pieces (meet/<id>/audio/<epoch>-<n>.webm) go through Whisper for the transcript.
import { saToken } from './work/sheetsa';
import { aiFor } from './ai/guard';
import type { MeetEnv, Meeting } from './meet';
import { CHAPTER_MODELS, chatJson, plain, stamp, VERBATIM_PROMPT, WHISPER } from './clipai';

export const PART = 8 * 1024 * 1024;
const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

interface DriveEnv extends MeetEnv {
  /** The one destination for recordings is the id of the Meetings shared drive or of a folder inside it. Each month gets a folder under it. Set it as a Pages secret, never in wrangler.toml, because this repo is public. */
  MEET_DRIVE_FOLDER?: string;
}

async function gtoken(env: DriveEnv): Promise<string> {
  return saToken(env, fetch, 'https://www.googleapis.com/auth/drive');
}

async function gjson(env: DriveEnv, url: string, init: RequestInit = {}): Promise<Record<string, any>> {
  const t = await gtoken(env);
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${t}`, 'content-type': 'application/json', ...(init.headers || {}) } });
  const j = (await r.json().catch(() => ({}))) as Record<string, any>;
  if (!r.ok) throw new Error(`drive ${r.status} ${j?.error?.message || ''}`.trim());
  return j;
}

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** A folder by name under a parent, made when missing. */
async function subFolder(env: DriveEnv, parent: string, name: string): Promise<string> {
  const found = await gjson(env, `${FILES}?q=${encodeURIComponent(`'${parent}' in parents and name = '${q(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`)}&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id)`);
  if (found.files?.[0]?.id) return found.files[0].id as string;
  const made = await gjson(env, `${FILES}?supportsAllDrives=true&fields=id`, { method: 'POST', body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }) });
  return made.id as string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Marketing/Recordings/2026/10 October": the team folder name, the kind, the year and the month, in Eastern time. */
export function folderPath(team: string, kind: 'Recordings' | 'Notes', iso: string): string[] {
  const [y, mo] = etDate(iso).split('-');
  const name = team.replace(/[\\/]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Other';
  return [name, kind, y, `${mo} ${MONTHS[Number(mo) - 1]}`];
}

/** The host's team from the meeting directory, "Other" when the host is not listed. */
export async function hostTeam(env: MeetEnv, m: Pick<Meeting, 'host_email'>): Promise<string> {
  const r = await env.DB.prepare('SELECT team FROM meet_directory WHERE lower(email) = lower(?)').bind(m.host_email || '').first<{ team: string }>().catch(() => null);
  return (r?.team || '').trim() || 'Other';
}

/** Meetings/<team>/<Recordings or Notes>/<year>/<month>, made when missing (Will, 2026-10-14). */
export async function meetFolder(env: DriveEnv, m: Pick<Meeting, 'host_email' | 'started_at' | 'created_at'>, kind: 'Recordings' | 'Notes'): Promise<string> {
  const root = env.MEET_DRIVE_FOLDER;
  if (!root) throw new Error('MEET_DRIVE_FOLDER is not set');
  let id = root;
  for (const name of folderPath(await hostTeam(env, m), kind, m.started_at || m.created_at)) id = await subFolder(env, id, name);
  return id;
}

/** Kept for callers that only know a date: the month folder under Other. */
export async function monthFolder(env: DriveEnv, iso: string): Promise<string> {
  return meetFolder(env, { host_email: '', started_at: iso, created_at: iso }, 'Recordings');
}

export interface EpochRow { epoch: number; chunks: Array<{ seq: number; bytes: number }>; total: number }

export async function epochs(env: MeetEnv, id: string): Promise<EpochRow[]> {
  const rows = await env.DB.prepare('SELECT epoch, seq, bytes FROM hub_meeting_chunks WHERE meeting_id = ? ORDER BY epoch, seq').bind(id).all<{ epoch: number; seq: number; bytes: number }>();
  const by = new Map<number, EpochRow>();
  for (const r of rows.results || []) {
    const e = by.get(r.epoch) || { epoch: r.epoch, chunks: [], total: 0 };
    e.chunks.push({ seq: r.seq, bytes: r.bytes });
    e.total += r.bytes;
    by.set(r.epoch, e);
  }
  return [...by.values()];
}

const chunkKey = (id: string, epoch: number, seq: number) => `meet/${id}/${epoch}/${String(seq).padStart(6, '0')}.webm`;

/** Bytes [from, to) of the epoch's joined file, read from the R2 pieces. */
async function slice(env: MeetEnv, id: string, e: EpochRow, from: number, to: number): Promise<Uint8Array> {
  const out = new Uint8Array(to - from);
  let pos = 0;
  let o = 0;
  for (const c of e.chunks) {
    const s = pos, en = pos + c.bytes;
    pos = en;
    if (en <= from) continue;
    if (s >= to) break;
    const obj = await env.CLIPS.get(chunkKey(id, e.epoch, c.seq));
    if (!obj) throw new Error(`piece ${e.epoch}/${c.seq} is missing`);
    const buf = new Uint8Array(await obj.arrayBuffer());
    const a = Math.max(from, s) - s, b = Math.min(to, en) - s;
    out.set(buf.subarray(a, b), o);
    o += b - a;
  }
  return out.subarray(0, o);
}

/** The date in Eastern time, year first, so an evening meeting is filed under the day it happened. */
export const etDate = (iso: string): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

const cleanTitle = (t: string) => t.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

/** "2026-10-10 Will's meeting, audio.webm" (a part number follows the kind when the recording moved computers). */
export const fname = (m: Pick<Meeting, 'title' | 'started_at' | 'created_at'>, epoch: number, total: number, ext: string, kind: 'audio' | 'video') =>
  `${etDate(m.started_at || m.created_at)} ${cleanTitle(m.title) || 'Meeting'}, ${kind}${total > 1 ? ` part ${epoch}` : ''}.${ext}`;

/** A meeting that kept a placeholder title such as "Meeting" or "Will's meeting" takes the title the notes give it. */
export const isDefaultTitle = (t: string): boolean => t === '' || t === 'Meeting' || /\smeeting$/i.test(t) || /^Huddle( in #| with |$)/.test(t) || /^Meeting, [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}\s?[AP]M$/.test(t);

/** One part of one epoch's file to Drive. Returns whether every epoch is now in Drive. */
export async function pumpDrive(env: DriveEnv, m: Meeting): Promise<{ done: boolean; progress: string }> {
  const eps = await epochs(env, m.id);
  if (!eps.length) return { done: true, progress: 'nothing recorded' };
  const mime = m.rec_mode === 'video' ? 'video/webm' : 'audio/webm';
  for (const e of eps) {
    let row = await env.DB.prepare('SELECT * FROM hub_meeting_drive WHERE meeting_id = ? AND epoch = ?').bind(m.id, e.epoch).first<Record<string, any>>();
    if (row?.state === 'done') continue;
    if (!row) {
      const folder = m.drive_folder || (await meetFolder(env, m, 'Recordings'));
      const name = fname(m, e.epoch, eps.length, 'webm', m.rec_mode === 'video' ? 'video' : 'audio');
      const t = await gtoken(env);
      const r = await fetch(`${UPLOAD}?uploadType=resumable&supportsAllDrives=true&fields=id,size`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'content-type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(e.total) },
        body: JSON.stringify({ name, parents: [folder], mimeType: mime }),
      });
      const url = r.headers.get('Location');
      if (!r.ok || !url) throw new Error(`drive session ${r.status}`);
      await env.DB.prepare('UPDATE hub_meetings SET drive_folder = ? WHERE id = ?').bind(folder, m.id).run();
      await env.DB.prepare('INSERT OR REPLACE INTO hub_meeting_drive (meeting_id, epoch, session_url, total_bytes, file_name, ext) VALUES (?, ?, ?, ?, ?, ?)').bind(m.id, e.epoch, url, e.total, name, 'webm').run();
      row = { session_url: url, sent_bytes: 0, total_bytes: e.total, file_name: name };
    }
    const from = Number(row.sent_bytes) || 0;
    const to = Math.min(e.total, from + PART);
    const body = await slice(env, m.id, e, from, to);
    const t = await gtoken(env);
    const r = await fetch(String(row.session_url), {
      method: 'PUT',
      headers: { Authorization: `Bearer ${t}`, 'Content-Range': `bytes ${from}-${to - 1}/${e.total}`, 'Content-Length': String(body.length) },
      body,
    });
    if (r.status === 308) {
      await env.DB.prepare('UPDATE hub_meeting_drive SET sent_bytes = ? WHERE meeting_id = ? AND epoch = ?').bind(to, m.id, e.epoch).run();
      return { done: false, progress: `${Math.round((to / e.total) * 100)}%` };
    }
    if (r.ok) {
      const j = (await r.json().catch(() => ({}))) as { id?: string; size?: string };
      if (Number(j.size) !== e.total) throw new Error(`drive size ${j.size} against ${e.total}`);
      await env.DB.prepare(`UPDATE hub_meeting_drive SET sent_bytes = ?, state = 'done', file_id = ? WHERE meeting_id = ? AND epoch = ?`).bind(e.total, j.id || '', m.id, e.epoch).run();
      // Drive confirmed the full size: the R2 copy can go.
      const keys = e.chunks.map((c) => chunkKey(m.id, e.epoch, c.seq));
      for (let i = 0; i < keys.length; i += 500) await env.CLIPS.delete(keys.slice(i, i + 500));
      await env.DB.prepare('UPDATE hub_meetings SET drive_file_id = CASE WHEN drive_file_id = \'\' THEN ? ELSE drive_file_id END WHERE id = ?').bind(j.id || '', m.id).run();
      continue;
    }
    if (r.status === 404 || r.status === 410) {
      await env.DB.prepare('DELETE FROM hub_meeting_drive WHERE meeting_id = ? AND epoch = ?').bind(m.id, e.epoch).run();
      return { done: false, progress: 'restarting' };
    }
    throw new Error(`drive put ${r.status}`);
  }
  return { done: true, progress: 'stored' };
}

// ---------------------------------------------------------------- transcript and notes

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export interface Line { t: number; text: string; who?: string }

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/ +/g, ' ').trim();

/** Lines in time order with a repeat of the same words inside ten seconds dropped. Whisper sometimes says one sentence twice across a slice boundary. */
export function dedupeLines<T extends { t: number; text: string }>(lines: T[], window = 10): T[] {
  const out: T[] = [];
  for (const l of [...lines].sort((a, b) => a.t - b.t)) {
    const n = norm(l.text);
    if (n && out.some((k) => l.t - k.t <= window && l.t - k.t >= 0 && norm(k.text) === n)) continue;
    out.push(l);
  }
  return out;
}

/** The one person in the room during a slice, when the recorder could not tell who spoke and only one person was there. */
async function soleSpeaker(env: MeetEnv, id: string, from: number, to: number): Promise<string> {
  const rows = (await env.DB.prepare('SELECT DISTINCT name FROM hub_meeting_presence WHERE meeting_id = ? AND removed = 0 AND waiting = 0 AND joined_at <= ? AND (left_at = 0 OR left_at >= ?)').bind(id, to, from).all<{ name: string }>()).results || [];
  return rows.length === 1 ? rows[0].name : '';
}

/** One stored sound slice through Whisper into transcript lines. Used as the slice arrives (live) and again for any slice left over. */
export async function transcribeRow(env: MeetEnv, m: Pick<Meeting, 'id' | 'started_at' | 'created_at'>, next: { epoch: number; n: number; start_ms: number; end_ms?: number; ext: string; bytes: number }, who = ''): Promise<number> {
  const key = `meet/${m.id}/audio/${next.epoch}-${next.n}.${next.ext}`;
  const obj = await env.CLIPS.get(key);
  const lines: Line[] = [];
  if (obj && next.bytes < 24 * 1024 * 1024) {
    const ai = aiFor(env.AI, 'meet-notes') as { run(model: string, input: unknown, meta?: { audioSec?: number }): Promise<unknown> } | undefined;
    if (!ai) throw new Error('no ai binding');
    const res = (await ai.run(WHISPER, { audio: b64(new Uint8Array(await obj.arrayBuffer())), initial_prompt: VERBATIM_PROMPT, condition_on_previous_text: false }, { audioSec: Math.max(1, ((next.end_ms || next.start_ms + 11_000) - next.start_ms) / 1000) })) as { text?: string; segments?: Array<{ start?: number; text?: string; no_speech_prob?: number }> };
    const t0 = Date.parse(m.started_at || m.created_at);
    const base = (next.start_ms - t0) / 1000;
    const ghost = /^(thanks for watching|thank you for watching|thank you\.?|you\.?|bye\.?|\.+)$/i;
    const segs = (res.segments || []).filter((s) => (s.text || '').trim() && !(typeof s.no_speech_prob === 'number' && s.no_speech_prob > 0.9) && !ghost.test(String(s.text).trim()));
    for (const s of segs) lines.push({ t: Math.max(0, Math.round(base + (Number(s.start) || 0))), text: plain(s.text, 600) });
    if (!lines.length && res.text && !ghost.test(res.text.trim())) lines.push({ t: Math.max(0, Math.round(base)), text: plain(res.text, 2000) });
  }
  if (lines.length) {
    // A repeat of a sentence already stored in the last ten seconds is dropped, so captions and notes read each thing once.
    const lo = Math.min(...lines.map((l) => l.t)) - 10;
    const prior = (await env.DB.prepare('SELECT t, text FROM hub_meeting_lines WHERE meeting_id = ? AND t >= ?').bind(m.id, lo).all<{ t: number; text: string }>()).results || [];
    const kept = dedupeLines([...prior.map((p) => ({ ...p, old: true })), ...lines.map((l) => ({ ...l, old: false }))]).filter((l) => !l.old);
    // When the recorder named nobody and only one person was in the room, that person spoke.
    const speaker = plain(who, 80) || (kept.length ? await soleSpeaker(env, m.id, next.start_ms, next.end_ms || next.start_ms + 11000).catch(() => '') : '');
    if (kept.length) {
      const last = await env.DB.prepare('SELECT COALESCE(MAX(n), 0) AS n FROM hub_meeting_lines WHERE meeting_id = ?').bind(m.id).first<{ n: number }>();
      let n = (last?.n || 0) + 1;
      await env.DB.batch(kept.map((l) => env.DB.prepare('INSERT INTO hub_meeting_lines (meeting_id, n, t, who, text) VALUES (?, ?, ?, ?, ?)').bind(m.id, n++, l.t, speaker, l.text)));
    }
  }
  await env.DB.prepare(`UPDATE hub_meeting_audio SET status = 'done' WHERE meeting_id = ? AND epoch = ? AND n = ?`).bind(m.id, next.epoch, next.n).run();
  await env.CLIPS.delete(key);
  return lines.length;
}

/** Slices still waiting at the end of a meeting. When none are left the lines are joined into the meeting's transcript. */
export async function pumpTranscript(env: MeetEnv, m: Meeting): Promise<{ done: boolean; progress: string }> {
  const next = await env.DB.prepare(`SELECT * FROM hub_meeting_audio WHERE meeting_id = ? AND status = 'new' ORDER BY epoch, n LIMIT 1`).bind(m.id).first<{ epoch: number; n: number; start_ms: number; ext: string; bytes: number }>();
  if (next) {
    await transcribeRow(env, m, next);
    return { done: false, progress: `piece ${next.epoch}.${next.n}` };
  }
  const all = await env.DB.prepare('SELECT t, who, text FROM hub_meeting_lines WHERE meeting_id = ? ORDER BY t, n').bind(m.id).all<Line>();
  const lines = dedupeLines(all.results || []);
  await env.DB.prepare('UPDATE hub_meetings SET transcript = ? WHERE id = ?').bind(JSON.stringify(lines), m.id).run();
  m.transcript = JSON.stringify(lines);
  return { done: true, progress: 'read' };
}

export interface NotesOut { title: string; summary: string; decisions: Array<{ t: number; text: string }>; actions: Array<{ text: string; owner: string; due: string; t: number }>; chapters: Array<{ t: number; title: string }> }

const NOTE_VOICE = 'You work for Favor International, a Christian nonprofit, and write the notes of a staff meeting from its transcript. Name the staff member who owns each action item when the transcript names them. Leave out partner addresses, phone numbers, emails and gift amounts. Never invent facts, names, dates or numbers. Do not use em dashes. Do not mention artificial intelligence.';

/** Words of a quote that also appear in the lines around where the model says it was said: a check that the item was really said. */
export function quoteHolds(quote: string, near: string): boolean {
  const w = norm(quote).split(' ').filter((x) => x.length > 2);
  if (w.length < 2) return false;
  const hay = new Set(norm(near).split(' '));
  return w.filter((x) => hay.has(x)).length / w.length >= 0.6;
}

/** Action items that name no concrete thing ("Develop the dashboard further", "Continue the discussion") are dropped. */
export function vagueAction(text: string): boolean {
  const t = text.trim().toLowerCase();
  const n = t.split(/\s+/).length;
  if (n < 4) return true;
  if (/\b(further|more|going forward|as needed)$/.test(t) && n < 9) return true;
  return /^(continue|keep|discuss|work on|look into|think about|explore|consider)\b/.test(t) && n < 8;
}

type RawPart = { summary?: unknown; decisions?: unknown; actions?: unknown; topics?: unknown };

/** Favor says partners, never donors, in anything staff read (the model slips when the talk itself says donors). */
export const partnersWord = (s: string): string => s.replace(/\b([Dd])onor(s?)\b/g, (_m, d: string, pl: string) => (d === 'D' ? 'Partner' : 'partner') + pl);

/**
 * The notes of a meeting. Every transcript line carries a number, and the model cites line numbers instead of times, so each
 * decision, action item and chapter takes the real time of the line it came from (the old notes put chapters at 0, 10, 20 and 30).
 * A long meeting is read in parts and joined, so the middle is never dropped. Each action item must quote the words said; an item
 * whose quote is not in the transcript around that line, or that names nothing concrete, is left out.
 */
export async function makeNotes(env: MeetEnv, m: Meeting, names: string[]): Promise<NotesOut | null> {
  const lines = (JSON.parse(m.transcript || '[]') as Line[]).filter((l) => l && l.text);
  if (!lines.length) return null;
  const all = lines.map((l, i) => `L${i + 1} [${stamp(l.t)}] ${l.who ? l.who + ': ' : ''}${l.text}`);
  // Parts of about 16,000 characters, so a 70 minute meeting is three or four reads.
  const parts: string[] = [];
  for (let i = 0; i < all.length;) {
    let len = 0, j = i;
    while (j < all.length && (j === i || len + all[j].length < 16000)) len += all[j++].length + 1;
    parts.push(all.slice(i, j).join('\n'));
    i = j;
  }
  const who = names.slice(0, 30).join(', ') || 'unknown';
  const rules = `Each transcript line starts with its line number (L12), its time, and when the system could tell, the person who was talking for most of that stretch (the label can be wrong when people talk over each other). People in the meeting: ${who}.
Return keys:
summary: 2 to 4 sentences on what this stretch covered, with the specific projects, numbers and names said.
decisions: up to 6 objects {line, text}, only things the group agreed or settled, written as a plain statement.
actions: up to 10 objects {line, owner, text, due, quote}. An action item is a specific task a person took on or was asked to do. text starts with a verb and names the concrete thing and its detail, for example "Send Megan the final print file for the November letter". Never write a vague item such as "Develop the dashboard further" or "Continue working on the project". owner is the person named or the person who said they would do it, else empty. due is a date or phrase said aloud, else empty. quote is the exact words from the transcript, at most 20 words, where the task was said.
topics: 1 to 5 objects {line, title}: where a new subject starts, title at most 6 words.
Leave out small talk, greetings and getting the call working (audio, browsers, who can hear whom). Spell people's names as they appear in the list of people. Say partners, never donors.
line is the number after L. Use only what the transcript says. Do not invent names, dates, numbers or dollar amounts. Never copy a partner's personal details into the notes. Leave out prayer requests and personal matters people shared. No em dashes.`;
  const read = (text: string, n: number) => chatJson<RawPart>(env as never, `You read part ${n} of ${parts.length} of a staff meeting transcript at a nonprofit and pull out its notes.\n${rules}`, `Meeting title: ${m.title}\n\nTranscript:\n${text}`, 1600, CHAPTER_MODELS, { feature: 'meet-notes', voice: NOTE_VOICE });
  // The parts are read at the same time, so a long meeting's notes take about as long as one read (the step runs in the
  // background after the room empties, where time is short).
  const outs: RawPart[] = await Promise.all(parts.map(async (text, k) => {
    let o = await read(text, k + 1).catch(() => ({}) as RawPart);
    if (!plain(o.summary, 1600) && !Array.isArray(o.actions)) o = await read(text, k + 1).catch(() => ({}) as RawPart);
    return o;
  }));
  const arr = (x: unknown) => (Array.isArray(x) ? (x as Array<Record<string, unknown>>) : []);
  const at = (x: unknown): number | null => { const n = Number(String(x ?? '').replace(/^L/i, '')); return Number.isInteger(n) && n >= 1 && n <= lines.length ? n - 1 : null; };
  const near = (i: number) => lines.slice(Math.max(0, i - 3), i + 4).map((l) => l.text).join(' ');
  const decisions: NotesOut['decisions'] = [];
  const actions: NotesOut['actions'] = [];
  const chapters: NotesOut['chapters'] = [];
  for (const o of outs) {
    for (const d of arr(o.decisions)) { const i = at(d.line); const text = plain(d.text, 300); if (i != null && text) decisions.push({ t: lines[i].t, text }); }
    for (const a of arr(o.actions)) {
      const i = at(a.line); const text = plain(a.text, 300).replace(/\.$/, '');
      if (i == null || !text || vagueAction(text) || !quoteHolds(String(a.quote ?? ''), near(i))) continue;
      actions.push({ text, owner: plain(a.owner, 80), due: plain(a.due, 60), t: lines[i].t });
    }
    for (const c of arr(o.topics)) { const i = at(c.line); const title = plain(c.title, 80).replace(/\.$/, ''); if (i != null && title) chapters.push({ t: lines[i].t, title }); }
  }
  // One item said twice across a part boundary is kept once.
  const key = (x: { text?: string; title?: string }) => norm(String(x.text ?? x.title ?? ''));
  const uniq = <T extends { text?: string; title?: string }>(xs: T[]) => xs.filter((x, i) => xs.findIndex((y) => key(y) === key(x)) === i);
  const chap = uniq(chapters.sort((x, y) => x.t - y.t)).filter((c, i, xs) => i === 0 || c.t - xs[i - 1].t >= 60);
  if (chap.length && chap[0].t > 90) chap.unshift({ t: lines[0].t, title: 'Opening' });
  const dec = uniq(decisions).sort((x, y) => x.t - y.t).slice(0, 10);
  const act = uniq(actions).sort((x, y) => x.t - y.t).slice(0, 15);
  // The title and the summary are written from the parts' summaries, so the whole meeting is covered.
  const partSums = outs.map((o, k) => `Part ${k + 1}: ${plain(o.summary, 1200)}`).join('\n');
  const head = await chatJson<{ title?: unknown; summary?: unknown }>(env as never,
    'You write the title and summary of a staff meeting from summaries of its parts, in order. Return keys: title (at most 8 words, plain, says what the meeting was about, no trailing period) and summary (3 to 6 sentences: what was covered, what was decided, who is doing what next; name the specific projects and people). Leave out prayer requests, personal matters and getting the call working. Spell the names as the People line spells them. Say partners, never donors. Do not invent anything. No em dashes.',
    `Meeting title: ${m.title}\nPeople: ${who}\n\n${partSums}\n\nDecisions:\n${dec.map((d) => '- ' + d.text).join('\n') || 'none'}\n\nAction items:\n${act.map((a) => `- ${a.owner ? a.owner + ': ' : ''}${a.text}`).join('\n') || 'none'}`,
    700, CHAPTER_MODELS, { feature: 'meet-notes', voice: NOTE_VOICE }).catch(() => ({}) as { title?: unknown; summary?: unknown });
  const w = partnersWord;
  return {
    title: w(plain(head.title, 120).replace(/\.$/, '')),
    summary: w(plain(head.summary, 1600) || outs.map((o) => plain(o.summary, 600)).filter(Boolean).join(' ').slice(0, 1600)),
    decisions: dec.map((d) => ({ ...d, text: w(d.text) })),
    actions: act.map((a) => ({ ...a, text: w(a.text) })),
    chapters: chap.slice(0, 12).map((c) => ({ ...c, title: w(c.title) })),
  };
}

// ---------------------------------------------------------------- names and the Google Doc beside the recording

export const HUB = 'https://dash.favorintl.org';

/** The recording files take the notes title when the meeting kept a placeholder title. */
export async function renameRecordings(env: DriveEnv, m: Meeting, title: string): Promise<void> {
  const rows = (await env.DB.prepare(`SELECT epoch, file_id FROM hub_meeting_drive WHERE meeting_id = ? AND state = 'done' AND file_id != '' ORDER BY epoch`).bind(m.id).all<{ epoch: number; file_id: string }>()).results || [];
  const kind = m.rec_mode === 'video' ? 'video' : 'audio';
  for (const r of rows) {
    const name = fname({ ...m, title }, r.epoch, rows.length, 'webm', kind);
    await gjson(env, `${FILES}/${encodeURIComponent(r.file_id)}?supportsAllDrives=true&fields=id`, { method: 'PATCH', body: JSON.stringify({ name }) });
    await env.DB.prepare('UPDATE hub_meeting_drive SET file_name = ? WHERE meeting_id = ? AND epoch = ?').bind(name, m.id, r.epoch).run();
  }
}

const h = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface DocInput {
  title: string;
  startedAt: string;
  summary: string;
  decisions: Array<{ t: number; text: string }>;
  actions: Array<{ text: string; owner: string; due: string; t: number }>;
  chapters: Array<{ t: number; title: string }>;
  transcript: Line[];
  people: string[];
  notesUrl: string;
  recordingUrls: string[];
}

/** The notes as HTML. Google converts it to a Doc with real headings, lists and links. */
export function notesDocHtml(d: DocInput): string {
  const when = new Date(d.startedAt).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const list = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>` : '');
  const links = [`<a href="${h(d.notesUrl)}">Notes in FavorOS</a>`, ...d.recordingUrls.map((u, i) => `<a href="${h(u)}">${d.recordingUrls.length > 1 ? `Recording, part ${i + 1}` : 'Recording'}</a>`)];
  return `<html><body><h1>${h(d.title)}</h1><p>${h(when)} Eastern</p><p>${links.join(' &nbsp;|&nbsp; ')}</p>
<h2>Summary</h2><p>${h(d.summary || 'No summary.')}</p>
${d.decisions.length ? `<h2>Decisions</h2>${list(d.decisions.map((x) => `${h(x.text)} (${stamp(x.t)})`))}` : ''}
<h2>Action items</h2>${d.actions.length ? list(d.actions.map((a) => `${h(a.text)}. Owner: ${h(a.owner || 'not named')}${a.due ? `. Due: ${h(a.due)}` : ''}`)) : '<p>None.</p>'}
${d.chapters.length ? `<h2>Chapters</h2>${list(d.chapters.map((c) => `${stamp(c.t)} ${h(c.title)}`))}` : ''}
<h2>People present</h2>${d.people.length ? list(d.people.map(h)) : '<p>No one is listed.</p>'}
<h2>Transcript</h2>${d.transcript.length ? d.transcript.map((l) => `<p>[${stamp(l.t)}] ${l.who ? `<b>${h(l.who)}:</b> ` : ''}${h(l.text)}</p>`).join('') : '<p>No transcript.</p>'}
</body></html>`;
}

/** A Google Doc of the notes next to the recording. Returns the doc id. */
export async function makeNotesDoc(env: DriveEnv, m: Meeting, title: string, input: DocInput): Promise<string> {
  const folder = await meetFolder(env, m, 'Notes');
  const name = `${etDate(m.started_at || m.created_at)} ${cleanTitle(title) || 'Meeting'} notes`;
  const boundary = `b${crypto.randomUUID().replace(/-/g, '')}`;
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, mimeType: 'application/vnd.google-apps.document', parents: [folder] })}\r\n--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${notesDocHtml(input)}\r\n--${boundary}--`;
  const t = await gtoken(env);
  const r = await fetch(`${UPLOAD}?uploadType=multipart&supportsAllDrives=true&fields=id`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'content-type': `multipart/related; boundary=${boundary}` }, body });
  const j = (await r.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!r.ok || !j.id) throw new Error(`drive doc ${r.status} ${j.error?.message || ''}`.trim());
  await env.DB.prepare('UPDATE hub_meetings SET notes_doc_id = ? WHERE id = ?').bind(j.id, m.id).run();
  return j.id;
}

/** The recording file, streamed to the browser with the range the player asked for. */
export async function streamFile(env: DriveEnv, fileId: string, range: string | null): Promise<Response> {
  const t = await gtoken(env);
  const r = await fetch(`${FILES}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${t}`, ...(range ? { Range: range } : {}) } });
  const out = new Headers();
  for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) { const v = r.headers.get(k); if (v) out.set(k, v); }
  if (!out.has('accept-ranges')) out.set('accept-ranges', 'bytes');
  out.set('cache-control', 'private, max-age=300');
  return new Response(r.body, { status: r.status === 206 || r.status === 200 ? r.status : r.status, headers: out });
}

// ---------------------------------------------------------------- taking a file out of Drive

/**
 * Takes a recording or notes Doc out of Drive. Trash works when the service account manages the folder. As a Contributor on US Team
 * Files it may not trash (checked 2026-10-14), so the file is emptied and renamed instead, and the caller lists it for a person who
 * can trash it. Drive keeps an emptied file's older versions until the file is trashed.
 */
export async function removeDriveFile(env: DriveEnv, fileId: string, kind: 'recording' | 'notes', note = ''): Promise<'trashed' | 'emptied' | 'gone'> {
  const t = await gtoken(env);
  const url = `${FILES}/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id`;
  const tr = await fetch(url, { method: 'PATCH', headers: { Authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
  if (tr.ok) return 'trashed';
  if (tr.status === 404) return 'gone';
  const doc = kind === 'notes';
  const body = doc
    ? `<html><body><p>These notes were replaced${note ? ' on ' + h(note) : ''}. The current notes are in FavorOS.</p></body></html>`
    : 'removed';
  const up = await fetch(`${UPLOAD}/${encodeURIComponent(fileId)}?uploadType=media&supportsAllDrives=true&fields=id`, { method: 'PATCH', headers: { Authorization: `Bearer ${t}`, 'content-type': doc ? 'text/html; charset=UTF-8' : 'application/octet-stream' }, body });
  if (up.status === 404) return 'gone';
  if (!up.ok) throw new Error(`drive empty ${up.status}`);
  await gjson(env, url, { method: 'PATCH', body: JSON.stringify({ name: doc ? 'Replaced notes, trash this file' : 'Removed recording, trash this file', description: 'Removed in FavorOS. Trash this file.' }) });
  return 'emptied';
}

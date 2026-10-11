// Meetings: moving a recording from the private R2 bucket to Google Drive, and the notes made from it.
// The recorder's browser leaves one second pieces in R2 (meet/<id>/<epoch>/<seq>.webm). When the meeting ends the pieces of each
// epoch are joined, in order, into one Drive file with a resumable upload in 8 MiB parts, one part per call. The R2 copy is deleted
// only after Drive reports the full size. Sound pieces (meet/<id>/audio/<epoch>-<n>.webm) go through Whisper for the transcript.
import { saToken } from './work/sheetsa';
import type { MeetEnv, Meeting } from './meet';
import { chatJson, plain, stamp, VERBATIM_PROMPT, WHISPER } from './clipai';

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

/** The folder for this month under Meetings, made when missing. */
export async function monthFolder(env: DriveEnv, iso: string): Promise<string> {
  const root = env.MEET_DRIVE_FOLDER;
  if (!root) throw new Error('MEET_DRIVE_FOLDER is not set');
  const name = iso.slice(0, 7);
  const found = await gjson(env, `${FILES}?q=${encodeURIComponent(`'${root}' in parents and name = '${q(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`)}&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id)`);
  if (found.files?.[0]?.id) return found.files[0].id as string;
  const made = await gjson(env, `${FILES}?supportsAllDrives=true&fields=id`, { method: 'POST', body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [root] }) });
  return made.id as string;
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
export const isDefaultTitle = (t: string): boolean => t === '' || t === 'Meeting' || /\smeeting$/i.test(t);

/** One part of one epoch's file to Drive. Returns whether every epoch is now in Drive. */
export async function pumpDrive(env: DriveEnv, m: Meeting): Promise<{ done: boolean; progress: string }> {
  const eps = await epochs(env, m.id);
  if (!eps.length) return { done: true, progress: 'nothing recorded' };
  const mime = m.rec_mode === 'video' ? 'video/webm' : 'audio/webm';
  for (const e of eps) {
    let row = await env.DB.prepare('SELECT * FROM hub_meeting_drive WHERE meeting_id = ? AND epoch = ?').bind(m.id, e.epoch).first<Record<string, any>>();
    if (row?.state === 'done') continue;
    if (!row) {
      const folder = m.drive_folder || (await monthFolder(env, m.started_at || m.created_at));
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
    const ai = env.AI as { run(model: string, input: unknown): Promise<unknown> } | undefined;
    if (!ai) throw new Error('no ai binding');
    const res = (await ai.run(WHISPER, { audio: b64(new Uint8Array(await obj.arrayBuffer())), initial_prompt: VERBATIM_PROMPT, condition_on_previous_text: false })) as { text?: string; segments?: Array<{ start?: number; text?: string; no_speech_prob?: number }> };
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

export async function makeNotes(env: MeetEnv, m: Meeting, names: string[]): Promise<NotesOut | null> {
  const lines = JSON.parse(m.transcript || '[]') as Line[];
  if (!lines.length) return null;
  const text = lines.map((l) => `[${stamp(l.t)}] ${l.who ? l.who + ': ' : ''}${l.text}`).join('\n');
  const body = text.length > 28000 ? `${text.slice(0, 19000)}\n[...]\n${text.slice(-9000)}` : text;
  const ask = () => chatJson<{ title?: unknown; summary?: unknown; decisions?: unknown; actions?: unknown; chapters?: unknown }>(
    env as never,
    `You write the notes of a staff meeting at a nonprofit. Each transcript line has a time in minutes and seconds and, when the system could tell, the name of the person who was talking for most of that stretch (the label can be wrong when people talk over each other). People who were invited: ${names.slice(0, 30).join(', ') || 'unknown'}.
Return keys: title (at most 8 words, plain, says what the meeting was about, no trailing period); summary (3 to 5 sentences of what was covered and decided); decisions (array of up to 8 objects {t: seconds from the start, text}, only things the group agreed); actions (array of up to 12 objects {text, owner, due, t}, where owner is a person named in the talk or empty, due is a date or phrase said aloud or empty, t is seconds); chapters (array of 4 to 10 objects {t: seconds, title of at most 6 words}). Use only what the transcript says. Do not invent names, dates, numbers or dollar amounts. Never copy a partner's personal details, address or phone number into the notes. No em dashes.`,
    `Meeting title: ${m.title}\n\nTranscript:\n${body}`,
    1800
  );
  let out = await ask();
  // A reply with a title and no summary is a miss; one more try before the notes go out empty.
  if (!plain(out.summary, 1600)) out = await ask().catch(() => out);
  const num = (x: unknown) => Math.max(0, Math.round(Number(x) || 0));
  const arr = (x: unknown) => (Array.isArray(x) ? (x as Array<Record<string, unknown>>) : []);
  return {
    title: plain(out.title, 120).replace(/\.$/, ''),
    summary: plain(out.summary, 1600),
    decisions: arr(out.decisions).slice(0, 8).map((d) => ({ t: num(d.t), text: plain(d.text, 300) })).filter((d) => d.text),
    actions: arr(out.actions).slice(0, 12).map((a) => ({ text: plain(a.text, 300), owner: plain(a.owner, 80), due: plain(a.due, 60), t: num(a.t) })).filter((a) => a.text),
    chapters: arr(out.chapters).slice(0, 10).map((c) => ({ t: num(c.t), title: plain(c.title, 80) })).filter((c) => c.title),
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
  const links = [`<a href="${h(d.notesUrl)}">Notes in Favor Hub</a>`, ...d.recordingUrls.map((u, i) => `<a href="${h(u)}">${d.recordingUrls.length > 1 ? `Recording, part ${i + 1}` : 'Recording'}</a>`)];
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
  const folder = m.drive_folder || (await monthFolder(env, m.started_at || m.created_at));
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

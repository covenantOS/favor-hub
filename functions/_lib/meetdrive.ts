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
  /** The Drive folder "Meetings" recordings are filed under (inside the shared drive the service account can write to). */
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

const fname = (m: Meeting, epoch: number, total: number, ext: string, kind: string) => {
  const d = (m.started_at || m.created_at).slice(0, 10);
  const base = `${m.title.replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 80)} ${d}`;
  return `${base}${total > 1 ? ` part ${epoch}` : ''} (${kind}).${ext}`;
};

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
      const name = fname(m, e.epoch, eps.length, 'webm', m.rec_mode === 'video' ? 'recording' : 'sound');
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

export interface Line { t: number; text: string }

/** One sound piece through Whisper. Returns false when nothing is left to read. */
export async function pumpTranscript(env: MeetEnv, m: Meeting): Promise<{ done: boolean; progress: string }> {
  const next = await env.DB.prepare(`SELECT * FROM hub_meeting_audio WHERE meeting_id = ? AND status = 'new' ORDER BY epoch, n LIMIT 1`).bind(m.id).first<{ epoch: number; n: number; start_ms: number; ext: string; bytes: number }>();
  if (!next) return { done: true, progress: 'read' };
  const obj = await env.CLIPS.get(`meet/${m.id}/audio/${next.epoch}-${next.n}.${next.ext}`);
  let lines: Line[] = [];
  if (obj && next.bytes < 24 * 1024 * 1024) {
    const ai = env.AI as { run(model: string, input: unknown): Promise<unknown> } | undefined;
    if (!ai) throw new Error('no ai binding');
    const res = (await ai.run(WHISPER, { audio: b64(new Uint8Array(await obj.arrayBuffer())), initial_prompt: VERBATIM_PROMPT, condition_on_previous_text: false })) as { text?: string; segments?: Array<{ start?: number; text?: string; no_speech_prob?: number }> };
    const t0 = Date.parse(m.started_at || m.created_at);
    const base = (next.start_ms - t0) / 1000;
    const ghost = /^(thanks for watching|thank you for watching|thank you\.?|you\.?|bye\.?|\.+)$/i;
    const segs = (res.segments || []).filter((s) => (s.text || '').trim() && !(typeof s.no_speech_prob === 'number' && s.no_speech_prob > 0.9) && !ghost.test(String(s.text).trim()));
    lines = segs.map((s) => ({ t: Math.max(0, Math.round(base + (Number(s.start) || 0))), text: plain(s.text, 600) }));
    if (!lines.length && res.text && !ghost.test(res.text.trim())) lines = [{ t: Math.max(0, Math.round(base)), text: plain(res.text, 2000) }];
  }
  const prev = JSON.parse(m.transcript || '[]') as Line[];
  const all = [...prev, ...lines].sort((a, b) => a.t - b.t);
  await env.DB.prepare('UPDATE hub_meetings SET transcript = ? WHERE id = ?').bind(JSON.stringify(all), m.id).run();
  await env.DB.prepare(`UPDATE hub_meeting_audio SET status = 'done' WHERE meeting_id = ? AND epoch = ? AND n = ?`).bind(m.id, next.epoch, next.n).run();
  await env.CLIPS.delete(`meet/${m.id}/audio/${next.epoch}-${next.n}.${next.ext}`);
  m.transcript = JSON.stringify(all);
  return { done: false, progress: `piece ${next.epoch}.${next.n}` };
}

export interface NotesOut { title: string; summary: string; decisions: Array<{ t: number; text: string }>; actions: Array<{ text: string; owner: string; due: string; t: number }>; chapters: Array<{ t: number; title: string }> }

export async function makeNotes(env: MeetEnv, m: Meeting, names: string[]): Promise<NotesOut | null> {
  const lines = JSON.parse(m.transcript || '[]') as Line[];
  if (!lines.length) return null;
  const text = lines.map((l) => `[${stamp(l.t)}] ${l.text}`).join('\n');
  const body = text.length > 28000 ? `${text.slice(0, 19000)}\n[...]\n${text.slice(-9000)}` : text;
  const out = await chatJson<{ title?: unknown; summary?: unknown; decisions?: unknown; actions?: unknown; chapters?: unknown }>(
    env as never,
    `You write the notes of a staff meeting at a nonprofit. The transcript has no speaker names, only times in minutes and seconds. People who were invited: ${names.slice(0, 30).join(', ') || 'unknown'}.
Return keys: title (at most 8 words, plain, says what the meeting was about, no trailing period); summary (3 to 5 sentences of what was covered and decided); decisions (array of up to 8 objects {t: seconds from the start, text}, only things the group agreed); actions (array of up to 12 objects {text, owner, due, t}, where owner is a person named in the talk or empty, due is a date or phrase said aloud or empty, t is seconds); chapters (array of 4 to 10 objects {t: seconds, title of at most 6 words}). Use only what the transcript says. Do not invent names, dates, numbers or dollar amounts. Never copy a partner's personal details, address or phone number into the notes. No em dashes.`,
    `Meeting title: ${m.title}\n\nTranscript:\n${body}`,
    1800
  );
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

// Meetings: keeping private moments out of the record, and taking things out after the call.
//   Pause      A host turns on "Private moment" in the room. Until it is turned off the hub stores no sound slice and no recording piece,
//              so nothing said then reaches the transcript, the notes, the recording, the Google Doc or Favor Brain.
//   Cut        A host or hub admin removes a stretch of a finished meeting (from one time to another, or to the end). The transcript
//              lines, live notes, room chat and Brain questions in that stretch go, the action items said there go with the tasks made
//              from them, the summary and chapters are written again from what is left, the Chat posts are rewritten, the old Google
//              Doc is taken out of Drive and Favor Brain's index, and a new Doc is made.
//   Delete     A host or hub admin deletes the recording: every Drive part, any piece still in R2, and the player.
// History: on 2026-10-14 Danny Avila asked to remove the recording and the prayer requests of the Weekly Marketing Meeting. It took a
// person working by hand in D1, Drive and the Brain index. These are the tools for that.
import { HttpError, nowIso } from './http';
import { getMeeting, isHost, type Meeting, type MeetEnv } from './meet';
import { dedupeLines, makeNotes, removeDriveFile, type NotesOut } from './meetdrive';
import { MEETINGS_ID } from './chat/text';
import { summaryBody } from './meetauto';

type User = { email: string; name?: string; role: string };
type Vec = { deleteByIds(ids: string[]): Promise<unknown> };
type PEnv = MeetEnv & { MEET_DRIVE_FOLDER?: string; DRIVE_DB?: D1Database; VECTORIZE?: Vec };
type Line = { t: number; who?: string; text: string };

const safeJson = <T>(s: unknown, d: T): T => { try { const v = JSON.parse(String(s ?? '')); return v == null ? d : (v as T); } catch { return d; } };
const startOf = (m: Meeting) => Date.parse(m.started_at || m.created_at) || 0;
const inRange = (t: number, from: number, to: number | null) => t >= from && (to == null || t < to);

async function notice(env: MeetEnv, id: string, body: unknown) {
  await env.DB.prepare(`INSERT INTO hub_meeting_events (meeting_id, kind, from_pid, to_pid, body, ts) VALUES (?, 'notice', '', '', ?, ?)`).bind(id, JSON.stringify(body), Date.now()).run();
}

/** Host of the meeting (booked or made) or a hub admin. */
export function mayEdit(m: Meeting, user: User): boolean {
  return user.role === 'admin' || isHost(m, user.email);
}

// ---------------------------------------------------------------- pause

/** True while a private moment is on: the recorder's sound slices and recording pieces are not stored. */
export async function privateNow(env: MeetEnv, id: string): Promise<boolean> {
  const r = await env.DB.prepare('SELECT 1 AS x FROM hub_meeting_private WHERE meeting_id = ? AND to_t IS NULL LIMIT 1').bind(id).first().catch(() => null);
  return !!r;
}

/** Turns a private moment on or off. hostish is the caller's role in the room (host or made host), checked by the route. */
export async function setPrivate(env: MeetEnv, user: User, m: Meeting, on: boolean, hostish: boolean, name = '') {
  if (!hostish && !mayEdit(m, user)) throw new HttpError(403, 'host_only', 'Only a host can pause the notes.');
  if (m.status !== 'live') throw new HttpError(400, 'not_live', 'The meeting is not running.');
  const t = Math.max(0, Math.round((Date.now() - startOf(m)) / 1000));
  const open = await privateNow(env, m.id);
  if (on && !open) {
    const n = await env.DB.prepare('SELECT COALESCE(MAX(n), 0) + 1 AS n FROM hub_meeting_private WHERE meeting_id = ?').bind(m.id).first<{ n: number }>();
    await env.DB.prepare('INSERT INTO hub_meeting_private (meeting_id, n, from_t, to_t, by_email, at) VALUES (?, ?, ?, NULL, ?, ?)').bind(m.id, n?.n || 1, t, user.email.toLowerCase(), nowIso()).run();
    await env.DB.prepare('UPDATE hub_meetings SET private_on = 1 WHERE id = ?').bind(m.id).run();
    await notice(env, m.id, { a: 'private-on', name });
  } else if (!on && open) {
    await env.DB.prepare('UPDATE hub_meeting_private SET to_t = ? WHERE meeting_id = ? AND to_t IS NULL').bind(t, m.id).run();
    await env.DB.prepare('UPDATE hub_meetings SET private_on = 0 WHERE id = ?').bind(m.id).run();
    await notice(env, m.id, { a: 'private-off', name });
  }
  return { ok: true, private: on, t };
}

/** A meeting that ends during a private moment closes it at the end time. */
export async function closePrivate(env: MeetEnv, m: Pick<Meeting, 'id' | 'started_at' | 'created_at' | 'ended_at'>) {
  const end = Math.max(0, Math.round(((Date.parse(m.ended_at || '') || Date.now()) - startOf(m)) / 1000));
  await env.DB.prepare('UPDATE hub_meeting_private SET to_t = ? WHERE meeting_id = ? AND to_t IS NULL').bind(end, m.id).run().catch(() => undefined);
  await env.DB.prepare('UPDATE hub_meetings SET private_on = 0 WHERE id = ?').bind(m.id).run().catch(() => undefined);
}

// ---------------------------------------------------------------- Favor Brain's index

/** Takes Drive files out of Favor Brain's index: the file is marked excluded, and its passages, search entries and vectors go. */
export async function forgetFiles(env: PEnv, fileIds: string[]): Promise<number> {
  const ids = fileIds.filter(Boolean);
  if (!ids.length || !env.DRIVE_DB) return 0;
  const db = env.DRIVE_DB;
  const list = JSON.stringify(ids);
  const chunks = (await db.prepare('SELECT rowid AS rid, id, text FROM drive_chunks WHERE file_id IN (SELECT value FROM json_each(?))').bind(list).all<{ rid: number; id: string; text: string }>()).results || [];
  // The search table holds a copy of each passage (external content), so each one is taken out of it before the passage goes.
  for (let i = 0; i < chunks.length; i += 50) {
    await db.batch(chunks.slice(i, i + 50).map((c) => db.prepare(`INSERT INTO drive_chunks_fts (drive_chunks_fts, rowid, text) VALUES ('delete', ?, ?)`).bind(c.rid, c.text)));
  }
  await db.prepare('DELETE FROM drive_chunks WHERE file_id IN (SELECT value FROM json_each(?))').bind(list).run();
  await db.prepare(`UPDATE drive_files SET state = 'excluded', reason = 'Removed in FavorOS Meetings', chunks = 0 WHERE id IN (SELECT value FROM json_each(?))`).bind(list).run();
  if (env.VECTORIZE && chunks.length) for (let i = 0; i < chunks.length; i += 500) await env.VECTORIZE.deleteByIds(chunks.slice(i, i + 500).map((c) => c.id));
  return chunks.length;
}

// ---------------------------------------------------------------- removing a Drive file, with a record of it

async function takeOut(env: PEnv, m: Meeting, user: User, fileId: string, kind: 'recording' | 'notes', name: string): Promise<string> {
  const when = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' });
  const state = await removeDriveFile(env, fileId, kind, when);
  await env.DB.prepare('INSERT OR REPLACE INTO hub_meeting_removed (file_id, meeting_id, kind, name, state, by_email, at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(fileId, m.id, kind, name, state, user.email.toLowerCase(), nowIso()).run();
  await forgetFiles(env, [fileId]).catch((err) => console.warn('[meet] forget', fileId, err));
  return state;
}

// ---------------------------------------------------------------- delete the recording

export async function deleteRecording(env: PEnv, user: User, m: Meeting, opts: { doc?: (m: Meeting) => Promise<void> } = {}) {
  if (!mayEdit(m, user)) throw new HttpError(403, 'host_only', 'Only a host or an admin can delete the recording.');
  if (m.status === 'live') throw new HttpError(400, 'live', 'End the meeting first.');
  const files = (await env.DB.prepare('SELECT epoch, file_id, file_name, state FROM hub_meeting_drive WHERE meeting_id = ? ORDER BY epoch').bind(m.id).all<{ epoch: number; file_id: string; file_name: string; state: string }>()).results || [];
  const out: string[] = [];
  for (const f of files) if (f.file_id) out.push(await takeOut(env, m, user, f.file_id, 'recording', f.file_name));
  // Pieces that never reached Drive are deleted from storage.
  const chunks = (await env.DB.prepare('SELECT epoch, seq FROM hub_meeting_chunks WHERE meeting_id = ?').bind(m.id).all<{ epoch: number; seq: number }>()).results || [];
  const keys = chunks.map((c) => `meet/${m.id}/${c.epoch}/${String(c.seq).padStart(6, '0')}.webm`);
  for (let i = 0; i < keys.length; i += 500) await env.CLIPS.delete(keys.slice(i, i + 500));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM hub_meeting_drive WHERE meeting_id = ?').bind(m.id),
    env.DB.prepare('DELETE FROM hub_meeting_chunks WHERE meeting_id = ?').bind(m.id),
    env.DB.prepare(`UPDATE hub_meetings SET drive_file_id = '', rec_state = 'removed' WHERE id = ?`).bind(m.id),
  ]);
  await logCut(env, m.id, user, 'recording', 0, null, { files: files.length });
  // The Doc links to the recording, so it is made again without the links.
  const docState = await redoDoc(env, user, await getMeeting(env, m.id), opts.doc);
  return { ok: true, files: files.length, drive: out, doc: docState };
}

async function redoDoc(env: PEnv, user: User, m: Meeting, make?: (m: Meeting) => Promise<void>): Promise<string> {
  if (m.notes_doc_id) {
    await takeOut(env, m, user, m.notes_doc_id, 'notes', `${m.title} notes`);
    await env.DB.prepare(`UPDATE hub_meetings SET notes_doc_id = '' WHERE id = ?`).bind(m.id).run();
  }
  if (!make || !['ready'].includes(String(m.notes_status))) return 'none';
  try { await make({ ...m, notes_doc_id: '' } as Meeting); return 'made'; } catch (err) { console.warn('[meet] doc again', m.id, err); return 'later'; }
}

async function logCut(env: MeetEnv, id: string, user: User, kind: 'cut' | 'recording', from: number, to: number | null, detail: Record<string, unknown>) {
  const n = await env.DB.prepare('SELECT COALESCE(MAX(n), 0) + 1 AS n FROM hub_meeting_cuts WHERE meeting_id = ?').bind(id).first<{ n: number }>();
  await env.DB.prepare('INSERT INTO hub_meeting_cuts (meeting_id, n, kind, from_t, to_t, by_email, at, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, n?.n || 1, kind, from, to, user.email.toLowerCase(), nowIso(), JSON.stringify(detail)).run();
}

// ---------------------------------------------------------------- cut a section

/** The text the Chat posts carry after a cut, in the same shape as when the notes were first posted. */
export function chatBody(title: string, summary: string, actions: Array<{ owner_name?: string; owner?: string; text: string }>): string {
  const lines = [`Notes are ready for ${title || 'the meeting'}.`, '', String(summary || '').slice(0, 700)];
  const a = actions.filter((x) => x && x.text).slice(0, 6);
  if (a.length) lines.push('', 'Action items', ...a.map((x) => `- ${(x.owner_name || x.owner) ? (x.owner_name || x.owner) + ': ' : ''}${x.text}`));
  return lines.join('\n').trim();
}

export async function cutSection(env: PEnv, user: User, m: Meeting, b: Record<string, unknown>, opts: { doc?: (m: Meeting) => Promise<void>; names?: string[] } = {}) {
  if (!mayEdit(m, user)) throw new HttpError(403, 'host_only', 'Only a host or an admin can cut part of the notes.');
  if (m.status !== 'ended') throw new HttpError(400, 'live', 'End the meeting first.');
  if (String(m.notes_status) === 'pending' || String(m.notes_status) === 'redo') throw new HttpError(409, 'busy', 'The notes are still being made. Try again in a minute.');
  const from = Math.max(0, Math.round(Number(b.from)));
  const to = b.to === null || b.to === undefined || b.to === '' ? null : Math.round(Number(b.to));
  if (!Number.isFinite(from) || (to != null && (!Number.isFinite(to) || to <= from))) throw new HttpError(400, 'bad_range', 'The end has to come after the start.');
  const id = m.id;
  const t0 = startOf(m);

  // 1. What was said and typed in the stretch.
  const before = safeJson<Line[]>(m.transcript, []);
  const kept = before.filter((l) => !inRange(Number(l.t) || 0, from, to));
  const live = await env.DB.prepare('SELECT COUNT(*) AS n FROM hub_meeting_lines WHERE meeting_id = ? AND t >= ? AND (? IS NULL OR t < ?)').bind(id, from, to, to).first<{ n: number }>();
  const msFrom = t0 + from * 1000, msTo = to == null ? 8.64e15 : t0 + to * 1000;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM hub_meeting_lines WHERE meeting_id = ? AND t >= ? AND (? IS NULL OR t < ?)').bind(id, from, to, to),
    env.DB.prepare('DELETE FROM hub_meeting_live WHERE meeting_id = ? AND t >= ? AND (? IS NULL OR t < ?)').bind(id, from, to, to),
    env.DB.prepare(`DELETE FROM hub_meeting_events WHERE meeting_id = ? AND kind IN ('brain', 'chat') AND ts >= ? AND ts < ?`).bind(id, msFrom, msTo),
    env.DB.prepare('UPDATE hub_meetings SET transcript = ? WHERE id = ?').bind(JSON.stringify(kept), id),
  ]);

  // 2. Action items said in the stretch, and the tasks made from them. The other items keep their numbers, so their tasks stay linked.
  const acts = (await env.DB.prepare('SELECT idx, t FROM hub_meeting_actions WHERE meeting_id = ?').bind(id).all<{ idx: number; t: number }>()).results || [];
  const gone = acts.filter((a) => inRange(a.t, from, to)).map((a) => a.idx);
  let tasks = 0;
  if (gone.length) {
    const list = JSON.stringify(gone);
    await env.DB.prepare('DELETE FROM hub_meeting_actions WHERE meeting_id = ? AND idx IN (SELECT value FROM json_each(?))').bind(id, list).run();
    const r = await env.DB.prepare(`UPDATE hub_tasks SET status = 'dropped', title = 'Removed from the meeting notes', description = '', updated_at = ? WHERE meeting_id = ? AND meeting_action_idx IN (SELECT value FROM json_each(?))`).bind(nowIso(), id, list).run().catch(() => null);
    tasks = r?.meta?.changes || 0;
  }

  // 3. The summary, decisions and chapters are written again from what is left; the action items left keep their wording.
  const n0 = safeJson<Partial<NotesOut>>(m.notes_json, {});
  const kept2 = {
    decisions: (n0.decisions || []).filter((d) => !inRange(d.t, from, to)),
    actions: (n0.actions || []).filter((a) => !inRange(a.t, from, to)),
    chapters: (n0.chapters || []).filter((c) => !inRange(c.t, from, to)),
  };
  let summary = m.summary;
  let rewritten = false;
  try {
    const fresh = kept.length ? await makeNotes(env, { ...m, transcript: JSON.stringify(dedupeLines(kept)) } as Meeting, opts.names || []) : null;
    if (fresh) {
      summary = fresh.summary || summary;
      kept2.decisions = fresh.decisions.length ? fresh.decisions : kept2.decisions;
      kept2.chapters = fresh.chapters.length ? fresh.chapters : kept2.chapters;
      rewritten = !!fresh.summary;
    } else if (!kept.length) { summary = 'Nothing is left in the transcript.'; rewritten = true; }
  } catch (err) { console.warn('[meet] cut summary', id, err); }
  // A summary that could not be written again is not left saying what was cut.
  if (!rewritten) summary = 'The summary is being written again after part of the meeting was removed.';
  await env.DB.prepare('UPDATE hub_meetings SET summary = ?, notes_json = ? WHERE id = ?').bind(summary, JSON.stringify(kept2), id).run();

  // 4. The Chat posts made from the notes are rewritten.
  const left = (await env.DB.prepare('SELECT text, owner_name, owner_email, due FROM hub_meeting_actions WHERE meeting_id = ? ORDER BY idx').bind(id).all<{ text: string; owner_name: string; owner_email: string; due: string }>()).results || [];
  const body = chatBody(m.title, summary, left);
  const posts = await env.DB.prepare(`UPDATE chat_messages SET body = ?, edited_at = ? WHERE email = ? AND deleted_at IS NULL AND attachments LIKE ? AND body LIKE 'Notes are ready%'`).bind(body, nowIso(), MEETINGS_ID, `%"${id}"%`).run().catch(() => null);
  const body2 = summaryBody({ ...m, summary }, kept2, left);
  const posts2 = await env.DB.prepare(`UPDATE chat_messages SET body = ?, edited_at = ? WHERE email = ? AND deleted_at IS NULL AND attachments LIKE ? AND body LIKE 'Notes from %'`).bind(body2, nowIso(), MEETINGS_ID, `%"${id}"%`).run().catch(() => null);

  // 5. The recording, when asked: a recording cannot be trimmed, so it goes whole.
  let rec: unknown = null;
  if (b.recording === 'delete') {
    const fresh = await getMeeting(env, id);
    if ((await env.DB.prepare('SELECT COUNT(*) AS n FROM hub_meeting_drive WHERE meeting_id = ?').bind(id).first<{ n: number }>())?.n || (await env.DB.prepare('SELECT COUNT(*) AS n FROM hub_meeting_chunks WHERE meeting_id = ?').bind(id).first<{ n: number }>())?.n) {
      rec = await deleteRecording(env, user, fresh, {});
    }
  }

  const detail = { lines: before.length - kept.length || live?.n || 0, actions: gone.length, tasks, posts: (posts?.meta?.changes || 0) + (posts2?.meta?.changes || 0), rewritten };
  await logCut(env, id, user, 'cut', from, to, detail);
  // 6. The Google Doc: the old one is taken out of Drive and Favor Brain, and a new one is made from the notes as they are now.
  const doc = await redoDoc(env, user, await getMeeting(env, id), opts.doc);
  return { ok: true, ...detail, recording: rec ? 'deleted' : 'kept', doc };
}

// ---------------------------------------------------------------- what the notes page shows

const PRAYER = /\b(prayer requests?|let'?s pray|let us pray|pray for|praying for|close (us )?(out )?in prayer|in jesus'? name|amen)\b/i;

/** Where the prayer time looks to start, offered to the host as a one tap cut. Nothing is cut until the host says so. */
export function prayerSuggestion(lines: Line[], endT: number): { from: number; to: number | null; label: string } | null {
  const hits = lines.filter((l) => PRAYER.test(l.text));
  if (!hits.length) return null;
  const from = Math.max(0, hits[0].t - 5);
  const last = hits[hits.length - 1].t;
  // Prayer near the end runs to the end; prayer in the middle runs to a little after the last word of it.
  const to = endT && endT - last < 300 ? null : last + 30;
  return { from, to, label: 'Prayer requests' };
}

export async function privacyOf(env: PEnv, user: User, m: Meeting, lines: Line[]) {
  const edit = mayEdit(m, user);
  const ranges = (await env.DB.prepare('SELECT from_t, to_t FROM hub_meeting_private WHERE meeting_id = ? ORDER BY n').bind(m.id).all<{ from_t: number; to_t: number | null }>().catch(() => ({ results: [] }))).results || [];
  const cuts = (await env.DB.prepare('SELECT kind, from_t, to_t, by_email, at FROM hub_meeting_cuts WHERE meeting_id = ? ORDER BY n').bind(m.id).all<{ kind: string; from_t: number; to_t: number | null; by_email: string; at: string }>().catch(() => ({ results: [] }))).results || [];
  const files = user.role === 'admin'
    ? (await env.DB.prepare(`SELECT file_id, kind, at FROM hub_meeting_removed WHERE meeting_id = ? AND state = 'emptied' ORDER BY at`).bind(m.id).all<{ file_id: string; kind: string; at: string }>().catch(() => ({ results: [] }))).results || []
    : [];
  const endT = m.ended_at ? Math.round((Date.parse(m.ended_at) - startOf(m)) / 1000) : 0;
  const cutAlready = (s: { from: number }) => cuts.some((c) => c.kind === 'cut' && c.from_t <= s.from + 5);
  const sug = edit && m.status === 'ended' ? prayerSuggestion(lines, endT) : null;
  return {
    canEdit: edit && m.status === 'ended',
    paused: ranges.map((r) => ({ from: r.from_t, to: r.to_t })),
    cuts: cuts.map((c) => ({ kind: c.kind, from: c.from_t, to: c.to_t, by: c.by_email, at: c.at })),
    suggestion: sug && !cutAlready(sug) ? sug : null,
    toTrash: files.map((f) => ({ id: f.file_id, kind: f.kind, url: f.kind === 'notes' ? `https://docs.google.com/document/d/${f.file_id}/edit` : `https://drive.google.com/file/d/${f.file_id}/view` })),
  };
}

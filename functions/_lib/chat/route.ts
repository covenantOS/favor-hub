// Favor Chat's HTTP API. One router so tests can call it with a stand-in database and a fake room.
//   GET  boot                          who I am, the people, my conversations, who is online
//   GET  channels/browse               public channels
//   POST channels                      new channel        { name, topic?, private? }
//   POST conversations                 direct message or group   { members: [email] }
//   GET  channels/:id/messages?before= a page of messages
//   POST channels/:id/messages         { body, thread_id?, attachments? }
//   POST channels/:id/read|typing|join|leave|mute|members|meeting
//   GET  channels/:id/huddle           the live huddle in a channel and who is in it, or null
//   PATCH channels/:id                 { topic }
//   GET  threads/:id                   a thread
//   PATCH|DELETE messages/:id          edit, delete (own)
//   POST messages/:id/reactions        { emoji }
//   GET  search?q=&filter=&channel=    messages
//   GET  drive?q=  clips               the two pickers
//   POST upload  GET file/:id          shared files (byte ranges for audio and video)
//   GET  drive-file/:mid/:i/thumb|content   preview of a Drive card in a message this person can read
//   GET  inbox   POST inbox/read       the bell
import { HttpError, errorJson, handleError, json, nowIso, type Env } from '../http';
import type { HubUser } from '../session';
import { createMeeting, endMeeting } from '../meetroute';
import type { MeetEnv } from '../meet';
import * as store from './db';
import { chatMode, chatUser } from './gate';
import { directory, onlyKnown } from './users';
import { hydrateAttachments } from './hydrate';
import { presence, publish, type LiveEnv } from './live';
import { askInThread } from './brain';
import { huddlesOf, type HuddleState } from './huddle';
import { unfurl } from './unfurl';
import { driveCardFor, driveContent, driveIdOf, driveThumb, sharedDriveFile } from './preview';
import { parseRange } from '../clips';
import { taskDeleted, taskReply } from './tasks';
import { BRAIN_ID, EMOJI_OK, SYSTEM_VOICES, classifyUrl, cleanBody, channelSlug, parseMentions, plainLine, urlsIn } from './text';

export type ChatRouteEnv = LiveEnv & { UPLOADS: R2Bucket; BRAIN_HUB_KEY?: string; BRAIN_URL?: string; GOOGLE_SA_JSON?: string };
export interface Ctx {
  request: Request;
  env: ChatRouteEnv;
  user: HubUser | null;
  path: string[];
  waitUntil: (p: Promise<unknown>) => void;
}

const MAX_FILE = 25 * 1024 * 1024;
const HOSTS = (url: URL) => [url.hostname.toLowerCase(), 'dash.favorintl.org', 'hub.favorintl.org', 'favor-hub-d4n.pages.dev'];
const BRAIN_URL = 'https://mcp.favorintl.org';
const num = (s: string | undefined): number => {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'bad_id', 'That message id is not valid.');
  return n;
};
const body = async (request: Request): Promise<Record<string, unknown>> => {
  const b = await request.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
};

export async function handle(ctx: Ctx): Promise<Response> {
  try {
    return await route(ctx);
  } catch (err) {
    return handleError(err);
  }
}

async function route(ctx: Ctx): Promise<Response> {
  const { request, env, path } = ctx;
  const method = request.method.toUpperCase();
  const user = await chatUser(env, ctx.user);
  const me = user.email.toLowerCase();
  const url = new URL(request.url);
  const [a, b, c] = path;

  if (a === 'boot' && method === 'GET') return json(await boot(env, user));

  if (a === 'channels') {
    if (!b && method === 'POST') {
      const input = await body(request);
      const ch = await store.createChannel(env, me, input);
      return json({ ok: true, channel: ch });
    }
    if (b === 'browse' && method === 'GET') return json({ ok: true, channels: await store.browseChannels(env) });
    if (b && !c && method === 'PATCH') {
      const topic = await store.setTopic(env, me, b, (await body(request)).topic);
      const ch = await store.getChannel(env, b);
      if (ch) ctx.waitUntil(publish(env, await store.membersOf(env, b), { type: 'channel', channel: { id: b, topic } }));
      return json({ ok: true, topic });
    }
    if (b && c === 'messages' && method === 'GET') {
      await store.readableChannel(env, b, me);
      const before = Number(url.searchParams.get('before')) || null;
      return json({ ok: true, ...(await store.history(env, b, before, (x) => hydrateAttachments(env, x), me)) });
    }
    if (b && c === 'messages' && method === 'POST') return json({ ok: true, message: await send(ctx, user, b) });
    if (b && c === 'read' && method === 'POST') {
      await store.markRead(env, me, b, Number((await body(request)).upTo) || 0);
      return json({ ok: true });
    }
    if (b && c === 'typing' && method === 'POST') {
      await store.postableChannel(env, b, me);
      ctx.waitUntil(publish(env, (await store.membersOf(env, b)).filter((m) => m !== me), { type: 'typing', channel_id: b, user_id: me }));
      return json({ ok: true });
    }
    if (b && c === 'join' && method === 'POST') {
      const ch = await store.joinChannel(env, me, b);
      ctx.waitUntil(publish(env, await store.membersOf(env, b), { type: 'channel', channel: { id: b, members: ch.members } }));
      return json({ ok: true, channel: ch });
    }
    if (b && c === 'leave' && method === 'POST') {
      await store.leaveChannel(env, me, b);
      ctx.waitUntil(publish(env, [me, ...(await store.membersOf(env, b))], { type: 'channel', channel: { id: b, members: await store.membersOf(env, b) } }));
      return json({ ok: true });
    }
    if (b && c === 'mute' && method === 'POST') {
      await store.setMuted(env, me, b, (await body(request)).muted === true);
      return json({ ok: true });
    }
    if (b && c === 'members' && method === 'POST') {
      const dir = await directory(env, await chatMode(env), user);
      const ch = await store.addMembers(env, me, b, onlyKnown(((await body(request)).emails as string[]) || [], dir));
      ctx.waitUntil(publish(env, ch.members, { type: 'channel', channel: { ...ch, unread: 0, mentions: 0 } }));
      return json({ ok: true, channel: ch });
    }
    if (b && c === 'meeting' && method === 'POST') return json({ ok: true, ...(await startMeeting(ctx, user, b)) });
    if (b && c === 'huddle' && method === 'GET') {
      await store.readableChannel(env, b, me);
      return json({ ok: true, huddle: await liveHuddle(env, b) });
    }
  }

  if (a === 'conversations' && method === 'POST') {
    const dir = await directory(env, await chatMode(env), user);
    const others = onlyKnown(((await body(request)).members as string[]) || [], dir).filter((e) => e !== me);
    const ch = await store.openConversation(env, me, others.length ? others : [me]);
    ctx.waitUntil(publish(env, ch.members.filter((m) => m !== me), { type: 'channel', channel: { ...ch, unread: 0, mentions: 0, last_read: 0 } }));
    return json({ ok: true, channel: ch });
  }

  if (a === 'threads' && b && method === 'GET') {
    const root = num(b);
    const rootRow = await store.getMessage(env, root);
    if (!rootRow || !store.canSee(rootRow, me)) throw new HttpError(404, 'not_found', 'That thread is gone.');
    await store.readableChannel(env, rootRow.channel_id, me);
    const t = await store.thread(env, root, (x) => hydrateAttachments(env, x), me);
    if (!t) throw new HttpError(404, 'not_found', 'That thread is gone.');
    await store.markThreadRead(env, me, root);
    return json({ ok: true, ...t });
  }

  if (a === 'messages' && b) {
    const id = num(b);
    if (!c && method === 'PATCH') {
      const row = await store.edit(env, me, id, (await body(request)).body);
      return json({ ok: true, message: await broadcast(ctx, row, 'edit') });
    }
    if (!c && method === 'DELETE') {
      const row = await store.remove(env, me, id);
      ctx.waitUntil(taskDeleted(env, id)); // q3-tasks hook: the matching request comment goes too.
      ctx.waitUntil(publish(env, store.audienceOf(row, await store.membersOf(env, row.channel_id)), { type: 'delete', id, channel_id: row.channel_id }));
      return json({ ok: true });
    }
    if (c === 'share' && method === 'POST') {
      const { posted, removed } = await store.shareAnswer(env, me, id);
      const msg = await broadcast(ctx, posted.message, 'message');
      ctx.waitUntil(publish(env, [me], { type: 'delete', id, channel_id: removed.channel_id, purge: true }));
      return json({ ok: true, message: msg, removed: id });
    }
    if (c === 'dismiss' && method === 'POST') {
      const removed = await store.dismissAnswer(env, me, id);
      ctx.waitUntil(publish(env, [me], { type: 'delete', id, channel_id: removed.channel_id, purge: true }));
      return json({ ok: true, removed: id });
    }
    if (c === 'reactions' && method === 'POST') {
      const emoji = String((await body(request)).emoji || '');
      if (!EMOJI_OK.test(emoji)) throw new HttpError(400, 'emoji', 'Pick an emoji.');
      const reactions = await store.toggleReaction(env, me, id, emoji);
      const row = await store.getMessage(env, id);
      if (row) ctx.waitUntil(publish(env, store.audienceOf(row, await store.membersOf(env, row.channel_id)), { type: 'reaction', id, reactions }));
      return json({ ok: true, reactions });
    }
  }

  if (a === 'search' && method === 'GET') {
    const filter = (['all', 'here', 'files', 'mine'] as const).find((f) => f === url.searchParams.get('filter')) || 'all';
    const rows = await store.search(env, me, url.searchParams.get('q') || '', { filter, channel: url.searchParams.get('channel') || undefined });
    const channels = new Map<string, string>();
    for (const r of rows) if (!channels.has(r.channel_id)) channels.set(r.channel_id, ((await store.getChannel(env, r.channel_id))?.name) || '');
    const results = (await store.shape(env, rows)).map((m) => ({ ...m, channel_name: channels.get(m.channel_id) || '' }));
    return json({ ok: true, results });
  }

  if (a === 'drive' && method === 'GET') return json({ ok: true, files: await driveSearch(env, user, url.searchParams.get('q') || '') });

  if (a === 'clips' && method === 'GET') {
    const r = await env.DB.prepare(`SELECT id, title, summary, duration_ms, created_at FROM hub_clips WHERE owner_email = ? AND status IN ('ready', 'processing') ORDER BY created_at DESC LIMIT 30`).bind(me).all<{ id: string; title: string; summary: string; duration_ms: number; created_at: string }>();
    const hyd = await hydrateAttachments(env, (r.results || []).map((x) => ({ type: 'clip', id: x.id })));
    return json({ ok: true, clips: hyd });
  }

  if (a === 'upload' && method === 'POST') return json({ ok: true, ...(await upload(ctx, user)) });
  if (a === 'file' && b && method === 'GET') return serveFile(env, b, request);
  if (a === 'drive-file' && b && c && method === 'GET') {
    const f = await sharedDriveFile(env, me, num(b), Number(c) || 0);
    return path[3] === 'thumb' ? driveThumb(env, f.id, Number(url.searchParams.get('s')) || 800) : driveContent(env, f.id);
  }

  if (a === 'inbox' && !b && method === 'GET') return json({ ok: true, ...(await store.inbox(env, me)) });
  if (a === 'inbox' && b === 'read' && method === 'POST') {
    const id = Number((await body(request)).message_id) || null;
    await store.clearInbox(env, me, id);
    return json({ ok: true, count: await store.unreadMentionCount(env, me) });
  }

  return errorJson('not_found', 'No such chat route.', 404);
}

/* ------------------------------------------------------------------ boot */

async function boot(env: ChatRouteEnv, user: HubUser) {
  const me = user.email.toLowerCase();
  await store.joinDefaults(env, me);
  const mode = await chatMode(env);
  const [users, channels, here] = await Promise.all([directory(env, mode, user), store.listChannels(env, me), presence(env)]);
  const people = Object.fromEntries(Object.entries(users).map(([id, u]) => [id, { ...u, presence: here[id] || 'off' }]));
  return { ok: true, me: people[me] || { id: me, name: user.name, picture: user.picture, title: '', presence: 'online' }, users: people, channels, mode, live: !!env.CHAT_ROOM };
}

/* ------------------------------------------------------------------ messages */

async function broadcast(ctx: Ctx, row: store.MessageRow, type: 'message' | 'edit'): Promise<store.MessageOut> {
  const [msg] = await store.shape(ctx.env, [row], (x) => hydrateAttachments(ctx.env, x));
  const members = store.audienceOf(row, await store.membersOf(ctx.env, row.channel_id));
  ctx.waitUntil(publish(ctx.env, members, { type, message: msg }));
  return msg;
}

type Att = store.Attachment;

/** What a client may attach: references the server fills in, never a URL or a title the client invented. */
async function cleanAttachments(env: ChatRouteEnv, raw: unknown, me: string): Promise<Att[]> {
  const out: Att[] = [];
  for (const a of (Array.isArray(raw) ? raw : []).slice(0, 6)) {
    if (!a || typeof a !== 'object') continue;
    const x = a as Record<string, unknown>;
    if (x.type === 'clip' && /^[0-9a-f]{32}$/.test(String(x.id))) out.push({ type: 'clip', id: String(x.id) });
    else if (x.type === 'meeting' && /^[0-9a-f]{24}$/.test(String(x.id))) out.push({ type: 'meeting', id: String(x.id) });
    else if (x.type === 'drive' && /^https:\/\/(drive|docs)\.google\.com\//.test(String(x.url || ''))) {
      out.push({ type: 'drive', name: String(x.name || 'File').slice(0, 200), kind: ['doc', 'sheet', 'pdf', 'slides', 'photo', 'file'].includes(String(x.kind)) ? String(x.kind) : 'file', path: String(x.path || '').slice(0, 240), indexed: String(x.indexed || '').slice(0, 40), url: String(x.url) });
    } else if (x.type === 'file' && typeof x.id === 'string') {
      const f = await env.DB.prepare('SELECT id, name, mime, size FROM chat_files WHERE id = ? AND email = ?').bind(x.id, me).first<{ id: string; name: string; mime: string; size: number }>();
      // A picture keeps its width and height so the message reserves its space before the picture arrives.
      const w = Number(x.w), h = Number(x.h);
      const dims = f && /^image\//.test(f.mime) && Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w <= 20000 && h <= 20000 ? { w, h } : {};
      if (f) out.push({ type: 'file', id: f.id, name: f.name, mime: f.mime, size: f.size, url: `/api/chat/file/${f.id}`, ...dims });
    }
  }
  return out;
}

async function send(ctx: Ctx, user: HubUser, channelId: string): Promise<store.MessageOut> {
  const { env, request } = ctx;
  const me = user.email.toLowerCase();
  const input = await body(request);
  const text = cleanBody(input.body);
  const attachments = await cleanAttachments(env, input.attachments, me);
  // Pasted hub clip and meeting links become cards; the other first link is unfurled after the post.
  const hosts = HOSTS(new URL(request.url));
  const urls = urlsIn(text);
  for (const u of urls) {
    const ref = classifyUrl(u, hosts);
    if (ref && !attachments.some((x) => x.type === ref.type && x.id === ref.id)) attachments.push(ref);
  }
  // A pasted Google Docs, Sheets, Slides or Drive address becomes a Drive card the page can preview.
  for (const u of urls) {
    if (attachments.length >= 6 || !driveIdOf(u) || attachments.some((x) => x.type === 'drive' && x.url === u)) continue;
    const card = await driveCardFor(env, u);
    if (card) attachments.push(card as Att);
  }
  const threadId = input.thread_id ? Number(input.thread_id) : null;
  const posted = await store.post(env, { channel_id: channelId, email: me, body: text, thread_id: threadId, attachments });
  const msg = await broadcast(ctx, posted.message, 'message');
  // q3-tasks hook: a reply under a request's card is also a comment on the request (chat/tasks.ts).
  if (threadId) ctx.waitUntil(taskReply(env, posted.message, user));
  const fresh = urls.find((u) => !classifyUrl(u, hosts) && !attachments.some((x) => x.type === 'drive' && x.url === u));
  if (fresh && !attachments.some((x) => x.type === 'link')) {
    ctx.waitUntil((async () => {
      const card = await unfurl(fresh, hosts);
      if (!card) return;
      const row = await store.patch(env, posted.message.id, { attachments: [...attachments, card] });
      await broadcast(ctx, row, 'edit');
    })().catch(() => undefined));
  }
  if (parseMentions(text).brain && !SYSTEM_VOICES.has(me)) {
    ctx.waitUntil(askInThread(env, { channel_id: channelId, root_id: threadId || posted.message.id, thread_id: threadId, asker: { email: me, name: user.name }, text }));
  }
  return msg;
}

/**
 * The channel's live huddle, or null. Rooms everyone has left (no heartbeat in 20 seconds, or nobody joined within a minute of
 * Start a huddle) are ended on the way, so their cards flip to Ended for everyone and the notes start.
 */
async function liveHuddle(env: ChatRouteEnv, channelId: string): Promise<HuddleState | null> {
  const all = await huddlesOf(env, channelId);
  for (const h of all) if (!h.live) await endMeeting(env as unknown as MeetEnv, h.id).catch((err) => console.warn('[chat] end empty huddle', err));
  return all.find((h) => h.live) || null;
}

/**
 * Start a huddle, or join the one already going. Pressed from the pre-join sheet, after the person chose their microphone and
 * camera; the page then opens the room and goes straight in. One huddle per channel: if one is live the press joins it and posts
 * nothing. A new huddle posts one card in the channel.
 */
async function startMeeting(ctx: Ctx, user: HubUser, channelId: string): Promise<{ id: string; url: string; joined: boolean; message?: store.MessageOut }> {
  const { env, request } = ctx;
  const me = user.email.toLowerCase();
  const ch = await store.postableChannel(env, channelId, me);
  const open = await liveHuddle(env, ch.id);
  if (open) return { id: open.id, url: `/meet/room/?m=${open.id}`, joined: true };
  const members = await store.membersOf(env, ch.id);
  const dir = await directory(env, await chatMode(env), user);
  const others = members.filter((m) => m !== me).map((m) => (dir[m]?.name || m).split(' ')[0]);
  const title = ch.kind === 'public' || ch.kind === 'private' ? `Huddle in #${ch.name}` : others.length ? `Huddle with ${others.join(', ')}` : 'Huddle';
  const isOpen = ch.kind === 'public';
  const made = (await createMeeting(env as unknown as MeetEnv, { email: me, name: user.name }, {
    title, access: isOpen ? 'staff' : 'invited', rec: 'notes', notify: false,
    invitees: isOpen ? [] : members.filter((m) => m !== me).map((m) => ({ email: m, name: dir[m]?.name || m })),
  }, new URL(request.url).origin)) as { meeting: { id: string } };
  const mid = made.meeting.id;
  const posted = await store.post(env, { channel_id: ch.id, email: me, body: '', attachments: [{ type: 'meeting', id: mid }] });
  await env.DB.prepare('INSERT OR REPLACE INTO chat_meetings (meeting_id, channel_id, message_id, started_by, notes_posted) VALUES (?, ?, ?, ?, 0)').bind(mid, ch.id, posted.message.id, me).run();
  const message = await broadcast(ctx, posted.message, 'message');
  ctx.waitUntil(publish(env, members, { type: 'huddle', channel_id: ch.id, huddle: (await huddlesOf(env, ch.id)).find((h) => h.id === mid) || null }));
  return { id: mid, url: `/meet/room/?m=${mid}`, joined: false, message };
}

/* ------------------------------------------------------------------ Drive, files */

const KIND_OF = (type: string, name: string): string => {
  const t = `${type} ${name}`.toLowerCase();
  if (/sheet|excel|csv|xls/.test(t)) return 'sheet';
  if (/slide|presentation|ppt/.test(t)) return 'slides';
  if (/pdf/.test(t)) return 'pdf';
  if (/image|photo|jpe?g|png|picture/.test(t)) return 'photo';
  if (/doc|word|text/.test(t)) return 'doc';
  return 'file';
};

export async function driveSearch(env: ChatRouteEnv, user: HubUser, q: string, fetcher: typeof fetch = fetch) {
  const query = String(q || '').trim().slice(0, 200);
  if (query.length < 2 || !env.BRAIN_HUB_KEY) return [];
  const res = await fetcher(`${(env.BRAIN_URL || BRAIN_URL).replace(/\/$/, '')}/hub/drive/search`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.BRAIN_HUB_KEY}`, 'X-Acting-Email': user.email, 'X-Acting-Name': encodeURIComponent(user.name || user.email).replace(/%20/g, ' '), 'Content-Type': 'application/json', 'User-Agent': 'favor-hub' },
    body: JSON.stringify({ query }),
  }).catch(() => null);
  const data = res && res.ok ? ((await res.json().catch(() => null)) as { files?: Array<Record<string, string>> } | null) : null;
  return (data?.files || [])
    .filter((f) => f && /^https:\/\/(drive|docs)\.google\.com\//.test(f.link || ''))
    .slice(0, 12)
    .map((f) => ({
      name: String(f.name || 'Untitled file').trim(), kind: KIND_OF(f.type || '', f.name || ''), path: [f.folder, f.owner].filter(Boolean).join(' / ') || String(f.type || ''),
      indexed: f.modified ? new Date(f.modified + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '', url: f.link,
    }));
}

const SAFE_INLINE = /^(image\/(png|jpeg|gif|webp)|application\/pdf|audio\/(mpeg|mp4|wav|webm)|video\/(mp4|webm))$/;

async function upload(ctx: Ctx, user: HubUser) {
  const { env, request } = ctx;
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_FILE) throw new HttpError(413, 'too_big', 'Files can be up to 25 MB.');
  let name = 'file';
  try {
    name = decodeURIComponent(request.headers.get('X-File-Name') || 'file');
  } catch {
    name = 'file';
  }
  name = name.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 160) || 'file';
  const mime = (request.headers.get('Content-Type') || 'application/octet-stream').split(';')[0].trim().toLowerCase().slice(0, 100);
  const buf = await request.arrayBuffer();
  if (!buf.byteLength) throw new HttpError(400, 'empty', 'That file is empty.');
  if (buf.byteLength > MAX_FILE) throw new HttpError(413, 'too_big', 'Files can be up to 25 MB.');
  const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
  const key = `chat/${id}`;
  await env.UPLOADS.put(key, buf, { httpMetadata: { contentType: mime } });
  await env.DB.prepare('INSERT INTO chat_files (id, r2_key, name, mime, size, email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, key, name, mime, buf.byteLength, user.email.toLowerCase(), nowIso()).run();
  return { id, name, mime, size: buf.byteLength, url: `/api/chat/file/${id}` };
}

async function serveFile(env: ChatRouteEnv, id: string, request?: Request): Promise<Response> {
  if (!/^[0-9a-f]{24}$/.test(id)) return errorJson('not_found', 'That file is gone.', 404);
  const f = await env.DB.prepare('SELECT r2_key, name, mime FROM chat_files WHERE id = ?').bind(id).first<{ r2_key: string; name: string; mime: string }>();
  if (!f) return errorJson('not_found', 'That file is gone.', 404);
  const inline = SAFE_INLINE.test(f.mime);
  const base: Record<string, string> = {
    'Content-Type': inline ? f.mime : 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
  };
  // Audio and video ask for byte ranges; Safari will not play a file served without them.
  const want = request ? request.headers.get('Range') : null;
  if (want) {
    const head = await env.UPLOADS.head(f.r2_key);
    if (!head) return errorJson('not_found', 'That file is gone.', 404);
    const range = parseRange(want, head.size);
    if (range === 'bad') return new Response('Range not satisfiable', { status: 416, headers: { ...base, 'Content-Range': `bytes */${head.size}` } });
    if (range) {
      const part = await env.UPLOADS.get(f.r2_key, { range: { offset: range.start, length: range.end - range.start + 1 } });
      if (!part) return errorJson('not_found', 'That file is gone.', 404);
      return new Response(part.body, { status: 206, headers: { ...base, 'Content-Range': `bytes ${range.start}-${range.end}/${head.size}`, 'Content-Length': String(range.end - range.start + 1) } });
    }
  }
  const obj = await env.UPLOADS.get(f.r2_key);
  if (!obj) return errorJson('not_found', 'That file is gone.', 404);
  return new Response(obj.body, { headers: { ...base, 'Content-Length': String(obj.size) } });
}

export { BRAIN_ID, channelSlug, plainLine };
export type { Env };

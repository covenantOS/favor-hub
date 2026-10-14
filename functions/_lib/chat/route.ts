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
//   GET  threads                       every thread I am in, with unread replies counted
//   GET  activity                      where I was named, replies to me, reactions on my messages
//   POST channels/:id/unread           { from }  mark unread from a message on
//   GET  channels/:id/pins             pinned messages and bookmarks
//   POST messages/:id/pin              { on }
//   POST channels/:id/bookmarks  DELETE channels/:id/bookmarks/:bid
//   POST messages/:id/confirm          { bi, action }  a confirm card in a Favor Brain answer
//   POST channels/:id/request          { title, body?, surface?, from_message?, thread_id? }  a request board card made from Chat
import { HttpError, errorJson, handleError, json, nowIso, type Env } from '../http';
import type { HubUser } from '../session';
import { createMeeting, endMeeting } from '../meetroute';
import type { MeetEnv } from '../meet';
import * as store from './db';
import { chatMode, chatUser } from './gate';
import { fieldBrainOn, fieldChatGuard } from '../field';
import { pushForPost, type PushEnv } from '../push';
import { directory, onlyKnown } from './users';
import { hydrateAttachments } from './hydrate';
import { presence, publish, type LiveEnv } from './live';
import { askInThread } from './brain';
import { huddlesOf, type HuddleState } from './huddle';
import { unfurl } from './unfurl';
import { driveCardFor, driveContent, driveIdOf, driveThumb, sharedDriveFile } from './preview';
import { parseRange } from '../clips';
import { postMadeCard, taskDeleted, taskReply } from './tasks';
import * as more from './more';
import { chatEmailOn, setChatEmail } from './mail';
import { smartRoute } from './smart-route';
import { brainContext, getLang, startVoice, transcribe } from './smart';
import { LANGS } from './translate';
import { DRAWABLE } from './brain';
import { insertRequest } from '../db';
import { notifyNewRequest } from '../notify';
import { asSurface } from '../http';
import { resolveEntity, type EntityOut } from '../hub/entity';
import { accessOf, type Access } from '../hub/today';
import { slashTask, taskDeleted as ptaskDeleted, taskReply as ptaskReply } from '../projects/links/chat'; // projects hook
import * as plus from './plus'; // 2026-10-14: reminders, scheduled sends, checklists, polls, /meet, status
import { BRAIN_ID, EMOJI_OK, SYSTEM_VOICES, classifyUrl, cleanBody, channelSlug, parseMentions, plainLine, urlsIn } from './text';

export type ChatRouteEnv = LiveEnv & PushEnv & { UPLOADS: R2Bucket; BRAIN_HUB_KEY?: string; BRAIN_URL?: string; GOOGLE_SA_JSON?: string };
export interface Ctx {
  request: Request;
  env: ChatRouteEnv;
  user: HubUser | null;
  path: string[];
  waitUntil: (p: Promise<unknown>) => void;
  /** Tests pass a stand-in for calls that leave the hub (the Brain). */
  fetcher?: typeof fetch;
  /** Tests pass a stand-in for Workers AI. */
  ai?: { run(model: string, input: unknown): Promise<unknown> };
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
  await fieldChatGuard(env, user, method, path);

  // Any Chat or dock load posts scheduled messages that are due, so they land on time between the drain Worker's 5 minute passes.
  if ((a === 'boot' || a === 'dock') && method === 'GET') ctx.waitUntil(plus.anyDue(env).then((d) => (d ? plus.runScheduled(env, new Date(), ctx.fetcher || fetch) : null)).catch(() => undefined));
  if (a === 'boot' && method === 'GET') return json(await boot(env, user));
  // The floating dock on every other page: the conversations with their unread numbers and the names, no joining and no presence.
  if (a === 'dock' && method === 'GET') return json(await dockState(env, user));
  // 2026-10-14 additions (chat/plus.ts).
  if (a === 'scheduled' && !b && method === 'GET') return json({ ok: true, items: await plus.listScheduled(env, user) });
  if (a === 'scheduled' && b && c === 'cancel' && method === 'POST') return json(await plus.cancelScheduled(env, user, b));
  if (a === 'channels' && b && c === 'schedule' && method === 'POST') return json({ ok: true, message: await plus.scheduleFromBox(env, user, b, await body(request), url.origin) });
  if (a === 'messages' && b && c === 'vote' && method === 'POST') return json({ ok: true, message: await plus.vote(env, user, num(b), await body(request)) });
  if (a === 'messages' && b && c === 'check' && method === 'POST') return json({ ok: true, message: await plus.checkItem(env, user, num(b), await body(request)) });
  if (a === 'messages' && b && c === 'check-add' && method === 'POST') return json({ ok: true, message: await plus.addItem(env, user, num(b), await body(request)) });
  if (a === 'status' && method === 'GET') return json({ ok: true, status: await plus.statusMap(env) });
  // Translation, Catch me up, reminders, partner and fund chips: chat/smart-route.ts.
  const smart = await smartRoute(ctx, user, method, url);
  if (smart) return smart;

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
    if (b && c === 'messages' && method === 'POST') return json({ ok: true, message: await sendOnce(ctx, user, b) });
    if (b && c === 'read' && method === 'POST') {
      await store.markRead(env, me, b, Number((await body(request)).upTo) || 0);
      return json({ ok: true });
    }
    if (b && c === 'typing' && method === 'POST') {
      await store.postableChannel(env, b, me);
      const tid = Number((await body(request)).thread_id) || null;
      ctx.waitUntil(publish(env, (await store.membersOf(env, b)).filter((m) => m !== me), { type: 'typing', channel_id: b, user_id: me, ...(tid ? { thread_id: tid } : {}) }));
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
    if (b && c === 'unread' && method === 'POST') {
      const from = num(String((await body(request)).from || ''));
      const row = await store.getMessage(env, from);
      if (!row || row.channel_id !== b || !store.canSee(row, me)) throw new HttpError(404, 'not_found', 'That message is gone.');
      // A reply marks its thread's first message: the channel reads as unread from there.
      return json({ ok: true, ...(await store.markUnread(env, me, b, row.thread_id || row.id)) });
    }
    if (b && c === 'pins' && method === 'GET') return json({ ok: true, ready: await more.pinsReady(env), ...(await more.pinsOf(env, me, b, (x) => hydrateAttachments(env, x))) });
    if (b && c === 'bookmarks' && !path[3] && method === 'POST') {
      const bookmarks = await more.addBookmark(env, me, b, await body(request));
      ctx.waitUntil(publish(env, await store.membersOf(env, b), { type: 'bar', channel_id: b, bookmarks }));
      return json({ ok: true, bookmarks });
    }
    if (b && c === 'bookmarks' && path[3] && method === 'DELETE') {
      const bookmarks = await more.removeBookmark(env, me, b, path[3]);
      ctx.waitUntil(publish(env, await store.membersOf(env, b), { type: 'bar', channel_id: b, bookmarks }));
      return json({ ok: true, bookmarks });
    }
    if (b && c === 'request' && method === 'POST') return json({ ok: true, ...(await makeRequest(ctx, user, b)) });
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
    // What was new to this person goes back with the thread (the page draws its New line there), then it is all read.
    const unread = (await store.threadUnread(env, me, [root])).get(root) || 0;
    await store.markThreadRead(env, me, root);
    return json({ ok: true, ...t, unread, threads_unread: await more.threadUnreadTotal(env, me) });
  }
  if (a === 'threads' && !b && method === 'GET') return json({ ok: true, ...(await more.threadsFor(env, me, (x) => hydrateAttachments(env, x))) });
  if (a === 'activity' && !b && method === 'GET') {
    const dir = await directory(env, await chatMode(env), user);
    const items = await more.activityFor(env, me);
    return json({ ok: true, items: items.map((i) => ({ ...i, by_name: dir[i.by]?.name || (i.by === BRAIN_ID ? 'Favor Brain' : i.by.split('@')[0]) })) });
  }

  if (a === 'messages' && b) {
    const id = num(b);
    if (!c && method === 'PATCH') {
      const text = (await body(request)).body;
      const before = await store.getMessage(env, id);
      const row = await store.edit(env, me, id, text);
      // A reply that was also sent to the channel reads the same in both places.
      const twin = before ? more.twinOf(before) : null;
      if (twin) {
        const other = await store.edit(env, me, twin, text).catch(() => null);
        if (other) await broadcast(ctx, other, 'edit');
      }
      return json({ ok: true, message: await broadcast(ctx, row, 'edit') });
    }
    if (!c && method === 'DELETE') {
      const before = await store.getMessage(env, id);
      const row = await store.remove(env, me, id);
      ctx.waitUntil(taskDeleted(env, id)); // q3-tasks hook: the matching request comment goes too.
      ctx.waitUntil(ptaskDeleted(env, id)); // projects hook: the matching task comment goes too.
      const members = await store.membersOf(env, row.channel_id);
      ctx.waitUntil(publish(env, store.audienceOf(row, members), { type: 'delete', id, channel_id: row.channel_id }));
      const twin = before ? more.twinOf(before) : null;
      if (twin) {
        const other = await store.remove(env, me, twin).catch(() => null);
        if (other) ctx.waitUntil(publish(env, members, { type: 'delete', id: twin, channel_id: row.channel_id }));
      }
      return json({ ok: true, also: twin });
    }
    if (c === 'pin' && method === 'POST') {
      const on = (await body(request)).on !== false;
      const r = await more.setPin(env, me, id, on);
      ctx.waitUntil(publish(env, await store.membersOf(env, r.channel_id), { type: 'pin', id, channel_id: r.channel_id, on, pins: r.pins, by: me }));
      return json({ ok: true, ...r, on });
    }
    if (c === 'confirm' && method === 'POST') return json({ ok: true, ...(await confirm(ctx, user, id)) });
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
    const rows = await store.search(env, me, url.searchParams.get('q') || '', { filter, channel: url.searchParams.get('channel') || undefined, from: url.searchParams.get('from') || undefined, membersOnly: user.role === 'field' });
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

  if (a === 'email-pref' && !b && method === 'GET') return json({ ok: true, on: await chatEmailOn(env, me) });
  if (a === 'email-pref' && !b && method === 'POST') return json({ ok: true, on: await setChatEmail(env, me, Boolean((await body(request)).on)) });

  return errorJson('not_found', 'No such chat route.', 404);
}

/* ------------------------------------------------------------------ boot */

async function dockState(env: ChatRouteEnv, user: HubUser) {
  const me = user.email.toLowerCase();
  const mode = await chatMode(env);
  const [users, channels, threads] = await Promise.all([directory(env, mode, user), store.listChannels(env, me), more.threadUnreadTotal(env, me)]);
  return { ok: true, me, lang: await getLang(env, me), langs: LANGS, users, channels: channels.map((c) => ({ id: c.id, kind: c.kind, name: c.name, members: c.members, last_at: c.last_at, muted: c.muted, unread: c.unread, mentions: c.mentions })), threads_unread: threads };
}

async function boot(env: ChatRouteEnv, user: HubUser) {
  const me = user.email.toLowerCase();
  // Field staff are not put in the team channels; an admin or a member adds them to the conversations they need.
  if (user.role !== 'field') await store.joinDefaults(env, me);
  const mode = await chatMode(env);
  const [users, channels, here] = await Promise.all([directory(env, mode, user), store.listChannels(env, me), presence(env)]);
  const people = Object.fromEntries(Object.entries(users).map(([id, u]) => [id, { ...u, presence: here[id] || 'off' }]));
  const [bars, threads] = await Promise.all([more.barsFor(env, channels.map((c) => c.id)), more.threadUnreadTotal(env, me)]);
  const withBars = channels.map((c) => ({ ...c, pins: bars.pins.get(c.id) || 0, bookmarks: bars.bookmarks.get(c.id) || [] }));
  return {
    ok: true, me: { ...(people[me] || { id: me, name: user.name, picture: user.picture, title: '', presence: 'online' }), admin: user.role === 'admin' }, users: people, channels: withBars, mode, live: !!env.CHAT_ROOM,
    threads_unread: threads, features: { pins: bars.ready, plus: await plus.plusReady(env) }, lang: await getLang(env, me), langs: LANGS, status: await plus.statusMap(env),
  };
}

/* ------------------------------------------------------------------ messages */

async function broadcast(ctx: Ctx, row: store.MessageRow, type: 'message' | 'edit'): Promise<store.MessageOut> {
  const [msg] = await store.shape(ctx.env, [row], (x) => hydrateAttachments(ctx.env, x));
  const members = store.audienceOf(row, await store.membersOf(ctx.env, row.channel_id));
  ctx.waitUntil(publish(ctx.env, members, { type, message: msg }));
  return msg;
}

type Att = store.Attachment;

/** When the access answer fails, the card still resolves what needs no special access (a colleague, a clip). Partners and tasks stay closed. */
const FALLBACK_ACCESS = { admin: false, chat: true, workCenter: false, projects: false } as unknown as Access;

/** What a client may attach: references the server fills in, never a URL or a title the client invented. */
async function cleanAttachments(env: ChatRouteEnv, raw: unknown, me: string, ent?: (kind: string, id: string) => Promise<EntityOut | null>): Promise<Att[]> {
  const out: Att[] = [];
  for (const a of (Array.isArray(raw) ? raw : []).slice(0, 6)) {
    if (!a || typeof a !== 'object') continue;
    const x = a as Record<string, unknown>;
    // A FavorOS entity or page sent from a hover card or Send to (public/js/favor-share.js). The server resolves it as the sender and keeps
    // only the name, one line and the address; the facts behind it load for each reader through their own access.
    if (x.type === 'entity' && ent && typeof x.kind === 'string' && typeof x.id === 'string') {
      const e = await ent(x.kind, x.id).catch(() => null);
      // A clip and a meeting keep their own richer cards.
      if (e && e.kind === 'clip') out.push({ type: 'clip', id: e.id });
      else if (e && e.kind === 'meeting') out.push({ type: 'meeting', id: e.id });
      else if (e && !e.restricted) out.push({ type: 'entity', kind: e.kind, id: e.id, title: e.title.slice(0, 160), sub: e.sub.slice(0, 160), url: e.url });
    } else if (x.type === 'page' && /^\/(?![/\\])[^\s]{0,300}$/.test(String(x.url || '')) && String(x.title || '').trim()) {
      out.push({ type: 'entity', kind: 'page', id: String(x.url), title: String(x.title).trim().slice(0, 160), sub: '', url: String(x.url) });
    } else if (x.type === 'clip' && /^[0-9a-f]{32}$/.test(String(x.id))) out.push({ type: 'clip', id: String(x.id) });
    else if (x.type === 'meeting' && /^[0-9a-f]{24}$/.test(String(x.id))) out.push({ type: 'meeting', id: String(x.id) });
    else if (x.type === 'drive' && /^https:\/\/(drive|docs)\.google\.com\//.test(String(x.url || ''))) {
      out.push({ type: 'drive', name: String(x.name || 'File').slice(0, 200), kind: ['doc', 'sheet', 'pdf', 'slides', 'photo', 'file'].includes(String(x.kind)) ? String(x.kind) : 'file', path: String(x.path || '').slice(0, 240), indexed: String(x.indexed || '').slice(0, 40), url: String(x.url) });
    } else if (x.type === 'file' && typeof x.id === 'string') {
      const f = await env.DB.prepare('SELECT id, name, mime, size FROM chat_files WHERE id = ? AND email = ?').bind(x.id, me).first<{ id: string; name: string; mime: string; size: number }>();
      // A picture keeps its width and height so the message reserves its space before the picture arrives.
      const w = Number(x.w), h = Number(x.h);
      const dims = f && /^image\//.test(f.mime) && Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w <= 20000 && h <= 20000 ? { w, h } : {};
      // A voice note is an audio file the recorder marked; the server transcribes it after the message posts.
      const voice = f && /^audio\//.test(f.mime) && x.voice === true ? { voice: true, secs: Math.min(600, Math.max(0, Math.round(Number(x.secs) || 0))) } : {};
      if (f) out.push({ type: 'file', id: f.id, name: f.name, mime: f.mime, size: f.size, url: `/api/chat/file/${f.id}`, ...dims, ...voice });
    }
  }
  return out;
}

/**
 * A send with a client id (the header X-Client-Id) is safe to repeat: the phone's offline queue resends after a dropped connection,
 * and a second try gets the stored message back instead of posting twice.
 */
async function sendOnce(ctx: Ctx, user: HubUser, channelId: string): Promise<store.MessageOut> {
  const cid = (ctx.request.headers.get('X-Client-Id') || '').trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(cid)) return send(ctx, user, channelId);
  const me = user.email.toLowerCase();
  const stored = async (): Promise<store.MessageOut | null> => {
    const row = await ctx.env.DB.prepare('SELECT result FROM phone_sends WHERE email = ? AND client_id = ?').bind(me, cid).first<{ result: string }>().catch(() => null);
    try {
      return row && row.result ? (JSON.parse(row.result) as store.MessageOut) : null;
    } catch {
      return null;
    }
  };
  const done = await stored();
  if (done) return done;
  // Claim the id before sending, so two requests that carry the same id at the same moment post one message: the second waits for the first's answer.
  const claim = await ctx.env.DB.prepare(`INSERT OR IGNORE INTO phone_sends (email, client_id, result, created_at) VALUES (?, ?, '', ?)`).bind(me, cid, nowIso()).run().catch(() => null);
  if (claim && claim.meta && claim.meta.changes === 0) {
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const again = await stored();
      if (again) return again;
    }
    // The first request died without an answer: release the claim and send.
    await ctx.env.DB.prepare(`DELETE FROM phone_sends WHERE email = ? AND client_id = ? AND result = ''`).bind(me, cid).run().catch(() => undefined);
  }
  try {
    const msg = await send(ctx, user, channelId);
    await ctx.env.DB.prepare('INSERT OR REPLACE INTO phone_sends (email, client_id, result, created_at) VALUES (?, ?, ?, ?)').bind(me, cid, JSON.stringify(msg), nowIso()).run().catch(() => undefined);
    return msg;
  } catch (err) {
    await ctx.env.DB.prepare(`DELETE FROM phone_sends WHERE email = ? AND client_id = ? AND result = ''`).bind(me, cid).run().catch(() => undefined);
    throw err;
  }
}

async function send(ctx: Ctx, user: HubUser, channelId: string): Promise<store.MessageOut> {
  const { env, request } = ctx;
  const me = user.email.toLowerCase();
  const input = await body(request);
  const text = cleanBody(input.body);
  const access = (input.attachments as unknown[] | undefined)?.some((a) => (a as { type?: string } | null)?.type === 'entity') ? await accessOf(env, request, user).catch(() => FALLBACK_ACCESS) : null;
  const attachments = await cleanAttachments(env, input.attachments, me, access ? (kind, id) => resolveEntity(env, request, user, access, kind, id) : undefined);
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
  let threadId = input.thread_id ? Number(input.thread_id) : null;
  // A reply under the channel copy of a thread reply belongs to the thread the copy came from.
  if (threadId) {
    const under = await store.getMessage(env, threadId);
    if (under && under.channel_id === channelId) threadId = more.threadRootOf(under);
  }
  // /remind, /schedule, /todo, /poll, /meet, /status, /away, /back, /scheduled (chat/plus.ts).
  const plused = user.role === 'field' ? null : await plus.plusSlash({ env, user, channelId, text, threadId, origin: new URL(request.url).origin });
  if (plused) return plused;
  // projects hook: /task makes a task and posts its card instead of the typed text.
  const slashed = user.role === 'field' ? null : await slashTask(env, user, channelId, text, threadId);
  if (slashed) return slashed;
  const asksBrain = parseMentions(text).brain && !SYSTEM_VOICES.has(me) && (user.role !== 'field' || (await fieldBrainOn(env)));
  // A follow-up pressed inside a private Brain answer stays private: the question is the asker's alone, like the answer.
  const hidden = input.private === true && asksBrain && (await store.brainIsPrivate(env, channelId, me));
  const posted = await store.post(env, { channel_id: channelId, email: me, body: text, thread_id: threadId, attachments, visible_to: hidden ? me : null });
  let msg = await broadcast(ctx, posted.message, 'message');
  // A direct message to someone out of office: the writer sees a private note saying so.
  if (!hidden) ctx.waitUntil(plus.awayNote(env, posted.message, posted.channel, posted.members).then((n) => (n ? publish(env, [me], { type: 'message', message: n }) : undefined)));
  // A direct message or a mention reaches a locked phone (web push). Muted conversations were left out of notify already.
  ctx.waitUntil(pushForPost(env, { notify: posted.notify, channel: posted.channel, senderName: user.name || me, text: text, messageId: posted.message.id, threadId, urgent: user.role === 'admin' && parseMentions(text).here }, ctx.fetcher || fetch).catch((err) => console.warn('[chat] push', err)));
  // "Also send to the channel": the reply shows in the channel too, with a line naming the thread it answers.
  if (threadId && input.also === true && !hidden) {
    const dir = await directory(env, await chatMode(env), user);
    const both = await more.alsoSend(env, posted.message, (id) => dir[id]?.name || id.split('@')[0]);
    if (both) {
      await broadcast(ctx, both.copy.message, 'message');
      [msg] = await store.shape(env, [both.reply], (x) => hydrateAttachments(env, x));
    }
  }
  // q3-tasks hook: a reply under a request's card is also a comment on the request (chat/tasks.ts).
  if (threadId) ctx.waitUntil(taskReply(env, posted.message, user));
  // projects hook: a reply under a task's card is also a comment on the task (projects/links/chat.ts).
  if (threadId) ctx.waitUntil(ptaskReply(env, posted.message, user));
  const fresh = urls.find((u) => !classifyUrl(u, hosts) && !attachments.some((x) => x.type === 'drive' && x.url === u));
  if (fresh && !attachments.some((x) => x.type === 'link')) {
    ctx.waitUntil((async () => {
      const card = await unfurl(fresh, hosts);
      if (!card) return;
      const row = await store.patch(env, posted.message.id, { attachments: [...attachments, card] });
      await broadcast(ctx, row, 'edit');
    })().catch(() => undefined));
  }
  // A voice note is transcribed after the message posts; the card fills in for everyone when the words are ready.
  const voices = attachments.filter((x) => x.type === 'file' && x.voice === true) as Array<Att & { id: string; secs?: number }>;
  if (voices.length && !hidden) {
    for (const v of voices) await startVoice(env, String(v.id), posted.message.id, Number(v.secs) || 0).catch(() => undefined);
    ctx.waitUntil((async () => {
      for (const v of voices) await transcribe(env, String(v.id), (ctx.ai || env.AI) as any);
      const row = await store.getMessage(env, posted.message.id);
      if (row && !row.deleted_at) await broadcast(ctx, row, 'edit');
    })().catch(() => undefined));
  }
  if (asksBrain) {
    const intent = typeof input.intent === 'string' && /^[a-z_]{2,40}$/.test(input.intent) ? input.intent : undefined;
    // The Brain reads the thread it was asked in (or the last messages above a question that points at "this"), so "summarize this" works.
    const context = await brainContext(env, user, channelId, threadId, posted.message.id, text).catch(() => '');
    ctx.waitUntil(askInThread(env, { channel_id: channelId, root_id: threadId || posted.message.id, thread_id: threadId, asker: { email: me, name: user.name, role: user.role }, text, intent, context }, ctx.fetcher || fetch));
  }
  return msg;
}

/**
 * A confirm card pressed inside a Favor Brain answer. The press goes to the Brain as the signed-in person, so the Brain's own
 * rules decide whether it runs; the card in the message is then replaced with what the Brain sent back, for everyone who
 * can read the message.
 */
async function confirm(ctx: Ctx, user: HubUser, id: number): Promise<{ blocks: unknown[]; message: store.MessageOut }> {
  const { env, request } = ctx;
  const me = user.email.toLowerCase();
  const input = await body(request);
  const bi = Number(input.bi);
  const action = String(input.action || '');
  if (!Number.isInteger(bi) || bi < 0 || !/^[a-z_]{2,30}$/.test(action)) throw new HttpError(400, 'bad_action', 'That button is no longer there.');
  const { brain, block } = await more.confirmCard(env, me, id, bi);
  if (!env.BRAIN_HUB_KEY) throw new HttpError(503, 'not_set_up', 'The Brain is not connected to FavorOS yet.');
  const res = await (ctx.fetcher || fetch)(`${(env.BRAIN_URL || BRAIN_URL).replace(/\/$/, '')}/hub/confirm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.BRAIN_HUB_KEY}`, 'X-Acting-Email': user.email, 'X-Acting-Name': encodeURIComponent(user.name || user.email).replace(/%20/g, ' '), 'Content-Type': 'application/json', 'User-Agent': 'favor-hub' },
    body: JSON.stringify({ id: block.id, action }),
    signal: AbortSignal.timeout(60000),
  }).catch(() => null);
  const d = res ? ((await res.json().catch(() => null)) as { ok?: boolean; message?: string; blocks?: unknown[] } | null) : null;
  if (!res || !res.ok || !d || d.ok === false) throw new HttpError(res && res.status >= 400 && res.status < 500 ? res.status : 502, 'confirm', (d && d.message) || 'The Brain did not answer. Try again.');
  const blocks = (Array.isArray(d.blocks) ? d.blocks : []).filter((x: any) => x && DRAWABLE.has(String(x.type)));
  const next = (brain.blocks || []).slice();
  next.splice(bi, 1, ...(blocks as Array<Record<string, unknown>>));
  const row = await store.patch(env, id, { brain: { ...brain, blocks: next } });
  return { blocks, message: await broadcast(ctx, row, 'edit') };
}

/**
 * A request board card made from Chat. The request goes on the board as any other (the board's own notice for a new request
 * follows), and its card is posted in this conversation by the person who made it.
 */
async function makeRequest(ctx: Ctx, user: HubUser, channelId: string): Promise<{ request: { id: string; title: string; url: string }; message: store.MessageOut }> {
  const { env, request } = ctx;
  const me = user.email.toLowerCase();
  const input = await body(request);
  await store.postableChannel(env, channelId, me);
  let title = String(input.title || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  let text = String(input.body || '').trim().slice(0, 8000);
  const fromId = Number(input.from_message) || 0;
  let threadId: number | null = null;
  let note = text;
  if (fromId) {
    const src = await store.getMessage(env, fromId);
    if (!src || src.deleted_at || src.channel_id !== channelId || !store.canSee(src, me)) throw new HttpError(404, 'not_found', 'That message is gone.');
    const dir = await directory(env, await chatMode(env), user);
    const said = plainLine(src.body, (id) => dir[id]?.name || id.split('@')[0], 4000);
    const who = src.email === BRAIN_ID ? 'Favor Brain' : dir[src.email]?.name || src.email.split('@')[0];
    const link = `${new URL(request.url).origin}/chat/?c=${encodeURIComponent(channelId)}${src.thread_id ? '&t=' + src.thread_id : ''}&m=${src.id}`;
    if (!title) title = said.slice(0, 90) || 'Request from Chat';
    text = [text, said ? `${who} wrote in Chat:\n${said}` : '', link].filter(Boolean).join('\n\n');
    note = said ? `${who}: ${said}`.slice(0, 600) : '';
  } else if (input.thread_id) threadId = Number(input.thread_id) || null;
  if (!title) throw new HttpError(400, 'missing_title', 'Give the request a one-line summary.');
  const row = await insertRequest(env, { title, body: text || title, surface: asSurface(input.surface || 'website'), submitter_name: user.name || me, submitter_email: me, source: 'chat' });
  ctx.waitUntil(notifyNewRequest(env, row).catch((err) => console.error('[chat] request notify', err)));
  const posted = await postMadeCard(env, { from: me, channelId, threadId, requestId: row.id, note });
  return { request: { id: row.id, title: row.title, url: `/requests/?r=${encodeURIComponent(row.id)}` }, message: await broadcast(ctx, posted.message, 'message') };
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
  // 2026-10-14: every huddle is invited-only (the channel's members), public channels included, so its notes never open to all staff.
  const made = (await createMeeting(env as unknown as MeetEnv, { email: me, name: user.name }, {
    title, access: 'invited', rec: 'video', notify: false,
    invitees: members.filter((m) => m !== me && !SYSTEM_VOICES.has(m)).map((m) => ({ email: m, name: dir[m]?.name || m })),
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

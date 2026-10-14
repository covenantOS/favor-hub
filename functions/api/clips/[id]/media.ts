// Streams a clip with Range support so the player can seek. Signed-in staff stream it when its sharing level lets them in
// (functions/_lib/clips.ts, mayWatch); anyone else only when the level is Everybody and the request carries ?k=, the token the page
// was given (two hours, signed). Never cached by a shared cache.
//   ?poster=1  the poster frame     ?dl=1  the file as a download
// The video comes in the fast-start layout as soon as the clip has one (functions/_lib/clipmuxjob.ts): one index at the
// front, so a player starts on its first request. A clip that is not there yet gets a run of that job on the way past.
import { PRIVATE, ID_RE, isWatchable, canWatch, publicTokenOk, parseRange, posterKey, extFor, type Clip, type ClipsEnv } from '../../../_lib/clips';
//
// One viewer needs care: someone already playing a clip in the layout it was recorded in when the clip changes to the new
// one. Their player is partway through the old file and asks for more of it by byte position (and comes back to byte 0
// once it has read every fragment header), and the same positions in the new file hold different bytes. So a browser
// that is given the old layout is marked with a cookie for that one clip, and while the mark lasts it keeps getting the
// old file. The mark runs out ten minutes after that browser last asked for the clip; its next play gets the new layout.
// This only happens to clips recorded before the job existed, or when reading a recording took longer than /complete waits.
import { muxPending, muxRun, servedVideo, storedVideo, type Served } from '../../../_lib/clipmuxjob';
import { hubUserOf } from '../../../_lib/session';

async function load(env: ClipsEnv, id: string): Promise<Clip | null> {
  if (!ID_RE.test(id)) return null;
  return env.DB.prepare("SELECT * FROM hub_clips WHERE id = ? AND status IN ('ready', 'processing')").bind(id).first<Clip>();
}

const deny = async (env: ClipsEnv, request: Request, clip: Clip | null): Promise<Response | null> => {
  // A clip that does not exist and a clip the viewer may not see look the same to a signed-out viewer.
  if (!clip || !isWatchable(clip) || !(await canWatch(env, request, clip))) {
    return new Response(hubUserOf(request) ? 'Not found' : 'Sign in required', { status: hubUserOf(request) ? 404 : 401, headers: PRIVATE });
  }
  // Outside the hub (signed out, or a field account), a public clip streams only with the short-lived token its page was given.
  const user = hubUserOf(request);
  if (!user || user.role === 'field') {
    const q = new URL(request.url).searchParams;
    if (!(await publicTokenOk(env, clip.id, q.get('k'), q.get('poster') === '1'))) return new Response('Link expired. Open the clip page again.', { status: 401, headers: PRIVATE });
  }
  return null;
};

const MARK = 'clipsrc';
const marked = (request: Request) => /(?:^|;\s*)clipsrc=o(?:;|$)/.test(request.headers.get('Cookie') || '');
const markCookie = (id: string) => `${MARK}=o; Path=/api/clips/${id}/; Max-Age=600; Secure; HttpOnly; SameSite=Lax`;

const fileName = (c: Clip) => `${(c.title || 'Clip').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'Clip'}.${extFor(c.mime)}`;

async function posterOf(env: ClipsEnv, id: string): Promise<Served | null> {
  const head = await env.CLIPS.head(posterKey(id));
  if (!head) return null;
  return { size: head.size, etag: head.httpEtag, read: async (start, length) => (await env.CLIPS.get(posterKey(id), { range: { offset: start, length } }))?.body ?? null };
}

export const onRequestGet: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params, waitUntil }) => {
  const clip = await load(env, String(params.id));
  const refused = await deny(env, request, clip);
  if (refused || !clip) return refused as Response;
  const q = new URL(request.url).searchParams;
  const isPoster = q.get('poster') === '1';
  const rangeHeader = request.headers.get('Range');
  const changed = clip.mux === 'plan' || clip.mux === 'done';
  let mark = '';
  let file: Served | null = null;
  if (isPoster) file = await posterOf(env, clip.id);
  else {
    // A browser that began on the stored recording carries on with it (see the top of this file).
    if (changed && marked(request)) {
      file = await storedVideo(env, clip.id);
      if (file) mark = markCookie(clip.id);
    }
    if (!file) file = await servedVideo(env, clip);
    if (clip.mux === '' && /mp4|quicktime/.test(clip.mime)) mark = markCookie(clip.id);
  }
  if (!file) return new Response('Not found', { status: 404, headers: PRIVATE });
  if (!isPoster && waitUntil && muxPending(clip)) waitUntil(muxRun(env, clip.id, 20_000).then(() => undefined).catch(() => undefined));
  const type = isPoster ? 'image/jpeg' : clip.mime;
  const download = !isPoster && q.get('dl') === '1';
  const disposition = download ? `attachment; filename="${fileName(clip)}"; filename*=UTF-8''${encodeURIComponent(fileName(clip))}` : 'inline';
  const base: Record<string, string> = { ...PRIVATE, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Disposition': disposition, ETag: file.etag };
  if (mark) base['Set-Cookie'] = mark;
  const range = parseRange(rangeHeader, file.size);
  if (range === 'bad') return new Response('Range not satisfiable', { status: 416, headers: { ...PRIVATE, 'Content-Range': `bytes */${file.size}` } });
  if (!range) {
    const body = await file.read(0, file.size);
    if (!body) return new Response('Not found', { status: 404, headers: PRIVATE });
    return new Response(body, { status: 200, headers: { ...base, 'Content-Length': String(file.size) } });
  }
  const body = await file.read(range.start, range.end - range.start + 1);
  if (!body) return new Response('Not found', { status: 404, headers: PRIVATE });
  return new Response(body, {
    status: 206,
    headers: { ...base, 'Content-Range': `bytes ${range.start}-${range.end}/${file.size}`, 'Content-Length': String(range.end - range.start + 1) },
  });
};

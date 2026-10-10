// Streams a clip with Range support so the player can seek. Signed-in hub users may watch any clip that has been
// saved; signed-out viewers only when the clip's share switch is on. Never cached by a shared cache.
//   ?poster=1  the poster frame     ?dl=1  the file as a download
import { PRIVATE, ID_RE, isWatchable, mayWatch, parseRange, posterKey, videoKey, extFor, type Clip, type ClipsEnv } from '../../../_lib/clips';
import { hubUserOf } from '../../../_lib/session';

async function load(env: ClipsEnv, id: string): Promise<Clip | null> {
  if (!ID_RE.test(id)) return null;
  return env.DB.prepare("SELECT * FROM hub_clips WHERE id = ? AND status IN ('ready', 'processing')").bind(id).first<Clip>();
}

const deny = (request: Request, clip: Clip | null): Response | null => {
  // A clip that does not exist and a clip the viewer may not see look the same to a signed-out viewer.
  if (!clip || !isWatchable(clip) || !mayWatch(request, clip)) {
    return new Response(hubUserOf(request) ? 'Not found' : 'Sign in required', { status: hubUserOf(request) ? 404 : 401, headers: PRIVATE });
  }
  return null;
};

const fileName = (c: Clip) => `${(c.title || 'Clip').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'Clip'}.${extFor(c.mime)}`;

export const onRequestGet: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  const clip = await load(env, String(params.id));
  const refused = deny(request, clip);
  if (refused || !clip) return refused as Response;
  const q = new URL(request.url).searchParams;
  const key = q.get('poster') === '1' ? posterKey(clip.id) : videoKey(clip.id);
  const isPoster = key === posterKey(clip.id);
  const head = await env.CLIPS.head(key);
  if (!head) return new Response('Not found', { status: 404, headers: PRIVATE });
  const type = isPoster ? 'image/jpeg' : clip.mime;
  const download = !isPoster && q.get('dl') === '1';
  const disposition = download ? `attachment; filename="${fileName(clip)}"; filename*=UTF-8''${encodeURIComponent(fileName(clip))}` : 'inline';
  const base = { ...PRIVATE, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Disposition': disposition, ETag: head.httpEtag };
  const range = parseRange(request.headers.get('Range'), head.size);
  if (range === 'bad') return new Response('Range not satisfiable', { status: 416, headers: { ...PRIVATE, 'Content-Range': `bytes */${head.size}` } });
  if (!range) {
    const obj = await env.CLIPS.get(key);
    if (!obj) return new Response('Not found', { status: 404, headers: PRIVATE });
    return new Response(obj.body, { status: 200, headers: { ...base, 'Content-Length': String(head.size) } });
  }
  const obj = await env.CLIPS.get(key, { range: { offset: range.start, length: range.end - range.start + 1 } });
  if (!obj) return new Response('Not found', { status: 404, headers: PRIVATE });
  return new Response(obj.body, {
    status: 206,
    headers: { ...base, 'Content-Range': `bytes ${range.start}-${range.end}/${head.size}`, 'Content-Length': String(range.end - range.start + 1) },
  });
};

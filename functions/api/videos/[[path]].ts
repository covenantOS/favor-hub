// Training videos, captions and poster images, streamed from the hub's R2 bucket (videos/...) to
// signed-in staff. Range requests are honored so the player can seek without downloading a file whole.
import { errorJson, handleError, type Env } from '../../_lib/http';
import { hubUserOf } from '../../_lib/session';

const TYPES: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm', vtt: 'text/vtt; charset=utf-8', jpg: 'image/jpeg', png: 'image/png', json: 'application/json' };

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    if (!hubUserOf(request)) return errorJson('signin', 'Sign in with your Favor Google account first.', 401);
    const name = ([] as string[]).concat((params.path as string[] | string) || []).join('/');
    if (!/^[a-z0-9][a-z0-9._/-]{1,120}$/.test(name) || name.includes('..')) return errorJson('not_found', 'No such video.', 404);
    const key = `videos/${name}`;
    const ext = name.split('.').pop() || '';
    const range = request.headers.get('Range');
    const head = await env.UPLOADS.head(key);
    if (!head) return errorJson('not_found', 'No such video.', 404);
    const size = head.size;
    const headers = new Headers({
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
      ETag: head.httpEtag,
    });
    const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      let end = m[1] && m[2] ? Number(m[2]) : size - 1;
      end = Math.min(end, size - 1);
      if (start > end || start >= size) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      }
      const obj = await env.UPLOADS.get(key, { range: { offset: start, length: end - start + 1 } });
      if (!obj) return errorJson('not_found', 'No such video.', 404);
      headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
      headers.set('Content-Length', String(end - start + 1));
      return new Response(obj.body, { status: 206, headers });
    }
    const obj = await env.UPLOADS.get(key);
    if (!obj) return errorJson('not_found', 'No such video.', 404);
    headers.set('Content-Length', String(size));
    return new Response(obj.body, { status: 200, headers });
  } catch (err) {
    return handleError(err);
  }
};

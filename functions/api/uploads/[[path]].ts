import { type Env } from '../../_lib/http';

export const onRequestGet: PagesFunction<Env, 'path'> = async ({ env, params }) => {
  const raw = params.path;
  const key = Array.isArray(raw) ? raw.join('/') : String(raw || '');
  if (!key || key.includes('..')) return new Response('Not found', { status: 404 });
  const obj = await env.UPLOADS.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  const type = obj.httpMetadata?.contentType || 'application/octet-stream';
  return new Response(obj.body, {
    headers: {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};

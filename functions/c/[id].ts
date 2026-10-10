// The share page for a clip: /c/<id>. Favor branded, with a player, chapters, a searchable transcript, captions, comments
// and reactions. Signed-in hub users watch any saved clip. A signed-out viewer needs the clip's "Anyone with the link"
// switch on, and otherwise goes to sign-in and comes back here. The page itself is a shell; /js/clips/watch.js fills it from
// /api/clips/<id>/info, which decides again what this viewer may see.
import { ID_RE, PRIVATE, isWatchable, mayWatch, type Clip, type ClipsEnv } from '../_lib/clips';
import { hubUserOf } from '../_lib/session';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

function page(status: number, title: string, body: string, scripts = ''): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${esc(title)} - Favor Hub</title>
<link rel="icon" type="image/png" href="/images/favor-icon.png"><link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/fonts/playfair-500.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/js/clips/watch.css?v=1"><link rel="stylesheet" href="/js/clips/launcher.css?v=1">
</head><body>${body}${scripts}</body></html>`;
  return new Response(html, { status, headers: { ...PRIVATE, 'Content-Type': 'text/html; charset=utf-8', 'Referrer-Policy': 'no-referrer' } });
}

const frame = (inner: string, signedIn: boolean) =>
  `<div class="cw"><header class="cw-top"><a href="https://www.favorintl.org"><img src="/images/favor-logo-color.png" alt="Favor International"></a><span class="cw-top__r" id="cw-topr">${signedIn ? '<a class="cw-hub" href="/clips/">My clips</a><a class="cw-hub" href="/">Favor Hub</a>' : ''}</span></header>${inner}<footer class="cw-foot">Favor International</footer></div>`;

export const onRequestGet: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  const id = String(params.id);
  const user = hubUserOf(request);
  const clip = ID_RE.test(id) ? await env.DB.prepare('SELECT id, title, status, share FROM hub_clips WHERE id = ?').bind(id).first<Pick<Clip, 'id' | 'title' | 'status' | 'share'>>() : null;

  if (!clip || !isWatchable(clip) || !mayWatch(request, clip)) {
    // A signed-out viewer cannot tell a missing clip from a private one. They sign in and come back.
    if (!user) {
      const login = new URL('/login/', request.url);
      login.searchParams.set('next', '/c/' + id);
      return new Response(null, { status: 302, headers: { ...PRIVATE, Location: login.toString() } });
    }
    return page(404, 'Clip not found', frame('<div class="cw-sheet cw-msg"><h1>That clip is gone</h1><p class="cw-sub">It was deleted, or the link is wrong. Ask the person who shared it for a new one.</p></div>', true));
  }

  const body = frame(
    `<main class="cw-main" id="cw-main" data-id="${id}">
<div class="cw-loading" id="cw-loading" role="status"><i></i>Loading the clip</div>
</main>`,
    !!user
  );
  return page(200, clip.title || 'Clip', body, `<script type="module" src="/js/clips/watch.js?v=1"></script>`);
};

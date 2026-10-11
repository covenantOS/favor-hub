// The share page for a clip: /c/<id>. Favor branded, with a player, chapters, a searchable transcript, captions, comments
// and reactions. Signed-in hub users watch any saved clip. A signed-out viewer needs the clip's "Anyone with the link"
// switch on, and otherwise goes to sign-in and comes back here. The page itself is a shell; /js/clips/watch.js fills it from
// /api/clips/<id>/info, which decides again what this viewer may see.
import { ID_RE, PRIVATE, isWatchable, canWatch, type Clip, type ClipsEnv } from '../_lib/clips';
import { hubUserOf } from '../_lib/session';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

function page(status: number, title: string, body: string, scripts = '', head = ''): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${esc(title)} - Favor Hub</title>${head}
<link rel="icon" type="image/png" href="/images/favor-icon.png"><link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/fonts/playfair-500.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/js/clips/watch.css?v=1"><link rel="stylesheet" href="/js/clips/launcher.css?v=3">
</head><body>${body}${scripts}</body></html>`;
  return new Response(html, { status, headers: { ...PRIVATE, 'Content-Type': 'text/html; charset=utf-8', 'Referrer-Policy': 'no-referrer' } });
}

// Link previews (Slack, iMessage, WhatsApp, email). A clip shared with "Anyone with the link" previews with its title,
// summary, poster frame and video. Any other clip previews as a plain Favor card, so a forwarded link shows nothing of it.
type Preview = { title: string; desc: string; image: string; video?: string; videoType?: string; url: string };
function ogTags(p: Preview): string {
  const m = (k: string, v: string) => `<meta property="${k}" content="${esc(v)}">`;
  const n = (k: string, v: string) => `<meta name="${k}" content="${esc(v)}">`;
  return [
    m('og:site_name', 'Favor Hub'), m('og:type', p.video ? 'video.other' : 'website'), m('og:title', p.title), m('og:description', p.desc),
    m('og:url', p.url), m('og:image', p.image), m('og:image:alt', p.title),
    ...(p.video ? [m('og:video', p.video), m('og:video:secure_url', p.video), m('og:video:type', p.videoType || 'video/webm')] : []),
    n('twitter:card', 'summary_large_image'), n('twitter:title', p.title), n('twitter:description', p.desc), n('twitter:image', p.image),
    n('description', p.desc),
  ].join('');
}
const mins = (ms: number) => { const s = Math.round((ms || 0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

const frame = (inner: string, signedIn: boolean) =>
  `<div class="cw"><header class="cw-top"><a href="https://www.favorintl.org"><img src="/images/favor-logo-color.png" alt="Favor International"></a><span class="cw-top__r" id="cw-topr">${signedIn ? '<a class="cw-hub" href="/clips/">My clips</a><a class="cw-hub" href="/">Favor Hub</a>' : ''}</span></header>${inner}<footer class="cw-foot">Favor International</footer></div>`;

export const onRequestGet: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  const id = String(params.id);
  const user = hubUserOf(request);
  const clip = ID_RE.test(id) ? await env.DB.prepare('SELECT id, title, summary, status, share, owner_email, owner_name, has_poster, duration_ms, mime FROM hub_clips WHERE id = ?').bind(id).first<Pick<Clip, 'id' | 'title' | 'summary' | 'status' | 'share' | 'owner_email' | 'owner_name' | 'has_poster' | 'duration_ms' | 'mime'>>() : null;

  if (!clip || !isWatchable(clip) || !(await canWatch(env, request, clip))) {
    // A signed-out viewer cannot tell a missing clip from a private one. They sign in and come back.
    if (!user) {
      const login = new URL('/login/', request.url);
      login.searchParams.set('next', '/c/' + id);
      // Link unfurlers read this card; a browser goes straight on to sign-in.
      const origin = new URL(request.url).origin;
      const head = ogTags({ title: 'Favor Hub clip', desc: 'Sign in with your Favor Google account to watch.', image: origin + '/images/favor-logo-color.png', url: origin + '/c/' + id })
        + `<meta http-equiv="refresh" content="0;url=${esc(login.pathname + login.search)}">`;
      return page(200, 'Clip', `<script>location.replace(${JSON.stringify(login.pathname + login.search)})</script>`, '', head);
    }
    return page(404, 'Clip not found', frame('<div class="cw-sheet cw-msg"><h1>That clip is gone</h1><p class="cw-sub">It was deleted, or the link is wrong. Ask the person who shared it for a new one.</p></div>', true));
  }

  const body = frame(
    `<main class="cw-main" id="cw-main" data-id="${id}">
<div class="cw-loading" id="cw-loading" role="status"><i></i>Loading the clip</div>
</main>`,
    !!user
  );
  const origin = new URL(request.url).origin;
  const media = `${origin}/api/clips/${id}/media`;
  const open = clip.share === 1;
  const title = open ? clip.title || 'Clip' : 'Favor Hub clip';
  const desc = open
    ? ((clip.summary || '').replace(/\s+/g, ' ').trim().slice(0, 200) || `${mins(clip.duration_ms)} clip${clip.owner_name ? ' from ' + clip.owner_name : ''}`)
    : 'Sign in with your Favor Google account to watch.';
  const head = ogTags({
    title, desc, url: `${origin}/c/${id}`,
    image: open && clip.has_poster === 1 ? `${media}?poster=1` : origin + '/images/favor-logo-color.png',
    ...(open ? { video: media, videoType: clip.mime || 'video/webm' } : {}),
  });
  return page(200, clip.title || 'Clip', body, `<script type="module" src="/js/clips/watch.js?v=1"></script>`, head);
};

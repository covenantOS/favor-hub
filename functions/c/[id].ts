// The share page for a clip: /c/<id>. Favor branded, with a player, speed control and Copy link.
// Signed-in hub users watch any ready clip. A signed-out viewer needs the clip's "Anyone with the link"
// switch on, and otherwise goes to sign-in and comes back here.
import { ID_RE, PRIVATE, mayWatch, type Clip, type ClipsEnv } from '../_lib/clips';
import { hubUserOf } from '../_lib/session';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

function dateEt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' });
}

function page(status: number, title: string, body: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${esc(title)} - Favor Hub</title>
<link rel="icon" type="image/png" href="/images/favor-icon.png"><link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/fonts/playfair-500.woff2" as="font" type="font/woff2" crossorigin>
<style>
@font-face{font-family:Inter;src:url(/fonts/inter-var.woff2) format('woff2');font-weight:100 900;font-display:swap}
@font-face{font-family:'Playfair Display';src:url(/fonts/playfair-500.woff2) format('woff2');font-weight:500;font-display:swap}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;font:15px/1.55 Inter,system-ui,sans-serif;color:#2a2722;background:radial-gradient(1200px 600px at 50% -10%,#fbf3d9 0%,#faf8f4 55%,#f1ede2 100%)}
.cp{max-width:1040px;margin:0 auto;padding:22px 20px 56px}
.cp-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:22px}
.cp-top img{height:34px;display:block}
.cp-top a.hub{font-size:13px;color:#57524a;text-decoration:none;border:1px solid #ddd7cb;border-radius:999px;padding:7px 14px;background:#fffdf9}
.cp-sheet{background:#fffdf9;border:1px solid #e8e4dc;border-radius:22px;box-shadow:0 2px 6px rgba(42,39,34,.05),0 24px 60px -18px rgba(42,39,34,.22);padding:22px}
h1{font:500 clamp(26px,4vw,38px)/1.15 'Playfair Display',Georgia,serif;margin:0 0 6px;letter-spacing:-.01em;overflow-wrap:anywhere}
.cp-meta{color:#8a857c;font-size:13.5px;margin:0 0 16px}
.cp-video{position:relative;background:#14130f;border-radius:14px;overflow:hidden;aspect-ratio:16/9}
.cp-video video{width:100%;height:100%;display:block;background:#14130f}
.cp-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:14px}
.cp-speed{display:inline-flex;gap:4px;padding:4px;border-radius:999px;background:#f1eee7;border:1px solid #e8e4dc}
.cp-speed button{border:0;background:none;font:600 13px Inter,sans-serif;color:#57524a;height:32px;min-width:46px;padding:0 12px;border-radius:999px;cursor:pointer}
.cp-speed button[aria-pressed=true]{background:#fffdf9;color:#2a2722;box-shadow:0 1px 2px rgba(42,39,34,.1),0 4px 10px -6px rgba(42,39,34,.2)}
.cp-btn{height:38px;padding:0 18px;border-radius:999px;border:0;background:#5a7250;color:#fff;font:600 13.5px Inter,sans-serif;cursor:pointer}
.cp-btn:hover{background:#3f5233}
.cp-msg{max-width:520px;margin:12vh auto;text-align:center}
.cp-foot{margin-top:18px;text-align:center;color:#8a857c;font-size:12.5px}
@media(max-width:560px){.cp{padding:14px 12px 40px}.cp-sheet{padding:14px;border-radius:18px}.cp-bar{justify-content:center}}
</style></head><body>${body}</body></html>`;
  return new Response(html, { status, headers: { ...PRIVATE, 'Content-Type': 'text/html; charset=utf-8', 'Referrer-Policy': 'no-referrer' } });
}

const frame = (inner: string) =>
  `<div class="cp"><div class="cp-top"><a href="https://www.favorintl.org"><img src="/images/favor-logo-color.png" alt="Favor International"></a><a class="hub" href="/">Favor Hub</a></div>${inner}<div class="cp-foot">Favor International</div></div>`;

export const onRequestGet: PagesFunction<ClipsEnv, 'id'> = async ({ request, env, params }) => {
  const id = String(params.id);
  const user = hubUserOf(request);
  const clip = ID_RE.test(id) ? await env.DB.prepare("SELECT * FROM hub_clips WHERE id = ? AND status = 'ready'").bind(id).first<Clip>() : null;

  if (!clip || !mayWatch(request, clip)) {
    // A signed-out viewer cannot tell a missing clip from a private one. They sign in and come back.
    if (!user) {
      const login = new URL('/login/', request.url);
      login.searchParams.set('next', '/c/' + id);
      return new Response(null, { status: 302, headers: { ...PRIVATE, Location: login.toString() } });
    }
    return page(404, 'Clip not found', frame('<div class="cp-sheet cp-msg"><h1>That clip is gone</h1><p class="cp-meta">It was deleted, or the link is wrong. Ask the person who shared it for a new one.</p></div>'));
  }

  if (!user || user.email !== clip.owner_email) {
    await env.DB.prepare('UPDATE hub_clips SET views = views + 1 WHERE id = ?').bind(id).run().catch(() => undefined);
  }
  const poster = clip.has_poster ? ` poster="/api/clips/${id}/media?poster=1"` : '';
  const body = frame(`<div class="cp-sheet">
<h1>${esc(clip.title)}</h1>
<p class="cp-meta">${esc(clip.owner_name)} &middot; ${esc(dateEt(clip.created_at))}</p>
<div class="cp-video"><video id="v" controls playsinline preload="metadata"${poster} src="/api/clips/${id}/media"></video></div>
<div class="cp-bar">
<div class="cp-speed" role="group" aria-label="Playback speed"><button type="button" data-r="1" aria-pressed="true">1x</button><button type="button" data-r="1.5" aria-pressed="false">1.5x</button><button type="button" data-r="2" aria-pressed="false">2x</button></div>
<button type="button" class="cp-btn" id="copy">Copy link</button>
</div></div>
<script>
(function(){
  var v=document.getElementById('v');
  var bs=document.querySelectorAll('.cp-speed button');
  bs.forEach(function(b){b.addEventListener('click',function(){v.playbackRate=Number(b.dataset.r);bs.forEach(function(x){x.setAttribute('aria-pressed',String(x===b))});});});
  v.addEventListener('loadedmetadata',function(){ if(v.duration===Infinity){ v.currentTime=1e9; v.addEventListener('timeupdate',function f(){v.removeEventListener('timeupdate',f);v.currentTime=0;}); } });
  var c=document.getElementById('copy');
  c.addEventListener('click',function(){
    var url=location.origin+location.pathname;
    var done=function(){c.textContent='Copied';setTimeout(function(){c.textContent='Copy link'},1800)};
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(url).then(done,function(){prompt('Copy this link',url)});}else{prompt('Copy this link',url)}
  });
})();
</script>`);
  return page(200, clip.title, body);
};

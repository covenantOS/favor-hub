// Holds the app's JavaScript back until the page's stylesheets have arrived.
//
// The page is server-drawn: its HTML already holds the content, so the first paint waits only for the stylesheets. The head of the
// streamed page asked for the 200 KB of scripts at the same moment as the 110 KB of styles, and on a slow link they shared the
// bandwidth, so the styles (and the first paint) came in about twice as late as they need to. This rewrites the first chunk of the
// stream: the modulepreload links and the entry script tag are replaced by a few lines that add both once every stylesheet in the head
// has loaded (or after 15 seconds, so a stylesheet that never arrives cannot keep the page dead). On a repeat visit the styles come
// from the cache, the check passes at once and nothing changes. Hydration lands at the same time as before: the scripts start when
// the styles end instead of racing them. Measured on the phone field profile: first paint 9.8 s to 5.5 s, hydrated 14.4 s to 13.9 s.

const ENTRY = /<script type="module" async="" src="(\/_w\/[^"]+\.js)"><\/script>/;
const PRELOAD = /<link rel="modulepreload" href="([^"]+)"\/>/g;
const LIMIT = 200_000;

const LOADER = (entry: string, preloads: string[]) =>
  '<script>(function(u,p){var d=0,t;function go(){if(d)return;d=1;clearInterval(t);p.forEach(function(h){var l=document.createElement("link");l.rel="modulepreload";l.href=h;document.head.appendChild(l)});' +
  'var s=document.createElement("script");s.type="module";s.src=u;document.head.appendChild(s)}' +
  'function ready(){var l=document.querySelectorAll("link[rel=stylesheet]");for(var i=0;i<l.length;i++)if(!l[i].sheet)return 0;return 1}' +
  't=setInterval(function(){if(ready())go()},25);setTimeout(go,15000);if(ready())go()})(' +
  JSON.stringify(entry) +
  ',' +
  JSON.stringify(preloads) +
  ')</script>';

/** The rewrite of the buffered start of the page, or null when the entry script is not in it. */
export function rewriteHead(html: string): string | null {
  const m = ENTRY.exec(html);
  if (!m) return null;
  const preloads: string[] = [];
  const stripped = html.replace(PRELOAD, (_all, href: string) => {
    preloads.push(href);
    return '';
  });
  const at = ENTRY.exec(stripped);
  if (!at) return null;
  return stripped.slice(0, at.index) + LOADER(m[1], preloads) + stripped.slice(at.index + at[0].length);
}

/** Wraps a streamed page. Only the part up to the entry script is held; everything after it passes through untouched. */
export function deferEntry(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let held = '';
  let done = false;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        if (done) {
          ctrl.enqueue(chunk);
          return;
        }
        held += dec.decode(chunk, { stream: true });
        const out = rewriteHead(held);
        if (out !== null || held.length > LIMIT) {
          ctrl.enqueue(enc.encode(out ?? held));
          held = '';
          done = true;
        }
      },
      flush(ctrl) {
        if (!done && held) ctrl.enqueue(enc.encode(held));
      },
    })
  );
}

// The classic helpers native Chat draws with, loaded once: the Brain answer renderer (brain-blocks.js, chat-brain.js), the file and
// picture viewer (chat-view.js), the emoji picker (chat-emoji.js), the request and project task cards, the huddle pre-join sheet and
// Make a task (projects/links.js). The script list and versions are read from the classic page itself, so they never drift.
import page from '../../../../src/pages/chat/index.astro?raw';
import { SPRITE } from '../../../../src/pages/brain/_icons';
import { loadScript, loadStyle } from '@/lib/legacy';

const SKIP = /\/js\/chat\/(chat-ui|chat|chat-smart)\.js/;

function fromPage(re: RegExp): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const r = new RegExp(re.source, 'g');
  while ((m = r.exec(page))) out.push(m[1]);
  return out;
}

let ready: Promise<void> | null = null;
/** Load the helpers. Chat draws at once without them; a card or answer that needs one redraws when it arrives. */
export function chatAssets(): Promise<void> {
  if (ready) return ready;
  if (!document.getElementById('bci-brain')) {
    const d = document.createElement('div');
    d.innerHTML = SPRITE;
    if (d.firstElementChild) document.body.appendChild(d.firstElementChild);
  }
  fromPage(/<link rel="stylesheet" href="([^"]+)"/).forEach(loadStyle);
  const scripts = Array.from(new Set(fromPage(/<script is:inline src="([^"]+)"/))).filter((s) => !SKIP.test(s));
  // app=1 tells public/js/hub-own.js these belong to the app: leaving a classic page in the frame must not remove their listeners.
  ready = Promise.all(scripts.map((s) => loadScript(s + (s.indexOf('?') >= 0 ? '&' : '?') + 'app=1').catch((e) => console.warn('[chat]', (e as Error).message)))).then(() => undefined);
  return ready;
}

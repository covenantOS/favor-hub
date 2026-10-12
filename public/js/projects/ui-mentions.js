/* The one place the projects UI touches the request board's composer, mention picker and people picker (public/js/request-tasks.js,
   with Chat's composer from public/js/chat/chat-ui.js). Round 2 of that work (branch tasks2) turns mentions into solid tokens in a
   shared file. When it lands, change the three functions below to call it; nothing else in the projects UI knows where mentions come from. */
import { esc } from './ui-util.js';

const CHAT_JS = '/js/chat/chat-ui.js?v=15';
const REQ_JS = '/js/request-tasks.js?v=1';
const loadScript = (src) => new Promise((resolve) => {
  const base = src.split('?')[0];
  if ([...document.scripts].some((s) => (s.getAttribute('src') || '').split('?')[0] === base)) { resolve(); return; }
  const s = document.createElement('script');
  s.src = src;
  s.onload = () => resolve();
  s.onerror = () => resolve();
  document.head.appendChild(s);
});

let readyP = null;
/** Resolves once the composer and the people picker are on the page (the shell may already load them). */
export function ready() {
  if (!readyP) {
    readyP = (async () => {
      if (!window.FavorChat) await loadScript(CHAT_JS);
      if (!window.ReqTasks) await loadScript(REQ_JS);
      if (window.ReqTasks) await window.ReqTasks.people();
      return !!window.ReqTasks;
    })();
  }
  return readyP;
}
const RT = () => window.ReqTasks;

/* ------------ the three calls to swap when tasks2 lands */
export const composerHtml = (placeholder) => RT().composerHtml(placeholder);
export const bindComposer = (root, onSend) => RT().bindComposer(root, onSend);
export const pickPerson = (opts) => RT().pick(opts);

/** Text of a comment with <@email> tokens drawn as @Name. */
export function fmt(body, me) {
  let t = esc(body || '');
  t = t.replace(/&lt;@([^&\s]+?)&gt;/g, (_, id) => `<span class="ch-at${id === me ? ' ch-at--me' : ''}">@${esc(RT().person(id).name)}</span>`);
  t = t.replace(/(https?:\/\/[^\s<]+[^\s<).,;:!?])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\n/g, '<br>');
  return t;
}
export const mentionsIn = (text) => [...new Set([...String(text).matchAll(/<@([^>\s]+)>/g)].map((m) => m[1]))];
export const personName = (email) => (RT() ? RT().person(email).name : String(email || '').split('@')[0]);
export const personAvatar = (email, size) => RT().avatar(email, size);

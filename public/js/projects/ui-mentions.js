/* The one place the projects UI touches the request board's mention composer (public/js/chat/mention-input.js, FavorMention) and
   people picker (public/js/request-tasks.js, ReqTasks). A mention is a solid token; the stored text carries <@email>. */
import { esc } from './ui-util.js';

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
/** Resolves once the composer and the people picker are on the page. */
export function ready() {
  if (!readyP) {
    readyP = (async () => {
      if (!window.FavorMention) await loadScript('/js/chat/mention-input.js?v=1');
      if (!window.ReqTasks) await loadScript('/js/request-tasks.js?v=2');
      if (window.ReqTasks) await window.ReqTasks.people();
      return !!(window.ReqTasks && window.FavorMention);
    })();
  }
  return readyP;
}
const RT = () => window.ReqTasks;
const FM = () => window.FavorMention;

export const composerHtml = () => `<form class="rq-comp" autocomplete="off"><div class="rq-comp__box"><div class="rq-comp__in" data-mi></div><div class="rq-comp__bar"><button type="button" class="rq-comp__at" data-at aria-label="Mention someone">${RT().ic('at')}</button><span class="rq-comp__sp"></span><button type="submit" class="rq-comp__send" disabled aria-label="Send">${RT().ic('send')}<span>Send</span></button></div></div></form>`;

/** Wires the composer drawn by composerHtml. onSend(text) may throw; the text is put back then. */
export function bindComposer(root, onSend) {
  const host = root.querySelector('[data-mi]');
  const send = root.querySelector('.rq-comp__send');
  const form = root.querySelector('.rq-comp');
  if (!host) return null;
  let busy = false;
  const submit = async () => {
    if (busy || box.isEmpty()) return;
    busy = true;
    const text = box.value();
    const names = {};
    box.mentions().forEach((id) => { names[id] = RT().person(id).name; });
    box.clear();
    send.disabled = true;
    try { await onSend(text); } catch (_) { box.setValue(text, names); send.disabled = box.isEmpty(); }
    busy = false;
  };
  const box = FM().attach(host, {
    people: () => RT().list().map((p) => ({ id: p.email, name: p.name, sub: RT().sub(p), picture: p.picture })),
    me: RT().me(),
    placeholder: 'Write a comment, or @ to bring someone in',
    label: 'Comment',
    onInput: (b) => { send.disabled = b.isEmpty(); },
    onSubmit: submit,
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  root.querySelector('[data-at]').addEventListener('click', async () => {
    const r = await RT().pick({ title: 'Mention someone', exclude: [RT().me()] });
    if (r && r.email) { const p = RT().person(r.email); box.focus(); box.insertMention({ id: p.email, name: p.name }); }
  });
  return box;
}
export const pickPerson = (opts) => RT().pick(opts);

/** Text of a comment with <@email> tokens drawn as @Name chips. */
export const fmt = (body, me) => FM().render(body, (id) => RT().person(id).name, me);
export const mentionsIn = (text) => [...new Set([...String(text).matchAll(/<@([^>\s]+)>/g)].map((m) => m[1]))];
export const personName = (email) => (RT() ? RT().person(email).name : String(email || '').split('@')[0]);
export const personAvatar = (email, size) => RT().avatar(email, size);
export { esc };

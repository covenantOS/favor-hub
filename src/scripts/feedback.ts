// The Feedback button on every page. It opens a short form (what kind of note, a few words), sends it
// with the page the person was on, and says where the answer will show. Other parts of the hub open
// the same form with a starting point: the Favor Brain page passes an answer reference so the note is
// tied to the exact question.
import { cue } from './feel';

type Open = { source?: string; rating?: string; ref?: string; question?: string; title?: string };

const RATINGS: Array<[string, string]> = [
  ['problem', "Something's wrong"],
  ['confusing', 'Confusing'],
  ['idea', 'An idea'],
  ['praise', 'Works well'],
];
const BRAIN: Array<[string, string]> = [
  ['wrong', 'The answer was wrong'],
  ['missing', 'Something was missing'],
  ['confusing', 'Confusing'],
  ['right', 'It was right'],
  ['idea', 'An idea'],
];

let dlg: HTMLDialogElement | null = null;
let ctx: Open = {};

const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function render() {
  if (!dlg) return;
  const brain = ctx.source === 'hub-brain';
  const opts = brain ? BRAIN : RATINGS;
  const pick = ctx.rating && opts.some(([k]) => k === ctx.rating) ? ctx.rating : '';
  dlg.innerHTML = `
    <form method="dialog" class="fb-form" novalidate>
      <div class="fb-head">
        <h2 id="fb-title">${esc(ctx.title || (brain ? 'How was this answer?' : 'Send feedback'))}</h2>
        <button type="button" class="tr-x" data-fb-close aria-label="Close">&#x2715;</button>
      </div>
      ${ctx.question ? `<p class="fb-q"><span>Your question</span>${esc(ctx.question)}</p>` : ''}
      <fieldset class="fb-chips"><legend class="h-label">What kind of note?</legend>
        ${opts.map(([k, label]) => `<label><input type="radio" name="rating" value="${k}" ${k === pick ? 'checked' : ''} /><span>${esc(label)}</span></label>`).join('')}
      </fieldset>
      <label class="h-label" for="fb-text">${brain ? 'What was off, or what should it have said?' : 'What happened, or what would help?'}</label>
      <textarea id="fb-text" rows="4" maxlength="2000" placeholder="${brain ? 'For example: it counted 412 partners in Texas, but my list has about 300.' : 'A few words is enough. Say which button or number if it helps.'}"></textarea>
      <p class="fb-where">Sent with the page you're on: <b>${esc(document.title.replace(/ - Favor Hub$/, ''))}</b></p>
      <p class="fb-msg" role="status"></p>
      <div class="fb-acts">
        <a class="tr-link" href="/feedback/">Your notes and answers</a>
        <button type="submit" class="h-btn h-btn--primary">Send</button>
      </div>
    </form>`;
  const form = dlg.querySelector('form')!;
  form.addEventListener('submit', send);
  dlg.querySelector('[data-fb-close]')!.addEventListener('click', () => dlg!.close());
  (dlg.querySelector('input[name=rating]:checked') ? dlg.querySelector<HTMLTextAreaElement>('#fb-text') : dlg.querySelector<HTMLInputElement>('input[name=rating]'))?.focus();
}

async function send(e: Event) {
  e.preventDefault();
  if (!dlg) return;
  const form = e.target as HTMLFormElement;
  const rating = (form.querySelector('input[name=rating]:checked') as HTMLInputElement | null)?.value || '';
  const comment = (form.querySelector('#fb-text') as HTMLTextAreaElement).value.trim();
  const msg = form.querySelector('.fb-msg')!;
  if (!rating && comment.length < 2) {
    msg.textContent = 'Pick what kind of note it is, or write a few words.';
    return;
  }
  const btn = form.querySelector<HTMLButtonElement>('[type=submit]')!;
  btn.disabled = true;
  msg.textContent = 'Sending...';
  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: ctx.source || 'hub', rating, comment, ref: ctx.ref, question: ctx.question, page: location.pathname + location.search }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d.ok === false) throw new Error(d.message || 'It did not send. Try again in a minute.');
    cue('success');
    dlg.innerHTML = `<div class="fb-done">
      <span class="fb-done__mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg></span>
      <h2>Thanks. It's in.</h2>
      <p>Will reads every note. When he answers, the reply shows under <b>Feedback</b> in the menu.</p>
      <div class="fb-acts"><a class="tr-link" href="/feedback/">Your notes and answers</a><button type="button" class="h-btn h-btn--primary h-btn--sm" data-fb-close>Close</button></div>
    </div>`;
    dlg.querySelector('[data-fb-close]')!.addEventListener('click', () => dlg!.close());
    (dlg.querySelector('[data-fb-close]') as HTMLElement).focus();
    document.dispatchEvent(new CustomEvent('favor:feedback-sent', { detail: { ref: ctx.ref, rating } }));
  } catch (err) {
    msg.textContent = (err as Error).message;
    btn.disabled = false;
    cue('error');
  }
}

export function openFeedback(o: Open = {}) {
  ctx = o;
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.className = 'fb';
    dlg.setAttribute('aria-labelledby', 'fb-title');
    document.body.appendChild(dlg);
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg!.close();
    });
  }
  render();
  dlg.showModal();
}

export function initFeedback() {
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-feedback]');
    if (!b) return;
    e.preventDefault();
    openFeedback({ source: b.dataset.feedback || 'hub', rating: b.dataset.rating, ref: b.dataset.ref, question: b.dataset.question, title: b.dataset.title });
  });
  (window as unknown as { favorFeedback: typeof openFeedback }).favorFeedback = openFeedback;
}

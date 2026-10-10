// The Feedback button on every page. It opens a short form (what kind of note, a few words), sends it
// with the page the person was on, and says where the answer will show. Other parts of the hub open
// the same form with a starting point: the Favor Brain page passes an answer reference so the note is
// tied to the exact question.
import html2canvas from 'html2canvas-pro';
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

// The picture of the page. Only the hub's Feedback button attaches one; the Favor Brain answer notes do not.
type Shot = 'off' | 'busy' | 'ready' | 'edit' | 'failed';
const SHOT_MAX_BYTES = 1_500_000;
const BLOCK_PX = 14;
let shot: Shot = 'off';
let shotCanvas: HTMLCanvasElement | null = null;
let shotBlob: Blob | null = null;
let shotUrl = '';
let undoSteps: ImageData[] = [];

const wantsShot = (o: Open) => o.source === 'hub' && !o.ref;

const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function discardShot() {
  if (shotUrl) URL.revokeObjectURL(shotUrl);
  shotUrl = '';
  shotBlob = null;
  shotCanvas = null;
  undoSteps = [];
  shot = 'off';
}

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
      ${wantsShot(ctx) ? '<div class="fb-shot" id="fb-shot"></div>' : ''}
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
  renderShot();
}

// Captures the viewport the person is looking at. The dialog itself is left out.
async function capture() {
  shot = 'busy';
  renderShot();
  try {
    shotCanvas = await html2canvas(document.body, {
      x: window.scrollX,
      y: window.scrollY,
      width: window.innerWidth,
      height: window.innerHeight,
      windowWidth: document.documentElement.clientWidth,
      windowHeight: window.innerHeight,
      scale: 1,
      useCORS: true,
      logging: false,
      ignoreElements: (el) => el.tagName === 'DIALOG',
    });
    await exportShot();
  } catch {
    shot = 'failed';
  }
  renderShot();
}

// Turns the working canvas into the JPEG that gets sent. Lowers the quality until it fits the size limit.
function exportShot(): Promise<void> {
  const canvas = shotCanvas;
  return new Promise((resolve, reject) => {
    if (!canvas) return reject(new Error('no picture'));
    const tryQuality = (q: number) =>
      canvas.toBlob((b) => {
        if (!b) return reject(new Error('no picture'));
        if (b.size > SHOT_MAX_BYTES && q > 0.45) return tryQuality(q - 0.15);
        if (b.size > SHOT_MAX_BYTES) return reject(new Error('too large'));
        if (shotUrl) URL.revokeObjectURL(shotUrl);
        shotBlob = b;
        shotUrl = URL.createObjectURL(b);
        shot = 'ready';
        resolve();
      }, 'image/jpeg', q);
    tryQuality(0.8);
  });
}

function renderShot() {
  const slot = dlg?.querySelector<HTMLElement>('#fb-shot');
  const submit = dlg?.querySelector<HTMLButtonElement>('form [type=submit]');
  if (submit) submit.disabled = shot === 'busy' || shot === 'edit';
  if (!slot) return;
  if (shot === 'busy') {
    slot.innerHTML = '<p class="fb-shot__wait" role="status">Capturing the page...</p>';
    return;
  }
  if (shot === 'failed') {
    slot.innerHTML = '<p class="fb-shot__wait" role="status">The picture of this page did not capture. The note still sends.</p>';
    return;
  }
  if (shot === 'ready') {
    slot.innerHTML = `<img class="fb-shot__img" src="${shotUrl}" alt="Picture of the page you were on" />
      <div class="fb-shot__row">
        <p>Sent with your note. Blur anything private first.</p>
        <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-fb-blur>Blur an area</button>
        <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-fb-remove>Remove</button>
      </div>`;
    slot.querySelector('[data-fb-blur]')!.addEventListener('click', startEdit);
    slot.querySelector('[data-fb-remove]')!.addEventListener('click', () => {
      discardShot();
      renderShot();
    });
    return;
  }
  if (shot === 'edit' && shotCanvas) {
    slot.innerHTML = `<div class="fb-shot__row">
        <p>Drag a box over anything private. It blurs when you let go.</p>
        <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-fb-undo>Undo</button>
        <button type="button" class="h-btn h-btn--primary h-btn--sm" data-fb-done>Done</button>
      </div>
      <div class="fb-shot__edit" role="img" aria-label="Picture of the page. Drag a box over anything to blur it."></div>`;
    const wrap = slot.querySelector<HTMLElement>('.fb-shot__edit')!;
    // Fit the picture to the dialog. The inline size is set here because the capture library sets its own.
    shotCanvas.style.width = '100%';
    shotCanvas.style.height = 'auto';
    wrap.appendChild(shotCanvas);
    bindEditor(wrap, shotCanvas);
    slot.querySelector('[data-fb-undo]')!.addEventListener('click', () => {
      const prev = undoSteps.pop();
      if (prev && shotCanvas) shotCanvas.getContext('2d')!.putImageData(prev, 0, 0);
    });
    slot.querySelector('[data-fb-done]')!.addEventListener('click', async () => {
      try {
        await exportShot();
      } catch {
        shot = 'failed';
      }
      renderShot();
    });
    return;
  }
  slot.innerHTML = '';
}

function startEdit() {
  if (!shotCanvas) return;
  shot = 'edit';
  undoSteps = [];
  renderShot();
}

// Drag a box over an area to blur it. Each box is pixelated on the working canvas, and Undo steps back.
function bindEditor(wrap: HTMLElement, canvas: HTMLCanvasElement) {
  let start: { x: number; y: number } | null = null;
  let box: HTMLElement | null = null;
  const pixelate = (x: number, y: number, w: number, h: number) => {
    const cx = canvas.getContext('2d')!;
    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.ceil(w / BLOCK_PX));
    small.height = Math.max(1, Math.ceil(h / BLOCK_PX));
    small.getContext('2d')!.drawImage(canvas, x, y, w, h, 0, 0, small.width, small.height);
    cx.imageSmoothingEnabled = false;
    cx.drawImage(small, 0, 0, small.width, small.height, x, y, w, h);
  };
  // Box corners in the canvas's own pixels, clamped to the picture.
  const area = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width;
    const sy = canvas.height / r.height;
    const x0 = Math.max(0, Math.min(start!.x, e.clientX) - r.left);
    const x1 = Math.min(r.width, Math.max(start!.x, e.clientX) - r.left);
    const y0 = Math.max(0, Math.min(start!.y, e.clientY) - r.top);
    const y1 = Math.min(r.height, Math.max(start!.y, e.clientY) - r.top);
    return { x: Math.round(x0 * sx), y: Math.round(y0 * sy), w: Math.round((x1 - x0) * sx), h: Math.round((y1 - y0) * sy), cssX0: x0, cssY0: y0, cssW: x1 - x0, cssH: y1 - y0 };
  };
  const place = (a: ReturnType<typeof area>) => {
    if (!box) return;
    const wr = wrap.getBoundingClientRect();
    const r = canvas.getBoundingClientRect();
    box.style.left = `${r.left - wr.left - wrap.clientLeft + wrap.scrollLeft + a.cssX0}px`;
    box.style.top = `${r.top - wr.top - wrap.clientTop + wrap.scrollTop + a.cssY0}px`;
    box.style.width = `${a.cssW}px`;
    box.style.height = `${a.cssH}px`;
  };
  wrap.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    e.preventDefault();
    wrap.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY };
    box = document.createElement('div');
    box.className = 'fb-shot__box';
    wrap.appendChild(box);
    place(area(e));
  });
  wrap.addEventListener('pointermove', (e) => {
    if (start) place(area(e));
  });
  const finish = (e: PointerEvent, keep: boolean) => {
    if (!start) return;
    const a = keep ? area(e) : null;
    start = null;
    box?.remove();
    box = null;
    if (a && a.w > 4 && a.h > 4) {
      undoSteps.push(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height));
      if (undoSteps.length > 10) undoSteps.shift();
      pixelate(a.x, a.y, a.w, a.h);
    }
  };
  wrap.addEventListener('pointerup', (e) => finish(e, true));
  wrap.addEventListener('pointercancel', (e) => finish(e, false));
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
    let picSent = true;
    if (shotBlob && d.id) {
      // The picture goes up after the note, so a failed upload never loses the words.
      picSent = await fetch(`/api/feedback/${d.id}/shot`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'image/jpeg' },
        body: shotBlob,
      })
        .then((r) => r.ok)
        .catch(() => false);
    }
    discardShot();
    cue('success');
    dlg.innerHTML = `<div class="fb-done">
      <span class="fb-done__mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg></span>
      <h2>Thanks. It's in.</h2>
      <p>Will reads every note. When he answers, the reply shows under <b>Feedback</b> in the menu.</p>
      ${picSent ? '' : '<p>The note sent. The picture of the page did not.</p>'}
      <div class="fb-acts"><a class="tr-link" href="/feedback/">Your notes and answers</a><button type="button" class="h-btn h-btn--primary h-btn--sm" data-fb-close>Close</button></div>
    </div>`;
    dlg.querySelector('[data-fb-close]')!.addEventListener('click', () => dlg!.close());
    (dlg.querySelector('[data-fb-close]') as HTMLElement).focus();
    document.dispatchEvent(new CustomEvent('favor:feedback-sent', { detail: { ref: ctx.ref, rating } }));
  } catch {
    msg.textContent = (err as Error).message;
    btn.disabled = false;
    cue('error');
  }
}

export function openFeedback(o: Open = {}) {
  ctx = o;
  discardShot();
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
  if (wantsShot(o)) void capture();
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

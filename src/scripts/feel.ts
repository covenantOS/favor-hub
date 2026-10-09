// How the hub sounds and moves. Sounds come from Cuelume (MIT, synthesized in the browser, no audio
// files) and play only on a press or a finished action, never on hover. One switch in the menu turns
// them off, and the choice is kept in this browser. Numbers count up when they first appear. A person
// whose computer asks for less motion gets no count-ups and no movement.
import { bind, play, setEnabled, type SoundName } from 'cuelume';

const KEY = 'favor.hub.sound';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function soundOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function cue(name: SoundName): void {
  if (!soundOn()) return;
  try {
    play(name);
  } catch {
    // No audio before the first press on the page; nothing to do.
  }
}

function setSound(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Private windows refuse storage; the switch still holds for this page.
  }
  setEnabled(on);
  paintSwitch();
  if (on) cue('chime');
}

function paintSwitch() {
  const on = soundOn();
  document.querySelectorAll<HTMLButtonElement>('[data-sound-switch]').forEach((b) => {
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.title = on ? 'Sounds are on. Press to turn them off.' : 'Sounds are off. Press to turn them on.';
    b.setAttribute('aria-label', b.title);
    b.classList.toggle('is-off', !on);
  });
}

// Count-ups: any element with data-countup counts from zero to the number it shows, keeping the
// dollar sign, commas, decimals and any words around the number.
function countUp(el: HTMLElement) {
  if (el.dataset.counted) return;
  el.dataset.counted = '1';
  const text = el.textContent || '';
  const m = /(-?[\d,]*\.?\d+)/.exec(text);
  if (!m || reduced()) return;
  const raw = m[1];
  const target = Number(raw.replace(/,/g, ''));
  if (!isFinite(target) || Math.abs(target) < 2) return;
  const decimals = (raw.split('.')[1] || '').length;
  const before = text.slice(0, m.index);
  const after = text.slice(m.index + raw.length);
  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const ms = Math.min(1400, 700 + Math.log10(Math.abs(target) + 1) * 120);
  const t0 = performance.now();
  const step = (t: number) => {
    const p = Math.min(1, (t - t0) / ms);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = before + fmt(target * eased) + after;
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = text;
  };
  requestAnimationFrame(step);
}

function scan(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('[data-countup]').forEach(countUp);
}

export function initFeel() {
  setEnabled(soundOn());
  // data-cuelume-press on an element plays "press" when it is pressed (Cuelume's own wiring).
  bind();
  paintSwitch();
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-sound-switch]');
    if (b) setSound(!soundOn());
  });
  // Primary buttons press softly. Pages can ask for a sound with a "favor:cue" event, for example
  // after something sent: document.dispatchEvent(new CustomEvent('favor:cue', { detail: 'success' })).
  document.addEventListener(
    'pointerdown',
    (e) => {
      const el = (e.target as HTMLElement).closest('.h-btn--primary, .h-btn--warn, [data-cue-press]');
      if (el && !(el as HTMLButtonElement).disabled) cue('press');
    },
    { passive: true }
  );
  document.addEventListener('favor:cue', (e) => cue(((e as CustomEvent).detail || 'success') as SoundName));
  (window as unknown as { favorCue: typeof cue }).favorCue = cue;

  scan(document);
  new MutationObserver((list) => {
    for (const m of list)
      m.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        const el = n as HTMLElement;
        if (el.matches('[data-countup]')) countUp(el);
        scan(el);
      });
  }).observe(document.body, { childList: true, subtree: true });
}

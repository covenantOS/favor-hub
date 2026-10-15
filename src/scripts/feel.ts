// How the hub sounds and moves. Sounds are the FavorOS family in public/js/hub-sound.js (files rendered from code, levels On,
// Subtle and Off, one volume, quiet hours); this file keeps the older names pages already ask for and maps them onto that family.
// Sounds play only on a press or a finished action, never on hover. Numbers count up when they first appear. A person whose
// computer asks for less motion gets no count-ups and no movement.

type HubSound = { play: (n: string, o?: Record<string, unknown>) => boolean; level: () => string; setLevel: (v: string) => void };
const hs = (): HubSound | undefined => (window as unknown as { hubSound?: HubSound }).hubSound;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const LAST_ON = 'favor.hub.sound.lastOn';

// The names pages used before (Cuelume's) and the family sound each one plays now.
const MAP: Record<string, string> = { press: 'tap', release: 'tap', tick: 'tap', toggle: 'toggle', success: 'done', sparkle: 'done', ready: 'done', chime: 'notify', bloom: 'notify', droplet: 'dismiss', whisper: 'dismiss', page: 'tap', loading: 'tap', error: 'error' };

export function soundOn(): boolean {
  const s = hs();
  if (s) return s.level() !== 'off';
  try {
    return localStorage.getItem('favor.hub.sound') !== 'off';
  } catch {
    return true;
  }
}

export function cue(name: string): void {
  const s = hs();
  if (!s) return;
  s.play(MAP[name] || name);
}

function setSound(on: boolean) {
  const s = hs();
  if (!s) return;
  if (!on) {
    try {
      localStorage.setItem(LAST_ON, s.level());
    } catch {
      // Private windows refuse storage.
    }
    s.setLevel('off');
  } else {
    let back = 'subtle';
    try {
      back = localStorage.getItem(LAST_ON) || 'subtle';
    } catch {
      // keep subtle
    }
    s.setLevel(back === 'on' ? 'on' : 'subtle');
    s.play('notify', { preview: true });
  }
  paintSwitch();
}

function paintSwitch() {
  const on = soundOn();
  document.querySelectorAll<HTMLButtonElement>('[data-sound-switch]').forEach((b) => {
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.title = on ? 'Sounds are on. Press to turn them off. Choose which in Settings under the bell.' : 'Sounds are off. Press to turn them on.';
    b.setAttribute('aria-label', on ? 'Sounds are on. Press to turn them off.' : 'Sounds are off. Press to turn them on.');
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
  paintSwitch();
  document.addEventListener('hub:sound', paintSwitch);
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-sound-switch]');
    if (b) setSound(!soundOn());
  });
  // Main buttons give a soft tap under the finger (the On level only). Pages can ask for a sound with a "favor:cue" event, for
  // example after something sent: document.dispatchEvent(new CustomEvent('favor:cue', { detail: 'success' })).
  document.addEventListener(
    'pointerdown',
    (e) => {
      const el = (e.target as HTMLElement).closest('.h-btn--primary, .h-btn--warn, [data-cue-press], [data-cuelume-press]');
      if (el && !(el as HTMLButtonElement).disabled) cue('press');
    },
    { passive: true }
  );
  document.addEventListener('favor:cue', (e) => cue(String((e as CustomEvent).detail || 'success')));
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

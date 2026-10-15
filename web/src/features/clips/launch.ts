// The camera button at the top right of every web page (drawn by the shell's TopBar as #clip-cam) opens the recorder. Port of
// public/js/clips-launch.js, which classic pages still load.
// The recorder lives in a small window of its own (/clips/rec/), so going to another hub page, reloading or switching tabs never touches a
// recording. Phones, and browsers that block the window, get the same card inside the page. While a recording runs, a small pill with the
// time and Pause, Mute, Start over, Stop and Discard shows on every page (clips/pill.js). It is not shown while the floating window is open
// (Chrome and Edge), which does the same job. The window and the pages talk over the BroadcastChannel 'favor-clips', the same messages
// the classic script uses, so a classic page and a web page in the same browser see one recorder.
//
// The click is caught on the document, not on the button, because the top bar can draw its button again (it streams in after the menu
// answers); the button's red dot is painted on whichever button is there.

interface Msg {
  t?: string;
  phase?: string;
  id?: string;
  pip?: boolean;
  [k: string]: unknown;
}
interface Pill {
  init: (post: (m: Msg) => void) => void;
  show: (m: Msg | null, at?: number) => void;
  saved: (id?: string) => void;
}
interface Launcher {
  openLauncher: (anchor: HTMLElement | null) => void;
  resumeUnfinished: () => Promise<void>;
}

const NAME = 'favor-clip-recorder';
const LIVE_KEY = 'favor.clips.live';

let started = false;

export function installClipsLauncher(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const ch = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('favor-clips') : null;
  let mod: Promise<Launcher> | null = null;
  let pillMod: Promise<Pill> | null = null;
  let rec = { phase: 'idle', id: '', at: 0 };
  // True once a recorder window has answered. Only then is the named window looked up (looking up a name that does not exist would open a blank tab).
  let winAlive = false;

  const button = () => document.getElementById('clip-cam');
  const pill = (): Promise<Pill> => {
    if (!pillMod) {
      pillMod = import('@clips/pill.js').then((m: Pill) => {
        m.init((msg) => {
          if (ch) ch.postMessage(msg);
        });
        return m;
      });
    }
    return pillMod;
  };
  const remember = (m: Msg | null) => {
    try {
      if (m) localStorage.setItem(LIVE_KEY, JSON.stringify({ at: Date.now(), m }));
      else localStorage.removeItem(LIVE_KEY);
    } catch {
      // the pill appears a moment later
    }
  };
  const load = (): Promise<Launcher> => {
    if (!mod) mod = import('@clips/launcher.js');
    return mod;
  };
  const isPhone = () => matchMedia('(max-width: 700px)').matches || (matchMedia('(pointer: coarse)').matches && matchMedia('(max-width: 1023px)').matches);
  const toast = (msg: string) => {
    const w = window as unknown as { hubToast?: (m: string) => void };
    if (w.hubToast) {
      w.hubToast(msg);
      return;
    }
    const t = document.createElement('div');
    t.className = 'h-toast';
    t.setAttribute('role', 'status');
    t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#2a2722;color:#fff;padding:10px 18px;border-radius:999px;font:500 14px Inter,system-ui,sans-serif;z-index:3000;max-width:calc(100vw - 24px)';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4200);
  };
  const recording = () => rec.phase === 'recording' || rec.phase === 'paused' || rec.phase === 'finishing';
  const busy = (phase?: string) => phase === 'preparing' || phase === 'countdown' || phase === 'recording' || phase === 'paused' || phase === 'finishing';
  const paint = () => {
    const btn = button();
    if (!btn) return;
    const live = recording();
    btn.classList.toggle('is-rec', live);
    btn.setAttribute('aria-label', live ? 'Recording. Open the recorder window' : 'Record a clip');
    btn.title = live ? 'Recording in the recorder window' : 'Record a clip';
  };

  // The recorder window reports to every hub page in the browser, whatever page the person is on.
  if (ch) {
    ch.addEventListener('message', (e: MessageEvent<Msg>) => {
      const m = e.data || {};
      if (m.t === 'gone') {
        winAlive = false;
        remember(null);
        if (pillMod) void pillMod.then((p) => p.show(null));
        return;
      }
      if (m.t === 'state' || m.t === 'saved' || m.t === 'closed') winAlive = true;
      if (m.t === 'state') {
        rec = { phase: m.phase || 'idle', id: m.id || '', at: Date.now() };
        paint();
        if (busy(m.phase) && !m.pip) {
          remember(m);
          void pill().then((p) => p.show(m));
        } else {
          remember(null);
          if (pillMod) void pillMod.then((p) => p.show(null));
        }
      } else if (m.t === 'saved') {
        rec = { phase: 'idle', id: '', at: 0 };
        paint();
        remember(null);
        // The floating window already says so when it is open.
        if (!m.pip) void pill().then((p) => p.saved(m.id));
        window.dispatchEvent(new CustomEvent('clips:changed', { detail: { id: m.id } }));
      } else if (m.t === 'closed') {
        rec = { phase: 'idle', id: '', at: 0 };
        paint();
        remember(null);
        if (pillMod) void pillMod.then((p) => p.show(null));
        toast('The recorder window closed. The clip so far is saved in My clips.');
      }
    });
    // A page that loads in the middle of a recording shows the pill at once, from the last state another page heard.
    try {
      const kept = JSON.parse(localStorage.getItem(LIVE_KEY) || 'null');
      if (kept && kept.m && Date.now() - kept.at < 4000 && busy(kept.m.phase)) void pill().then((p) => p.show(kept.m, kept.at));
    } catch {
      // the answer to the ping shows it
    }
    ch.postMessage({ t: 'ping' });
  }

  // A recorder window that stops reporting without saying goodbye (a crash) is finished here from what the server holds.
  window.setInterval(() => {
    if (!recording() || !rec.id || Date.now() - rec.at < 20000) return;
    const id = rec.id;
    rec = { phase: 'idle', id: '', at: 0 };
    paint();
    fetch('/api/clips/' + id + '/complete', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{"recover":true}' })
      .then((r) => {
        if (r.ok) toast('A recording was cut off. The clip so far is in My clips.');
      })
      .catch(() => undefined);
  }, 5000);

  const openWindow = (): boolean => {
    // An open recorder window is brought forward, never replaced.
    if (winAlive) {
      let existing: Window | null = null;
      try {
        existing = window.open('', NAME);
      } catch {
        existing = null;
      }
      if (existing) {
        try {
          existing.focus();
        } catch {
          // the browser decides
        }
        if (ch) ch.postMessage({ t: 'open' });
        return true;
      }
    }
    // Links in the recorder window ("Open the clip", "My clips") come back to this tab.
    if (!window.name) window.name = 'favor-hub-main';
    const w = 440;
    const h = Math.min(720, Math.max(520, (screen.availHeight || 800) - 90));
    const left = Math.max(0, Math.round(window.screenX + window.outerWidth - w - 40));
    const top = Math.max(0, Math.round(window.screenY + 80));
    const win = window.open('/clips/rec/', NAME, 'popup=yes,width=' + w + ',height=' + h + ',left=' + left + ',top=' + top);
    if (!win) return false;
    winAlive = true;
    try {
      win.focus();
    } catch {
      // the browser decides
    }
    return true;
  };

  const go = (btn: HTMLElement) => {
    if (!openWindow()) {
      toast('Your browser blocked the recorder window. Allow pop-ups for this site, or record here and keep this tab open.');
      void load().then((m) => m.openLauncher(btn));
    }
  };
  document.addEventListener('click', (e) => {
    const btn = (e.target as Element | null)?.closest?.('#clip-cam') as HTMLElement | null;
    if (!btn || btn.hidden) return;
    if (isPhone() || typeof BroadcastChannel === 'undefined') {
      void load().then((m) => m.openLauncher(btn));
      return;
    }
    // Ask once more whether a recorder window is open (a page that just loaded may not have heard yet).
    if (!winAlive && ch) {
      ch.postMessage({ t: 'ping' });
      setTimeout(() => go(btn), 180);
    } else go(btn);
  });

  // A recording whose window closed is finished the next time anyone opens a hub page (quiet for 90 seconds). It waits until the button shows,
  // which means this person may record.
  let checked = false;
  const whenShown = () => {
    const btn = button();
    if (checked || !btn || btn.hidden) return;
    checked = true;
    // Looked at most once every ten minutes per browser, so moving between pages does not load the recorder code each time.
    try {
      const last = Number(localStorage.getItem('favor.clips.unfinished.at') || 0);
      if (Date.now() - last < 600000) return;
      localStorage.setItem('favor.clips.unfinished.at', String(Date.now()));
    } catch {
      // storage refused; check as before
    }
    // In a meeting room it waits a minute, so the recorder code never loads while the call is joining.
    setTimeout(() => void load().then((m) => m.resumeUnfinished()), /^\/meet\/(room|g)\//.test(location.pathname) ? 60000 : 4000);
  };
  let tries = 0;
  const watch = window.setInterval(() => {
    whenShown();
    paint();
    if (checked || ++tries > 90) clearInterval(watch);
  }, 700);
  paint();
}

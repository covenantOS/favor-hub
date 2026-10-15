// The notice at the bottom of the page. The hub's own stacked toasts (window.hubToast, loaded with the frame's helpers) draw it when they
// are there; otherwise the page's own #ev-toast does, as on the Astro page. Browser only: nothing here runs while a page draws on the server.
import { useSyncExternalStore } from 'react';

interface State {
  msg: string;
  bad: boolean;
  on: boolean;
}

let state: State = { msg: '', bad: false, on: false };
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const set = (s: State) => {
  state = s;
  listeners.forEach((l) => l());
};

export function toast(msg: string, bad = false): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { hubToast?: (m: string, o: Record<string, unknown>) => void };
  if (w.hubToast) {
    w.hubToast(msg, { tone: bad ? 'bad' : '' });
    return;
  }
  clearTimeout(timer);
  set({ msg, bad, on: true });
  timer = setTimeout(() => set({ ...state, on: false }), bad ? 6000 : 2800);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const server: State = { msg: '', bad: false, on: false };

export function ToastHost() {
  const s = useSyncExternalStore(subscribe, () => state, () => server);
  return (
    <div className={'ev-toast' + (s.on ? ' is-on' : '') + (s.on && s.bad ? ' is-bad' : '')} id="ev-toast" role="status" aria-live="polite">
      {s.msg}
    </div>
  );
}

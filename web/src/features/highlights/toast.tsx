// The small message at the bottom of Highlights (.rg-toast). The shared toast (window.hubToast, favor-ui.js) is used when it has loaded,
// as the classic page does; this box is the fallback.
import { useSyncExternalStore } from 'react';
import { BodyPortal } from '@/shell/BodyPortal';

let state = { msg: '', on: false };
let timer: ReturnType<typeof setTimeout> | undefined;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const server = { msg: '', on: false };

export function toast(msg: string) {
  const shared = (window as unknown as { hubToast?: (m: string) => void }).hubToast;
  if (shared) {
    shared(msg);
    return;
  }
  state = { msg, on: true };
  emit();
  clearTimeout(timer);
  timer = setTimeout(() => {
    state = { ...state, on: false };
    emit();
  }, 3200);
}

export function PageToast() {
  const s = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
    () => server
  );
  return BodyPortal(
    <div className={'rg-toast' + (s.on ? ' is-on' : '')} id="rg-toast" role="status" aria-live="polite">
      {s.msg}
    </div>
  );
}

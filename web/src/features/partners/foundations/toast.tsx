// The small message at the bottom of the Foundations page. The hub's stacked toast draws it when it is loaded; .fnd-toast is the fallback.
import { useSyncExternalStore } from 'react';
import { BodyPortal } from '@/shell/BodyPortal';

let state = { msg: '', on: false };
let timer: ReturnType<typeof setTimeout> | undefined;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const server = { msg: '', on: false };

export function toast(msg: string) {
  // The hub's stacked toasts (window.hubToast) draw it when the frame's helpers have loaded, as the classic page does.
  const shared = typeof window !== 'undefined' ? (window as unknown as { hubToast?: (m: string) => void }).hubToast : undefined;
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
  }, 3400);
}

export function FndToast() {
  const s = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
    () => server
  );
  return BodyPortal(
    <div className={'fnd-toast' + (s.on ? ' is-on' : '')} id="fnd-toast" role="status" aria-live="polite">
      {s.msg}
    </div>
  );
}

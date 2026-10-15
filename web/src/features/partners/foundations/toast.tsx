// The small message at the bottom of the Foundations page (.fnd-toast).
import { useSyncExternalStore } from 'react';
import { BodyPortal } from '@/shell/BodyPortal';

let state = { msg: '', on: false };
let timer: ReturnType<typeof setTimeout> | undefined;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const server = { msg: '', on: false };

export function toast(msg: string) {
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

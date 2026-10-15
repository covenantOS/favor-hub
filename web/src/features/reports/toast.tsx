// The small message at the bottom of Reports (.rp-toast), the same box the classic page draws.
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
  }, 3800);
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
    <div className={'rp-toast' + (s.on ? ' is-on' : '')} id="rp-toast" role="status">
      {s.msg}
    </div>
  );
}

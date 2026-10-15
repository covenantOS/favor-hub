// The pill at the bottom of the page (.ge-toast): one message for 3.2 seconds, as the classic page's toast().
import { useSyncExternalStore } from 'react';

interface State {
  msg: string;
  on: boolean;
}
let state: State = { msg: '', on: false };
let timer: ReturnType<typeof setTimeout> | undefined;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
const server: State = { msg: '', on: false };

export function geToast(msg: string): void {
  state = { msg, on: true };
  emit();
  clearTimeout(timer);
  timer = setTimeout(() => {
    state = { ...state, on: false };
    emit();
  }, 3200);
}

export function GeToast() {
  const s = useSyncExternalStore(subscribe, () => state, () => server);
  return (
    <div className={'ge-toast' + (s.on ? ' is-on' : '')} id="ge-toast" role="status" aria-live="polite">
      {s.msg}
    </div>
  );
}

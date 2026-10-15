// True on a phone-width screen (860px and under, the width the Projects styles switch at). False while the page is drawn on the server;
// the first browser render agrees with the server, then this follows the screen.
import { useSyncExternalStore } from 'react';

const Q = '(max-width: 860px)';
const subscribe = (fn: () => void) => {
  const m = matchMedia(Q);
  m.addEventListener('change', fn);
  return () => m.removeEventListener('change', fn);
};
export const usePhone = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => matchMedia(Q).matches,
    () => false
  );

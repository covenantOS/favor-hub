// Work that is not needed for the first screen (the bell lists, the dock socket, the search index) waits until the page has
// painted and the browser is idle, so it never competes with the answers the first screen is waiting on.
import { useEffect, useState } from 'react';

let ready = false;
const subs = new Set<() => void>();

function arm() {
  const go = () => {
    ready = true;
    subs.forEach((f) => f());
  };
  const idle = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  const after = () => setTimeout(() => (idle ? idle(go, { timeout: 2500 }) : go()), 500);
  if (document.readyState === 'complete') after();
  else addEventListener('load', after, { once: true });
}
if (typeof window !== 'undefined') arm();

export function useIdleReady(): boolean {
  const [r, setR] = useState(ready);
  useEffect(() => {
    if (ready) {
      setR(true);
      return;
    }
    const f = () => setR(true);
    subs.add(f);
    return () => void subs.delete(f);
  }, []);
  return r;
}

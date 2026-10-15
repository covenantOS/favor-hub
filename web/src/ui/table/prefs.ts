// What a person picked for a list, kept in this browser under the same keys the classic lists used (public/js/ptable.js), so a choice
// carries over. Drawing never reads storage: every hook starts from the default on the server and in the first browser frame, then
// reads the saved value after mount.
import { useCallback, useEffect, useState } from 'react';

export type Density = 'compact' | 'comfortable';
export const SIZES = [25, 50, 100] as const;

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    // private mode: the choice lasts until the page closes
  }
};
const DENSITY_EVENT = 'pt:density';

/** Compact unless the person picked comfortable. One setting for every list; a change shows on every list on the page at once. */
export function useDensity(): [Density, (d: Density) => void] {
  const [d, setD] = useState<Density>('compact');
  useEffect(() => {
    const sync = () => setD(read('pt.density') === 'comfortable' ? 'comfortable' : 'compact');
    sync();
    window.addEventListener(DENSITY_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(DENSITY_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  useEffect(() => {
    document.documentElement.setAttribute('data-density', d);
  }, [d]);
  const set = useCallback((v: Density) => {
    write('pt.density', v);
    setD(v);
    window.dispatchEvent(new Event(DENSITY_EVENT));
  }, []);
  return [d, set];
}

/** Rows per page for one list (25, 50 or 100). */
export function usePageSize(key: string, fallback = 50): [number, (n: number) => void] {
  const [n, setN] = useState(fallback);
  useEffect(() => {
    const v = Number(read('pt.size.' + key));
    if ((SIZES as readonly number[]).includes(v)) setN(v);
  }, [key]);
  const set = useCallback(
    (v: number) => {
      write('pt.size.' + key, String(v));
      setN(v);
    },
    [key]
  );
  return [n, set];
}

/** The columns a person hid in one list. defaults are hidden until the person changes the menu. */
export function useHiddenColumns(key: string, defaults: readonly string[] = []): [Set<string>, (s: Set<string> | null) => void] {
  const [h, setH] = useState<Set<string>>(() => new Set(defaults));
  useEffect(() => {
    const raw = read('pt.cols.' + key);
    if (raw == null) return;
    try {
      setH(new Set(JSON.parse(raw) as string[]));
    } catch {
      // a damaged value keeps the defaults
    }
  }, [key]);
  const set = useCallback(
    (s: Set<string> | null) => {
      if (s == null) {
        write('pt.cols.' + key, null);
        setH(new Set(defaults));
      } else {
        write('pt.cols.' + key, JSON.stringify([...s]));
        setH(new Set(s));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  );
  return [h, set];
}

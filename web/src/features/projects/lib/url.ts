// The page address as the Projects screens use it (?p=KEY&view=board&t=CODE&owner=me ...). The address is read raw, so a link keeps
// its exact form; it is written back through the router's history so Back and Forward work and the router stays in step.
import { useCallback, useMemo } from 'react';
import { useRouter, useRouterState } from '@tanstack/react-router';

/** The query string of the current address as URLSearchParams (the same on the server and in the browser). */
export function useSearchParams(): URLSearchParams {
  const str = useRouterState({ select: (s) => s.location.searchStr });
  return useMemo(() => new URLSearchParams(str), [str]);
}

/** Change the query string. replace keeps the history as it is (filters, an opened task); push adds an entry (a view or a tab). */
export function useSetSearch() {
  const router = useRouter();
  return useCallback(
    (mut: (p: URLSearchParams) => void, how: 'push' | 'replace' = 'replace') => {
      const u = new URL(window.location.href);
      mut(u.searchParams);
      const to = u.pathname + (u.search || '') + u.hash;
      if (to === window.location.pathname + window.location.search + window.location.hash) return;
      if (how === 'push') router.history.push(to);
      else router.history.replace(to);
    },
    [router]
  );
}

export const projectHref = (key: string, extra = '') => '/projects/p/?p=' + encodeURIComponent(key) + extra;
export const cleanRef = (s: string | null | undefined) => String(s || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');

// Code that runs outside React (sheets opened from a handler) goes to another page through the router when a page has registered it.
let navFn: ((href: string) => void) | null = null;
export const setNavigator = (f: ((href: string) => void) | null) => {
  navFn = f;
};
export const goto = (href: string) => {
  if (navFn) navFn(href);
  else window.location.href = href;
};

// A list taller than the screen scrolls inside its card (sticky header row), so the pager stays in view. DataTable takes how many pixels
// sit above and below the list; this measures them in the browser after each draw, the way the classic tabs' fit() did.
import { useLayoutEffect, useRef, useState } from 'react';

/** Attach `ref` to the box around the table and its pager. `fit` goes to DataTable; it is a guess until the browser has measured. */
export function useFit(guess = 440, below = 10) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(guess);
  useLayoutEffect(() => {
    const measure = () => {
      const host = ref.current;
      const wrap = host?.querySelector<HTMLElement>('.pt-wrap');
      if (!host || !wrap) return;
      const pg = host.querySelector<HTMLElement>('.pt-pager');
      // Everything under the table inside the card (the pager, a footer note) stays on screen with it.
      const under = host.getBoundingClientRect().bottom - wrap.getBoundingClientRect().bottom;
      const next = Math.round(wrap.getBoundingClientRect().top + window.scrollY + (under > 0 ? under : pg ? pg.offsetHeight : 48) + below);
      setFit((f) => (Math.abs(f - next) > 1 ? next : f));
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('pt:density', measure);
    const t = setTimeout(measure, 250);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('pt:density', measure);
      clearTimeout(t);
    };
  });
  return { ref, fit };
}

// The rail's behavior: slim or full, the phone menu, open groups, pins, the Tools pop-up and the keyboard shortcuts.
// A port of public/js/hub-nav.js. Choices are saved per person under favor.hub.nav.prefs.v1, the same record the classic menu keeps.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { hubOv } from '@/lib/hubOv';
import { readPrefs, savePrefs } from '@/lib/storage';

const wideMq = () => window.matchMedia('(min-width: 1280px)');
const phoneMq = () => window.matchMedia('(max-width: 860px)');

function useMq(make: () => MediaQueryList): boolean {
  // Starts false so the server and the first browser render agree (the React app is drawn on the server since 2026-10-15); read after mount.
  const [on, setOn] = useState(false);
  useEffect(() => {
    const m = make();
    const f = () => setOn(m.matches);
    m.addEventListener('change', f);
    f();
    return () => m.removeEventListener('change', f);
  }, [make]);
  return on;
}

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
};

export function useRail(email: string, curArea: string) {
  const wideOk = useMq(wideMq);
  const phone = useMq(phoneMq);
  // Empty on the first render everywhere (server and hydration agree); the saved choices load right after mount.
  const [prefs, setPrefs] = useState(() => ({}) as ReturnType<typeof readPrefs>);
  const [peek, setPeek] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [pop, setPop] = useState<string | null>(null);

  // Prefs are keyed by email; read them again when the person becomes known.
  useEffect(() => setPrefs(readPrefs(email)), [email]);

  const wide = !!prefs.wide;
  const full = phone ? false : wideOk ? wide : peek;

  useEffect(() => {
    document.documentElement.classList.toggle('nav-wide', wide && wideOk);
    if (wideOk) setPeek(false);
  }, [wide, wideOk]);

  const update = useCallback(
    (fn: (p: ReturnType<typeof readPrefs>) => void) => {
      setPrefs({ ...savePrefs(email, fn) });
    },
    [email]
  );

  const toggleWide = useCallback(() => {
    if (phone) return;
    if (wideOk) update((p) => { p.wide = !p.wide; });
    else setPeek((v) => !v);
  }, [phone, wideOk, update]);

  const toggleGroup = useCallback(
    (id: string, now: boolean) => {
      update((p) => {
        p.open = p.open || {};
        p.open[id] = !now;
      });
    },
    [update]
  );

  const pins = useMemo(() => (prefs.pins || []).slice(0, 5), [prefs.pins]);
  const togglePin = useCallback(
    (id: string) =>
      update((p) => {
        const cur = (p.pins || []).slice();
        const i = cur.indexOf(id);
        if (i >= 0) cur.splice(i, 1);
        else {
          cur.push(id);
          while (cur.length > 5) cur.shift();
        }
        p.pins = cur;
      }),
    [update]
  );

  const remember = useCallback((areaId: string, pageId: string) => update((p) => { p.last = p.last || {}; p.last[areaId] = pageId; }), [update]);

  const closeNav = useCallback(() => setNavOpen(false), []);

  // The back gesture closes the phone menu.
  useEffect(() => {
    if (!(phone && navOpen)) return;
    const tok = hubOv.on(() => setNavOpen(false));
    return () => hubOv.off(tok);
  }, [phone, navOpen]);

  // Leaving the phone layout closes its menu.
  useEffect(() => {
    if (!phone) setNavOpen(false);
  }, [phone]);

  // A press outside the menu closes the phone menu and the Tools pop-up.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t || !(t instanceof Element)) return;
      if (!t.closest('.h-area--pop')) setPop(null);
      if (navOpen && !t.closest('.h-side') && !t.closest('#h-menu') && !t.closest('#h-bar-more')) setNavOpen(false);
      if (peek && !t.closest('.h-side') && !t.closest('#h-wide')) setPeek(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [navOpen, peek]);

  // Shortcuts: backslash toggles the rail, [ and ] cycle the area's tabs, G then a letter jumps to an area.
  useEffect(() => {
    let gAt = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey) return;
      const cmdk = document.getElementById('cmdk');
      if (cmdk && !cmdk.hidden) return;
      if (e.ctrlKey && e.key === '\\') {
        e.preventDefault();
        toggleWide();
        return;
      }
      if (e.metaKey || e.ctrlKey || typing(e.target)) return;
      if (e.key === 'Escape') {
        if (peek) setPeek(false);
        setPop(null);
        return;
      }
      if (e.key === '\\') {
        e.preventDefault();
        toggleWide();
        return;
      }
      if (e.key === '[' || e.key === ']') {
        const tabs = Array.from(document.querySelectorAll<HTMLElement>('#h-tabs .h-tab:not([hidden])'));
        const i = tabs.findIndex((t) => t.classList.contains('is-on'));
        if (tabs.length > 1 && i >= 0) {
          e.preventDefault();
          tabs[(i + (e.key === ']' ? 1 : tabs.length - 1)) % tabs.length].click();
        }
        return;
      }
      const k = e.key.toLowerCase();
      if (gAt && Date.now() - gAt < 1200) {
        gAt = 0;
        const link = document.querySelector<HTMLElement>(`.h-area[data-key="${k}"]:not([hidden]):not(.h-area--pop) .h-area__link`);
        if (link) {
          e.preventDefault();
          link.click();
        }
        return;
      }
      if (k === 'g' && !e.shiftKey) gAt = Date.now();
    };
    document.addEventListener('keydown', onKey);
    const onToggle = () => toggleWide();
    window.addEventListener('hub-nav-toggle', onToggle);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('hub-nav-toggle', onToggle);
    };
  }, [peek, toggleWide]);

  const isOpen = (id: string) => id === curArea || prefs.open?.[id] === true;

  return { phone, wide, full, peek, setPeek, navOpen, setNavOpen, closeNav, pop, setPop, pins, togglePin, toggleWide, toggleGroup, isOpen, remember };
}

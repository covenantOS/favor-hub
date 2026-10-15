// The guided tour. One component runs in two places: inside the web app's frame (TourHost.tsx) and as a small island on
// the classic pages (island.tsx). It reads who the person is from the nav answer, picks the tour for their job, walks the
// real screens with a spotlight, keeps its place per person on the server, and offers a short What's new tour for what
// changed since their last visit. The steps are in data.ts, the geometry in engine.ts, the progress in store.ts.
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { RETURNS, comesBack, dayWord, etStamp, etToday, finish as markDone, isDone, mayOpen, place, skip as markSkipped, type Progress } from '@hub/scripts/tour-state';
import { TOUR_IDS, TOUR_LABEL, pickTour, say, tourFor, tourFromAs, whoFromNav, type NavAnswer, type Step, type TourId, type Who } from './data';
import { loadNews, newsCount, newsSteps, type News } from './news';
import { vh, vw, busy, clearSpacer, clearTyping, deviceNow, findFirst, stable, holeRect, isPhone, isTouch, leadsTo, linkTo, navLink, openMenuFor, placeAlone, pressEl, reduced, samePage, settle, sleep, visible, watchTyping, type Placement } from './engine';
import { openStore, type ProgressStore } from './store';
import './tour.css';

type Mode = 'tour' | 'news';
type Run = { mode: Mode; tour: TourId; steps: Step[]; i: number; replay: boolean; as?: TourId; since?: string };
type Saved = { mode: Mode; tour: TourId; ids: string[]; i: number; at: number; replay: boolean; as?: TourId; since?: string; tried?: string[] };

const SESSION = 'favor.hub.tour3';
const INVITED = 'favor.hub.tour3.invited';
const PENDING = 'favor.hub.tours.pending';
const AUTO_TEST = 'favor.hub.tours.auto';
const SEEN = 'favor.changelog.seen';

const sess = {
  get(): Saved | null {
    try {
      const s = JSON.parse(sessionStorage.getItem(SESSION) || 'null') as Saved | null;
      return s && Array.isArray(s.ids) && Date.now() - s.at < 20 * 60 * 1000 ? s : null;
    } catch {
      return null;
    }
  },
  set(s: Omit<Saved, 'at'>) {
    try {
      sessionStorage.setItem(SESSION, JSON.stringify({ ...s, at: Date.now() }));
    } catch {
      // A tab that refuses storage still runs the tour on this page.
    }
  },
  clear() {
    try {
      sessionStorage.removeItem(SESSION);
    } catch {
      // nothing to clear
    }
  },
};

const X = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
const SPARK = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
  </svg>
);

const weekday = (stamp: string) => {
  const [y, m, d] = stamp.slice(0, 10).split('-').map(Number);
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return names[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};

type Ov = { on: (close: () => void) => unknown; off: (t: unknown) => void };
const hubOv = () => (window as unknown as { hubOv?: Ov }).hubOv;

/** The nav answer: the page's own copy at once, then every update. A page that has none after a few seconds is asked directly. */
function useHub(): NavAnswer | null {
  const [hub, setHub] = useState<NavAnswer | null>(() => (typeof window !== 'undefined' ? (window as unknown as { FAVOR_HUB?: NavAnswer }).FAVOR_HUB || null : null));
  useEffect(() => {
    const on = (e: Event) => setHub((e as CustomEvent).detail || null);
    document.addEventListener('favor-hub', on);
    const w = window as unknown as { FAVOR_HUB?: NavAnswer };
    if (w.FAVOR_HUB) setHub(w.FAVOR_HUB);
    const t = window.setTimeout(async () => {
      if (w.FAVOR_HUB) return;
      try {
        const r = await fetch('/api/hub/nav', { credentials: 'same-origin' });
        const d = r.ok ? ((await r.json()) as NavAnswer & { ok?: boolean }) : null;
        if (d && d.ok) setHub(d);
      } catch {
        // No answer: the tour does not start.
      }
    }, 5000);
    return () => {
      document.removeEventListener('favor-hub', on);
      window.clearTimeout(t);
    };
  }, []);
  return hub;
}

/** The address of the page, updated when the page changes in place (a swap, a route change, Back). */
function usePath(): string {
  const [p, setP] = useState(() => (typeof location !== 'undefined' ? location.pathname + location.search : ''));
  useEffect(() => {
    const read = () => setP(location.pathname + location.search);
    document.addEventListener('hub-swapped', read);
    addEventListener('popstate', read);
    const t = window.setInterval(read, 400);
    return () => {
      document.removeEventListener('hub-swapped', read);
      removeEventListener('popstate', read);
      window.clearInterval(t);
    };
  }, []);
  return p;
}

/** The island's stylesheet loads beside its script: wait until the card is styled before measuring it. */
async function styled(el: HTMLElement | null): Promise<void> {
  for (let k = 0; k < 40 && el && getComputedStyle(el).position !== 'absolute' && getComputedStyle(el).position !== 'fixed'; k++) await new Promise((r) => setTimeout(r, 50));
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

export function TourRoot(): ReactElement | null {
  const hub = useHub();
  const path = usePath();
  const who: Who | null = useMemo(() => (hub && hub.user?.email ? whoFromNav(hub) : null), [hub]);
  const [progress, setProgress] = useState<Progress>({});
  const [loaded, setLoaded] = useState(false);
  const storeRef = useRef<ProgressStore | null>(null);
  const progressRef = useRef<Progress>({});
  progressRef.current = progress;
  const [news, setNews] = useState<News | null>(null);
  const newsRef = useRef<News | null>(null);
  newsRef.current = news;

  const [run, setRun] = useState<Run | null>(null);
  const runRef = useRef<Run | null>(null);
  runRef.current = run;
  const [ui, setUi] = useState<'idle' | 'invite' | 'pick' | 'run' | 'done'>('idle');
  const [inviteKind, setInviteKind] = useState<Mode>('tour');
  const [finished, setFinished] = useState<{ mode: Mode } | null>(null);
  const [asTour, setAsTour] = useState<TourId | undefined>(undefined);

  // The card and the frame.
  const cardRef = useRef<HTMLDivElement | null>(null);
  const holeRef = useRef<HTMLDivElement | null>(null);
  const tapRef = useRef<HTMLDivElement | null>(null);
  const [place_, setPlace] = useState<Placement | null>(null);
  const placeRef = useRef<Placement | null>(null);
  placeRef.current = place_;
  const targetRef = useRef<Element | null>(null);
  const targetSel = useRef('');
  const [card, setCard] = useState<{ title: string; body: string; busy: boolean; key: string } | null>(null);
  const gen = useRef(0);
  const travelling = useRef(false);
  const lostAt = useRef(0);
  const offAt = useRef(0);
  // Steps whose page the tour has already loaded once. A page that sends the person elsewhere (a view they cannot open) drops the step instead of looping.
  const tried = useRef<Set<string>>(new Set());
  const refinding = useRef(false);
  const gone = useRef<Set<string>>(new Set());
  const [, bump] = useState(0);
  const ovTok = useRef<unknown>(null);
  const device = deviceNow();

  const email = who?.email || '';

  /* ---------------------------------------------------------------- progress */

  useEffect(() => {
    if (!email) return;
    let dead = false;
    void openStore(email, (p) => {
      if (!dead) setProgress(p);
    }).then((s) => {
      if (dead) return;
      storeRef.current = s;
      setProgress(s.get());
      setLoaded(true);
    });
    const leave = () => storeRef.current?.flush();
    addEventListener('pagehide', leave);
    return () => {
      dead = true;
      removeEventListener('pagehide', leave);
    };
  }, [email]);

  useEffect(() => {
    void loadNews().then(setNews);
  }, []);

  const commit = useCallback((next: Progress, now = false) => {
    progressRef.current = next;
    storeRef.current?.set(next, now);
    setProgress(next);
  }, []);

  /* ----------------------------------------------------------- what is waiting */

  const myTour: TourId | null = who ? pickTour(who) : null;
  const corePending = loaded && !isDone(progress, 'core');
  const sinceStamp = useMemo(() => {
    const row = progress.news;
    if (row) return etStamp(row.at);
    try {
      return localStorage.getItem(SEEN) || '';
    } catch {
      return '';
    }
  }, [progress.news]);
  const fresh = who && news ? newsCount(who, news, sinceStamp) : 0;
  const sinceRef = useRef('');
  sinceRef.current = sinceStamp;

  // A person new to FavorOS has no last visit: the first look sets it, so the tour is not followed by months of changes.
  useEffect(() => {
    if (!loaded || !news || progress.news) return;
    let seen = '';
    try {
      seen = localStorage.getItem(SEEN) || '';
    } catch {
      seen = '';
    }
    if (!seen) {
      try {
        localStorage.setItem(SEEN, news.latest);
      } catch {
        // storage refused
      }
      commit(markDone(progressRef.current, 'news'));
    }
  }, [loaded, news, progress.news, commit]);

  // The number on Help and the card on Today.
  useEffect(() => {
    if (!who || !loaded) return;
    const count = (corePending ? 1 : 0) + (fresh > 0 ? 1 : 0);
    try {
      localStorage.setItem(PENDING, String(count));
    } catch {
      // nothing to do
    }
    document.querySelectorAll<HTMLElement>('[data-count="tours"]').forEach((el) => {
      el.hidden = !count;
      el.textContent = String(count);
    });
    const layout = (window as unknown as { hubNavLayout?: () => void }).hubNavLayout;
    if (layout) layout();
    document.documentElement.classList.toggle('show-welcome', count > 0);
    const c = document.getElementById('t-welcome');
    if (c) {
      c.hidden = !count;
      const b = c.querySelector('b');
      if (b) b.textContent = corePending ? 'Tour of FavorOS, 2 minutes' : `What's new: ${fresh} ${fresh === 1 ? 'change' : 'changes'}`;
      const btn = c.querySelector('button');
      if (btn) btn.textContent = corePending && (progress.core?.i || 0) > 0 ? 'Resume' : 'Show me';
    }
  }, [who, loaded, corePending, fresh, path, progress.core?.i]);

  // Help's own button replays the tour instead of opening the picker.
  useEffect(() => {
    if (!loaded) return;
    const b = document.querySelector<HTMLElement>('.hd-hero__acts [data-tour-start]');
    if (b && !b.hasAttribute('data-tour-replay')) {
      b.setAttribute('data-tour-replay', '1');
      const t = Array.from(b.childNodes).find((n) => n.nodeType === 3 && n.textContent?.trim());
      if (t) t.textContent = 'Replay the tour';
    }
  }, [loaded, path]);

  /* ------------------------------------------------------------------ the run */

  const stepsFor = useCallback(
    (mode: Mode, tour: TourId, since?: string): Step[] => {
      if (!who) return [];
      if (mode === 'news') return newsSteps(who, news, since || sinceStamp);
      return tourFor(tour, who, device);
    },
    [who, news, sinceStamp, device]
  );

  const stopOv = useCallback(() => {
    const ov = hubOv();
    if (ov && ovTok.current) {
      const t = ovTok.current;
      ovTok.current = null;
      ov.off(t);
    }
  }, []);

  const teardown = useCallback(() => {
    gen.current++;
    travelling.current = false;
    targetRef.current = null;
    clearSpacer();
    stopOv();
    setRun(null);
    setCard(null);
    setPlace(null);
    setFinished(null);
    setUi('idle');
    document.documentElement.classList.remove('tour-on');
    if (isPhone()) document.getElementById('h-app')?.classList.remove('is-nav');
  }, [stopOv]);

  const saveSession = (r: Run) =>
    sess.set({ mode: r.mode, tour: r.tour, ids: r.steps.map((s) => s.id), i: r.i, replay: r.replay, as: r.as, since: r.since, tried: [...tried.current] });

  /** Leave the tour. The step stays saved, so Resume picks up there. */
  const close = useCallback(
    (how: 'skip' | 'done') => {
      const r = runRef.current;
      sess.clear();
      if (r && how === 'skip' && r.mode === 'tour' && !r.replay && !r.as) {
        const p = markSkipped(progressRef.current, 'core', etToday());
        commit({ ...p, core: { ...p.core, ...(r.i > 0 ? { i: r.i } : {}) } }, true);
      }
      teardown();
    },
    [commit, teardown]
  );

  const finishRun = useCallback(() => {
    const r = runRef.current;
    if (!r) return;
    sess.clear();
    gen.current++;
    targetRef.current = null;
    setPlace(null);
    if (r.mode === 'tour' && !r.replay && !r.as) commit(markDone(progressRef.current, 'core'), true);
    if (r.mode === 'news' || (r.mode === 'tour' && !r.replay && !r.as)) {
      // What changed is seen once the tour or the What's new run is over.
      const nw = newsRef.current;
      if (nw) {
        try {
          localStorage.setItem(SEEN, nw.latest);
        } catch {
          // storage refused
        }
        document.documentElement.classList.remove('has-cl-new');
      }
      commit(markDone(progressRef.current, 'news'), true);
    }
    setFinished({ mode: r.mode });
    setUi('done');
  }, [commit]);

  /** Show one stop: find the thing, bring it into view, put the card beside it. */
  const show = useCallback(
    async (steps: Step[], i: number, my: number, dir: 1 | -1) => {
      const step = steps[i];
      const stale = () => my !== gen.current || !runRef.current;
      openMenuFor(step.at[0]);
      setCard({ title: say(step.title, device), body: say(step.body, device), busy: true, key: step.id });
      targetRef.current = null;
      holeRef.current?.classList.add('is-none');
      await nextFrame();
      await styled(cardRef.current);
      if (stale()) return;
      const el = cardRef.current;
      const size = { w: el?.offsetWidth || 380, h: el?.offsetHeight || 160, safeTop: parseFloat(getComputedStyle(document.querySelector('.tour') || document.body).paddingTop) || 0 };
      if (!step.at.length) {
        setPlace(placeAlone(size));
        setCard((c) => (c ? { ...c, busy: false } : c));
        return;
      }
      if (isPhone() && step.at[0] && document.querySelector(step.at[0])?.closest('.h-side')) await sleep(260);
      let found = await findFirst(step.at, 6500);
      // A page that draws its list again replaces the element while it settles: wait for the one that stays.
      for (let k = 0; found && k < 3; k++) {
        await stable(found.el);
        if (stale()) return;
        const r = found.el.getBoundingClientRect();
        if (found.el.isConnected && r.width >= 8 && r.height >= 8) break;
        found = await findFirst(step.at, 3000);
      }
      if (stale()) return;
      if (!found) {
        // Nothing to show here for this person (a page that did not load, a card that is not on it): the stop is left out.
        gone.current.add(step.id);
        bump((n) => n + 1);
        const live = steps.map((s, k) => ({ s, k })).filter((x) => !gone.current.has(x.s.id));
        const nxt = dir === 1 ? live.find((x) => x.k > i) : [...live].reverse().find((x) => x.k < i);
        if (nxt) return void go(nxt.k, dir);
        if (dir === 1) return finishRun();
        return void go(Math.max(0, live[0]?.k ?? 0), 1);
      }
      const at = await settle(found.el, step.side, size, stale);
      if (stale() || !at) return;
      if (el) el.dataset.size = `${size.w}x${size.h}`;
      targetSel.current = found.sel;
      targetRef.current = found.el;
      setPlace(at);
      setCard((c) => (c ? { ...c, busy: false } : c));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [device, finishRun]
  );

  /** Press the menu item that leads to the step's page, the way a person would, then wait for the page. */
  const travel = useCallback(
    async (steps: Step[], i: number, my: number, dir: 1 | -1) => {
      const step = steps[i];
      const stale = () => my !== gen.current || !runRef.current;
      travelling.current = true;
      const link = navLink(step.via);
      targetRef.current = null;
      openMenuFor(undefined);
      setCard({ title: say(step.title, device), body: 'Opening the page.', busy: true, key: `go-${step.id}` });
      await nextFrame();
      await styled(cardRef.current);
      if (stale()) return;
      const el = cardRef.current;
      const size = { w: el?.offsetWidth || 380, h: el?.offsetHeight || 140, safeTop: parseFloat(getComputedStyle(document.querySelector('.tour') || document.body).paddingTop) || 0 };
      if (link) {
        const at = await settle(link, 'right', size, stale);
        if (stale() || !at) return;
        targetRef.current = link;
        targetSel.current = '';
        setPlace(at);
        const rect = link.getBoundingClientRect();
        const tap = tapRef.current;
        if (tap) {
          tap.style.left = `${Math.round(rect.left + rect.width / 2) - 26}px`;
          tap.style.top = `${Math.round(rect.top + rect.height / 2) - 26}px`;
          tap.classList.remove('is-press');
          void tap.offsetWidth;
          tap.classList.add('is-press');
        }
        await sleep(isTouch() ? 520 : 650);
        if (stale()) return;
        saveSession({ ...runRef.current!, i });
        // A link that opens some other page (an area's first page) is not pressed: the tour goes straight to its own page.
        if (leadsTo(link, step.page)) pressEl(link as HTMLElement);
        else {
          tried.current.add(step.id);
          saveSession({ ...runRef.current!, i });
          location.assign(step.page || '/');
          return;
        }
      }
      // The page may change in place (the menu swaps it) or load whole. Give a swap a moment, then go straight there.
      for (let k = 0; k < 14 && !samePage(step.page); k++) {
        await sleep(150);
        if (stale()) return;
      }
      if (!samePage(step.page)) {
        const a = step.page ? linkTo(step.page) : null;
        if (a) {
          a.click();
          for (let k = 0; k < 14 && !samePage(step.page); k++) {
            await sleep(150);
            if (stale()) return;
          }
        }
      }
      if (!samePage(step.page)) {
        tried.current.add(step.id);
        saveSession({ ...runRef.current!, i });
        location.assign(step.page || '/');
        return;
      }
      travelling.current = false;
      targetRef.current = null;
      await show(steps, i, my, dir);
    },
    [device, show]
  );

  const go = useCallback(
    async (i: number, dir: 1 | -1 = 1) => {
      const r = runRef.current;
      if (!r) return;
      if (i >= r.steps.length) return finishRun();
      if (i < 0) i = 0;
      const my = ++gen.current;
      const next: Run = { ...r, i };
      runRef.current = next;
      setRun(next);
      saveSession(next);
      if (r.mode === 'tour' && !r.replay && !r.as) {
        const p = place(progressRef.current, 'core', i);
        if (p !== progressRef.current) commit(p);
      }
      const step = r.steps[i];
      if (!samePage(step.page) && tried.current.has(step.id)) {
        // The page was loaded for this step and answered with another view: the person cannot open it, so the stop is left out.
        gone.current.add(step.id);
        bump((n) => n + 1);
        const live = r.steps.map((s, k) => ({ s, k })).filter((x) => !gone.current.has(x.s.id));
        const nxt = dir === 1 ? live.find((x) => x.k > i) : [...live].reverse().find((x) => x.k < i);
        if (nxt) return void go(nxt.k, dir);
        return dir === 1 ? finishRun() : void go(Math.max(0, live[0]?.k ?? 0), 1);
      }
      if (!samePage(step.page)) return void travel(r.steps, i, my, dir);
      travelling.current = false;
      return void show(r.steps, i, my, dir);
    },
    [commit, finishRun, show, travel]
  );

  const begin = useCallback(
    (mode: Mode, opts: { tour?: TourId; at?: number; replay?: boolean; as?: TourId; since?: string; ids?: string[] } = {}) => {
      if (!who || !myTour) return;
      const tour = opts.tour || opts.as || myTour;
      let steps = stepsFor(mode, tour, opts.since);
      if (opts.ids && opts.ids.length) {
        const keep = steps.filter((s) => opts.ids!.includes(s.id));
        if (keep.length) steps = keep;
      }
      if (!steps.length) return;
      gone.current = new Set();
      if (!opts.ids) tried.current = new Set();
      const replay = opts.replay ?? (mode === 'tour' ? isDone(progressRef.current, 'core') : false);
      const i = Math.min(Math.max(0, opts.at || 0), steps.length - 1);
      const r: Run = { mode, tour, steps, i, replay, as: opts.as, since: opts.since };
      runRef.current = r;
      setRun(r);
      setUi('run');
      setFinished(null);
      document.documentElement.classList.add('tour-on');
      const ov = hubOv();
      if (ov && !ovTok.current) ovTok.current = ov.on(() => { ovTok.current = null; close('skip'); });
      void go(i, 1);
    },
    [who, myTour, stepsFor, go, close]
  );

  /* ------------------------------------------------------- following the target */

  useEffect(() => {
    if (ui !== 'run') return;
    let raf = 0;
    let last = '';
    let replaceT = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const hole = holeRef.current;
      if (!hole) return;
      let t = targetRef.current;
      // A page that draws its list again replaces the element: find the same thing again.
      if (t && !t.isConnected && targetSel.current) {
        const again = Array.from(document.querySelectorAll(targetSel.current)).find((e) => visible(e) && !e.closest('.tour'));
        if (again) { targetRef.current = again; t = again; }
      }
      const pl = placeRef.current;
      // The card itself must stay on the screen: a card measured before its content or its styles settled is placed again.
      const cc = cardRef.current;
      if (cc && pl && !card?.busy && !refinding.current) {
        const cr = cc.getBoundingClientRect();
        const bad = cr.height > 0 && (cr.bottom > vh() + 1 || cr.top < -1 || cr.right > vw() + 1 || cr.left < -1);
        if (bad) {
          offAt.current = offAt.current || Date.now();
          if (Date.now() - offAt.current > 500) {
            offAt.current = 0;
            refinding.current = true;
            const my = gen.current;
            const r0 = runRef.current;
            void (async () => {
              const el = targetRef.current;
              const size = { w: cc.offsetWidth, h: cc.offsetHeight, safeTop: 0 };
              const at = el && el.isConnected ? await settle(el, r0?.steps[r0.i]?.side, size, () => my !== gen.current) : placeAlone(size);
              if (at && my === gen.current) setPlace(at);
              refinding.current = false;
            })();
          }
        } else offAt.current = 0;
      }
      const rect = t && t.isConnected && pl ? holeRect(t, pl.clip) : null;
      if (!rect) {
        if (last !== 'none') { hole.classList.add('is-none'); last = 'none'; }
        // The target went away or shrank to nothing (the page drew itself again): after a moment look for it again.
        const r0 = runRef.current;
        if (pl && r0 && !travelling.current && r0.steps[r0.i]?.at.length && !refinding.current) {
          lostAt.current = lostAt.current || Date.now();
          if (Date.now() - lostAt.current > 700) {
            refinding.current = true;
            lostAt.current = 0;
            const my = gen.current;
            void (async () => {
              const found = await findFirst(r0.steps[r0.i].at, 2500);
              if (found && my === gen.current) {
                await stable(found.el);
                const c = cardRef.current;
                const at = await settle(found.el, r0.steps[r0.i].side, { w: c?.offsetWidth || 380, h: c?.offsetHeight || 200, safeTop: 0 }, () => my !== gen.current);
                if (at && my === gen.current) { targetSel.current = found.sel; targetRef.current = found.el; setPlace(at); last = ''; }
              }
              refinding.current = false;
            })();
          }
        }
        return;
      }
      lostAt.current = 0;
      const k = `${rect.x}|${rect.y}|${rect.w}|${rect.h}`;
      if (k === last) return;
      last = k;
      hole.classList.remove('is-none');
      hole.style.cssText = `transform:translate(${rect.x}px,${rect.y}px);width:${rect.w}px;height:${rect.h}px`;
      // The thing grew or moved after the card was placed (its rows loaded): place the card again so it never sits on it.
      const c = cardRef.current;
      const rr = c?.getBoundingClientRect();
      if (rr && !card?.busy && Math.min(rect.x + rect.w, rr.right) - Math.max(rect.x, rr.left) > 2 && Math.min(rect.y + rect.h, rr.bottom) - Math.max(rect.y, rr.top) > 2) {
        window.clearTimeout(replaceT);
        replaceT = window.setTimeout(async () => {
          const el = targetRef.current;
          const r0 = runRef.current;
          if (!el || !r0) return;
          const my = gen.current;
          const at = await settle(el, r0.steps[r0.i]?.side, { w: c!.offsetWidth, h: c!.offsetHeight, safeTop: 0 }, () => my !== gen.current);
          if (at && my === gen.current) setPlace(at);
        }, 140);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(replaceT);
    };
  }, [ui, card?.busy]);

  // The person left the tour's page on their own (Back, a link): the tour stops and keeps its place.
  useEffect(() => {
    if (ui !== 'run' || !run) return;
    const t = window.setInterval(() => {
      const r = runRef.current;
      if (!r || travelling.current) return;
      const step = r.steps[r.i];
      if (step?.page && new URL(step.page, location.origin).pathname.replace(/\/+$/, '') !== location.pathname.replace(/\/+$/, '')) close('skip');
    }, 600);
    return () => window.clearInterval(t);
  }, [ui, run, close]);

  // A page change while the card is up: the keys and the resize.
  useEffect(() => {
    if (ui !== 'run') return;
    const onKey = (e: KeyboardEvent) => {
      const r = runRef.current;
      if (!r) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close('skip');
      } else if (e.key === 'Tab') {
        // The page behind the card is not for pressing: Tab stays on the card's own buttons.
        const items = Array.from(cardRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]') || []);
        if (items.length) {
          const at = items.indexOf(document.activeElement as HTMLElement);
          const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at === items.length - 1 ? 0 : at + 1;
          e.preventDefault();
          items[next].focus({ preventScroll: true });
        }
      } else if (e.key === 'ArrowRight' && !(e.target as HTMLElement).matches?.('input,textarea,select')) {
        e.preventDefault();
        void go(r.i + 1, 1);
      } else if (e.key === 'ArrowLeft' && !(e.target as HTMLElement).matches?.('input,textarea,select')) {
        e.preventDefault();
        if (r.i > 0) void go(r.i - 1, -1);
      }
    };
    const onResize = () => {
      const t = targetRef.current;
      const c = cardRef.current;
      const r = runRef.current;
      if (!c || !r) return;
      const my = gen.current;
      if (t) void settle(t, r.steps[r.i]?.side, { w: c.offsetWidth, h: c.offsetHeight, safeTop: 0 }, () => my !== gen.current).then((at) => { if (at && my === gen.current) setPlace(at); });
      else setPlace(placeAlone({ w: c.offsetWidth, h: c.offsetHeight, safeTop: 0 }));
    };
    document.addEventListener('keydown', onKey, true);
    addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      removeEventListener('resize', onResize);
    };
  }, [ui, close, go]);

  useEffect(() => {
    if (ui === 'run' && card && !card.busy) cardRef.current?.querySelector<HTMLElement>('[data-tour-next]')?.focus({ preventScroll: true });
  }, [ui, card]);

  /* -------------------------------------------------------- starting and inviting */

  // The Help item, Today's card and a Help button open the picker, or replay at once.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const b = (e.target as HTMLElement).closest?.('[data-tour-start], [data-tour-replay]');
      if (!b || !who || !loaded) return;
      e.preventDefault();
      if (runRef.current) return;
      const saved = !isDone(progressRef.current, 'core') ? progressRef.current.core?.i || 0 : 0;
      if (b.hasAttribute('data-tour-replay')) return begin('tour', { at: saved, replay: isDone(progressRef.current, 'core') ? true : undefined });
      if (b.closest('#t-welcome')) {
        if (!isDone(progressRef.current, 'core')) return begin('tour', { at: saved });
        const nw = newsRef.current;
        return begin('news', { since: sinceRef.current || weekBefore(nw?.latest) });
      }
      setUi('pick');
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [who, loaded, begin]);

  // A link can start the tour: ?tour (the picker), ?tour=1 or core, ?tour=new. An admin can add &as=rdd to see another job's.
  const startedFromUrl = useRef(false);
  useEffect(() => {
    if (!who || !loaded || !myTour || startedFromUrl.current) return;
    const q = new URLSearchParams(location.search);
    if (!q.has('tour')) return;
    const want = q.get('tour') || '';
    if (want === 'new' && !news) return;
    startedFromUrl.current = true;
    const as = who.can.admin ? tourFromAs(q.get('as')) || undefined : undefined;
    q.delete('tour');
    q.delete('as');
    const rest = q.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
    setAsTour(as);
    if (want === 'new') {
      const since = sinceStamp && newsCount(who, news, sinceStamp) > 0 ? sinceStamp : weekBefore(news?.latest);
      return begin('news', { since });
    }
    if (want === 'pick' || want === '') return setUi('pick');
    begin('tour', { as, at: 0, replay: as ? true : undefined });
  }, [who, loaded, myTour, begin, news, sinceStamp]);

  // Other code (and the tests) can start the tour: document.dispatchEvent(new CustomEvent('favor-tour', { detail: { kind: 'tour' | 'news' | 'pick', as?: 'rdd' } })).
  useEffect(() => {
    const on = (e: Event) => {
      const d = ((e as CustomEvent).detail || {}) as { kind?: string; as?: string };
      if (!who || !loaded || runRef.current) return;
      const as = who.can.admin ? tourFromAs(d.as) || undefined : undefined;
      setAsTour(as);
      if (d.kind === 'pick') return setUi('pick');
      if (d.kind === 'news') return begin('news', { since: sinceRef.current && fresh > 0 ? sinceRef.current : weekBefore(newsRef.current?.latest) });
      begin('tour', { as, at: 0, replay: as || isDone(progressRef.current, 'core') ? true : undefined });
    };
    document.addEventListener('favor-tour', on);
    return () => document.removeEventListener('favor-tour', on);
  }, [who, loaded, begin, fresh]);

  // A tour in progress carries over a full page load.
  const resumed = useRef(false);
  useEffect(() => {
    if (!who || !loaded || !myTour || resumed.current) return;
    const s = sess.get();
    if (!s) { resumed.current = true; return; }
    if (new URLSearchParams(location.search).has('tour')) return;
    if (s.mode === 'news' && !news) return;
    resumed.current = true;
    setAsTour(s.as);
    tried.current = new Set(s.tried || []);
    begin(s.mode, { tour: s.tour, at: s.i, replay: s.replay, as: s.as, since: s.since, ids: s.ids });
  }, [who, loaded, myTour, begin, news]);

  // A quiet page with something waiting: invite. Anything else waits for the next page.
  useEffect(() => {
    if (!who || !loaded || !myTour || run || ui !== 'idle' || asTour) return;
    const t = window.setTimeout(() => {
      if (runRef.current || sess.get()) return;
      // A browser driven by a script (a test) is not a person: it gets an invitation only when it asks for one.
      try {
        if (navigator.webdriver && localStorage.getItem(AUTO_TEST) !== '1') return;
      } catch {
        return;
      }
      if (busy()) return;
      const today = etToday();
      const p = progressRef.current;
      if (!isDone(p, 'core') && mayOpen(p, 'core', today)) {
        setInviteKind('tour');
        return setUi('invite');
      }
      let shown = '';
      try {
        shown = sessionStorage.getItem(INVITED) || '';
      } catch {
        shown = '';
      }
      if (shown === 'news') return;
      if ((isDone(p, 'core') || (p.core?.n || 0) > RETURNS) && who && newsCount(who, news, sinceStamp) > 0) {
        setInviteKind('news');
        setUi('invite');
      }
    }, 1500);
    return () => window.clearTimeout(t);
  }, [who, loaded, myTour, run, ui, path, news, sinceStamp, asTour]);

  useEffect(() => watchTyping(), []);
  useEffect(() => {
    clearTyping();
  }, [path]);

  const dismissInvite = () => {
    if (inviteKind === 'tour') {
      const p = markSkipped(progressRef.current, 'core', etToday());
      const i = progressRef.current.core?.i || 0;
      commit({ ...p, core: { ...p.core, ...(i > 0 ? { i } : {}) } }, true);
    } else {
      try {
        sessionStorage.setItem(INVITED, 'news');
      } catch {
        // nothing to do
      }
    }
    setUi('idle');
  };

  const acceptInvite = () => {
    setUi('idle');
    if (inviteKind === 'news') {
      try {
        sessionStorage.setItem(INVITED, 'news');
      } catch {
        // nothing to do
      }
      return begin('news', { since: sinceStamp });
    }
    begin('tour', { at: progressRef.current.core?.i || 0 });
  };

  /* ------------------------------------------------------------------------ views */

  if (!who || !myTour) return null;
  if (typeof document === 'undefined') return null;

  const tourName = TOUR_LABEL[asTour || myTour];
  const savedAt = corePending ? progress.core?.i || 0 : 0;
  const total = run ? run.steps.length - gone.current.size : 0;
  const ordinal = run ? run.steps.filter((s) => !gone.current.has(s.id)).indexOf(run.steps[run.i]) + 1 : 0;
  const last = run ? run.i >= run.steps.length - 1 : false;
  const label = run ? (run.mode === 'news' ? "What's new" : run.as ? `Tour as ${TOUR_LABEL[run.as]}` : 'Tour') : '';

  const nodes: ReactElement[] = [];

  if (ui === 'invite') {
    const n = tourFor(myTour, who, device).length;
    const days = sinceStamp ? weekday(sinceStamp) : '';
    nodes.push(
      <div key="inv" className="tour-inv" role="dialog" aria-label={inviteKind === 'tour' ? 'Tour of FavorOS' : "What's new"}>
        <span className="tour-inv__mark">{SPARK}</span>
        <div className="tour-inv__t">
          {inviteKind === 'tour' ? (
            <>
              <b>{savedAt > 0 ? 'Pick up your tour' : 'Take a 2 minute tour'}</b>
              <span>{savedAt > 0 ? `Stop ${savedAt + 1} of ${n} is next.` : `${n} stops, set up for ${tourName}.`}</span>
            </>
          ) : (
            <>
              <b>{fresh} {fresh === 1 ? 'change' : 'changes'} since {days}</b>
              <span>A short look at what is new for you.</span>
            </>
          )}
        </div>
        <div className="tour-inv__a">
          <button type="button" className="tour-btn tour-btn--primary" onClick={acceptInvite}>
            {inviteKind === 'tour' ? (savedAt > 0 ? 'Resume' : 'Start') : 'Show me'}
          </button>
          <button type="button" className="tour-btn tour-btn--ghost" onClick={dismissInvite}>
            Later
          </button>
        </div>
      </div>
    );
  }

  if (ui === 'pick') {
    const closePick = () => setUi('idle');
    const since = sinceStamp && fresh > 0 ? sinceStamp : weekBefore(news?.latest);
    const newsN = news ? newsSteps(who, news, since).length : 0;
    const row = (title: string, sub: string, onClick: () => void, disabled = false) => (
      <button type="button" className="tour-pick__row" onClick={onClick} disabled={disabled}>
        <span className="tour-pick__t">
          <b>{title}</b>
          <span>{sub}</span>
        </span>
        <svg viewBox="0 0 24 24" aria-hidden="true" className="tour-pick__chev"><path d="m9 6 6 6-6 6" /></svg>
      </button>
    );
    nodes.push(
      <div key="pick" className="tour-pickwrap" onClick={(e) => { if (e.target === e.currentTarget) closePick(); }}>
        <div className="tour-pick" role="dialog" aria-modal="true" aria-labelledby="tour-pick-h">
          <header>
            <h2 id="tour-pick-h">Tour and what is new</h2>
            <button type="button" className="tour-x" aria-label="Close" onClick={closePick}>{X}</button>
          </header>
          {row(corePending ? (savedAt > 0 ? 'Resume the tour' : 'Take the tour') : 'Replay the tour', `${tourFor(asTour || myTour, who, device).length} stops, set up for ${tourName}.`, () => { setUi('idle'); begin('tour', { as: asTour, at: savedAt, replay: asTour ? true : undefined }); })}
          {row("What's new", fresh > 0 ? `${fresh} ${fresh === 1 ? 'change' : 'changes'} since ${weekday(sinceStamp)}.` : newsN ? 'Nothing since your last visit. See the latest week.' : 'Nothing new right now.', () => { setUi('idle'); begin('news', { since }); }, !newsN)}
          {who.can.admin && (
            <label className="tour-pick__as">
              <span>Show as</span>
              <select value={asTour || ''} onChange={(e) => setAsTour((e.target.value || undefined) as TourId | undefined)}>
                <option value="">Me</option>
                {TOUR_IDS.map((t) => (
                  <option key={t} value={t}>{TOUR_LABEL[t][0].toUpperCase() + TOUR_LABEL[t].slice(1)}</option>
                ))}
              </select>
            </label>
          )}
          <p className="tour-pick__more">
            <a href="/changelog/">Every change, by date</a>
            <a href="/help/">Help docs</a>
          </p>
        </div>
      </div>
    );
  }

  if (ui === 'run' && run) {
    nodes.push(
      <div key="run" className={'tour' + (isTouch() ? ' tour--touch' : '') + (reduced() ? ' tour--calm' : '')}>
        <div className="tour-block" />
        <div className="tour-hole is-none" ref={holeRef} />
        <div className="tour-tap" ref={tapRef} aria-hidden="true" />
        <div
          className={'tour-card' + (card?.busy ? ' is-busy' : '') + (place_ ? ' is-placed' : '')}
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-title"
          tabIndex={-1}
          data-at={place_?.at || ''}
          data-step={run.steps[run.i]?.id}
          data-gone={Array.from(gone.current).join(',')}
          style={place_ ? { transform: `translate(${Math.round(place_.x)}px, ${Math.round(place_.y)}px)` } : undefined}
        >
          {(
            <div className="tour-in" key={card?.key || 'x'}>
              <div className="tour-meta">
                <span>{label} · {Math.max(1, ordinal)} of {Math.max(1, total)}</span>
                <button type="button" className="tour-x" data-tour-close aria-label="Close the tour" onClick={() => close('skip')}>{X}</button>
              </div>
              <h3 id="tour-title">{card?.title}</h3>
              <p>{card?.body}</p>
              <div className="tour-dots" aria-hidden="true">
                {run.steps.map((s, k) => (
                  <i key={s.id} className={(k === run.i ? 'is-on ' : k < run.i ? 'is-past ' : '') + (gone.current.has(s.id) ? 'is-gone' : '')} />
                ))}
              </div>
              <div className="tour-acts">
                {run.i > 0 ? (
                  <button type="button" className="tour-btn tour-btn--ghost" data-tour-back onClick={() => void go(run.i - 1, -1)}>Back</button>
                ) : (
                  <button type="button" className="tour-btn tour-btn--text" data-tour-skip onClick={() => close('skip')}>Skip for now</button>
                )}
                <button type="button" className="tour-btn tour-btn--primary" data-tour-next onClick={() => void go(run.i + 1, 1)}>{last ? 'Finish' : 'Next'}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (ui === 'done' && finished) {
    nodes.push(<DoneCard key="done" mode={finished.mode} replay={!!run?.replay} fresh={fresh} asName={run?.as ? TOUR_LABEL[run.as] : ''} onClose={() => close('done')} />);
  }

  void comesBack;
  void dayWord;
  return createPortal(<>{nodes}</>, document.body);
}

const weekBefore = (latest?: string): string => {
  if (!latest) return '';
  const d = new Date(`${latest.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return `${d.toISOString().slice(0, 10)}T00:00`;
};

/** The last card: what just finished and where to find it again. A tour also asks if it helped. */
function DoneCard({ mode, replay, fresh, asName, onClose }: { mode: Mode; replay: boolean; fresh: number; asName: string; onClose: () => void }) {
  const [rated, setRated] = useState<'' | 'helpful' | 'not-helpful' | 'sent'>('');
  const [why, setWhy] = useState('');
  const send = (rating: string, comment = '') =>
    fetch('/api/feedback', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' },
      body: JSON.stringify({ source: 'tour', rating, comment, page: `${location.pathname} (tour${asName ? `, as ${asName}` : ''})` }),
    }).catch(() => undefined);
  const ask = mode === 'tour' && !replay && !asName;
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>('[data-tour-done]')?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="tour tour--done">
      <div className="tour-block" />
      <div className="tour-card is-placed is-final" ref={rootRef} role="dialog" aria-modal="true" aria-labelledby="tour-title" data-step="done">
        <div className="tour-in">
          <div className="tour-meta">
            <span>{mode === 'news' ? "What's new" : 'Tour'} · done</span>
            <button type="button" className="tour-x" aria-label="Close" onClick={onClose}>{X}</button>
          </div>
          <h3 id="tour-title">{mode === 'news' ? 'You are caught up.' : 'That is the tour.'}</h3>
          <p>{mode === 'news' ? "What's new, under Help, lists every change by date." : "You can replay it or open What's new from Help whenever you want."}</p>
          {ask && (
            <div className="tour-rate">
              {rated === '' && (
                <>
                  <span>Was this tour useful?</span>
                  <button type="button" className="tour-btn tour-btn--ghost" onClick={() => { setRated('helpful'); void send('helpful'); }}>Yes</button>
                  <button type="button" className="tour-btn tour-btn--ghost" onClick={() => setRated('not-helpful')}>Not really</button>
                </>
              )}
              {rated === 'helpful' && <span>Thanks. Glad it helped.</span>}
              {rated === 'sent' && <span>Thanks. Will reads every note.</span>}
              {rated === 'not-helpful' && (
                <form
                  className="tour-why"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send('not-helpful', why.trim());
                    setRated('sent');
                  }}
                >
                  <label htmlFor="tour-why">What would have helped?</label>
                  <textarea id="tour-why" rows={2} maxLength={600} value={why} onChange={(e) => setWhy(e.target.value)} />
                  <button type="submit" className="tour-btn tour-btn--primary">Send</button>
                </form>
              )}
            </div>
          )}
          <div className="tour-acts">
            {mode === 'tour' && fresh > 0 ? <a className="tour-link" href="/changelog/">What is new</a> : <a className="tour-link" href="/changelog/">Every change</a>}
            <button type="button" className="tour-btn tour-btn--primary" data-tour-done onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

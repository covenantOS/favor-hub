// What Today's parts share: the rows a person just cleared, whose partners the briefing shows, and the one ranked list that the status line,
// the Needs you heading and the list itself all read, so the three counts can never disagree.
import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useQuery, useSuspenseQueries } from '@tanstack/react-query';
import { briefQ, giftsQ, homeQ, inboxQ, todayQ, waitingQ } from './queries';
import { buildItems, type Item, type Thank } from './rank';
import { useNow } from './ui';

interface Shared {
  gone: ReadonlySet<string>;
  markGone: (id: string) => void;
  unmarkGone: (id: string) => void;
  owner: string;
  setOwner: (v: string) => void;
}
const Ctx = createContext<Shared | null>(null);

export function TodayProvider({ children }: { children: ReactNode }) {
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const [owner, setOwnerState] = useState('');
  // The saved choice is read after mount; the briefing asks again for that person's partners without blanking the page.
  useEffect(() => {
    try {
      const v = localStorage.getItem('favor.hub.brief.owner') || '';
      if (v) startTransition(() => setOwnerState(v));
    } catch {
      // storage refused
    }
  }, []);
  const markGone = useCallback((id: string) => setGone((s) => new Set(s).add(id)), []);
  const unmarkGone = useCallback((id: string) => setGone((s) => { const n = new Set(s); n.delete(id); return n; }), []);
  const setOwner = useCallback((v: string) => {
    try {
      localStorage.setItem('favor.hub.brief.owner', v);
    } catch {
      // storage refused
    }
    startTransition(() => setOwnerState(v));
  }, []);
  const value = useMemo(() => ({ gone, markGone, unmarkGone, owner, setOwner }), [gone, markGone, unmarkGone, owner, setOwner]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShared(): Shared {
  const v = useContext(Ctx);
  if (!v) throw new Error('TodayProvider is missing');
  return v;
}

const never = () => () => undefined;
/** False on the server and during hydration, true after: late answers join only then, so the server page and the first browser render agree. */
export function useHydrated(): boolean {
  return useSyncExternalStore(never, () => true, () => false);
}

/**
 * The five reads the ranked list needs at once (suspends until they answer), then the parts that merge in without holding the list: the
 * gift desk (the slowest read, and empty for most people) and the mail parts. Classic Today drew its list after its main sources or 1.5 s
 * and let the gifts in when they answered; this does the same, so the server page carries the list as soon as the main sources are in.
 */
export function useNeeds() {
  const { gone, owner } = useShared();
  const now = useNow();
  const hydrated = useHydrated();
  const [t, ib, wt, h, b] = useSuspenseQueries({ queries: [todayQ, inboxQ('fast'), waitingQ('fast'), homeQ, briefQ(owner)] });
  const gifts = useQuery(giftsQ).data;
  const ibMail = useQuery(inboxQ('mail')).data;
  const wtMail = useQuery(waitingQ('mail')).data;
  const g = hydrated && gifts ? gifts : null;
  const today = t.data;
  const brief = b.data ? b.data.briefing || null : null;
  const built = useMemo(
    () => buildItems({ today, inbox: [...(ib.data.items || []), ...((ibMail && ibMail.items) || [])], waiting: [...(wt.data.items || []), ...((wtMail && wtMail.items) || [])], brief, gifts: g, home: h.data, gone, now }),
    [today, ib.data, ibMail, wt.data, wtMail, brief, g, h.data, gone, now],
  );
  return { ...built, now, today, home: h.data, brief, briefRaw: b.data };
}
export type Needs = { items: Item[]; thanks: Thank[] };

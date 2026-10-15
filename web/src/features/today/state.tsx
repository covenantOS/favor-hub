// What Today's parts share: the rows a person just cleared, whose partners the briefing shows, and the one ranked list that the status line,
// the Needs you heading and the list itself all read, so the three counts can never disagree.
import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
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

/** The six reads the ranked list needs at once (suspends until they answer), then the mail parts, which merge in when Gmail answers. */
export function useNeeds() {
  const { gone, owner } = useShared();
  const now = useNow();
  const [t, ib, wt, g, h, b] = useSuspenseQueries({ queries: [todayQ, inboxQ('fast'), waitingQ('fast'), giftsQ, homeQ, briefQ(owner)] });
  const ibMail = useQuery(inboxQ('mail')).data;
  const wtMail = useQuery(waitingQ('mail')).data;
  const today = t.data;
  const brief = b.data ? b.data.briefing || null : null;
  const built = useMemo(
    () => buildItems({ today, inbox: [...(ib.data.items || []), ...((ibMail && ibMail.items) || [])], waiting: [...(wt.data.items || []), ...((wtMail && wtMail.items) || [])], brief, gifts: g.data, home: h.data, gone, now }),
    [today, ib.data, ibMail, wt.data, wtMail, brief, g.data, h.data, gone, now],
  );
  return { ...built, now, today, home: h.data, brief, briefRaw: b.data };
}
export type Needs = { items: Item[]; thanks: Thank[] };

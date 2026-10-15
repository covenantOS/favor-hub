// Gift entry: photograph the checks and reply slips, review each gift beside its photo, approve, and send the batch to Blackbaud. Served by
// the FavorOS web app. ?d=<deposit id> opens a deposit and ?start=1 puts the cursor in the tape total. The reads start in the loader and
// are drawn with useSuspenseQuery inside Suspense (the classic page's 320 px skeleton is the fallback).
import { createFileRoute } from '@tanstack/react-router';
import { GiftEntryPage } from '../../features/gift-entry/GiftEntryPage';
import { depositQuery, indexQuery, monthQuery, needsQuery, overviewQuery, summaryQuery } from '../../features/gift-entry/data';

interface GeSearch {
  d?: string;
  start?: boolean;
}

export const Route = createFileRoute('/gift-entry/')({
  staticData: { nav: 'gift-entry', title: 'Gift entry', layout: 'full' },
  validateSearch: (raw: Record<string, unknown>): GeSearch => {
    const out: GeSearch = {};
    const d = typeof raw.d === 'number' ? String(raw.d) : raw.d;
    if (typeof d === 'string' && d.trim()) out.d = d.trim().slice(0, 80);
    if (raw.start === '1' || raw.start === 1 || raw.start === true || raw.start === 'true') out.start = true;
    return out;
  },
  loaderDeps: ({ search }) => ({ d: search.d }),
  loader: ({ context, deps }) => {
    const qc = context.queryClient;
    void qc.prefetchQuery(indexQuery);
    if (deps.d) {
      void qc.prefetchQuery(depositQuery(deps.d));
      return;
    }
    void qc.prefetchQuery(summaryQuery(''));
    void qc.prefetchQuery(needsQuery);
    void qc.prefetchQuery(monthQuery);
    void qc.prefetchQuery(overviewQuery);
  },
  component: GiftEntryRoute,
});

function GiftEntryRoute() {
  const s = Route.useSearch();
  return <GiftEntryPage d={s.d} start={!!s.start} />;
}

// Reporting > Highlights (/highlights/): goal pacing to year end, the week in plain language for each team, and My dashboard (?tab=mine).
// The page itself is in features/highlights.
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { HighlightsPage, type Tab } from '../../features/highlights/HighlightsPage';
import { pinsQuery, weekQuery } from '../../features/highlights/api';

export const Route = createFileRoute('/highlights/')({
  validateSearch: (raw: Record<string, unknown>): { tab?: 'mine' } => (raw.tab === 'mine' ? { tab: 'mine' } : {}),
  staticData: { nav: 'reporting', title: 'Highlights', layout: 'wide' },
  loaderDeps: ({ search }) => ({ tab: search.tab }),
  loader: ({ context, deps }) => {
    // The pin count shows on its tab before it is opened, so the pins start at once. The week is read when its tab is the one showing; neither holds the page.
    void context.queryClient.prefetchQuery(pinsQuery);
    if (deps.tab !== 'mine') void context.queryClient.prefetchQuery(weekQuery);
  },
  component: HighlightsRoute,
});

function HighlightsRoute() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: '/highlights/' });
  const now: Tab = tab === 'mine' ? 'mine' : 'week';
  return <HighlightsPage tab={now} onTab={(t) => void navigate({ search: t === 'mine' ? { tab: 'mine' } : {}, replace: true, resetScroll: false })} />;
}

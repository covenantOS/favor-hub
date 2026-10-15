// Moves: the major-partner pipeline board and the relationship map in its side panel.
import { createFileRoute } from '@tanstack/react-router';
import { Moves, type MovesSearch } from '../../features/moves/Moves';
import { boardQuery } from '../../features/moves/queries';

export const Route = createFileRoute('/moves/')({
  validateSearch: (raw: Record<string, unknown>): MovesSearch => {
    const out: MovesSearch = {};
    if (typeof raw.cid === 'string' && /^\d{1,12}$/.test(raw.cid)) out.cid = raw.cid;
    else if (typeof raw.cid === 'number') out.cid = String(raw.cid);
    if (raw.view === 'list') out.view = 'list';
    if (typeof raw.owner === 'string' && /^\d{1,12}$/.test(raw.owner)) out.owner = raw.owner;
    if (typeof raw.q === 'string' && raw.q.trim()) out.q = raw.q.slice(0, 100);
    if (typeof raw.sort === 'string' && ['due', 'contact', 'largest', 'name'].includes(raw.sort)) out.sort = raw.sort;
    return out;
  },
  staticData: { nav: 'partners-moves', title: 'Moves', layout: 'wide' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(boardQuery('', '', 'asked', 12));
  },
  component: MovesRoute,
});

function MovesRoute() {
  return <Moves search={Route.useSearch()} />;
}

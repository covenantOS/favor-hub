// What's new: every change to FavorOS, newest first, with pictures, search and the area filter. Served by the FavorOS web app.
import { createFileRoute } from '@tanstack/react-router';
import { Changelog } from '../../features/changelog/Changelog';

export const Route = createFileRoute('/changelog/')({
  staticData: { nav: 'changelog', title: "What's new", layout: 'page' },
  validateSearch: (s: Record<string, unknown>) => ({ q: typeof s.q === 'string' ? s.q : undefined, area: typeof s.area === 'string' ? s.area : undefined }),
  component: ChangelogRoute,
});

function ChangelogRoute() {
  const { q, area } = Route.useSearch();
  return <Changelog initialQ={q ?? ''} initialArea={area ?? ''} />;
}

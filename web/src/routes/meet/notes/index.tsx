// Meetings > Notes for one meeting: ?m=<id>. Port of src/pages/meet/notes.astro.
import { createFileRoute } from '@tanstack/react-router';
import { NotesPage } from '../../../features/meet/notes/NotesPage';
import { notesQuery } from '../../../features/meet/queries';

export const Route = createFileRoute('/meet/notes/')({
  staticData: { nav: 'meet-notes', title: 'Meeting notes', layout: 'page' },
  validateSearch: (s: Record<string, unknown>) => ({ m: typeof s.m === 'string' ? s.m : undefined }),
  loaderDeps: ({ search }) => ({ m: search.m }),
  loader: ({ context, deps }) => {
    if (deps.m) void context.queryClient.prefetchQuery(notesQuery(deps.m));
  },
  component: NotesRoute,
});

function NotesRoute() {
  const { m } = Route.useSearch();
  return <NotesPage m={m ?? ''} />;
}

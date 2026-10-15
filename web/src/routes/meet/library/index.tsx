// Meetings > Notes: every meeting the person was invited to, with its notes. Port of src/pages/meet/library.astro.
import { createFileRoute } from '@tanstack/react-router';
import { LibraryPage } from '../../../features/meet/library/LibraryPage';
import { libraryActions, libraryDirectory, libraryList } from '../../../features/meet/queries';

export const Route = createFileRoute('/meet/library/')({
  staticData: { nav: 'meet-notes', title: 'Meeting notes', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(libraryList);
    void context.queryClient.prefetchQuery(libraryActions);
    void context.queryClient.prefetchQuery(libraryDirectory);
  },
  component: LibraryPage,
});

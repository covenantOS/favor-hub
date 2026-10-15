// Clips > My clips (/clips/): every clip you recorded. Served by the FavorOS web app.
import { createFileRoute } from '@tanstack/react-router';
import { LibraryPage } from '../../features/clips/LibraryPage';
import { clipsQuery } from '../../features/clips/queries';

export const Route = createFileRoute('/clips/')({
  staticData: { nav: 'clips', title: 'Clips', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(clipsQuery('mine'));
  },
  component: () => <LibraryPage scope="mine" />,
});

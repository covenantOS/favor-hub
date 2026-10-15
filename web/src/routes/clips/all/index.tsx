// Clips > All clips (/clips/all/): every person's clips and what each person's storage looks like. Admins only (the data route refuses everyone else).
import { createFileRoute } from '@tanstack/react-router';
import { LibraryPage } from '../../../features/clips/LibraryPage';
import { clipsQuery } from '../../../features/clips/queries';

export const Route = createFileRoute('/clips/all/')({
  staticData: { nav: 'clips', title: 'All clips', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(clipsQuery('all'));
  },
  component: () => <LibraryPage scope="all" />,
});

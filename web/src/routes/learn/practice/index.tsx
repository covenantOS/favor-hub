// Learn > Practice: a pretend partner record for practicing gift entry and logging a call. Nothing reaches Blackbaud.
import { createFileRoute } from '@tanstack/react-router';
import { PracticePage } from '../../../features/learn/PracticePage';
import { practiceQuery } from '../../../features/learn/queries';

export const Route = createFileRoute('/learn/practice/')({
  staticData: { nav: 'practice', title: 'Practice', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(practiceQuery);
  },
  component: PracticePage,
});

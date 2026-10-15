// Learn > My learning: courses and paths assigned to you, and where you left off. Served by the FavorOS web app.
import { createFileRoute } from '@tanstack/react-router';
import { HomePage } from '../../features/learn/HomePage';
import { homeQuery } from '../../features/learn/queries';

export const Route = createFileRoute('/learn/')({
  staticData: { nav: 'learn', title: 'My learning', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(homeQuery);
  },
  component: HomePage,
});

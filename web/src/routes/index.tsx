// Today. Reached when an admin lists "/" in the hub setting web.routes (scripts/web-routes.mjs set / admin).
import { createFileRoute } from '@tanstack/react-router';
import { TodayPage } from '../features/today/TodayPage';
import { firstReads } from '../features/today/queries';

export const Route = createFileRoute('/')({
  staticData: { nav: 'home', title: 'Today', layout: 'page' },
  // Started at once and never awaited, so the frame streams first and each card fills as its read answers.
  loader: ({ context }) => {
    for (const q of firstReads) void context.queryClient.prefetchQuery(q);
  },
  component: TodayPage,
});

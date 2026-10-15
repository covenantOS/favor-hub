// Learn > Course: ?c=slug, and &l=lessonId for the lesson player. A course address without ?c= goes to the catalog.
import { createFileRoute, redirect } from '@tanstack/react-router';
import { CoursePage } from '../../../features/learn/CoursePage';
import { slugOf } from '../../../lib/route-search';
import { courseQuery } from '../../../features/learn/queries';

export const Route = createFileRoute('/learn/c/')({
  staticData: { nav: 'learn-course', title: 'Course', layout: 'page' },
  validateSearch: (s: Record<string, unknown>) => s,
  beforeLoad: ({ search }) => {
    if (!slugOf(search.c)) throw redirect({ to: '/learn/catalog/', replace: true });
  },
  loaderDeps: ({ search }) => ({ c: slugOf(search.c) }),
  loader: ({ context, deps }) => {
    if (deps.c) void context.queryClient.prefetchQuery(courseQuery(deps.c));
  },
  component: CoursePage,
});

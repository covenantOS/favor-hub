// Learn > Certificate: ?c=course, &email= for a supervisor, HR or an admin. A certificate address without ?c= goes to My learning.
import { createFileRoute, redirect } from '@tanstack/react-router';
import { CertificatePage } from '../../../features/learn/CertificatePage';
import { slugOf } from '../../../features/learn/logic';
import { certQuery } from '../../../features/learn/queries';

export const Route = createFileRoute('/learn/certificate/')({
  staticData: { nav: 'learn-cert', title: 'Certificate', layout: 'page' },
  validateSearch: (s: Record<string, unknown>) => s,
  beforeLoad: ({ search }) => {
    if (!slugOf(search.c)) throw redirect({ to: '/learn/', replace: true });
  },
  loaderDeps: ({ search }) => ({ c: slugOf(search.c), email: slugOf(search.email) }),
  loader: ({ context, deps }) => {
    if (deps.c) void context.queryClient.prefetchQuery(certQuery(deps.c, deps.email));
  },
  component: CertificatePage,
});

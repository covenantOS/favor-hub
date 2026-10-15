// Projects: the home (My tasks, All projects, Team workload and the request tabs). Served by the FavorOS web app.
import { createFileRoute } from '@tanstack/react-router';
import { HomeError, HomePage } from '../../features/projects/home/HomePage';
import { asanaMeQuery, mineTasksQuery, projectsQuery } from '../../features/projects/lib/queries';
import { staffQuery } from '../../features/projects/lib/staff';
import { prefetchIntake } from '../../features/projects/intake/queries';

export const Route = createFileRoute('/projects/')({
  staticData: { nav: 'projects', title: 'Projects', layout: 'full' },
  validateSearch: (s: Record<string, unknown>) => s,
  head: () => ({ links: [{ rel: 'stylesheet', href: '/css/projects-links.css?v=1' }] }),
  // The reads start at once and are not waited for, so the frame streams first and the page fills in as each answer arrives.
  loader: ({ context }) => {
    const qc = context.queryClient;
    void qc.prefetchQuery(staffQuery);
    void qc.prefetchQuery(asanaMeQuery);
    void qc.prefetchQuery(projectsQuery);
    void qc.prefetchQuery(mineTasksQuery(false));
    prefetchIntake(qc);
  },
  component: HomePage,
  errorComponent: ({ error }) => <HomeError message={(error as Error).message || 'Something went wrong. Try again.'} />,
});

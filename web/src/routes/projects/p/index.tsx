// Projects: one project, ?p=KEY&view=list|board|calendar|timeline|workload&t=CODE. Served by the FavorOS web app.
import { createFileRoute } from '@tanstack/react-router';
import '../../../features/projects/css';
import { ProjectNotFound, ProjectPage } from '../../../features/projects/project/ProjectPage';
import { asanaMeQuery, projectQuery, projectTasksQuery } from '../../../features/projects/lib/queries';
import { staffQuery } from '../../../features/projects/lib/staff';

const keyOf = (v: unknown) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');

export const Route = createFileRoute('/projects/p/')({
  staticData: { nav: 'projects', title: 'Project', layout: 'full' },
  validateSearch: (s: Record<string, unknown>) => s,
  loaderDeps: ({ search }) => ({ p: keyOf(search.p), done: String(search.done ?? '') === '1' || String(search.status ?? '') === 'done' }),
  head: () => ({ links: [{ rel: 'stylesheet', href: '/css/projects-links.css?v=1' }] }),
  loader: ({ context, deps }) => {
    const qc = context.queryClient;
    void qc.prefetchQuery(staffQuery);
    void qc.prefetchQuery(asanaMeQuery);
    if (deps.p) {
      void qc.prefetchQuery(projectQuery(deps.p));
      void qc.prefetchQuery(projectTasksQuery(deps.p, deps.done));
    }
  },
  component: ProjectPage,
  errorComponent: ({ error }) => {
    const e = error as { status?: number; message?: string };
    return <ProjectNotFound status={e.status || 0} message={e.message || 'Something went wrong. Try again.'} />;
  },
});

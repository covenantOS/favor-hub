// Learn > Manage > Edit course (/learn/admin/course/?c=): details, lessons in order, and adding lessons.
import { createFileRoute } from '@tanstack/react-router';
import { EditorPage } from '../../../../features/learn-admin/EditorPage';
import { courseQuery } from '../../../../features/learn-admin/queries';

export const Route = createFileRoute('/learn/admin/course/')({
  validateSearch: (raw: Record<string, unknown>): { c?: string } => (typeof raw.c === 'string' && raw.c ? { c: raw.c } : {}),
  loaderDeps: ({ search }) => ({ c: search.c || '' }),
  staticData: { nav: 'learn-admin', title: 'Edit course', layout: 'page' },
  loader: ({ context, deps }) => {
    if (deps.c) void context.queryClient.prefetchQuery(courseQuery(deps.c));
  },
  component: Page,
});

function Page() {
  return <EditorPage id={Route.useSearch().c || ''} />;
}

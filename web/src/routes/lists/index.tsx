// Reporting > Lists (/lists/): build a list of partners or gifts from menus, save it, download it, open it in Google Sheets. ?l=<id> opens a
// saved list and ?spec=<criteria in base64url> opens a standard report's row. The page itself is in features/lists.
import { createFileRoute } from '@tanstack/react-router';
import { ListsError, ListsPage, type ListsSearch } from '../../features/lists/ListsPage';
import { prefetchLists } from '../../features/lists/api';

export const Route = createFileRoute('/lists/')({
  validateSearch: (raw: Record<string, unknown>): ListsSearch => ({
    ...(typeof raw.l === 'string' && raw.l ? { l: raw.l } : {}),
    ...(typeof raw.spec === 'string' && raw.spec ? { spec: raw.spec } : {}),
  }),
  staticData: { nav: 'lists', title: 'Lists', layout: 'full' },
  loader: ({ context }) => prefetchLists(context.queryClient),
  component: ListsRoute,
  errorComponent: ({ error }) => <ListsError message={(error as Error).message} />,
});

function ListsRoute() {
  return <ListsPage search={Route.useSearch()} />;
}

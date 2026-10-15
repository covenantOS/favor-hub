// Gifts > Giving statements (/statements/): one partner's statement on request and the January year-end print files. ?tab=year, files or wording
// opens that tab. The page itself is in features/statements.
import { createFileRoute } from '@tanstack/react-router';
import { StatementsPage } from '../../features/statements/StatementsPage';
import { prefetchStatements } from '../../features/statements/api';
import { today } from '../../features/receipts/format';

export const Route = createFileRoute('/statements/')({
  validateSearch: (raw: Record<string, unknown>): { tab?: string } => (typeof raw.tab === 'string' && ['one', 'year', 'files', 'wording'].includes(raw.tab) ? { tab: raw.tab } : {}),
  loaderDeps: ({ search }) => ({ tab: search.tab || 'one' }),
  staticData: { nav: 'statements', title: 'Giving statements', layout: 'page' },
  loader: ({ context, deps }) => prefetchStatements(context.queryClient, deps.tab, today()),
  component: StatementsRoute,
});

function StatementsRoute() {
  const { tab } = Route.useSearch();
  return <StatementsPage tab={tab || 'one'} />;
}

// Reporting > Credit and assignments (/lists/credit/): proposed credit and assignment changes, a look-up of one gift or partner, approval.
// The page itself is in features/lists.
import { createFileRoute } from '@tanstack/react-router';
import { CreditError, CreditPage } from '../../../features/lists/CreditPage';
import { prefetchCredit } from '../../../features/lists/api';

export const Route = createFileRoute('/lists/credit/')({
  staticData: { nav: 'list-credit', title: 'Credit and assignments', layout: 'full' },
  loader: ({ context }) => prefetchCredit(context.queryClient),
  component: CreditPage,
  errorComponent: ({ error }) => <CreditError message={(error as Error).message} />,
});

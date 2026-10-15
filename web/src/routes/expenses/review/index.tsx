// The approver's page, from the emailed link (?token=) or the expense log (?id=). The middleware keeps /expenses/review/ open to a
// visitor with no sign-in (the token is the key) and hands it to this page only when the person is signed in.
import { createFileRoute } from '@tanstack/react-router';
import { ReviewPage } from '../../../features/expenses/ReviewPage';
import { reviewQuery } from '../../../features/expenses/queries';
import { reviewTarget } from '../../../features/expenses/logic';

export const Route = createFileRoute('/expenses/review/')({
  staticData: { nav: 'expenses', title: 'Review and sign', layout: 'page' },
  validateSearch: (s: Record<string, unknown>) => s,
  loaderDeps: ({ search }) => reviewTarget(search),
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(reviewQuery(deps.token, deps.id));
  },
  component: ReviewPage,
});

// Gifts > Receipts (/receipts/): the gifts Blackbaud has not receipted yet, the print file for the receipt paper and marking the gifts thanked.
// The reads run through Suspense on the server and in the browser; the page itself is in features/receipts.
import { createFileRoute } from '@tanstack/react-router';
import { ReceiptsPage } from '../../features/receipts/ReceiptsPage';
import { prefetchReceipts } from '../../features/receipts/api';

export const Route = createFileRoute('/receipts/')({
  staticData: { nav: 'receipts', title: 'Receipts', layout: 'page' },
  loader: ({ context }) => prefetchReceipts(context.queryClient),
  component: ReceiptsPage,
});

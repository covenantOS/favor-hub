// Partners > Foundations (/foundations/): check a foundation before a call, the prospects, the clean-up list and what went to Blackbaud.
import { createFileRoute } from '@tanstack/react-router';
import { FoundationsPage, prefetchFoundations } from '../../features/partners/foundations/FoundationsPage';

export const Route = createFileRoute('/foundations/')({
  staticData: { nav: 'foundations', title: 'Foundation prospects', layout: 'full' },
  loader: ({ context }) => prefetchFoundations(context.queryClient),
  component: FoundationsPage,
});

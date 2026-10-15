// Text Favor Brain (/brain/text/): register the mobile number you will text Favor Brain from. The page is in features/admin-a.
import { createFileRoute } from '@tanstack/react-router';
import { BrainTextPage } from '../../../features/admin-a/BrainTextPage';
import { textStatusQuery } from '../../../features/admin-a/brain-text.api';

export const Route = createFileRoute('/brain/text/')({
  staticData: { nav: 'brain', title: 'Text Favor Brain', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(textStatusQuery);
  },
  component: BrainTextPage,
});

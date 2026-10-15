// Gifts > First-gift letters (/gifts/first-gifts/), served by the FavorOS web app. The thank-you letters to partners whose first gift came from an
// acquisition mailing: the list, the print file, marking the gifts acknowledged in Blackbaud, the past print files and the letter wording.
import { createFileRoute } from '@tanstack/react-router';
import { FirstGiftsPage } from '../../../features/first-gifts/FirstGiftsPage';
import { prefetchFirstGifts } from '../../../features/first-gifts/api';

export const Route = createFileRoute('/gifts/first-gifts/')({
  staticData: { nav: 'first-gifts', title: 'First-gift letters', layout: 'page' },
  loader: ({ context }) => prefetchFirstGifts(context.queryClient),
  component: FirstGiftsPage,
});

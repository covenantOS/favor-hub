// Help home: search, the tour, topics and "For your work". Served by the FavorOS web app. The training videos stay on Astro (/help/videos/).
import { createFileRoute } from '@tanstack/react-router';
import { HelpHome } from '../../features/help/HelpHome';

export const Route = createFileRoute('/help/')({
  staticData: { nav: 'docs', title: 'Help docs', layout: 'page' },
  component: HelpHome,
});

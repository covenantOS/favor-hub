// Admin > Adoption (/admin/adoption/): who uses FavorOS, which areas they open, and what they do there. Admins only. The page is in features/admin-a.
import { createFileRoute } from '@tanstack/react-router';
import { AdoptionPage } from '../../../features/admin-a/AdoptionPage';
import { adoptionQuery } from '../../../features/admin-a/adoption.api';

export const Route = createFileRoute('/admin/adoption/')({
  staticData: { nav: 'admin-adoption', title: 'Adoption', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(adoptionQuery);
  },
  component: AdoptionPage,
});

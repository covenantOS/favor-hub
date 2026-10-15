// Admin > Tours (/admin/tours/): who finished the tour of FavorOS and each release, and Send again. Admins only. The page is in features/admin-a.
import { createFileRoute } from '@tanstack/react-router';
import { ToursPage } from '../../../features/admin-a/ToursPage';
import { toursQuery } from '../../../features/admin-a/tours.api';

export const Route = createFileRoute('/admin/tours/')({
  staticData: { nav: 'admin-tours', title: 'Tours', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(toursQuery);
  },
  component: ToursPage,
});

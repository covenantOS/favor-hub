// Learn > Catalog: every course and learning path.
import { createFileRoute } from '@tanstack/react-router';
import { CatalogPage } from '../../../features/learn/CatalogPage';
import { catalogQuery } from '../../../features/learn/queries';

export const Route = createFileRoute('/learn/catalog/')({
  staticData: { nav: 'learn-catalog', title: 'Catalog', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(catalogQuery);
  },
  component: CatalogPage,
});

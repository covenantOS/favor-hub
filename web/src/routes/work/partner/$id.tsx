// A partner's page (/work/partner/<id>): the record with Overview, Gifts, Actions, Relationships, Contact, Codes and Record.
import { createFileRoute } from '@tanstack/react-router';
import { PartnerPage, prefetchPartner } from '../../../features/partners/record/PartnerPage';
import { validatePartnerSearch, type PartnerSearch } from '../../../features/partners/record/search';

export const Route = createFileRoute('/work/partner/$id')({
  validateSearch: (raw: Record<string, unknown>): PartnerSearch => validatePartnerSearch(raw),
  loaderDeps: ({ search }) => ({ as: search.as }),
  staticData: { nav: 'work', title: 'Partner', layout: 'full' },
  loader: ({ context, params, deps }) => prefetchPartner(context.queryClient, params.id, deps.as || ''),
  component: PartnerRoute,
});

function PartnerRoute() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  return <PartnerPage id={id} search={search} />;
}

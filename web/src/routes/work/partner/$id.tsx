// A partner's page (/work/partner/<id>): the record with Overview, Gifts, Actions, Relationships, Contact, Codes and Record.
import { createFileRoute } from '@tanstack/react-router';
import { PartnerPage, prefetchPartner } from '../../../features/partners/record/PartnerPage';

export const Route = createFileRoute('/work/partner/$id')({
  staticData: { nav: 'work', title: 'Partner', layout: 'full' },
  loader: ({ context, params }) => prefetchPartner(context.queryClient, params.id),
  component: PartnerRoute,
});

function PartnerRoute() {
  const { id } = Route.useParams();
  return <PartnerPage id={id} />;
}

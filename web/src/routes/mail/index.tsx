// Mail (/mail/): your Gmail inside FavorOS, read, reply, archive, labels, drafts and search. The page is app/src/features/mail; this
// file only names the route. Mail has no server reads: it asks /api/mail from the browser, as app2 does.
import { createFileRoute } from '@tanstack/react-router';
import { MailRoute } from '../../features/mail-page/MailRoute';

export const Route = createFileRoute('/mail/')({
  staticData: { nav: 'mail', title: 'Mail', layout: 'bare' },
  component: MailRoute,
});

// Meetings > Book: pick the people, find a time, set the details, book it. ?edit=<id> moves one meeting, ?follow=<id> books the follow-up,
// ?template=<id> starts from a template, ?google=meetings is the way back from the Google consent screen. Port of src/pages/meet/book.astro.
import { createFileRoute } from '@tanstack/react-router';
import { BookPage } from '../../../features/meet/book/BookPage';
import { bookDirQuery, bookEditQuery, bookMyRecQuery, bookStatusQuery, bookTemplatesQuery } from '../../../features/meet/queries';

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

export const Route = createFileRoute('/meet/book/')({
  staticData: { nav: 'meet-book', title: 'Book a meeting', layout: 'page' },
  validateSearch: (s: Record<string, unknown>) => ({ edit: str(s.edit), follow: str(s.follow), template: str(s.template), google: str(s.google) }),
  loaderDeps: ({ search }) => ({ edit: search.edit, follow: search.follow }),
  loader: ({ context, deps }) => {
    const qc = context.queryClient;
    void qc.prefetchQuery(bookDirQuery);
    void qc.prefetchQuery(bookStatusQuery);
    void qc.prefetchQuery(bookMyRecQuery);
    void qc.prefetchQuery(bookTemplatesQuery);
    void qc.prefetchQuery(bookEditQuery(deps.edit || deps.follow || ''));
  },
  component: BookRoute,
});

function BookRoute() {
  const s = Route.useSearch();
  return <BookPage edit={s.edit ?? ''} follow={s.follow ?? ''} template={s.template ?? ''} google={s.google === 'meetings'} />;
}

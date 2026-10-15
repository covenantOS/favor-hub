// Feedback: the notes a person sent and the answers; for the hub admin, every note with the buttons to mark and answer it. Served by the FavorOS web app.
import { createFileRoute } from '@tanstack/react-router';
import { FeedbackPage } from '../../features/feedback/FeedbackPage';

export const Route = createFileRoute('/feedback/')({
  staticData: { nav: 'feedback', title: 'Feedback', layout: 'page' },
  validateSearch: (s: Record<string, unknown>) => ({ item: typeof s.item === 'string' || typeof s.item === 'number' ? String(s.item) : undefined }),
  component: FeedbackRoute,
});

function FeedbackRoute() {
  const { item } = Route.useSearch();
  return <FeedbackPage item={item ?? ''} />;
}

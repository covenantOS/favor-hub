// Clips > Edit (/clips/edit/?id=): the editor for one clip. Admins only (the API says who may edit). The page itself is in features/clips.
import { createFileRoute } from '@tanstack/react-router';
import { EditorPage } from '../../../features/clips/EditorPage';

export const Route = createFileRoute('/clips/edit/')({
  validateSearch: (raw: Record<string, unknown>): { id?: string } => (typeof raw.id === 'string' && raw.id ? { id: raw.id } : {}),
  staticData: { nav: 'clips', title: 'Edit clip', layout: 'full' },
  component: Page,
});

function Page() {
  const { id } = Route.useSearch();
  return <EditorPage key={id || ''} id={id || ''} />;
}

// A plain page that proves the web app is live behind the middleware: the frame, the person and the build. Admins and testers only.
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { navQuery } from '../../lib/queries';

export const Route = createFileRoute('/web-check/')({
  staticData: { nav: 'help', title: 'Web app check', layout: 'page' },
  component: WebCheck,
});

function WebCheck() {
  const nav = useQuery(navQuery);
  return (
    <section className="h-card" style={{ padding: 24 }}>
      <h1>The FavorOS web app is running</h1>
      <p>Signed in as {nav.data?.user?.email || 'someone'}. Build {__BUILD__}.</p>
    </section>
  );
}

import { createFileRoute } from '@tanstack/react-router';
import { LegacyPage } from '@/legacy/LegacyPage';
import { MailPage } from '@/features/mail/MailPage';

// Native Mail is the page. The classic page stays reachable at /mail/?classic=1 (served by the middleware) and, inside the frame, at ?legacy=1.
const Mail = () => (new URLSearchParams(location.search).has('legacy') ? <LegacyPage /> : <MailPage />);

export const Route = createFileRoute('/mail')({
  component: Mail,
  staticData: { nav: 'mail', title: 'Mail', layout: 'bare', description: 'Your Gmail inside FavorOS: read, reply, archive, labels, drafts and search.' },
});

import { createFileRoute } from '@tanstack/react-router';
import { LegacyPage } from '@/legacy/LegacyPage';
import { MailPage } from '@/features/mail/MailPage';

// Native Mail is behind ?native=1 until the parity checklist (docs/mail-parity.md) is complete; without it the classic page runs in the frame.
// The classic page stays reachable at /mail/?classic=1 after that.
const Mail = () => (new URLSearchParams(location.search).has('native') ? <MailPage /> : <LegacyPage />);

export const Route = createFileRoute('/mail')({
  component: Mail,
  staticData: { nav: 'mail', title: 'Mail', layout: 'bare', description: 'Your Gmail inside FavorOS: read, reply, archive, labels, drafts and search.' },
});

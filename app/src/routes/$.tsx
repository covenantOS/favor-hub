import { createFileRoute } from '@tanstack/react-router';
import { LegacyPage } from '@/legacy/LegacyPage';

// Every address the app does not have a native route for. The classic page of that address runs inside the frame (legacy/page.ts).
export const Route = createFileRoute('/$')({ component: LegacyPage });

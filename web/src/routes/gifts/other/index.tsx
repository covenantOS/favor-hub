// Gifts > Other gifts: DAF, foundation, wire, stock and phone gifts entered with the soft credit into a batch a second person approves.
// Served by its own switch (hub setting gifts.other, shared/web.ts WEB_OWN_SWITCH), never by web.routes.
import { createFileRoute } from '@tanstack/react-router';
import { OtherGiftsPage, OtherGiftsSkeleton } from '../../../features/other-gifts/OtherGiftsPage';

export const Route = createFileRoute('/gifts/other/')({
  staticData: { nav: 'other-gifts', title: 'Other gifts', layout: 'wide' },
  // The reads here take about a second, longer than the Worker's server read allows, so the data is drawn in the browser; the shell and the
  // skeleton still come from the server.
  ssr: false,
  pendingComponent: OtherGiftsSkeleton,
  component: OtherGiftsPage,
});

// Gifts > Other gifts: DAF, foundation, wire, stock and phone gifts entered with the soft credit into a batch a second person approves.
// Served by its own switch (hub setting gifts.other, shared/web.ts WEB_OWN_SWITCH), never by web.routes.
import { createFileRoute } from '@tanstack/react-router';
import { OtherGiftsPage } from '../../../features/other-gifts/OtherGiftsPage';

export const Route = createFileRoute('/gifts/other/')({
  staticData: { nav: 'other-gifts', title: 'Other gifts', layout: 'wide' },
  component: OtherGiftsPage,
});

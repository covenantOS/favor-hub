// Meetings > the lobby and the room. The room code is the classic room.js, hosted by features/meet/room/RoomPage.tsx; the frame stays lean
// (no chat dock, tours or partner drawer over a call), as the Astro page's lean layout did. Port of src/pages/meet/room.astro.
import { createFileRoute } from '@tanstack/react-router';
import { RoomPage } from '../../../features/meet/room/RoomPage';

export const Route = createFileRoute('/meet/room/')({
  staticData: { nav: 'meet', title: 'Meeting', layout: 'bare', lean: true },
  component: RoomPage,
});

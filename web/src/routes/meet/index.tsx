// Meetings, Day tab: the chosen day's meetings on a timeline, the live ones on top, the notes beside it. Port of src/pages/meet/index.astro.
import { createFileRoute } from '@tanstack/react-router';
import { DayPage } from '../../features/meet/day/DayPage';
import { dayDirectory, dayNotes, dayRecent, dayUpcoming } from '../../features/meet/day/queries';

export const Route = createFileRoute('/meet/')({
  staticData: { nav: 'meet', title: 'Meetings', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(dayUpcoming);
    void context.queryClient.prefetchQuery(dayRecent);
    void context.queryClient.prefetchQuery(dayNotes);
    void context.queryClient.prefetchQuery(dayDirectory);
  },
  component: DayPage,
});

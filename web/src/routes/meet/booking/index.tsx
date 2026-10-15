// Meetings > Booking page: the owner's booking page setup. Port of src/pages/meet/booking.astro.
import { createFileRoute } from '@tanstack/react-router';
import { BookingPage } from '../../../features/meet/booking/BookingPage';
import { bookingPrefsQuery, bookingQuery } from '../../../features/meet/queries';

export const Route = createFileRoute('/meet/booking/')({
  staticData: { nav: 'meet-booking', title: 'Booking page', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(bookingQuery);
    void context.queryClient.prefetchQuery(bookingPrefsQuery);
  },
  component: BookingPage,
});

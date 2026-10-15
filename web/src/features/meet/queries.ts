// Meetings reads as queryOptions, in one light module so route files can prefetch them without pulling a page component into the entry chunk.
import { queryOptions } from '@tanstack/react-query';
import { hubGet, hubGetLoose } from '../../lib/hub';
import { meetQuery } from './queryBase';
import type { Action, Meeting, PartnerAsk, Person } from './library/LibraryPage';
import type { Prep } from './prep/PrepPage';
import type { SeriesData } from './series/SeriesPage';
import type { BookingData, PrefsData } from './booking/BookingPage';

export const libraryList = meetQuery<{ meetings: Meeting[] }>('meetings?scope=notes', ['meet', 'library', 'list']);
export const libraryActions = meetQuery<{ actions: Action[]; partnerConfirms?: PartnerAsk[] }>('meetings/actions', ['meet', 'library', 'actions']);
// The directory only fills the team chips; a failed read leaves them off, as on the classic page.
export const libraryDirectory = queryOptions({
  queryKey: ['meet', 'library', 'directory'],
  staleTime: 15_000,
  queryFn: async (): Promise<{ people: Person[] }> => {
    try {
      return (await hubGet('/api/meet/meetings/directory')) as { people: Person[] };
    } catch {
      return { people: [] };
    }
  },
});

export const prepQuery = (id: string) => meetQuery<Prep>(`meetings/${encodeURIComponent(id)}/prep`, ['meet', 'prep', id]);

export const seriesQuery = (id: string) => meetQuery<SeriesData>(`meetings/series/${encodeURIComponent(id)}`, ['meet', 'series', id]);

export const bookingQuery = meetQuery<BookingData>('meetings/booking', ['meet', 'booking', 'types']);
// The working hours read may fail without failing the page (classic catches it).
export const bookingPrefsQuery = queryOptions({
  queryKey: ['meet', 'booking', 'prefs'],
  staleTime: 15_000,
  queryFn: async (): Promise<PrefsData | null> => {
    try {
      return (await hubGet('/api/meet/meetings/prefs')) as PrefsData;
    } catch {
      return null;
    }
  },
});

export const notesQuery = (id: string) => meetQuery<Record<string, any>>(`meetings/${encodeURIComponent(id)}/notes`, ['meet', 'notes', id]);

/* The booking wizard's reads (features/meet/book). Each is a plain read; the ones the classic page tolerates failing carry their fallback. */
export const bookDirQuery = meetQuery<{ people: { email: string; name: string; team: string }[] }>('meetings/directory', ['meet', 'book', 'dir']);
// The status answers ok:false (with a 200) for a person who has not connected a calendar; that is data, not an error.
export const bookStatusQuery = queryOptions({
  queryKey: ['meet', 'book', 'status'],
  staleTime: 15_000,
  queryFn: async (): Promise<{ ok: boolean; connected?: boolean; guestsEnabled?: boolean; leadMin?: number }> => (await hubGetLoose('/api/meet/meetings/bookstatus')) as { ok: boolean; connected?: boolean; guestsEnabled?: boolean; leadMin?: number },
});
export const bookMyRecQuery = queryOptions({
  queryKey: ['meet', 'book', 'myrec'],
  staleTime: 15_000,
  queryFn: async (): Promise<{ rec: string }> => {
    try {
      return (await hubGet('/api/meet/meetings/myrec')) as { rec: string };
    } catch {
      return { rec: 'video' };
    }
  },
});
export const bookTemplatesQuery = queryOptions({
  queryKey: ['meet', 'book', 'templates'],
  staleTime: 15_000,
  queryFn: async (): Promise<{ templates: any[] }> => {
    try {
      return (await hubGet('/api/meet/meetings/templates')) as { templates: any[] };
    } catch {
      return { templates: [] };
    }
  },
});
/** The meeting being edited or followed up (null when the address names none). */
export const bookEditQuery = (id: string) =>
  queryOptions({
    queryKey: ['meet', 'book', 'meeting', id],
    staleTime: 15_000,
    queryFn: async (): Promise<{ meeting: any } | null> => (id ? ((await hubGet('/api/meet/meetings/' + encodeURIComponent(id))) as { meeting: any }) : null),
  });
/** The series of the meeting being edited; a read that fails leaves the pattern unchanged, as on the classic page. */
export const bookSeriesQuery = (id: string) =>
  queryOptions({
    queryKey: ['meet', 'book', 'series', id],
    staleTime: 15_000,
    queryFn: async (): Promise<{ series: any } | null> => {
      if (!id) return null;
      try {
        return (await hubGet('/api/meet/meetings/series/' + encodeURIComponent(id))) as { series: any };
      } catch {
        return null;
      }
    },
  });

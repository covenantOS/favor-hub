// The Meetings Day page's first reads (public/js/meet/day.js load()). The route loader prefetches them by importing dayQueries; the page
// reads the same keys. The directory only fills names, so a failed read leaves them empty, as on the classic page.
import { queryOptions } from '@tanstack/react-query';
import { hubGet } from '../../../lib/hub';
import { meetQuery } from '../queryBase';

export const dayUpcoming = meetQuery<{ meetings: any[] }>('meetings?scope=upcoming', ['meet', 'day', 'upcoming']);
export const dayRecent = meetQuery<{ meetings: any[] }>('meetings?scope=recent', ['meet', 'day', 'recent']);
export const dayNotes = meetQuery<{ meetings: any[] }>('meetings?scope=notes', ['meet', 'day', 'notes']);
export const dayDirectory = queryOptions({
  queryKey: ['meet', 'day', 'directory'],
  staleTime: 15_000,
  queryFn: async (): Promise<{ people: { email: string; name: string }[] }> => {
    try {
      return (await hubGet('/api/meet/meetings/directory')) as { people: { email: string; name: string }[] };
    } catch {
      return { people: [] };
    }
  },
});

/** In the order the page reads them: upcoming, recent, notes, directory. */
export const dayQueries = [dayUpcoming, dayRecent, dayNotes, dayDirectory] as const;

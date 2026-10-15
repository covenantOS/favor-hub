// Every read the partner page, the drawer and the tools make: one queryOptions per API call, the same routes the classic scripts call.
import { queryOptions } from '@tanstack/react-query';
import { rApi, rGet, type Note, type Partner } from './lib';

const enc = encodeURIComponent;
export const prKeys = {
  partner: (id: string, as = '') => ['pr', 'partner', id, as] as const,
  notes: (id: string, as = '') => ['pr', 'notes', id, as] as const,
  story: (id: string) => ['pr', 'story', id] as const,
  timeline: (id: string) => ['pr', 'timeline', id] as const,
  mail: (id: string) => ['pr', 'mail', id] as const,
  extras: (id: string) => ['pr', 'extras', id] as const,
  codes: ['pr', 'codes'] as const,
  gate: ['pr', 'gate'] as const,
  comm: (id: string) => ['pr', 'comm', id] as const,
};

export const partnerQuery = (id: string, as = '') =>
  queryOptions({
    queryKey: prKeys.partner(id, as),
    queryFn: async () => ((await rGet('/api/work/partners/' + enc(id), as)) as { partner: Partner }).partner,
    staleTime: 60_000,
  });

export const notesQuery = (id: string, as = '') =>
  queryOptions({
    queryKey: prKeys.notes(id, as),
    queryFn: async () => ((await rGet('/api/work/partners/' + enc(id) + '/notes', as)) as { rows: Note[] }).rows || [],
    staleTime: 10 * 60_000,
  });
/** The notes read live, skipping the ten-minute copy (after a note is saved or an undo). */
export const freshNotes = async (id: string): Promise<Note[]> => (((await rApi('/api/work/partners/' + enc(id) + '/notes?fresh=1')) as { rows: Note[] }).rows || []);

export const storyQuery = (id: string) =>
  queryOptions({ queryKey: prKeys.story(id), queryFn: async () => (await rGet('/api/brief/story/' + enc(id)).catch(() => null)) as any, staleTime: 60_000 });
export const timelineQuery = (id: string) =>
  queryOptions({ queryKey: prKeys.timeline(id), queryFn: async () => (await rGet('/api/brief/timeline/' + enc(id)).catch(() => null)) as any, staleTime: 60_000 });
/** This person's own email with the partner and emails naming them. Read apart so the timeline never waits on it. */
export const mailQuery = (id: string) =>
  queryOptions({
    queryKey: prKeys.mail(id),
    queryFn: async () => (((await rGet('/api/today/partner-mail?cid=' + enc(id)).catch(() => ({ events: [] }))) as { events?: any[] }).events || []) as any[],
    staleTime: 60_000,
  });

export const extrasQuery = (id: string) =>
  queryOptions({ queryKey: prKeys.extras(id), queryFn: async () => (await rGet('/api/partners/record/' + enc(id) + '/extras')) as any, staleTime: 30_000 });

export const codesQuery = queryOptions({
  queryKey: prKeys.codes,
  queryFn: async () => (await rGet('/api/work/codes').catch(() => ({ codes: {}, me: {}, types: {} }))) as { codes: any; me: any; types: Record<string, string> },
  staleTime: 10 * 60_000,
});

/** Whether this person has the Work Center (the partner drawer opens only for them). */
export const gateQuery = queryOptions({
  queryKey: prKeys.gate,
  queryFn: async () => !!((await rGet('/api/work/gate').catch(() => ({ open: false }))) as { open?: boolean }).open,
  staleTime: 5 * 60_000,
});

export const commQuery = (id: string) =>
  queryOptions({ queryKey: prKeys.comm(id), queryFn: async () => ((await rGet('/api/work/partners/' + enc(id) + '/comm')) as { comm: any }).comm, staleTime: 30_000 });

/** The prefetch the route loader starts for a partner page (never awaited). */
export function prefetchPartnerReads(qc: import('@tanstack/react-query').QueryClient, id: string, as = '') {
  void qc.prefetchQuery(partnerQuery(id, as));
  void qc.prefetchQuery(notesQuery(id, as));
  void qc.prefetchQuery(storyQuery(id));
  void qc.prefetchQuery(timelineQuery(id));
  void qc.prefetchQuery(commQuery(id));
}

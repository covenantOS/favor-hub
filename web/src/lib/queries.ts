import { queryOptions } from '@tanstack/react-query';
import type { NavResponse, RecurringResponse } from '@shared/schemas';
import { keys } from '@/lib/query';
import { hubGet } from './hub';

/** The menu answer: who is signed in, what they may open, counts, jobs and release badges. Same key as app2's useNav. */
export const navQuery = queryOptions({
  queryKey: keys.nav,
  queryFn: async (): Promise<NavResponse> => (await import('@shared/schemas')).navResponse.parse(await hubGet('/api/hub/nav')),
  staleTime: 20_000,
  refetchInterval: 120_000,
});

/** Gifts > Recurring: the same key and shape as the browser's read, drawn through hubGet so the server asks with the visitor's cookie. */
export const recurringHubQuery = queryOptions({
  queryKey: ['recurring'] as const,
  queryFn: async (): Promise<RecurringResponse> => (await import('@shared/schemas')).recurringResponse.parse(await hubGet('/api/work/recurring')),
  staleTime: 20_000,
});

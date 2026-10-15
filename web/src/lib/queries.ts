import { queryOptions } from '@tanstack/react-query';
import { navResponse, type NavResponse } from '@shared/schemas';
import { keys } from '@/lib/query';
import { hubGet } from './hub';

/** The menu answer: who is signed in, what they may open, counts, jobs and release badges. Same key as app2's useNav. */
export const navQuery = queryOptions({
  queryKey: keys.nav,
  queryFn: async (): Promise<NavResponse> => navResponse.parse(await hubGet('/api/hub/nav')),
  staleTime: 20_000,
  refetchInterval: 120_000,
});

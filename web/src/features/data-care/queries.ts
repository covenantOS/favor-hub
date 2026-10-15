import { queryOptions } from '@tanstack/react-query';
import { hubGet } from '../../lib/hub';
import type { Compare, Flag, Pair, Summary } from './types';

export const dcKeys = {
  all: ['data-care'] as const,
  summary: ['data-care', 'summary'] as const,
  pairs: (tab: string) => ['data-care', 'pairs', tab] as const,
  pair: (id: string) => ['data-care', 'pair', id] as const,
  flags: (state: string, q: string, offset: number) => ['data-care', 'flags', state, q, offset] as const,
};

export const FLAG_PAGE = 20;

export const summaryQuery = queryOptions({
  queryKey: dcKeys.summary,
  queryFn: async () => (await hubGet('/api/datacare/')) as { summary: Summary; me: { email: string; admin: boolean } },
  staleTime: 15_000,
});

export const pairsQuery = (tab: string) =>
  queryOptions({
    queryKey: dcKeys.pairs(tab),
    queryFn: async () => ((await hubGet('/api/datacare/pairs?tab=' + tab)) as { pairs: Pair[] }).pairs,
    staleTime: 15_000,
  });

export const pairQuery = (id: string) =>
  queryOptions({
    queryKey: dcKeys.pair(id),
    queryFn: async () => (await hubGet('/api/datacare/pair?id=' + encodeURIComponent(id))) as { pair: Pair; compare: Compare | null },
    staleTime: 15_000,
  });

export const flagsQuery = (state: string, q: string, offset: number) =>
  queryOptions({
    queryKey: dcKeys.flags(state, q, offset),
    queryFn: async () => (await hubGet(`/api/datacare/flags?state=${state}&q=${encodeURIComponent(q)}&offset=${offset}&limit=${FLAG_PAGE}`)) as { rows: Flag[]; total: number },
    staleTime: 15_000,
  });

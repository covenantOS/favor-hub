import { queryOptions } from '@tanstack/react-query';
import { hubGet } from '../../lib/hub';
import type { Board, CardDetail, CardList, RelGraph } from './types';

export const mvKeys = {
  all: ['moves'] as const,
  board: (owner: string, q: string, sort: string, per: number) => ['moves', 'board', owner, q, sort, per] as const,
  list: (owner: string, q: string, sort: string, stage: string, offset: number, limit: number) => ['moves', 'list', owner, q, sort, stage, offset, limit] as const,
  card: (cid: string) => ['moves', 'card', cid] as const,
  rel: (cid: string) => ['moves', 'rel', cid] as const,
};

const qs = (o: Record<string, string | number>) => Object.entries(o).filter(([, v]) => v !== '' && v !== 0).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');

export const boardQuery = (owner: string, q: string, sort: string, per: number) =>
  queryOptions({ queryKey: mvKeys.board(owner, q, sort, per), queryFn: async () => (await hubGet('/api/moves/?' + qs({ owner, q, sort, per }))) as Board, staleTime: 20_000 });

export const listQuery = (owner: string, q: string, sort: string, stage: string, offset: number, limit: number) =>
  queryOptions({ queryKey: mvKeys.list(owner, q, sort, stage, offset, limit), queryFn: async () => (await hubGet('/api/moves/cards?' + qs({ owner, q, sort, stage, offset, limit }))) as CardList, staleTime: 20_000 });

export const cardQuery = (cid: string) =>
  queryOptions({ queryKey: mvKeys.card(cid), queryFn: async () => (await hubGet('/api/moves/card?cid=' + cid)) as CardDetail, staleTime: 10_000 });

export const relQuery = (cid: string) =>
  queryOptions({ queryKey: mvKeys.rel(cid), queryFn: async () => (await hubGet('/api/moves/relations?cid=' + cid)) as RelGraph, staleTime: 30_000 });

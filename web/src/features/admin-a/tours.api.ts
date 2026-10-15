// Admin > Tours: the read behind the page and the answer a Send again gives. Light on purpose: the route file imports this module (never a component).
import { queryOptions } from '@tanstack/react-query';
import { hubGet } from '../../lib/hub';

export interface TourCore {
  state: '' | 'done' | 'queued' | 'snoozed' | 'offered' | null;
  at?: string | null;
  skips?: number;
}
export interface TourRelease {
  shown?: number;
  done?: number;
  skips?: number;
  at?: string | null;
}
export interface TourPerson {
  name: string;
  email: string;
  team: string;
  core: TourCore;
  releases: Record<string, TourRelease | undefined>;
  lastSeen?: string | null;
}
export interface Tours {
  ready: boolean;
  teams: string[];
  releases: Array<{ id: string; title: string }>;
  people: TourPerson[];
}
export const toursQuery = queryOptions({
  queryKey: ['admin', 'tours'] as const,
  queryFn: async (): Promise<Tours> => (await hubGet('/api/admin/tours')) as Tours,
  staleTime: 20_000,
});

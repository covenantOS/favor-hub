// Admin > Adoption: the two reads behind the page. Light on purpose: the route file imports this module (never a component).
import { queryOptions } from '@tanstack/react-query';
import { hubGet } from '../../lib/hub';

export interface AdoptionPerson {
  email: string;
  name: string;
  team: string;
  you: boolean;
  firstSignin: string;
  lastActive: string;
  activeDays30: number;
  areas: Array<{ area: string; n: number }>;
  brain: number;
  feedback: number;
  tasks: number;
  meetings: number;
  work: number;
  gifts: number;
}
export interface AdoptionFeedback {
  id: number | string;
  at: string;
  email: string;
  name: string;
  source: string;
  rating: string;
  comment: string;
  question: string;
  page: string;
  status: string;
}
export interface Adoption {
  summary: { withAccount: number; signedInEver: number; active7: number; active30: number; neverSignedIn: number; trackingSince: string };
  weekly: Array<{ week: string; people: number }>;
  people: AdoptionPerson[];
  never: Array<{ name: string; team: string; email?: string }>;
  teams: string[];
  feedback: AdoptionFeedback[];
}
export const adoptionQuery = queryOptions({
  queryKey: ['admin', 'adoption'] as const,
  queryFn: async (): Promise<Adoption> => (await hubGet('/api/admin/adoption')) as Adoption,
  staleTime: 30_000,
});

export interface AdoptionDay {
  day: string;
  areas: Array<{ area: string; n: number }>;
  signins: number;
  brain: number;
  feedback: number;
  tasks: number;
  meetings: number;
  work: number;
}
export interface AdoptionLog {
  email: string;
  name: string;
  team: string;
  days: AdoptionDay[];
  feedback: Array<{ at: string; question: string; rating: string; comment: string; status: string; page: string }>;
}
export const adoptionPersonQuery = (email: string) =>
  queryOptions({
    queryKey: ['admin', 'adoption', 'person', email] as const,
    queryFn: async (): Promise<AdoptionLog> => (await hubGet('/api/admin/adoption?person=' + encodeURIComponent(email))) as AdoptionLog,
    staleTime: 30_000,
  });

// The Entry tab's read (GET /api/work/entry, functions/_lib/work/entry.ts entryView) and the words its buttons use.
import { queryOptions } from '@tanstack/react-query';
import { hubGet } from '../../../../../lib/hub';
import { wcKeys } from '../queries';

export interface EntryOwner {
  fid: string;
  name: string;
  /** The kind of action Blackbaud gets for this person ("RDD Action"). */
  type: string;
  /** The tab of the tracking sheet that holds this person's contacts. Empty when there is none. */
  tab: string;
  sub: number;
  inBB: number;
  wait: number;
  late: number;
  in: number;
  all: number;
}

export interface EntryRow {
  id: string;
  owner: string;
  source: string;
  date: string;
  wk: string;
  name: string;
  org: string;
  isNew: string;
  row: string | number;
  how: string;
  cid: string | null;
  cands: string[];
  ch: string;
  act: string;
  sum: string;
  notes: string;
  tags: string[];
  ask: string;
  state: string;
  ticked: boolean;
  dup: { id: string; added: string; cat: string; same: boolean } | null;
  posted: { at: string; by: string } | null;
  email: boolean;
  phone: boolean;
  emailV: string;
  phoneV: string;
  addr: string;
}

export interface EntryPartner {
  n: string;
  loc: string;
  lk: string;
  hold: string[];
  dec?: number;
}

export interface EntryData {
  ok: boolean;
  owners: EntryOwner[];
  owner: string;
  deadline: { iso: string; label: string; from: string; to: string };
  week: Omit<EntryOwner, 'fid' | 'name' | 'type' | 'tab'> | null;
  bb: { this: number; last: number; lastByMon3: number };
  rows: EntryRow[];
  partners: Record<string, EntryPartner>;
}

const still = { staleTime: 5 * 60_000, refetchOnWindowFocus: false, refetchOnReconnect: false } as const;

/** The owner is the fundraiser whose contacts show. Empty asks the server for the first person this viewer may enter for. */
export const entryQuery = (owner = '', as = '') =>
  queryOptions({
    queryKey: wcKeys.entry(owner, as),
    queryFn: async () => {
      const q = [owner ? 'owner=' + encodeURIComponent(owner) : '', as ? 'as=' + encodeURIComponent(as) : ''].filter(Boolean).join('&');
      return (await hubGet('/api/work/entry' + (q ? '?' + q : ''))) as EntryData;
    },
    ...still,
  });

export const HOWS: [string, string][] = [
  ['call', 'Call'],
  ['vm', 'Voicemail'],
  ['text', 'Text'],
  ['email', 'Email'],
  ['meet', 'Meeting'],
  ['mail', 'Mail'],
];
export const TAGS: [string, string][] = [
  ['thanked', 'Thanked'],
  ['texted', 'Texted'],
  ['stewardship', 'Stewardship'],
  ['scheduling', 'Scheduling'],
];
export type Lane = 'wait' | 'late' | 'in' | 'all';

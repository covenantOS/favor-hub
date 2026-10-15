// The staff list: names and pictures for owners, members and pickers. One StaffDir per signed-in person. It is built from the
// /api/requests/people answer and handed down by React context; nothing is kept in module state on the server, where one Worker
// answers many people. The browser keeps one copy for the imperative pickers (pickOwner and friends) in `activeStaff`.
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { hubGet } from '../../../lib/hub';
import type { Person } from '../types';

export class StaffDir {
  me: string;
  list: Person[];
  by: Map<string, Person>;
  constructor(me: string, list: Person[]) {
    this.me = me;
    this.list = list;
    this.by = new Map(list.map((p) => [p.email.toLowerCase(), p]));
  }
  /** A person to draw. Someone outside the list still gets a name made from their address. */
  personOf = (email: string | null | undefined): Person | null => {
    if (!email) return null;
    const p = this.by.get(String(email).toLowerCase());
    if (p) return { email: p.email, name: p.name, picture: p.picture || '' };
    return { email, name: String(email).split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), picture: '' };
  };
  nameOf = (email: string | null | undefined): string => (email ? this.personOf(email)!.name : '');
}

export const EMPTY_STAFF = new StaffDir('', []);

export const staffQuery = queryOptions({
  queryKey: ['projects', 'staff'],
  queryFn: async (): Promise<{ me: string; people: Person[] }> => {
    const d = (await hubGet('/api/requests/people')) as { me?: string; people?: Person[] };
    return { me: d.me || '', people: d.people || [] };
  },
  staleTime: 5 * 60_000,
});

const Ctx = createContext<StaffDir>(EMPTY_STAFF);
export const useStaff = (): StaffDir => useContext(Ctx);

/** Reads the staff list (suspends until it arrives) and provides it to everything below. */
export function StaffProvider({ children }: { children: ReactNode }) {
  const { data } = useSuspenseQuery(staffQuery);
  const dir = useMemo(() => new StaffDir(data.me, data.people), [data]);
  useEffect(() => {
    activeStaff = dir;
  }, [dir]);
  return <Ctx.Provider value={dir}>{children}</Ctx.Provider>;
}

/** The browser's copy for code that runs outside React (the imperative pickers). Never read on the server. */
let activeStaff: StaffDir = EMPTY_STAFF;
export const getActiveStaff = (): StaffDir => activeStaff;

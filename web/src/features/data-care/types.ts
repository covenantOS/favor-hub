export interface Summary {
  noAddress: { open: number; gave: number; fixed: number };
  nameCheck: number;
  pairs: { review: number; notSame: number; queued: number; merged: number; failed: number };
  scannedAt: string | null;
  sheet: string | null;
  reviewer: { email: string; name: string };
  assigned: { at: string; by: string; taskId: string | null } | null;
}
export interface Flag {
  cid: string;
  lookup: string;
  name: string;
  why: string;
  gave: number;
  gifts: number;
  lastGift: string | null;
  email: string | null;
  state: string;
  fixedAt: string | null;
  fixedHow: string | null;
}
export interface PairRef {
  id: string;
  lookup: string;
  name: string;
}
export interface Pair {
  id: string;
  a: PairRef;
  b: PairRef;
  score: number;
  why: string;
  state: string;
  keep: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  result: string | null;
}
export interface Side {
  id: string;
  lookup: string;
  name: string;
  type: string;
  added: string;
  address: string | null;
  addressDoNotMail: boolean;
  phone: string | null;
  emails: string[];
  codes: string[];
  heldBy: string[];
  gifts: { n: number; total: number; last: string | null };
  actions: { n: number; last: string | null };
}
export interface Compare {
  a: Side;
  b: Side;
  suggestKeep: 'a' | 'b';
  differs: { name: boolean; address: boolean; phone: boolean };
}
export const WHY: Record<string, string> = { dnm: 'Do not mail', no_street: 'No street', inactive: 'Address ended', none: 'None on file', name: 'Name is not a person' };

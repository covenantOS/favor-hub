// Shapes the Work Center's reads answer with (functions/_lib/work/service.ts) and the form the lists use.

export interface Person {
  n: string;
  team: string;
  active: number | boolean;
  listed: number | boolean;
  left?: number | boolean;
}
export type People = Record<string, Person>;

export interface Me {
  role: string;
  label?: string;
  fid: string | null;
  team: string;
  all?: boolean;
  canDelete: boolean;
  canMove: boolean;
  canEntry: boolean;
  canGifts: boolean;
  anyTeam: boolean;
  fids?: string[];
  canPartnerEdit?: boolean;
}

export interface Meter {
  used: number;
  cap: number;
  lane: number;
  resets: string;
}

export interface Gate {
  ok: boolean;
  open: boolean;
  admin: boolean;
  reason?: string;
  release?: string;
  name?: string;
}

/** One row of /api/work/board as the server sends it. */
export interface BoardRowRaw {
  id: string;
  due: string;
  added: string;
  type: string;
  category: string;
  summary: string;
  description: string;
  cid: string;
  partner: string;
  place: string;
  lookup: string;
  fundraisers: string[];
  deceased?: boolean;
  ty?: boolean;
  ctg?: boolean;
  priority?: string;
  tags?: string[];
  gift?: { id: string; amount: number; date: string; fund?: string } | null;
  later?: { id: string; date: string; by?: string[]; summary: string; category: string; strength: string } | null;
  holders?: string[];
  group?: string[] | null;
  pending?: { state: 'saving' | 'queued' | string; label?: string } | null;
  reopened?: boolean;
}

export interface BoardData {
  ok: boolean;
  synced: string;
  today: string;
  meter: Meter;
  counts: { mine?: number; [k: string]: number | undefined };
  people: People;
  me: Me;
  orphans?: unknown;
  total: number;
  entryWaiting?: number;
  rows: BoardRowRaw[];
}

/** A board row in the short form the lists use (public/js/work.js adapt). */
export interface Act {
  id: string;
  due: string;
  add: string;
  type: string;
  cat: string;
  sum: string;
  desc: string;
  cid: string;
  p: string;
  loc: string;
  lk: string;
  f: string[];
  dec: boolean;
  ty: boolean;
  ctg: boolean;
  pri: string;
  tg: string[];
  gift: { id: string; a: number; d: string; fund?: string } | null;
  later: { id: string; d: string; by: string[]; s: string; cat: string; k: 's' | 'l' } | null;
  hold: string[];
  grp: string[] | null;
  pending: { state: string; label?: string } | null;
  reopened: boolean;
}

export interface BatchItem {
  id: string;
  name: string;
  what: string;
  state: string;
  error?: string;
}
export interface Batch {
  id: string;
  op: string;
  label: string;
  actor: string;
  mine?: boolean;
  at: string;
  undo_until: string;
  undone?: boolean;
  undoing?: boolean;
  posted: number;
  failed: number;
  queued: number;
  tonight: number;
  run_when?: string;
  state?: string;
  items: BatchItem[];
}

export interface WorkFilters {
  fr: string;
  type: string;
  cat: string;
  due: string;
  q: string;
  cid: string;
  theirs: boolean;
  quick: string;
  scope?: string;
}
export const EMPTY_FILTERS: WorkFilters = { fr: '', type: '', cat: '', due: '', q: '', cid: '', theirs: false, quick: '', scope: '' };

/** What a person changed that the board does not show yet (an optimistic change, until the board is read again). */
export interface Overlay {
  due?: string;
  f?: string[];
  sum?: string;
  cat?: string;
  type?: string;
}

// The moves board's pure part: which stage each major partner sits in, the totals per stage, the order and the page. No reads here, so the
// tests and the tie-out script run the same code the page does.
//
// Who is on the board: every household whose largest single gift is $1,000 or more (the rule in shared/giving.ts), every partner with an
// open ask on the Asks board, and every partner someone has staged. A partner with a stage row sits there. A partner with an open ask and no
// stage row sits in the stage marked role "ask". A major partner with neither sits in the pool until someone stages them.
import type { AskRow } from '../work/asks';

export const POOL = 'pool';
export const MIN_MAJOR = 1000;

export interface Stage { id: string; label: string; sort: number; role: string; active: number }
export interface CardRow { key: string; cid: string; stage_id: string; next_step: string | null; next_due: string | null; entered_at: string; updated_at: string; updated_by: string | null }
export interface Household { key: string; record: string; spouse: string | null; name: string; city: string; state: string; largest: number; lifetime: number; lastGift: string | null; lastContact: string | null; major: boolean }

export interface BoardRow {
  key: string;
  cid: string;
  name: string;
  place: string;
  stage: string;
  staged: boolean;
  major: boolean;
  largest: number;
  lifetime: number;
  lastGift: string | null;
  lastContact: string | null;
  asked: number;
  asks: number;
  closeDate: string | null;
  nextStep: string;
  nextDue: string | null;
  overdue: boolean;
  enteredAt: string | null;
  owners: string[];
}

export interface Tally { n: number; asked: number }

export interface BoardInput {
  stages: Stage[];
  cards: CardRow[];
  households: Household[];
  /** Fundraiser ids holding each household key now. */
  holders: Record<string, string[]>;
  /** Open asks (open, closing or past; not held for review, not from former staff). Each carries the household key in `key`. */
  asks: (Pick<AskRow, 'id' | 'cid' | 'name' | 'place' | 'amount' | 'owners' | 'close' | 'date'> & { key: string })[];
  /** Last contact for keys that are not households in the snapshot. */
  contacts?: Record<string, string>;
  today: string;
}

/** The household key a record belongs to: the smaller id of a linked couple when the snapshot has it, else the record's own id. */
export function keyIndex(households: Household[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const h of households) {
    m.set(h.record, h.key);
    if (h.spouse) m.set(h.spouse, h.key);
  }
  return m;
}

export function compose(inp: BoardInput): BoardRow[] {
  const stages = inp.stages.filter((s) => s.active === 1);
  const stageIds = new Set(stages.map((s) => s.id));
  const askStage = (stages.find((s) => s.role === 'ask') || stages[0] || { id: POOL }).id;
  const hh = new Map(inp.households.map((h) => [h.key, h]));
  const cardOf = new Map(inp.cards.map((c) => [c.key, c]));
  const asksOf = new Map<string, BoardInput['asks']>();
  for (const a of inp.asks) (asksOf.get(a.key) || asksOf.set(a.key, []).get(a.key)!).push(a);
  const keys = new Set<string>(asksOf.keys());
  for (const c of inp.cards) keys.add(c.key);
  for (const h of inp.households) if (h.major) keys.add(h.key);
  const rows: BoardRow[] = [];
  for (const key of keys) {
    const h = hh.get(key);
    const card = cardOf.get(key);
    const asks = asksOf.get(key) || [];
    const first = asks[0];
    const stage = card && stageIds.has(card.stage_id) ? card.stage_id : asks.length ? askStage : POOL;
    const owners = new Set<string>(inp.holders[key] || []);
    for (const a of asks) for (const o of a.owners) owners.add(String(o));
    const closes = asks.map((a) => (a.close ? a.close.date : '')).filter(Boolean).sort();
    const due = card && card.next_due ? card.next_due : null;
    rows.push({
      key,
      cid: card ? card.cid : h ? h.record : first ? String(first.cid) : key,
      name: h ? h.name : first ? first.name : `Record ${key}`,
      place: h ? [h.city, h.state].filter(Boolean).join(', ') : first ? first.place : '',
      stage,
      staged: !!card && stageIds.has(card.stage_id),
      major: !!h && h.major,
      largest: h ? h.largest : 0,
      lifetime: h ? h.lifetime : 0,
      lastGift: h ? h.lastGift : null,
      lastContact: (h && h.lastContact) || (inp.contacts && inp.contacts[key]) || null,
      asked: asks.reduce((t, a) => t + a.amount, 0),
      asks: asks.length,
      closeDate: closes[0] || null,
      nextStep: card && card.next_step ? card.next_step : '',
      nextDue: due,
      overdue: !!due && due < inp.today,
      enteredAt: card ? card.entered_at : null,
      owners: [...owners],
    });
  }
  return rows;
}

export const inScope = (r: BoardRow, vis: Set<string> | null): boolean => !vis || r.owners.some((o) => vis.has(o));

export const SORTS = ['asked', 'name', 'due', 'contact', 'largest'] as const;
export type Sort = (typeof SORTS)[number];

/** Rows with no value in the sorted column go last. Ties break on the name, then the key, so every page agrees. */
export function sorter(sort: Sort): (a: BoardRow, b: BoardRow) => number {
  const tail = (a: BoardRow, b: BoardRow) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || (a.key < b.key ? -1 : 1);
  const asc = (x: string | null, y: string | null) => (x === y ? 0 : x === null || x === '' ? 1 : y === null || y === '' ? -1 : x < y ? -1 : 1);
  if (sort === 'name') return tail;
  if (sort === 'due') return (a, b) => asc(a.nextDue, b.nextDue) || tail(a, b);
  if (sort === 'contact') return (a, b) => asc(a.lastContact, b.lastContact) || tail(a, b);
  if (sort === 'largest') return (a, b) => b.largest - a.largest || tail(a, b);
  return (a, b) => b.asked - a.asked || b.largest - a.largest || tail(a, b);
}

export function tally(rows: BoardRow[]): Tally {
  return { n: rows.length, asked: rows.reduce((t, r) => t + r.asked, 0) };
}

export function matches(r: BoardRow, needle: string): boolean {
  return !needle || (r.name + ' ' + r.place + ' ' + r.nextStep).toLowerCase().includes(needle);
}

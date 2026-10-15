// A partner's giving before the gift on the deposit screen (functions/api/gift-entry/history.ts reads it through partnerGiving).
// The figures are the household's credited giving under the shared rule (shared/giving.ts): the partner's and spouse's own gifts plus
// gifts sent through a DAF, foundation or business that name them, a recurring schedule never counted, its payments counted.
import { lifetimeLine, sourceLine, throughName, type Giving } from '../../../shared/giving';

export interface GiftHistory {
  count: number;
  lifetimeCents: number;
  /** The newest earlier gift as credited to this partner. through names the DAF, foundation or business it came through. */
  last: { cents: number; date: string; through: string } | null;
  /** No credited gift before this one, and the record passes none on for others. */
  first: boolean;
  /** "All through National Christian Foundation (DAF)", or a split. Empty when every earlier gift is their own. */
  source: string;
  /** True when the record has no gifts of its own but passes gifts on for other partners. */
  passesOn: boolean;
  /** The server's words for the lifetime figure. */
  line: string;
}

/** Pure: the panel's numbers from the household's giving as of the day before this gift. */
export function historyOf(g: Pick<Giving, 'total' | 'count' | 'last' | 'own' | 'through' | 'passedOn'>): GiftHistory {
  return {
    count: g.count,
    lifetimeCents: Math.round(g.total * 100),
    last: g.last ? { cents: Math.round(g.last.amount * 100), date: g.last.date, through: g.last.through ? throughName(g.through.find((t) => t.name === g.last!.through) || { name: g.last.through, kind: '' }) : '' } : null,
    first: g.count === 0 && g.passedOn.count === 0,
    source: sourceLine(g),
    passesOn: g.count === 0 && g.passedOn.count > 0,
    line: lifetimeLine(g),
  };
}

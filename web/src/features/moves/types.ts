export interface MoveRow {
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
  ownerNames: string[];
}
export interface MoveStage { id: string; label: string; role: string; sort: number; n: number; asked: number; rows: MoveRow[] }
export interface Board {
  today: string;
  synced: string;
  admin: boolean;
  owner: string;
  q: string;
  sort: string;
  owners: { id: string; name: string; n: number }[];
  stages: MoveStage[];
  askedTotal: number;
  total: number;
  stageDefs: { id: string; label: string; sort: number; role: string; active: number }[];
}
export interface CardList { stage: string; n: number; asked: number; offset: number; limit: number; rows: MoveRow[] }
export interface CardDetail {
  row: MoveRow;
  stages: { id: string; label: string }[];
  asks: { id: string; amount: number; date: string; line: string; state: string; closeDate: string | null }[];
  giving: { lifetime: number; largest: { amount: number; date: string } | null; last: { amount: number; date: string } | null; major: boolean; members: { id: string; name: string; relation: string }[] } | null;
  audit: { at: string; actor: string; kind: string; from_stage: string | null; to_stage: string | null; detail: string | null }[];
}
export interface MapNode {
  cid: string;
  name: string;
  role: string;
  back: string;
  group: 'family' | 'church' | 'work' | 'board' | 'foundation' | 'other';
  position: string;
  place: string;
  kind: string;
  deceased: boolean;
  lifetime: number;
  largest: number;
  lastGift: string | null;
  major: boolean;
  source: 'blackbaud' | 'favoros' | 'favoros-only';
}
export interface RelGraph {
  /** Set when the Moves switch leaves this person out: nothing to draw. */
  off?: boolean;
  center: { cid: string; name: string; lifetime: number; largest: number; lastGift: string | null; major: boolean };
  nodes: MapNode[];
  types: { type: string; back: string }[];
}

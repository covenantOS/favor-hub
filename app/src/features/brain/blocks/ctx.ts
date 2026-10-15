// What every answer block gets: the block, where it sits, and what it may do. New block types (action cards, charts, partner
// cards, a clarifying question) are a component and one registerBlock() line (registry.tsx); nothing else changes.
import type { BrainEngine } from '../engine';
import type { Block, Turn } from '../types';

export interface BlockCtx {
  engine: BrainEngine;
  turn: Turn;
  /** The turn's index in the open chat, and the block's index in the turn (-1 for an extra the page added). */
  ti: number;
  bi: number;
  /** Lists last 24 hours: an older answer shows its preview rows without the tools. */
  expired: boolean;
  /** The view: the full page or the dock. */
  where: 'page' | 'dock';
  /** Ask the Brain (a follow-up, a choice, More like this). */
  ask: (q: string, intent?: string) => void;
  /** Show one table large (the page's side panel; the dock opens the page). */
  openTable: (key: string) => void;
}

export interface BlockProps<B extends Block = Block> {
  b: B;
  ctx: BlockCtx;
}

/** A table's key inside the open chat: the turn and the block. */
export const tableKey = (ti: number, bi: number) => ti + ':' + bi;

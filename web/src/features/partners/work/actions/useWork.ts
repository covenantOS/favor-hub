// The board and the helpers a list draws from, as hooks.
import { useMemo } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { indexOf, makeWork, type Work } from './model';
import { boardQuery, gateQuery } from './queries';
import { useWc } from './store';
import type { BoardData, Gate } from './types';

export const asOf = (search: Record<string, unknown> | undefined): string | undefined => (typeof search?.as === 'string' && search.as ? search.as : undefined);

export function useBoard(as?: string): BoardData {
  return useSuspenseQuery(boardQuery(as)).data;
}
export function useGate(as?: string): Gate {
  return useSuspenseQuery(gateQuery(as)).data;
}

/** The helpers for a board with this person's pending changes laid over it. A new object only when the board or a pending change changes. */
export function useWork(data: BoardData): Work {
  const ov = useWc((s) => s.ov);
  const gone = useWc((s) => s.gone);
  const saving = useWc((s) => s.saving);
  const queued = useWc((s) => s.queued);
  const back = useWc((s) => s.back);
  return useMemo(() => makeWork(indexOf(data), { ov, gone, saving, queued, back }), [data, ov, gone, saving, queued, back]);
}

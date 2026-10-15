// Which tool is open: Call prep, Call mode or Add a partner. Any component calls openPrep(id) and the tools host (mounted once with the
// partner drawer, in PartnerLinks) draws it. Call mode can open with a line already typed (the Gifts to thank row passes none).
import { useSyncExternalStore } from 'react';

export interface ToolState {
  prep: string | null;
  call: { id: string; say?: string; done?: () => void } | null;
  add: boolean;
}
let state: ToolState = { prep: null, call: null, add: false };
const subs = new Set<() => void>();
const set = (s: Partial<ToolState>) => {
  state = { ...state, ...s };
  subs.forEach((f) => f());
};
const server: ToolState = { prep: null, call: null, add: false };

export const openPrep = (id: string) => set({ prep: id, call: null });
export const closePrep = () => set({ prep: null });
export const openCall = (id: string, o: { say?: string; done?: () => void } = {}) => set({ call: { id, ...o }, prep: null });
export const closeCall = () => set({ call: null });
export const openAdd = () => set({ add: true });
export const closeAdd = () => set({ add: false });

export function useTools(): ToolState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
    () => server
  );
}

// Which partner the slide-over drawer shows. openPartner(id) from anywhere (a component, a tool, a script) opens it; the drawer
// (PartnerDrawer, drawn once by PartnerLinks) follows. compose asks the drawer to open a form on arrival (Add a note, Log a contact).
import { useSyncExternalStore } from 'react';

export interface DrawerState {
  id: string | null;
  compose: string | null;
  seq: number;
}
let state: DrawerState = { id: null, compose: null, seq: 0 };
const subs = new Set<() => void>();
const set = (s: Partial<DrawerState>) => {
  state = { ...state, ...s };
  subs.forEach((f) => f());
};
const server: DrawerState = { id: null, compose: null, seq: 0 };

export const openPartner = (id: string, o: { compose?: string } = {}) => {
  if (!id) return;
  set({ id: String(id), compose: o.compose || null, seq: state.seq + 1 });
};
export const closePartner = () => set({ id: null, compose: null });
export const openPartnerId = (): string | null => state.id;

export function useDrawer(): DrawerState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
    () => server
  );
}

/** A hook for components: returns a function that opens the partner drawer. */
export function useOpenPartner(): (id: string, o?: { compose?: string }) => void {
  return openPartner;
}

/** A form that is open in the drawer asks to be closed by Escape before the drawer is. Returns true when it handled the key. */
let escGuard: (() => boolean) | null = null;
export const setEscGuard = (f: (() => boolean) | null) => {
  escGuard = f;
};
export const runEscGuard = (): boolean => (escGuard ? escGuard() : false);

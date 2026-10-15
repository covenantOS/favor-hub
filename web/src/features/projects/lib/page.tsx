// What every Projects screen shares: the page's task store, opening a task in the drawer, and the quick add box. Provided by the home
// page and the project page; read with usePage().
import { createContext, useContext } from 'react';
import type { TaskCtx } from './store';

export interface QuickAddDefaults {
  section_id?: string | null;
  due_date?: string;
  owner_email?: string;
  project_id?: string | null;
}

export interface PageApi {
  ctx: TaskCtx;
  /** Open a task (id or code) in the drawer. */
  openTask: (ref: string) => void;
  /** Open the quick add box. */
  quickAdd: (defaults?: QuickAddDefaults) => void;
}

export const PageContext = createContext<PageApi | null>(null);
export function usePage(): PageApi {
  const p = useContext(PageContext);
  if (!p) throw new Error('usePage outside a Projects page');
  return p;
}

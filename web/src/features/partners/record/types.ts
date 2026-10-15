// State the partner view keeps while it is open, and what the sections get from it.
import type { Note, Partner } from './lib';

export type Mode = 'drawer' | 'full' | 'compact';

/** A line on the timeline: a gift, a contact, a note, or something from this hub (mention, meeting). */
export interface Ev {
  t: 'gift' | 'note' | 'act' | 'hub';
  gid?: string;
  id?: string;
  d: string;
  a?: number;
  what: string;
  how?: string;
  text?: string;
  by?: string;
  icon?: string;
  href?: string;
  src?: string;
  log?: { type?: string; date?: string; summary?: string; source?: string } | null;
  logged?: boolean;
  fresh?: number;
}
export interface LocalTask {
  id: string;
  what: string;
  kind: string;
  by: string;
  due: string;
  local?: boolean;
  done?: boolean;
}
/** Changes made here that the copy of Blackbaud does not show yet. */
export interface LocalState {
  events: Ev[];
  tasks: LocalTask[];
  done: Set<string>;
  moved: Record<string, string>;
  thanked: Set<string>;
  thankedNow: string;
  notes: Note[];
  logged: Set<string>;
}
export const emptyLocal = (): LocalState => ({ events: [], tasks: [], done: new Set(), moved: {}, thanked: new Set(), thankedNow: '', notes: [], logged: new Set() });

export interface ViewState {
  tab: string;
  filter: string;
  shown: number;
  compose: string | null;
  prefill: { type?: string; date?: string; summary?: string; source?: string; from?: string } | null;
  notesShown: number;
  noteOpen: Set<string>;
  editing: string | null;
}
export const initialView = (): ViewState => ({ tab: 'overview', filter: 'all', shown: 8, compose: null, prefill: null, notesShown: 10, noteOpen: new Set(), editing: null });

export interface Ctx {
  id: string;
  mode: Mode;
  p: Partner;
  as: string;
  notes: Note[] | null;
  story: any;
  storyLoading: boolean;
  tl: any;
  codes: any;
  V: ViewState;
  setV: (patch: Partial<ViewState>) => void;
  L: LocalState;
  events: Ev[];
  focusGift: string;
  focusOpp: string;
  ix: boolean;
  act: {
    compose: (kind: string) => void;
    closeCompose: () => void;
    save: (kind: string, form: SaveForm) => Promise<void>;
    logit: (src: string) => void;
    done: (id: string) => Promise<void>;
    move: (id: string, date: string) => Promise<void>;
    thank: (anchor: HTMLElement, g: any) => void;
    taskOpen: (id: string) => void;
    saveOpp: (id: string, opp: Record<string, string>) => Promise<void>;
    setTab: (tab: string) => void;
    reload: () => void;
  };
}
export interface SaveForm {
  what: string;
  text?: string;
  when?: string;
  kind?: string;
  tags?: string[];
  topic?: string;
  instruction?: boolean;
}

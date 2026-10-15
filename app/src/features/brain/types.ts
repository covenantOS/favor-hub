// Favor Brain's shapes, as /api/brain sends them. Blocks are open: a type this page does not know draws its markdown.
/* eslint-disable @typescript-eslint/no-explicit-any */

/** One answer block. `type` picks the component (blocks/registry.tsx); the rest is that type's own fields. */
export interface Block {
  type: string;
  [k: string]: any;
}

export interface Step {
  id: 'read' | 'lookup' | 'check' | 'answer' | string;
  label: string;
  status: 'running' | 'done' | 'withheld' | 'skipped' | 'pending' | 'handoff';
  at?: number;
  ms?: number;
  detail?: string;
  count?: string;
}

export interface ReadingChip {
  key: string;
  label: string;
  value: string;
  options?: string[] | null;
}

export interface Turn {
  q: string;
  ref?: string | null;
  at?: string;
  blocks: Block[] | null;
  reading: ReadingChip[];
  follow: string[];
  lists?: { token?: string; label?: string; rows?: number }[];
  markdown?: string;
  intent?: string;
  outcome?: string;
  asked_as?: string;
  steps?: Step[];
  extras?: Block[];
  rated?: 'right' | 'wrong' | null;
  hint?: boolean;
  connectCard?: boolean;
  pending?: boolean;
  error?: string | null;
  stopped?: boolean;
  stored?: boolean;
  editing?: boolean;
}

export interface Conv {
  id: string;
  title: string;
  turns: Turn[];
}

export interface ConvRow {
  id: string;
  title: string;
  pinned: number | boolean;
  made_at?: string;
  changed_at: string;
  pending?: number;
  preview?: string;
  turns?: number;
  same?: string[];
}

export interface Pkg {
  key: string;
  label: string;
  has: boolean;
  requestable?: boolean;
  until?: string;
}

export interface Me {
  email?: string;
  name?: string;
  role?: string;
  admin?: boolean;
  packages?: Pkg[];
  requests?: { package: string; status: string }[];
}

export interface StoredTurn {
  n?: number;
  question: string;
  answer: any;
  at: string;
  ref: string | null;
}

/** A turn from the Brain's reply to a question asked now. */
export function fromReply(q: string, d: any): Turn {
  return {
    q,
    ref: d.ref,
    at: new Date().toISOString(),
    blocks: d.blocks || [],
    reading: Array.isArray(d.reading) ? d.reading : [],
    follow: d.follow || [],
    lists: d.lists || [],
    markdown: d.markdown || d.text || '',
    steps: Array.isArray(d.steps) ? d.steps : [],
    intent: d.intent,
    outcome: d.outcome,
    asked_as: d.asked_as || q,
    hint: d.hint === 'connect',
    extras: [],
    rated: null,
  };
}

/** A turn from a stored chat (answer_json is the Brain's stored answer). */
export function fromStored(t: StoredTurn): Turn {
  const a = t.answer || {};
  const base: Turn = { q: t.question, ref: t.ref, at: t.at, blocks: null, reading: [], follow: [], lists: [], markdown: '', extras: [], rated: null, stored: true };
  if (a.pending) return { ...base, ref: null, blocks: null, pending: true };
  if (a.error) return { ...base, blocks: null, error: a.error };
  return {
    ...base,
    blocks: a.blocks || [],
    reading: Array.isArray(a.reading) ? a.reading : [],
    follow: a.follow || [],
    lists: a.lists || [],
    steps: Array.isArray(a.steps) ? a.steps : [],
    intent: a.intent,
    outcome: a.outcome,
    asked_as: a.asked_as || t.question,
  };
}

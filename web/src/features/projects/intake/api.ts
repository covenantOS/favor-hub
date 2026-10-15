// The browser client for requests inside Projects: one function per route of /api/tasks/intake/*, each returning the parsed answer or
// throwing an Error with .code, .status and a message that is safe to show (the same `call` as the rest of Projects). Routes and their
// rules are listed in functions/_lib/intake/route.ts; the design is in README-model.ts.
//
// Reading the composer's chips needs no network: `parseRequest` runs in the browser (parse.ts). `intakeApi.parse` asks the server for the
// same chips plus the suggested owner from the board's history and the staff list, and is the one to use for the assignee chip.
import { call, qs, type ApiError } from '../lib/api';
import type { Parsed, PersonLite } from '@shared/request-parse';
import type {
  IntakeAcceptTarget,
  IntakeDetail,
  IntakeItem,
  IntakeSubmit,
  IntakeTeam,
  IntakeTriageInput,
} from '@shared/intake-model';

const base = '/api/tasks/intake';
const enc = encodeURIComponent;

export interface SubmitResult {
  request: IntakeItem;
  parsed: Parsed;
}

/** A request about money does not become a card: the answer carries the address of the expense form. */
export interface ExpenseRedirect {
  expense: true;
  href: string;
  message: string;
}

export type QueueScope = 'intake' | 'open' | 'all';

export const intakeApi = {
  /** My requests with where each one is. all = true adds everything older than 45 days. */
  mine: (all = false) => call<{ ok: true; requests: IntakeItem[] }>('GET', `${base}/mine${qs({ all: all ? 1 : undefined })}`),

  /** The chips for the words typed so far, with the suggested owner, and the staff list for the assignee chip. */
  parse: (text: string, opts?: { signal?: AbortSignal }) => call<{ ok: true; parsed: Parsed; people: PersonLite[] }>('POST', `${base}/parse`, { text }, opts),

  /**
   * Sends a request. Pass files to send pictures, PDFs and Word files with it (up to 6, 4 MB each). Resolves with the new request, or
   * with { expense: true, href } when the words are about money, which the composer answers by opening the expense form.
   */
  submit: async (input: IntakeSubmit & { title?: string }, files: File[] = []): Promise<SubmitResult | ExpenseRedirect> => {
    try {
      if (!files.length) return await call<SubmitResult>('POST', `${base}/submit`, input);
      const form = new FormData();
      form.set('payload', JSON.stringify(input));
      for (const f of files) form.append('files', f);
      return await call<SubmitResult>('POST', `${base}/submit`, form);
    } catch (e) {
      const err = e as ApiError & { href?: string };
      if (err.code === 'expense') return { expense: true, href: expenseHref(input.text), message: err.message };
      throw e;
    }
  },

  /** The teams I triage, with their pipeline sections and how many requests wait (for the Intake tab and its badge). */
  teams: () => call<{ ok: true; teams: IntakeTeam[] }>('GET', `${base}/teams`),

  /** The cards waiting on my teams. scope intake = Sent and still in Intake (the default); open adds Approved and In progress. */
  queue: (o: { team?: string; scope?: QueueScope } = {}) => call<{ ok: true; teams: string[]; requests: IntakeItem[] }>('GET', `${base}/queue${qs(o)}`),

  /** One request in full: the item, the conversation, the files, the history and what I may do with it. 404 when it is not mine to read. */
  request: (id: string) => call<{ ok: true } & IntakeDetail>('GET', `${base}/r/${enc(id)}`),

  /** Where Accept can put a request, and who it could go to. For people who triage. */
  options: (id: string) => call<{ ok: true; projects: IntakeAcceptTarget[]; people: Array<{ email: string; name: string; title: string; team: string; picture: string }> }>('GET', `${base}/r/${enc(id)}/options`),

  accept: (id: string, input: IntakeTriageInput = {}) => call<{ ok: true; request: IntakeItem; told: { via: string; why: string } }>('POST', `${base}/r/${enc(id)}/accept`, input),
  ask: (id: string, question: string) => call<{ ok: true; request: IntakeItem }>('POST', `${base}/r/${enc(id)}/ask`, { question }),
  decline: (id: string, reason: string) => call<{ ok: true; request: IntakeItem }>('POST', `${base}/r/${enc(id)}/decline`, { reason }),
  /** The person who asked answers a question, or the owner adds a note. */
  reply: (id: string, body: string) => call<{ ok: true; request: IntakeItem }>('POST', `${base}/r/${enc(id)}/reply`, { body }),
};

export const expenseHref = (text: string): string => `/expenses/new/?reason=${enc(text.slice(0, 300))}`;

export const isExpense = (r: SubmitResult | ExpenseRedirect): r is ExpenseRedirect => (r as ExpenseRedirect).expense === true;

/** Query keys for react-query, so every screen refreshes the same lists after a change. */
export const intakeKeys = {
  all: ['intake'] as const,
  mine: ['intake', 'mine'] as const,
  teams: ['intake', 'teams'] as const,
  queue: (scope: QueueScope = 'intake', team = '') => ['intake', 'queue', scope, team] as const,
  request: (id: string) => ['intake', 'request', id] as const,
  options: (id: string) => ['intake', 'options', id] as const,
};

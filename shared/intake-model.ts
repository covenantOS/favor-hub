// How a request lives in Projects. Shared by the server (functions/_lib/intake) and the web app (web/src/features/projects/intake).
// The design is written out in web/src/features/projects/intake/README-model.ts. Pure: no server or browser APIs.
import type { Kind } from './request-parse';

/** The stages of every team's pipeline, in order. These are the section names, exact. */
export const STAGES = ['Intake', 'Triage', 'In progress', 'Review', 'Done'] as const;
export type Stage = (typeof STAGES)[number];

/** Where Accept puts a card when the owner picks no other stage. */
export const DEFAULT_ACCEPT_STAGE: Stage = 'Triage';

/** The teams that own a pipeline. Expense requests keep their own screen and approval, so they are not a team here. */
export type PipelineTeam = 'tech' | 'marketing';
export const PIPELINE_TEAMS: PipelineTeam[] = ['tech', 'marketing'];

/** The pipeline project each team gets. Projects are made on first use; an admin may rename one or change its lead. */
export const PIPELINE_PROJECTS: Record<PipelineTeam, { name: string; key: string; description: string; color: string }> = {
  tech: { name: 'Tech requests', key: 'TRQ', description: 'Requests for Tech, from Intake to Done. Accept a request into any project from its card.', color: 'sky' },
  marketing: { name: 'Marketing requests', key: 'MRQ', description: 'Requests for Marketing, from Intake to Done. Accept a request into any project from its card.', color: 'sun' },
};

/** The status the request board always had. requests.status stays the one record of it. */
export type RequestStatus = 'inbox' | 'approved' | 'in_progress' | 'done' | 'declined';

/** The words the person who asked sees. Review reads as In progress. */
export const STATUS_WORD: Record<RequestStatus, string> = {
  inbox: 'Sent',
  approved: 'Approved',
  in_progress: 'In progress',
  done: 'Done',
  declined: 'Declined',
};

/** The four stops shown under a request, in order. */
export const STOPS = ['Sent', 'Approved', 'In progress', 'Done'] as const;

/**
 * The request status a section name means. In a team pipeline the names are exact (Intake is Sent, Triage is Approved, In progress and
 * Review are In progress, Done is Done). In any other project the owner picks a stage by its own name, so the words are matched loosely:
 * done-like names close it, doing-like names are In progress, anything else is Approved.
 */
export function statusForSection(name: string | null | undefined, inPipeline: boolean): RequestStatus {
  const n = String(name || '').trim();
  if (inPipeline && /^intake$/i.test(n)) return 'inbox';
  if (/^(done|complete|completed|finished)$/i.test(n)) return 'done';
  if (/(progress|doing|working|review|testing|building|underway)/i.test(n)) return 'in_progress';
  return 'approved';
}

/** Which stage a section name is, or null when it is not one of the five. */
export function stageOf(name: string | null | undefined): Stage | null {
  const n = String(name || '').trim().toLowerCase();
  return STAGES.find((s) => s.toLowerCase() === n) ?? null;
}

/** One person as the intake answers name them. */
export interface IntakePerson {
  email: string;
  name: string;
  picture?: string;
}

/** The chips a request was sent with, kept on its card. */
export interface IntakeChips {
  team: PipelineTeam;
  kind: Kind;
  place: string;
  audience: string;
  needed: string;
  assignee: string | null;
}

export interface IntakeStep {
  key: 'sent' | 'approved' | 'in_progress' | 'done';
  label: string;
  at: string | null;
  state: 'done' | 'now' | 'next';
}

export interface IntakeMove {
  at: string;
  text: string;
}

/** A question the owner asked, shown to the person who asked until they answer. */
export interface IntakeQuestion {
  by: IntakePerson;
  body: string;
  at: string;
}

/** One request as the lists and the drawer show it. The same shape serves My requests, the Intake queue and a single request. */
export interface IntakeItem {
  /** The request id (req_...). */
  id: string;
  title: string;
  body: string;
  status: RequestStatus;
  /** Sent, Approved, In progress, Done or Declined. */
  word: string;
  steps: IntakeStep[];
  team: PipelineTeam;
  team_name: string;
  kind: Kind;
  place: string;
  place_label: string;
  audience: string;
  /** The card in Projects. Null for a declined request, which never gets one. */
  task: { id: string; code: string | null; url: string } | null;
  project: { id: string; key: string; name: string } | null;
  section: { id: string; name: string } | null;
  /** The stage name when the card sits in a team pipeline section, else null. */
  stage: Stage | null;
  owner: IntakePerson | null;
  /** Who the person asked for, from the composer's assignee chip. */
  assignee_hint: IntakePerson | null;
  due_date: string | null;
  /** The person who asked. Triagers and admins always get it; the person who asked gets themselves. */
  submitter: IntakePerson | null;
  question: IntakeQuestion | null;
  declined_reason: string | null;
  created_at: string;
  updated_at: string;
  done_at: string | null;
  moves: IntakeMove[];
  /** The link that opens it in Projects. */
  href: string;
}

/** What the signed-in person may do with one request. */
export interface IntakeStanding {
  submitter: boolean;
  /** Owns the team's pipeline (a member of its project) or is a FavorOS admin. */
  triage: boolean;
}

export interface IntakeSubmit {
  text: string;
  /** Edited chips. Anything left out is read from the text. */
  team?: string;
  kind?: string;
  place?: string;
  audience?: string;
  due_date?: string | null;
  assignee?: string | null;
}

export interface IntakeTriageInput {
  /** accept */
  project_id?: string;
  section_id?: string;
  owner_email?: string;
  due_date?: string | null;
  note?: string;
}

export const INTAKE_LIMITS = { text: 4000, reason: 600, question: 2000, note: 600 } as const;

/** A team the signed-in person triages: its pipeline project, the sections to show as columns, and how many requests wait. */
export interface IntakeTeam {
  team: PipelineTeam;
  name: string;
  project: { id: string; key: string; name: string };
  sections: Array<{ id: string; name: string; stage: Stage | null }>;
  counts: { intake: number; questions: number; open: number };
}

/** A place Accept can put a request: a project the person may add to, with the stages it has. */
export interface IntakeAcceptTarget {
  id: string;
  key: string;
  name: string;
  /** Linked to Asana: a request accepted here goes to Asana too, in one of the stages it already has. */
  synced: boolean;
  pipeline: PipelineTeam | null;
  sections: Array<{ id: string; name: string }>;
}

export interface IntakeComment {
  id: string;
  body: string;
  at: string;
  by: { email: string; name: string };
  mine: boolean;
}

export interface IntakeAttachment {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  url: string;
}

/** One request in full, for the drawer and the My requests detail. */
export interface IntakeDetail {
  item: IntakeItem;
  standing: IntakeStanding;
  attachments: IntakeAttachment[];
  comments: IntakeComment[];
  history: Array<{ id: string; kind: string; actor: string; at: string }>;
  page_url: string | null;
}

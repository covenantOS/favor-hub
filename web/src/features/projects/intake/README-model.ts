// REQUESTS INSIDE PROJECTS: how a request is stored, who sees it, and the words people read. Read this first. The shared constants at the
// bottom are the ones the screens use; the server uses the same file (shared/intake-model.ts), so the two cannot drift.
//
// WHAT A REQUEST IS NOW
//   The request itself stays in `requests` (the words, the files, the conversation, the history and requests.status, which is still the
//   one record of Sent / Approved / In progress / Done / Declined). Its CARD is a hub_tasks row with request_id set. The card sits in the
//   Intake section of its team's pipeline project. hub_intake keeps what the composer sent (kind, place, audience, the reason for each
//   chip), whether a question is open, and who decided. hub_intake_teams says which project is each team's pipeline.
//   Schema: db/projects-intake.sql. Server: functions/_lib/intake/. Routes: /api/tasks/intake/* (list in functions/_lib/intake/route.ts).
//
// THE TEAM'S PIPELINE
//   Two teams own one: Tech and Marketing. Each gets a project ("Tech requests" TRQ, "Marketing requests" MRQ), made the first time a
//   request needs it. Its sections are exactly Intake, Triage, In progress, Review, Done. It is members-only (visibility 'members'), led
//   by the person the staff directory names (Tech: the Lead Developer; Marketing: its director; else the first FavorOS admin), and
//   its members are the team's owners. Owners add members the usual way (Project > Members).
//   A request about money (the Goes to chip says Expense request) makes no card: the composer sends the person to /expenses/new/,
//   which keeps its own approver, signature and PDF.
//   Who owns a request: the Goes to chip. It is read from the words with the old route finder's keywords (shared/request-parse.ts
//   routeByWords), is editable, and defaults to Tech when the words name nothing. Marketing used to go to an Asana form (or the
//   projects.marketing_key project); that path is left alone for the old pages, and the new composer does not use it.
//
// THE FIVE STAGES AND THE FOUR WORDS (what the person who asked reads)
//   Intake        Sent          new, untouched. A question asked of the person who asked keeps it here with a "Question for you" mark.
//   Triage        Approved      the owner accepted it; it waits its turn. Accept with no other choice lands here.
//   In progress   In progress   being worked on
//   Review        In progress   being checked (still reads In progress)
//   Done          Done          finished. Landing in Done ticks the card and sends the done email, exactly as ticking the card does.
//   (declined)    Declined      closed with a reason, shown to the person who asked. The card is dropped; the request stays.
//   A card dragged to any stage, or accepted into another project's stage, sets the request's status from the stage's name
//   (statusForSection): done-like names close it, doing-like names (progress, doing, review...) are In progress, anything else is Approved.
//
// THE OWNER'S THREE ACTIONS (POST /api/tasks/intake/r/:id/...)
//   accept   moves the card into a project and a stage (default: the team's own Triage), sets the owner (default: the person the asker
//            named, else the accepter) and the due date, makes the request Approved or further, and tells the asker once (a Chat card, or
//            one email when they are not in Chat; both behind the request notice gate). Press it again to move the card again.
//   ask      posts a question as a comment on the request, tells the asker the way any comment is told, keeps the card in Intake with
//            question_open = 1. The asker answers with reply, which closes the question and tells the owner.
//   decline  needs a reason. Closes the request, drops the card, posts "Declined: reason" as a comment, and the reason shows on
//            My requests.
//
// ASANA (the two-way sync is not touched; these rules keep it quiet)
//   A pipeline project is never linked to Asana (setProjectSync refuses it), so a card in Intake, Triage or any pipeline stage makes no
//   task and no section in Asana. Accept into a project that IS linked puts the card in a stage that project already has and the usual
//   task.moved event queues it: Asana gets the task (its notes carry the request's words and a link back). The server never adds a
//   section to a linked project, so a stage must be one the project has (or none, and Asana files it in its first section). A task
//   ticked in Asana closes the request on the next pass (sweepDoneTasks) and sends the done email. Cards in Done stay hub-only.
//
// WHO SEES WHAT (do not widen; the privacy smoke check has a cell for every route below)
//   The person who asked: their own requests (GET mine, GET r/:id for theirs) with status, owner, due date, the question and the
//   decline reason. Not the team's board: the card's creator is the team lead, the asker is not a follower, and the pipeline project is
//   members-only, so /api/tasks and /api/projects never show them the card.
//   The team's owners (members of the pipeline project, its lead) and FavorOS admins: that team's Intake queue and every request in it.
//   A request from a test account is read by the test accounts alone, and sits in a separate test pipeline led by that account.
//   Nobody else reads a request through these routes; a stranger's id answers 404, never 403.
//   The old board's open reading (/api/requests, readable by any signed-in person) is left as it was and is not used by Projects.
//
// MIGRATION (scripts/migrate-requests-to-projects.mjs, dry run by default)
//   inbox -> Intake, approved -> Triage, in_progress -> In progress, done -> Done (ticked, with its finish time). A request that already
//   has a card (it was accepted before) keeps that card where it is and gets a link row. Declined requests get a link row and no card.
//   Test accounts' requests are left alone. Keyed on the request id, so a second run changes nothing.
//
// ADDRESSES (exactly these)
//   /projects/?compose=1     the "What do you need?" composer      /projects/?tab=requests   My requests
//   /projects/?tab=intake    the Intake view for people who triage  /projects/?r=<request id>  one request, opened in the drawer
//   /requests/ and /requests/new/ redirect to the Intake view and the composer; /requests/?r=<id> redirects to /projects/?r=<id>.
export {
  STAGES,
  STOPS,
  STATUS_WORD,
  DEFAULT_ACCEPT_STAGE,
  PIPELINE_TEAMS,
  PIPELINE_PROJECTS,
  INTAKE_LIMITS,
  statusForSection,
  stageOf,
} from '@shared/intake-model';
export type {
  Stage,
  PipelineTeam,
  RequestStatus,
  IntakeItem,
  IntakePerson,
  IntakeStep,
  IntakeMove,
  IntakeQuestion,
  IntakeStanding,
  IntakeChips,
  IntakeSubmit,
  IntakeTriageInput,
} from '@shared/intake-model';

export const INTAKE_ADDRESSES = {
  compose: '/projects/?compose=1',
  mine: '/projects/?tab=requests',
  intake: '/projects/?tab=intake',
  request: (id: string) => `/projects/?r=${encodeURIComponent(id)}`,
} as const;

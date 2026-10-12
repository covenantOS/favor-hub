// Project templates built from how Favor runs its work. Each one comes from the Marketing Daily history in hub_tasks (the weekly
// Newsletter checklist, the monthly Appeal tasks, the Marketing Request print orders, the grants asset library and the hosted
// event invite) and the department manuals. People are never named here. A task names a role, and the role is matched to the
// staff directory by title when the plan is drafted, so a new hire or a departure needs no change to this file.

export type RoleId =
  | 'designer'
  | 'creative'
  | 'social'
  | 'video'
  | 'dev'
  | 'programs'
  | 'grantwriter'
  | 'grantlead'
  | 'grantadmin'
  | 'finance'
  | 'ops'
  | 'admin'
  | 'rdd'
  | 'church'
  | 'carecare'
  | 'lead';

/** Title patterns, tried in order. A role with no match falls to the project lead. */
export const ROLE_TITLES: Record<RoleId, { label: string; titles: RegExp[] }> = {
  designer: { label: 'Designer', titles: [/graphic designer/i] },
  creative: { label: 'Creative lead', titles: [/creative director/i] },
  social: { label: 'Marketing assistant', titles: [/marketing\/support|\(marketing/i, /marketing (&|and) campaign/i] },
  video: { label: 'Video', titles: [/director of media/i, /videographer/i] },
  dev: { label: 'Tech', titles: [/developer/i] },
  programs: { label: 'Program facts', titles: [/uganda|south sudan|country director/i] },
  grantwriter: { label: 'Grant writer', titles: [/grants (specialist|management)/i, /grant writer/i] },
  grantlead: { label: 'Grants lead', titles: [/director of grant/i] },
  grantadmin: { label: 'Grants admin', titles: [/grants coordinator/i] },
  finance: { label: 'Finance', titles: [/deputy director of operations/i, /director of operations/i] },
  ops: { label: 'Operations', titles: [/director of operations/i] },
  admin: { label: 'Administration', titles: [/hr\/operations administrator/i, /^administrative assistant$/i] },
  rdd: { label: 'Regional director', titles: [/regional development director/i, /\brdd\b/i] },
  church: { label: 'Church engagement', titles: [/church engagement/i] },
  carecare: { label: 'Partner Care', titles: [/partner care/i] },
  lead: { label: 'Project lead', titles: [] },
};

export interface TemplateTask {
  title: string;
  role: RoleId;
  /** Days from the anchor date. Negative is before. */
  offset: number;
  note?: string;
  priority?: 'low' | 'normal' | 'high';
  /** Keep a weekend date as written (a Saturday send). Other dates move back to Friday. */
  weekend?: boolean;
}

export interface TemplateSection {
  name: string;
  tasks: TemplateTask[];
}

export interface Template {
  id: string;
  name: string;
  /** One line for the chooser. */
  blurb: string;
  keywords: RegExp;
  /** What the date means: shown beside the date box. */
  anchor: string;
  /** Days ahead of today when the person gives no date. */
  lead: number;
  /** Snap the anchor to this weekday (0 Sunday to 6 Saturday), forward. */
  snap?: number;
  team: string;
  color: string;
  /** Where the structure came from. Shown nowhere; kept so the next person can check it. */
  basis: string;
  sections: TemplateSection[];
}

export const TEMPLATES: Template[] = [
  {
    id: 'newsletter',
    name: 'Weekly newsletter',
    blurb: 'Story in, build, approval, Saturday 10 AM send, Monday social post',
    keywords: /\bnewsletter|weekly (email|issue)|e-?news\b/i,
    anchor: 'Send date (a Saturday)',
    lead: 7,
    snap: 6,
    team: 'Marketing',
    color: 'sky',
    basis: 'The Newsletter task checklist in Marketing Daily (28 issues, one a week, due Friday) and the Newsletter Post task that follows each issue on Monday.',
    sections: [
      {
        name: 'Content',
        tasks: [
          { title: 'Receive the story from the field', role: 'programs', offset: -5, note: 'The story and photos for this issue.' },
          { title: 'Write the issue in Blackbaud', role: 'designer', offset: -4 },
          { title: 'Build the art in Canva', role: 'designer', offset: -4 },
        ],
      },
      {
        name: 'Giving',
        tasks: [
          { title: 'Create the appeal code', role: 'dev', offset: -3, note: 'One code for this issue so gifts trace back to it.' },
          { title: 'Create the giving form', role: 'dev', offset: -3 },
          { title: 'Make the PDF and upload it to Share Now Links', role: 'designer', offset: -3 },
        ],
      },
      {
        name: 'Approval and send',
        tasks: [
          { title: 'Get content approval', role: 'programs', offset: -2, note: 'Approval runs through the program director, who clears it with the founder.', priority: 'high' },
          { title: 'Hand the finished issue to Tech with the go', role: 'creative', offset: -1 },
          { title: 'Schedule and send, Saturday 10 AM', role: 'dev', offset: 0, weekend: true },
          { title: 'Resend to non-openers', role: 'dev', offset: 3 },
        ],
      },
      { name: 'After', tasks: [{ title: 'Post the newsletter to social', role: 'social', offset: 2 }] },
    ],
  },
  {
    id: 'appeal',
    name: 'Monthly appeal letter',
    blurb: 'Letter, design, codes, list, print proof, mail drop, results',
    keywords: /\bappeal|direct mail|mailing|mail ?drop|letter campaign\b/i,
    anchor: 'Mail drop date',
    lead: 28,
    team: 'Marketing',
    color: 'terra',
    basis: 'The monthly Appeal tasks in Marketing Daily (March to September 2026, each due about three weeks before its month), print orders and the CE Letter inserts request.',
    sections: [
      {
        name: 'Letter',
        tasks: [
          { title: 'Choose the story and the ask', role: 'creative', offset: -24 },
          { title: 'Write the letter', role: 'designer', offset: -21 },
          { title: 'Get message approval', role: 'lead', offset: -17, priority: 'high' },
        ],
      },
      {
        name: 'Design and print',
        tasks: [
          { title: 'Design the letter, reply card and envelope', role: 'designer', offset: -16 },
          { title: 'Send the proof to the print vendor', role: 'designer', offset: -12 },
          { title: 'Approve the printed proof', role: 'creative', offset: -9 },
          { title: 'Order the print run', role: 'designer', offset: -8 },
        ],
      },
      {
        name: 'Codes and lists',
        tasks: [
          { title: 'Create the appeal and source codes', role: 'dev', offset: -14 },
          { title: 'Build the giving form for the appeal', role: 'dev', offset: -12 },
          { title: 'Pull the mailing list and clear opt-outs', role: 'dev', offset: -10 },
          { title: 'Send the list to the mail house', role: 'dev', offset: -7 },
        ],
      },
      {
        name: 'Mail and results',
        tasks: [
          { title: 'Mail drop', role: 'admin', offset: 0 },
          { title: 'Check the first gifts trace to the appeal code', role: 'dev', offset: 7 },
          { title: 'Write the results summary', role: 'creative', offset: 21 },
        ],
      },
    ],
  },
  {
    id: 'banquet',
    name: 'Banquet or hosted dinner',
    blurb: 'Venue and budget, invitations, materials, event day, thank-yous',
    keywords: /\bbanquet|dinner|gala|fundrais(er|ing) event|hosted event|reception|luncheon|rdd event\b/i,
    anchor: 'Event date',
    lead: 63,
    team: 'Development (RDD)',
    color: 'sun',
    basis: 'The hosted-event invite request, RDD table setup, RDD letterhead, giving envelopes and map tasks in Marketing Daily, and the RDD manual.',
    sections: [
      {
        name: 'Plan',
        tasks: [
          { title: 'Confirm the date, venue and host', role: 'rdd', offset: -56, priority: 'high' },
          { title: 'Approve the budget', role: 'finance', offset: -52 },
          { title: 'Build the guest list from partner records', role: 'rdd', offset: -49 },
          { title: 'Line up the speaker and the program', role: 'rdd', offset: -42 },
        ],
      },
      {
        name: 'Invitations',
        tasks: [
          { title: 'Design the invitation', role: 'designer', offset: -42 },
          { title: 'Send the invitations', role: 'rdd', offset: -35 },
          { title: 'Follow up on RSVPs', role: 'rdd', offset: -14 },
          { title: 'Final RSVP count to the venue', role: 'rdd', offset: -7 },
        ],
      },
      {
        name: 'Materials',
        tasks: [
          { title: 'Update the map and printed pieces', role: 'designer', offset: -21 },
          { title: 'Print giving envelopes, connect cards and letterhead', role: 'designer', offset: -14 },
          { title: 'Create the event appeal code and giving form', role: 'dev', offset: -14 },
          { title: 'Cut the program video or slideshow', role: 'video', offset: -10 },
          { title: 'Pack the table kit', role: 'admin', offset: -3 },
        ],
      },
      {
        name: 'Event day and after',
        tasks: [
          { title: 'Event day', role: 'rdd', offset: 0, weekend: true, priority: 'high' },
          { title: 'Send thank-you notes to everyone who came', role: 'rdd', offset: 2 },
          { title: 'Enter gifts and log the event in Blackbaud', role: 'carecare', offset: 4 },
          { title: 'Debrief and record what to change', role: 'rdd', offset: 10 },
        ],
      },
    ],
  },
  {
    id: 'grant',
    name: 'Grant application',
    blurb: 'Eligibility, outline, program facts, budget, attachments, review, submit',
    keywords: /\bgrant|foundation (application|proposal)|proposal|loi\b|letter of inquiry|funder\b/i,
    anchor: 'Funder deadline',
    lead: 45,
    team: 'Grants',
    color: 'leaf',
    basis: 'The Grants manual, the grants media and testimony asset library request in Marketing Daily, the thank-you within one business day rule and the Grants Action log.',
    sections: [
      {
        name: 'Prepare',
        tasks: [
          { title: 'Check eligibility and the funder guidelines', role: 'grantwriter', offset: -45 },
          { title: 'Write the outline and pick the program', role: 'grantwriter', offset: -38 },
          { title: 'Request program facts and current numbers', role: 'programs', offset: -35, note: 'Program facts in a proposal are cleared by the program director.' },
        ],
      },
      {
        name: 'Write',
        tasks: [
          { title: 'First draft', role: 'grantwriter', offset: -28, priority: 'high' },
          { title: 'Build the budget with Finance', role: 'finance', offset: -24 },
          { title: 'Gather attachments: financials, 990, board list, letters', role: 'grantadmin', offset: -21 },
          { title: 'Pull photos and testimonies from the grants asset library', role: 'video', offset: -18 },
        ],
      },
      {
        name: 'Review and submit',
        tasks: [
          { title: 'Review by the grants lead', role: 'grantlead', offset: -12 },
          { title: 'Clear program facts', role: 'programs', offset: -8 },
          { title: 'Final edits', role: 'grantwriter', offset: -4 },
          { title: 'Submit', role: 'grantwriter', offset: -2, priority: 'high' },
        ],
      },
      {
        name: 'After',
        tasks: [
          { title: 'Log the submission as a Grants Action', role: 'grantadmin', offset: 1 },
          { title: 'Follow up with the funder', role: 'grantwriter', offset: 14 },
          { title: 'Thank the funder within one business day of an award', role: 'grantwriter', offset: 30 },
        ],
      },
    ],
  },
  {
    id: 'print',
    name: 'Print order',
    blurb: 'Brief, design, proof, order, delivery',
    keywords: /\bprint|flyer|business cards?|brochure|insert|letterhead|banner|poster|connect card\b/i,
    anchor: 'Needed by',
    lead: 14,
    team: 'Marketing',
    color: 'dusk',
    basis: 'Marketing Request tickets tagged Print Order in Marketing Daily: flyers, business cards, inserts and letterhead, usually one to three weeks.',
    sections: [
      {
        name: 'Design',
        tasks: [
          { title: 'Confirm the brief, quantity and paper', role: 'creative', offset: -12 },
          { title: 'Design the piece', role: 'designer', offset: -10 },
          { title: 'Requester signs off on the proof', role: 'lead', offset: -7, priority: 'high' },
        ],
      },
      {
        name: 'Order and deliver',
        tasks: [
          { title: 'Place the order with the print vendor', role: 'designer', offset: -6 },
          { title: 'Receive and check the delivery', role: 'admin', offset: -1 },
          { title: 'Update the print inventory', role: 'admin', offset: 1 },
        ],
      },
    ],
  },
  {
    id: 'church-newsletter',
    name: 'Church newsletter',
    blurb: 'Email to partner and prospect churches, four a year',
    keywords: /\bchurch(es)? (newsletter|email)|pastor (email|newsletter)\b/i,
    anchor: 'Send date',
    lead: 21,
    team: 'Church Engagement',
    color: 'teal',
    basis: 'The February and June Church Newsletter tasks and the draft and analytics tasks around them in Marketing Daily.',
    sections: [
      {
        name: 'Draft',
        tasks: [
          { title: 'Collect the stories and the ask', role: 'church', offset: -14 },
          { title: 'Draft the issue', role: 'church', offset: -10 },
          { title: 'Design the issue', role: 'designer', offset: -7 },
          { title: 'Approve the content', role: 'programs', offset: -4 },
        ],
      },
      {
        name: 'Send',
        tasks: [
          { title: 'Build the church list in Blackbaud', role: 'dev', offset: -3 },
          { title: 'Schedule and send', role: 'dev', offset: 0 },
          { title: 'Report opens, clicks and gifts', role: 'dev', offset: 5 },
        ],
      },
    ],
  },
];

export const templateById = (id: string): Template | undefined => TEMPLATES.find((t) => t.id === id);

/** The template whose keywords match the sentence best, or null. Longer matches score higher. */
export function matchTemplate(text: string): Template | null {
  let best: { t: Template; score: number } | null = null;
  for (const t of TEMPLATES) {
    const re = new RegExp(t.keywords.source, 'gi');
    let score = 0;
    for (const m of text.matchAll(re)) score += m[0].length;
    if (score && (!best || score > best.score)) best = { t, score };
  }
  return best ? best.t : null;
}

/** What a sentence with no matching template starts from. */
export const GENERIC: Template = {
  id: 'generic',
  name: 'Project',
  blurb: 'Plan, prepare, launch, wrap up',
  keywords: /$^/,
  anchor: 'Finish date',
  lead: 28,
  team: '',
  color: 'leaf',
  basis: 'Used when no Favor template fits the sentence.',
  sections: [
    { name: 'Plan', tasks: [{ title: 'Write the goal and what done looks like', role: 'lead', offset: -26 }, { title: 'List who is involved and what each does', role: 'lead', offset: -24 }] },
    { name: 'Prepare', tasks: [{ title: 'Draft the main piece of work', role: 'lead', offset: -14 }, { title: 'Review with the people involved', role: 'lead', offset: -7 }] },
    { name: 'Launch', tasks: [{ title: 'Finish and deliver', role: 'lead', offset: 0, priority: 'high' }] },
    { name: 'Wrap up', tasks: [{ title: 'Record what worked and what to change', role: 'lead', offset: 7 }] },
  ],
};

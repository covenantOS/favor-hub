// The default onboarding and offboarding checklists. Onboarding comes from the HR manual's checklist, the Favor Onboarding
// Checklists master and the orientation checklist (US Team Files, Operations, US Talent); offboarding from the staff
// offboarding checklist. HR can change the list on the Onboarding page: edits land in onb_template, and an empty table means
// this list. Duties name roles, never people; the Owners card on the Onboarding page says who holds each duty.

export type Kind = 'onboard' | 'offboard';
export type StepKind = 'task' | 'form' | 'learn' | 'auto';

export const PAPERWORK_URL = 'https://onboard.favorintl.org';

/** Who owns what. `supervisor`, `hire` and `starter` come from the run itself; the rest come from onb_owners. */
export const DUTIES: Array<{ key: string; label: string; hint: string }> = [
  { key: 'hr', label: 'HR file and shared drive', hint: 'Employee file, Google Admin email, paperwork, Paycom, shared drive, equipment' },
  { key: 'directory', label: 'Staff directory and groups', hint: 'Staff directory, Google Groups, recurring calendar events' },
  { key: 'whatsapp', label: 'WhatsApp', hint: 'Field Updates and department threads' },
  { key: 'training', label: 'Training', hint: 'Blackbaud and Drive training for the role' },
  { key: 'tech', label: 'Technical access', hint: 'Blackbaud user, the website, the KPI dashboard, Favor Brain, GoHighLevel' },
  { key: 'overseer', label: 'Oversight', hint: 'Sees every run and each step that is late' },
];
export const RUN_DUTIES = ['supervisor', 'hire', 'starter'];

export interface TemplateStep {
  key: string;
  grp: string;
  sort: number;
  title: string;
  detail: string;
  step_kind: StepKind;
  duty: string;
  offset_days: number;
  link_url?: string;
  link_label?: string;
  hq_only?: boolean;
  leaving_only?: boolean;
  docs?: string[];
}

export const GROUPS: Record<Kind, Array<{ key: string; label: string }>> = {
  onboard: [
    { key: 'before', label: 'Before day one' },
    { key: 'day1', label: 'Day one' },
    { key: 'week1', label: 'First week' },
    { key: 'month1', label: 'First month' },
  ],
  offboard: [
    { key: 'before', label: 'Before the last day' },
    { key: 'last', label: 'On the last day' },
    { key: 'after', label: 'After' },
  ],
};

/** The HR file: one mark per document received. Michael's checklist, the paper form HR has used since 2024. */
export const HR_DOCS = [
  'Signed job offer letter',
  'Resume',
  'Photo ID',
  'Employee information sheet',
  'References',
  'Background check authorization',
  'W-4',
  'I-9',
  'Direct deposit form',
  'Non-disclosure agreement',
  'Code of conduct',
  'Conflict of interest',
  'Employee handbook acknowledgement',
  'Technology and program policy',
  'Expense management and travel policy acknowledgement',
  'Release document',
];

const s = (key: string, grp: string, sort: number, title: string, detail: string, duty: string, offset_days: number, more: Partial<TemplateStep> = {}): TemplateStep => ({
  key,
  grp,
  sort,
  title,
  detail,
  step_kind: 'task',
  duty,
  offset_days,
  ...more,
});

export const ONBOARD_STEPS: TemplateStep[] = [
  s('email', 'before', 10, 'Create the Favor email in Google Admin', 'Everything else waits on this. Make it after the offer letter is signed. FavorOS cannot create a Google account.', 'hr', -7),
  s('file', 'before', 20, 'Start the employee file', 'A folder for the person in the US Executive Drive, Operations, US Talent. Tick each document as it arrives. FavorOS records that a document arrived and keeps nothing from it.', 'hr', -7, { docs: HR_DOCS }),
  s('invite', 'before', 30, 'Start the paperwork site for the new hire', 'Submit the start form at onboard.favorintl.org with the new hire’s first name, last name, phone and Favor email.', 'hr', -5, { link_url: PAPERWORK_URL, link_label: 'Open onboard.favorintl.org' }),
  s('book', 'before', 40, 'Send Carole’s book', 'Mail or hand over the book the orientation checklist asks every new hire to read.', 'hr', -5),
  s('paperwork', 'before', 50, 'Finish the HR paperwork', 'Complete the forms from the paperwork site: employee information sheet, background check authorization, direct deposit, W-4, code of conduct, conflict of interest and the policy acknowledgements. Press Done when they are all in.', 'hire', -3, { step_kind: 'form', link_url: PAPERWORK_URL, link_label: 'Open the paperwork site' }),
  s('directory', 'before', 60, 'Add to the staff directory', 'Name, title, team and work email in the Favor Staff Directory on the shared drive.', 'directory', -3),
  s('hubadd', 'before', 70, 'Add to FavorOS', 'Gives the new hire a FavorOS account, joins the default Chat channels, sets the supervisor and start date, and assigns the New hire paths in Learn. Press Add to FavorOS on this page.', 'starter', -2, { step_kind: 'auto' }),
  s('drive', 'before', 80, 'Add to the shared drive', 'Add the new hire to US Team Files and to the department folder. Folder names start with the department letters and the two-digit year.', 'hr', -2),
  s('whatsapp', 'before', 90, 'Add to WhatsApp', 'The Field Updates group and the department threads. Share the mute and auto-download settings from the hardware and software checklist.', 'whatsapp', -2),
  s('groups', 'before', 100, 'Add to Google Groups', 'The All Staff Google Group and every department group the role needs.', 'directory', -2),
  s('blackbaud', 'before', 110, 'Create the Blackbaud user and set the role', 'Admin, Security, User Management. Tell the new hire which Blackbaud role was set and why.', 'tech', -2),
  s('paycom', 'before', 120, 'Set up Paycom', 'Time sheet, time off and expense cards. The new hire requests time off through FavorOS, two weeks ahead.', 'hr', -2),
  s('equipment', 'before', 130, 'Equipment, email signature and door code', 'Equipment form, email signature line, and for headquarters staff the door code.', 'hr', -1, { hq_only: true }),
  s('welcome', 'day1', 140, 'Welcome the new hire and walk through the first-day page', 'Meet in person or on a call. Open the first-day page in FavorOS together. For headquarters staff: the tour, housekeeping and the office devotions schedule.', 'supervisor', 0, { link_url: '/welcome/', link_label: 'Open the first-day page' }),
  s('calendar', 'day1', 150, 'Add the recurring calendar events', 'The Wednesday all-staff meeting, the department meeting, and for the RDD team the RDD meeting and the weekly tasks on Monday and Friday.', 'directory', 0),
  s('firstday', 'day1', 160, 'Read the first-day page and take the FavorOS tour', 'Who to meet, what the first week holds and how to find things in FavorOS.', 'hire', 0, { step_kind: 'form', link_url: '/welcome/', link_label: 'Open the first-day page' }),
  s('ospath', 'week1', 170, 'Finish New hire: FavorOS in Learn', 'Short lessons on Today, Chat, Projects, requests and meetings, with a quiz.', 'hire', 7, { step_kind: 'learn', link_url: '/learn/', link_label: 'Open Learn' }),
  s('trainbb', 'week1', 180, 'Blackbaud training for the role', 'Schedule the training for this role: Blackbaud first day, then the actions the role enters.', 'training', 7),
  s('teammates', 'week1', 190, 'A 15-minute call with each teammate', 'Connect with every person in the department. Take notes.', 'hire', 14, { step_kind: 'form' }),
  s('favpath', 'week1', 200, 'Finish New hire: Favor in Learn', 'Orientation videos, Core Values, the Ten Channels of Grace, the 10/40 Window and the Africa ministries, with a quiz.', 'hire', 14, { step_kind: 'learn', link_url: '/learn/', link_label: 'Open Learn' }),
  s('rre', 'week1', 210, 'Write the role’s RR&E and review it together', 'The new hire writes their own responsibilities and expectations by hand, then they review it with the supervisor. Signed policy acknowledgements go to HR.', 'supervisor', 14),
  s('checkin', 'month1', 220, '30-day check-in', 'Supervisor and new hire: what is clear, what is not, and what training is still missing.', 'supervisor', 30),
];

export const OFFBOARD_STEPS: TemplateStep[] = [
  s('exit', 'before', 10, 'Exit conversation', 'Supervisor meets the person. Record anything that needs follow-up in the run notes.', 'supervisor', -3),
  s('handover', 'before', 20, 'Hand over open work', 'Open tasks, request cards, Blackbaud assignments and partners move to the supervisor or the person who takes the job. The panel on this page lists what the person still owns.', 'supervisor', -2, { step_kind: 'auto' }),
  s('equipment', 'last', 30, 'Collect equipment, keys and the door code', 'Return the equipment form signed. Change the door code if the person had it.', 'hr', 0),
  s('hubclose', 'last', 40, 'Close FavorOS access', 'Blocks the FavorOS account, ends open sessions and unlinks Google. Press Close FavorOS access on this page on the last day.', 'starter', 0, { step_kind: 'auto', leaving_only: true }),
  s('google', 'last', 50, 'Suspend the Google Workspace account', 'Needs a Workspace admin. Suspend first, delete only after the files are moved.', 'hr', 0, { leaving_only: true }),
  s('paycom', 'last', 60, 'Final pay and Paycom', 'Close the Paycom profile and run the final pay.', 'hr', 0, { leaving_only: true }),
  s('blackbaud', 'last', 70, 'Make the Blackbaud user inactive', 'Never delete a user who has left: deleting removes the contact history on constituent records.', 'tech', 0, { leaving_only: true }),
  s('bbassign', 'last', 80, 'Reassign Blackbaud assignments and partners', 'Open assignments go to the person who takes the job. Credit for gifts dated in the person’s time stays with them.', 'tech', 0),
  s('kpi', 'last', 90, 'Remove from the KPI dashboard', 'Out of the access list and into the blocked list, then check the sign-in refuses.', 'tech', 0, { leaving_only: true }),
  s('brain', 'last', 100, 'Remove from Favor Brain', 'Blocked in the access list and out of the team lists.', 'tech', 0, { leaving_only: true }),
  s('website', 'last', 110, 'Remove from the team page on favorintl.org', 'Deploy and check the page live.', 'tech', 0, { leaving_only: true }),
  s('ghl', 'last', 120, 'Report their GoHighLevel users', 'Report the logins to HR. Do not remove them without the technical owner.', 'tech', 0, { leaving_only: true }),
  s('directory', 'last', 130, 'Remove from the staff directory, WhatsApp and Google Groups', 'The Field Team Updates group stays.', 'directory', 0, { leaving_only: true }),
  s('logins', 'last', 140, 'Remove from shared logins and subscriptions', 'The master record of software logins shows where the person had access.', 'hr', 0, { leaving_only: true }),
  s('files', 'after', 150, 'Move their files', 'Shared drive files and My Drive to the supervisor or the department folder.', 'hr', 7, { leaving_only: true }),
  s('roster', 'after', 160, 'Update the roster and name an owner for each job', 'Every job the person held needs an owner. Say which jobs have none yet.', 'overseer', 7),
];

export const DEFAULTS: Record<Kind, TemplateStep[]> = { onboard: ONBOARD_STEPS, offboard: OFFBOARD_STEPS };

/* ------------------------------------------------------------------------------------------------ dates */

export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A weekend due date moves to the Friday before when it falls before the anchor day, and to the Monday after otherwise. */
export function dueFrom(anchor: string, offset: number): string {
  let d = addDays(anchor, offset);
  const dow = new Date(d + 'T12:00:00Z').getUTCDay();
  if (dow === 6) d = addDays(d, offset < 0 ? -1 : 2);
  else if (dow === 0) d = addDays(d, offset < 0 ? -2 : 1);
  return d;
}

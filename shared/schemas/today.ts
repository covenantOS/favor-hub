import { z } from 'zod';
import { access, hubUser } from './common';

export const todayCard = z.object({
  id: z.string(),
  label: z.string(),
  n: z.number(),
  amount: z.number().optional(),
  what: z.string(),
  note: z.string().default(''),
  warn: z.boolean().default(false),
  href: z.string(),
  cta: z.string().optional().default(''),
});
export type TodayCard = z.infer<typeof todayCard>;

export const todayMine = z.object({
  kind: z.string(),
  title: z.string(),
  status: z.string(),
  at: z.string(),
  href: z.string(),
});
export type TodayMine = z.infer<typeof todayMine>;

export const todayActivity = z.object({
  at: z.string(),
  app: z.string(),
  text: z.string(),
  href: z.string().default(''),
});
export type TodayActivity = z.infer<typeof todayActivity>;

/** GET /api/hub/today */
export const todayResponse = z.object({
  ok: z.literal(true),
  user: hubUser,
  access,
  cards: z.array(todayCard),
  mine: z.array(todayMine),
  activity: z.array(todayActivity),
});
export type TodayResponse = z.infer<typeof todayResponse>;

export const kpiTeam = z.object({
  key: z.string(),
  name: z.string(),
  amount: z.number(),
  goal: z.number(),
  measure: z.enum(['raised', 'awarded']),
});

export const kpiSummary = z.object({
  asOf: z.string(),
  lastUpdated: z.string().nullable(),
  raised: z.number(),
  goal: z.number(),
  raisedLastYear: z.number().nullable(),
  teams: z.array(kpiTeam),
});
export type KpiSummary = z.infer<typeof kpiSummary>;

/** GET /api/hub/kpi */
export const kpiResponse = z.object({ ok: z.literal(true), summary: kpiSummary });
export type KpiResponse = z.infer<typeof kpiResponse>;

export const dayAction = z.object({
  id: z.string(),
  due: z.string(),
  type: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  cid: z.string().optional(),
  partner: z.string().optional().default(''),
});
export type DayAction = z.infer<typeof dayAction>;

export const dayEvent = z.object({
  id: z.string(),
  start: z.string(),
  end: z.string(),
  allDay: z.boolean(),
  title: z.string(),
  link: z.string().default(''),
  meet: z.string().default(''),
  phone: z.string().default(''),
  provider: z.string().default(''),
  source: z.string().default(''),
  people: z.array(z.string()).default([]),
  hub: z.string().default(''),
  organizer: z.boolean().default(false),
  canEdit: z.boolean().default(false),
  declined: z.boolean().default(false),
});
export type DayEvent = z.infer<typeof dayEvent>;

export const dayFile = z.object({
  id: z.string(),
  name: z.string(),
  link: z.string(),
  modified: z.string(),
  by: z.string().default(''),
  icon: z.string().optional(),
  mime: z.string().default(''),
});
export type DayFile = z.infer<typeof dayFile>;

export const dayMail = z.object({
  id: z.string(),
  threadId: z.string().default(''),
  from: z.string(),
  fromEmail: z.string().default(''),
  subject: z.string(),
  date: z.string().default(''),
  link: z.string().default(''),
});
export type DayMail = z.infer<typeof dayMail>;

/** GET /api/hub/day. A part of the Google half is null when it could not be read. */
export const dayResponse = z.object({
  ok: z.literal(true),
  blackbaud: z
    .object({
      linked: z.boolean(),
      actions: z.array(dayAction).default([]),
      total: z.number().default(0),
      overdue: z.number().default(0),
      error: z.string().optional(),
    })
    .passthrough(),
  google: z
    .object({
      connected: z.boolean(),
      events: z.array(dayEvent).nullable().optional(),
      mayWrite: z.boolean().optional(),
      files: z.array(dayFile).nullable().optional(),
      mail: z.array(dayMail).nullable().optional(),
      mailUnread: z.number().nullable().optional(),
      partners: z.record(z.string(), z.object({ name: z.string(), id: z.string() })).optional(),
      error: z.string().optional(),
    })
    .passthrough(),
});
export type DayResponse = z.infer<typeof dayResponse>;

/** POST /api/hub/day-move */
export const dayMoveResponse = z.object({
  ok: z.literal(true),
  id: z.string(),
  room: z.string(),
  linked: z.boolean().optional(),
  linkError: z.string().optional(),
});
export type DayMoveResponse = z.infer<typeof dayMoveResponse>;

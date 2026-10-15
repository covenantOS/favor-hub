// /api/admin/goals: fundraiser goals kept in FavorOS, with the tie-out against the KPI dashboard.
import { z } from 'zod';

const amount = z.number().nullable();

export const goalValues = z.object({
  annual_goal: amount,
  q1_goal: amount,
  q2_goal: amount,
  q3_goal: amount,
  q4_goal: amount,
  prev_q4_goal: amount,
});
export type GoalValues = z.infer<typeof goalValues>;

export const goalRow = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  lead: z.boolean(),
  active: z.boolean(),
  start: z.string().nullable(),
  end: z.string().nullable(),
  bb: goalValues,
  goals: goalValues,
  note: z.string().default(''),
  updatedBy: z.string().nullable(),
  updatedAt: z.string().nullable(),
  saved: z.boolean(),
});
export type GoalRowData = z.infer<typeof goalRow>;

export const tieLine = z.object({ key: z.string(), name: z.string(), dashboard: z.number(), favoros: z.number(), match: z.boolean() });

export const goalsResponse = z
  .object({
    ok: z.literal(true),
    year: z.number(),
    currentYear: z.number(),
    source: z.enum(['dashboard', 'favoros']),
    rows: z.array(goalRow),
    tie: z.object({ lines: z.array(tieLine), allMatch: z.boolean() }).nullable(),
  })
  .passthrough();
export type GoalsResponse = z.infer<typeof goalsResponse>;

export const goalSaved = z.object({ ok: z.literal(true), row: goalRow }).passthrough();
export const goalSeeded = z.object({ ok: z.literal(true), added: z.number(), kept: z.number() }).passthrough();
export const goalSource = z.object({ ok: z.literal(true), source: z.enum(['dashboard', 'favoros']) }).passthrough();

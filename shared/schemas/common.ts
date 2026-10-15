// Shapes shared by the Pages Functions and the React app. A route answers with one of these and the app parses what comes back
// with the same schema, so a field renamed on one side fails a test on the other.
import { z } from 'zod';

/** Every API answer is { ok: true, ... } or { ok: false, error, message }. */
export const apiError = z.object({ ok: z.literal(false), error: z.string().optional(), message: z.string().optional() });

export const hubUser = z.object({
  email: z.string(),
  name: z.string(),
  picture: z.string().optional().default(''),
  role: z.enum(['staff', 'admin']),
  via: z.enum(['google', 'password', 'agent', 'device']),
  kpi: z.boolean(),
});
export type HubUser = z.infer<typeof hubUser>;

/** Access flags from /api/hub/nav. New flags are added on the server first, so unknown keys pass through. */
export const access = z
  .object({
    admin: z.boolean(),
    kpi: z.boolean(),
    approver: z.boolean().optional(),
    expenseLog: z.boolean().optional(),
    workCenter: z.boolean().optional(),
    clips: z.boolean().optional(),
    meetings: z.boolean().optional(),
    clipsRecord: z.boolean().optional(),
    chat: z.boolean().optional(),
    projects: z.boolean().optional(),
    tasks: z.boolean().optional(),
    bell: z.boolean().optional(),
    learn: z.boolean().optional(),
    learnAdmin: z.boolean().optional(),
    hr: z.boolean().optional(),
    giftEntry: z.boolean().optional(),
    otherGifts: z.boolean().optional(),
    moves: z.boolean().optional(),
    mail: z.boolean().optional(),
  })
  .passthrough();
export type Access = z.infer<typeof access>;

export const counts = z.record(z.string(), z.number()).default({});
export type Counts = z.infer<typeof counts>;

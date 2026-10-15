// /api/work/recurring: every recurring gift schedule from the D1 copy of Blackbaud with the hub's finished changes laid over it.
import { z } from 'zod';

export const recurringChange = z
  .object({
    id: z.string(),
    op: z.enum(['amount', 'frequency', 'status', 'skip', 'next_date']),
    summary: z.string(),
    by: z.string().default(''),
    at: z.string(),
    askedBy: z.string().default(''),
    state: z.string(),
    undoable: z.boolean(),
  })
  .passthrough();
export type RecurringChange = z.infer<typeof recurringChange>;

export const recurringRow = z
  .object({
    id: z.string(),
    cid: z.string(),
    name: z.string(),
    place: z.string().default(''),
    status: z.string(),
    amount: z.number(),
    frequency: z.string().default(''),
    frequencyLabel: z.string().default(''),
    method: z.string().default(''),
    fund: z.string().default(''),
    start: z.string().default(''),
    end: z.string().default(''),
    next: z.string().default(''),
    statusDate: z.string().default(''),
    annual: z.number().default(0),
    months: z.array(z.boolean()),
    paid12: z.number().default(0),
    paid: z.number().default(0),
    lastPaid: z.string().default(''),
    holder: z.string().default(''),
    declinedOn: z.string().default(''),
    declineReason: z.string().default(''),
    declineRecovered: z.boolean().default(false),
    declines: z.number().default(0),
    daysLate: z.number().default(0),
    flags: z.object({ declined: z.boolean(), pastDue: z.boolean(), pastEnd: z.boolean(), stopped90: z.boolean(), twoYears: z.boolean(), noPayment: z.boolean() }),
    changes: z.array(recurringChange).default([]),
  })
  .passthrough();
export type RecurringRow = z.infer<typeof recurringRow>;

export const recurringStats = z
  .object({
    active: z.number(),
    card: z.number(),
    bank: z.number(),
    scheduledEach: z.number(),
    payments12: z.number(),
    paid30Schedules: z.number(),
    paid30Amount: z.number(),
    declined: z.number(),
    stopped90: z.number(),
    pastDue: z.number(),
    pastEnd: z.number(),
    held: z.number(),
    stopped: z.number(),
    twoYears: z.number(),
  })
  .passthrough();

export const recurringResponse = z
  .object({
    ok: z.literal(true),
    today: z.string(),
    synced: z.string().default(''),
    stats: recurringStats,
    rows: z.array(recurringRow),
    frequencies: z.array(z.object({ value: z.string(), label: z.string() })),
    askedBy: z.array(z.string()),
    canEdit: z.boolean(),
  })
  .passthrough();
export type RecurringResponse = z.infer<typeof recurringResponse>;

export const recurringEditResponse = z
  .object({ ok: z.literal(true), id: z.string().optional(), state: z.string().optional(), summary: z.string().optional(), repeat: z.boolean().optional(), batch: z.object({ id: z.string(), n: z.number() }).nullable().optional() })
  .passthrough();
export type RecurringEditResponse = z.infer<typeof recurringEditResponse>;

import { z } from 'zod';

/** GET /api/hub/notifications (functions/_lib/hub/notifications.ts): meetings, Learning, Evaluations, Mail, Expenses, Receipts, Feedback, Brain, Requests. */
export const hubNotice = z.object({
  id: z.string(),
  source: z.string(),
  head: z.string(),
  txt: z.string().default(''),
  href: z.string(),
  n: z.number().default(1),
  warn: z.boolean().default(false),
  at: z.string().optional(),
});
export type HubNotice = z.infer<typeof hubNotice>;
export const hubNotifications = z.object({ ok: z.literal(true), items: z.array(hubNotice), count: z.number().default(0), counts: z.record(z.string(), z.number()).default({}) });

/** GET /api/work/reminders */
export const reminderRow = z
  .object({ id: z.union([z.string(), z.number()]).transform(String), title: z.string(), note: z.string().nullable().optional(), bucket: z.string().optional(), at: z.string(), cid: z.union([z.string(), z.number()]).nullable().optional().transform((v) => (v == null ? '' : String(v))) })
  .passthrough();
export const remindersResponse = z.object({ ok: z.literal(true), rows: z.array(reminderRow).default([]), count: z.number().default(0), now: z.number().optional() });

/** GET /api/requests/notices */
export const requestNotice = z.object({ id: z.union([z.string(), z.number()]).transform(String), kind: z.string(), actor_name: z.string().nullable().optional(), title: z.string(), note: z.string().nullable().optional(), request_id: z.union([z.string(), z.number()]).transform(String), created_at: z.string() }).passthrough();
export const requestNoticesResponse = z.object({ ok: z.literal(true), count: z.number().default(0), items: z.array(requestNotice).default([]) });

/** GET /api/tasks/links/bell */
export const projectNotice = z.object({ id: z.union([z.string(), z.number()]).transform(String), url: z.string(), head: z.string(), title: z.string(), txt: z.string().nullable().optional(), created_at: z.string() }).passthrough();
export const projectNoticesResponse = z.object({ ok: z.literal(true), count: z.number().default(0), items: z.array(projectNotice).default([]) });

/** GET /api/chat/inbox */
export const chatNotice = z.object({ id: z.union([z.string(), z.number()]).transform(String), kind: z.string(), from: z.string().optional(), from_name: z.string().nullable().optional(), channel_kind: z.string().optional(), channel_name: z.string().nullable().optional(), channel_id: z.union([z.string(), z.number()]).transform(String), thread_id: z.union([z.string(), z.number()]).nullable().optional(), body: z.string().optional(), created_at: z.string().optional() }).passthrough();
export const chatInboxResponse = z.object({ ok: z.literal(true), count: z.number().default(0), items: z.array(chatNotice).default([]) });

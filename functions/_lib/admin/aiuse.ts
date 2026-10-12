// Puts the daily AI budget (../ai/guard.ts) over env.AI once per isolate, and counts calls a day for the health strip.
// Every model call in the hub goes through it: a call past today's cap throws AiPaused and the feature falls back to its rules.
// The FavorOS Testers can force every call closed for their own requests (cookie hub_ai_closed=1) to see the fallbacks; their
// requests count as test runs, which alone may draw on the month's extra test units an admin sets in Admin > Settings.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Env } from '../http';
import { guardBinding } from '../ai/guard';

interface Who {
  tester: boolean;
  closed: boolean;
}
const als = new AsyncLocalStorage<Who>();

/** Runs the rest of a request with who is asking known to the guard. */
export function withAiCaller<T>(who: Who, fn: () => T): T {
  return als.run(who, fn);
}

export function countAiCalls(env: Env): void {
  const ai = env.AI as (Env['AI'] & { counted?: boolean; guarded?: boolean }) | undefined;
  if (!ai || ai.counted || ai.guarded) return;
  try {
    const store = { db: env.DB as any, kv: (env as any).BB_KV || null };
    const guarded = guardBinding(store, {
      run: async (model: string, input: unknown) => {
        try {
          await env.DB.prepare('INSERT INTO hub_ai_use (day, calls) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET calls = calls + 1').bind(new Date().toISOString().slice(0, 10)).run();
        } catch {
          // the table arrives with db/admin-home.sql
        }
        return ai.run(model, input);
      },
    }, {
      closedFor: () => !!als.getStore()?.closed,
      testFor: () => !!als.getStore()?.tester,
    });
    env.AI = Object.assign(guarded, { counted: true }) as unknown as Env['AI'];
  } catch {
    // an environment that cannot be changed keeps the original binding
  }
}

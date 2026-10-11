// Counts the hub's Workers AI calls, one row a day, so the health strip can show use. The wrapper sits over env.AI once per isolate
// and passes every call through unchanged; a counting failure never touches the call.
import type { Env } from '../http';

export function countAiCalls(env: Env): void {
  const ai = env.AI as (Env['AI'] & { counted?: boolean }) | undefined;
  if (!ai || ai.counted) return;
  try {
    env.AI = {
      counted: true,
      run: async (model: string, input: unknown) => {
        try {
          await env.DB.prepare('INSERT INTO hub_ai_use (day, calls) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET calls = calls + 1').bind(new Date().toISOString().slice(0, 10)).run();
        } catch {
          // the table arrives with db/admin-home.sql
        }
        return ai.run(model, input);
      },
    } as Env['AI'];
  } catch {
    // an environment that cannot be changed keeps the original binding
  }
}

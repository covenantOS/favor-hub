// Where the Intake lane adds its panel to the task drawer. STUB: the intake lane replaces this file.
// The drawer renders <IntakeSlot task={task} ctx={ctx} /> between the fields and the description of every task. It draws nothing for a
// task that did not come in as a request.
import type { TaskCtx } from '../lib/store';
import type { Task } from '../types';

export function IntakeSlot({ task, ctx }: { task: Task; ctx: TaskCtx | null }) {
  void task;
  void ctx;
  return null;
}

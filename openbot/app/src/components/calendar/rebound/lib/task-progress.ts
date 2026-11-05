import { timeToMin } from "./helpers";
import type { Block, Task } from "./types";

export function blockDurationMinutes(block: Block): number {
  return Math.max(0, timeToMin(block.end) - timeToMin(block.start));
}

export function completedTaskMinutes(
  taskId: string,
  blocks: readonly Block[],
): number {
  return blocks
    .filter(
      (block) =>
        block.kind === "task" &&
        block.refId === taskId &&
        block.status === "done",
    )
    .reduce((total, block) => total + blockDurationMinutes(block), 0);
}

/** Outstanding effort before subtracting future scheduled blocks. Once a
 * student reports an exact remainder, that value supersedes estimate-minus-
 * history; completed/partial history must not be counted a second time. */
export function taskRemainingMinutes(
  task: Task,
  blocks: readonly Block[],
): number {
  if (task.remainingEstimateMin !== undefined) {
    return Math.max(0, task.remainingEstimateMin);
  }
  return Math.max(0, task.estimateMin - completedTaskMinutes(task.id, blocks));
}

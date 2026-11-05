import { formatDate, timeToMin } from "./helpers";
import {
  blockDurationMinutes,
  completedTaskMinutes,
  taskRemainingMinutes,
} from "./task-progress";
import type { Block, Task, TaskPriority } from "./types";

export type TaskPlanState =
  | "complete"
  | "blocked"
  | "waiting"
  | "unscheduled"
  | "at-risk"
  | "on-track";

export interface TaskPlanInsight {
  taskId: string;
  state: TaskPlanState;
  completedMin: number;
  remainingMin: number;
  scheduledMin: number;
  progressPct: number;
  etaDate?: string;
  etaTime?: string;
  blockingTaskIds: string[];
  reason: string;
}

export const TASK_PRIORITY_ORDER: Record<TaskPriority, number> = {
  asap: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Replace planner-internal ISO dates with the same human-readable date style
 * used everywhere else in the UI. The engine keeps its deterministic reason
 * strings; views call this at the presentation boundary. */
export function humanizeTaskPlanReason(reason: string): string {
  return reason.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (date) => formatDate(date));
}

export function taskPriority(task: Task): TaskPriority {
  return task.priority ?? "medium";
}

export function analyzeTaskPlan(
  task: Task,
  tasks: Task[],
  blocks: Block[],
  today: string,
): TaskPlanInsight {
  const mine = blocks.filter(
    (block) => block.kind === "task" && block.refId === task.id,
  );
  const doneMin = completedTaskMinutes(task.id, mine);
  const remainingMin = taskRemainingMinutes(task, mine);
  const completedMin =
    task.remainingEstimateMin === undefined
      ? doneMin
      : Math.max(doneMin, task.estimateMin - remainingMin);
  const upcoming = mine
    .filter((block) => block.status === "todo" && block.date >= today)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || timeToMin(a.start) - timeToMin(b.start),
    );
  const scheduledMin = upcoming.reduce(
    (total, block) => total + blockDurationMinutes(block),
    0,
  );
  const eta = upcoming[upcoming.length - 1];
  const blockingTaskIds = (task.dependsOn ?? []).filter((id) => {
    const dependency = tasks.find((candidate) => candidate.id === id);
    return dependency !== undefined && !dependency.done;
  });
  const currentTotal = Math.max(task.estimateMin, completedMin + remainingMin);
  const progressPct =
    currentTotal <= 0
      ? 100
      : Math.min(100, Math.round((completedMin / currentTotal) * 100));

  const base = {
    taskId: task.id,
    completedMin,
    remainingMin,
    scheduledMin,
    progressPct,
    ...(eta ? { etaDate: eta.date, etaTime: eta.end } : {}),
    blockingTaskIds,
  };

  if (task.done || remainingMin === 0) {
    return { ...base, state: "complete", reason: "Completed" };
  }
  if (blockingTaskIds.length > 0) {
    return {
      ...base,
      state: "blocked",
      reason: `Waiting for ${blockingTaskIds.length} prerequisite${blockingTaskIds.length === 1 ? "" : "s"}`,
    };
  }
  const effectiveStart =
    task.resumeOn && (!task.startDate || task.resumeOn > task.startDate)
      ? task.resumeOn
      : task.startDate;
  if (effectiveStart && task.due && effectiveStart > task.due) {
    return {
      ...base,
      state: "at-risk",
      reason: `Starts ${effectiveStart}, after the ${task.due} deadline`,
    };
  }
  if (effectiveStart && effectiveStart > today && scheduledMin === 0) {
    return {
      ...base,
      state: "waiting",
      reason: `Available to schedule starting ${effectiveStart}`,
    };
  }
  if (scheduledMin < remainingMin) {
    const missing = remainingMin - scheduledMin;
    return {
      ...base,
      state: scheduledMin === 0 ? "unscheduled" : "at-risk",
      reason:
        task.deadlineType === "hard"
          ? `${missing} min could not fit before the hard deadline`
          : `${missing} min still needs a time`,
    };
  }
  if (task.due && task.due < today) {
    return { ...base, state: "at-risk", reason: "Deadline has passed" };
  }
  if (task.due && eta && eta.date > task.due) {
    return {
      ...base,
      state: "at-risk",
      reason: `Finishes ${eta.date}, after the ${task.due} deadline`,
    };
  }
  return {
    ...base,
    state: "on-track",
    reason: eta ? `Planned to finish ${eta.date}` : "Scheduled",
  };
}

export function analyzeTaskPlans(
  tasks: Task[],
  blocks: Block[],
  today: string,
): Map<string, TaskPlanInsight> {
  return new Map(
    tasks.map((task) => [task.id, analyzeTaskPlan(task, tasks, blocks, today)]),
  );
}

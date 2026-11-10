import type {
  CalendarEvent,
  PlanStaleReason,
  PlanStatus,
  SchoolSnapshot,
  StudyBlock,
  StudyPlan,
} from "@openbot/shared/study";
import { z } from "zod";
import type { StudyRecord, StudyStore } from "./contracts";
import { normaliseName } from "./rules";
import type { BusyEvent, PlanTask } from "./scheduler";
import { isDate, isTimeZone, zonedInstant } from "./time";

/*
 * The glue between a study plan's pieces: the student's assignments as the scheduler's tasks, their
 * calendar and applied plans as the time it must leave alone, the assignments a request names to
 * do first, and a plan as it is stored (kind "plan") and read back. Pure, apart from the one store
 * read that every caller makes the same way (appliedPlans).
 *
 * A plan is stored whole in its record's data, every StudyPlan field but `stale` and `staleReason`,
 * which depend on what happened since and are worked out each time the plan is read. The record's
 * status column is the truth for status, so a list by status and the plan it returns never
 * disagree. A plan taken off the calendar is "discarded" and keeps its appliedAt, with removedAt
 * beside it in the data.
 */

/** The kinds of work a plan makes time for. Materials and announcements are read, not done. */
const PLANNED_KINDS = new Set(["assignment", "quiz", "test"]);

/** "HH:mm" within one day. A block never runs past midnight: the study hours end before it. */
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** How far ahead of a moment an applied plan can still be running: plans start within 30 days. */
const HORIZON_MS = 400 * 86_400_000;

/** Kinds taken in class at their due time: once that has passed, there is nothing to catch up. */
const HAPPENS_IN_CLASS = new Set(["quiz", "test"]);

/**
 * The work still to do at `now`, as the scheduler's tasks: open and missing assignments, quizzes and
 * tests with time estimated for them, titled with their class ("Chemistry: Lab 6 report") because a
 * block on a calendar has to say which class it is for. Returned work is done; a material has
 * nothing to hand in; a quiz or test whose time has come has been taken, whatever its notice says.
 * Late assignments stay: they are planned as catch-up.
 */
export function tasksFrom(snapshot: SchoolSnapshot, now: Date): PlanTask[] {
  const names = new Map(
    snapshot.classes.map((schoolClass) => [schoolClass.id, schoolClass.name]),
  );
  const seen = new Set<string>();
  const tasks: PlanTask[] = [];
  for (const assignment of snapshot.assignments) {
    if (assignment.status !== "open" && assignment.status !== "missing")
      continue;
    if (!PLANNED_KINDS.has(assignment.kind)) continue;
    if (
      HAPPENS_IN_CLASS.has(assignment.kind) &&
      assignment.due !== null &&
      Date.parse(assignment.due) <= now.getTime()
    )
      continue;
    if (!Number.isFinite(assignment.minutes) || assignment.minutes <= 0)
      continue;
    // A due date nobody can read would be planned with no deadline at all; better left out.
    if (assignment.dueDate !== null && !isDate(assignment.dueDate)) continue;
    if (seen.has(assignment.id)) continue;
    seen.add(assignment.id);
    const className = names.get(assignment.classId);
    tasks.push({
      id: assignment.id,
      title: className ? `${className}: ${assignment.title}` : assignment.title,
      classId: assignment.classId,
      due: assignment.dueDate,
      dueTime:
        assignment.dueTime !== null && CLOCK.test(assignment.dueTime)
          ? assignment.dueTime
          : null,
      minutes: assignment.minutes,
    });
  }
  return tasks;
}

/**
 * The time a new plan must leave alone: every timed calendar event as a commitment, and every
 * applied study block as study for its assignment. All the applied blocks from today on, not only
 * those on the days being planned, because the scheduler counts them against their assignment's
 * minutes wherever they fall: an hour of the essay already planned for Saturday is an hour less to
 * plan tonight.
 */
export function busyFrom(
  events: readonly CalendarEvent[],
  appliedPlans: readonly Pick<StudyPlan, "blocks">[],
): BusyEvent[] {
  return [
    ...events.map(
      (event): BusyEvent => ({
        id: event.id,
        date: event.date,
        start: event.start,
        end: event.end,
        kind: "commitment",
      }),
    ),
    ...appliedPlans.flatMap((plan) =>
      plan.blocks.map(
        (block): BusyEvent => ({
          id: block.id,
          date: block.date,
          start: block.start,
          end: block.end,
          kind: "study",
          assignmentId: block.assignmentId,
        }),
      ),
    ),
  ];
}

const wordsOf = (text: string) => {
  const normalised = normaliseName(text);
  return normalised.length > 0 ? normalised.split(" ") : [];
};

/** Whether `needle` is a run of whole words inside `haystack`. */
function containsRun(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0) return false;
  for (let start = 0; start + needle.length <= haystack.length; start++)
    if (needle.every((word, offset) => haystack[start + offset] === word))
      return true;
  return false;
}

/**
 * Whether every named word appears in the title in the same order, each the whole word or, from four
 * letters, the start of one: "chem lab report" and "precalc homework" both name their assignment.
 */
function inOrder(title: string[], named: string[]): boolean {
  if (named.length === 0) return false;
  let at = 0;
  for (const word of named) {
    while (
      at < title.length &&
      title[at] !== word &&
      !(word.length >= 4 && title[at].startsWith(word))
    )
      at++;
    if (at === title.length) return false;
    at++;
  }
  return true;
}

/**
 * The tasks a name fits: its id; otherwise its title, whole or without the class in front;
 * otherwise its title's words in order, or the whole title inside the name. Every task in the first
 * tier that fits any, so "the lab" before two labs puts both first.
 */
function tasksNamed(name: string, tasks: readonly PlanTask[]): PlanTask[] {
  const trimmed = name.trim();
  const want = wordsOf(trimmed);
  if (want.length === 0) return [];
  const squashed = want.join("");
  const titles = tasks.map((task) => ({ task, words: wordsOf(task.title) }));
  const tiers = [
    titles.filter(
      ({ task }) =>
        task.id === trimmed || wordsOf(task.id).join("") === squashed,
    ),
    titles.filter(({ words }) => {
      // The title alone is the end of "<Class>: <title>".
      const tail = words.slice(words.length - want.length);
      return tail.length === want.length && tail.join("") === squashed;
    }),
    titles.filter(
      ({ words }) => inOrder(words, want) || containsRun(want, words),
    ),
  ];
  return (tiers.find((tier) => tier.length > 0) ?? []).map(({ task }) => task);
}

/** The open assignments as a model can name them, the first eight, then how many more. */
function openList(tasks: readonly PlanTask[]): string {
  const shown = tasks.slice(0, 8).map((task) => `"${task.title}"`);
  const more = tasks.length - shown.length;
  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
}

export type PriorityMatch =
  | { ok: true; ids: string[] }
  | {
      ok: false;
      /** For the model: what did not match, and the titles it can use instead. */
      reason: string;
    };

/**
 * The task ids a request's `priority` names, in its order, each name matched by id or title (see
 * tasksNamed). A name that fits none is refused with the open assignments to choose from, rather
 * than dropped: a plan that quietly ignored "do the lab first" would be the wrong plan.
 */
export function resolvePriority(
  names: readonly string[],
  tasks: readonly PlanTask[],
): PriorityMatch {
  const ids: string[] = [];
  for (const name of names) {
    const found = tasksNamed(name, tasks);
    if (found.length === 0) {
      // Cut by code point, so a name never ends in half an emoji.
      const shown = `"${Array.from(name.trim()).slice(0, 80).join("")}"`;
      return {
        ok: false,
        reason:
          tasks.length === 0
            ? `${shown} isn't open: the student has no open assignments to put first, so leave priority out.`
            : `${shown} isn't one of the student's open assignments. Use one of: ${openList(tasks)}.`,
      };
    }
    for (const task of found) if (!ids.includes(task.id)) ids.push(task.id);
  }
  return { ok: true, ids };
}

/**
 * Why a plan waiting for Apply no longer fits, or null when it still does: "changed" when another
 * plan was applied since it was made, so the time and the minutes it counted on may be gone, and
 * "started" when one of its blocks has already begun. When both are true it is "changed". An
 * applied or dismissed plan is never stale; it is answered.
 *
 * "Since" is strictly after: the plan tool stamps createdAt before it reads the applied plans, so a
 * plan applied by then was one it saw. Apply stamps appliedAt as the plan lands, after its own
 * calendar read, so a plan made during that read is stale, as it should be.
 */
export function isStale(
  plan: Pick<StudyPlan, "id" | "status" | "createdAt" | "timeZone" | "blocks">,
  appliedPlans: readonly Pick<StudyPlan, "id" | "appliedAt">[],
  now: Date,
): PlanStaleReason | null {
  if (plan.status !== "proposed") return null;
  const created = Date.parse(plan.createdAt);
  if (
    appliedPlans.some(
      (other) =>
        other.id !== plan.id &&
        other.appliedAt !== null &&
        // NaN on either side compares false, so a time that cannot be read counts as after.
        !(Date.parse(other.appliedAt) <= created),
    )
  )
    return "changed";
  return plan.blocks.some(
    (block) =>
      zonedInstant(block.date, block.start, plan.timeZone).getTime() <
      now.getTime(),
  )
    ? "started"
    : null;
}

/* ------------------------------------------------------------------------------------------------
 * A plan as it is stored
 * ---------------------------------------------------------------------------------------------- */

const isInstant = (value: string) => Number.isFinite(Date.parse(value));

const PLAN_STATUSES = [
  "proposed",
  "applied",
  "discarded",
] as const satisfies readonly PlanStatus[];

const blockSchema = z.object({
  id: z.string().min(1),
  assignmentId: z.string().nullable(),
  classId: z.string().nullable(),
  title: z.string(),
  date: z.string().refine(isDate),
  start: z.string().regex(CLOCK),
  end: z.string().regex(CLOCK),
  late: z.boolean().optional(),
}) satisfies z.ZodType<StudyBlock>;

const storedSchema = z.object({
  status: z.enum(PLAN_STATUSES).optional(),
  reason: z.string(),
  timeZone: z.string().refine(isTimeZone),
  startDate: z.string().refine(isDate),
  days: z.number().int().min(1),
  blocks: z.array(blockSchema),
  remaining: z.array(
    z.object({
      assignmentId: z.string(),
      title: z.string(),
      minutes: z.number(),
      due: z.string().nullable(),
    }),
  ),
  warnings: z.array(z.string()),
  totalMinutes: z.number(),
  createdAt: z.string().refine(isInstant),
  appliedAt: z.string().refine(isInstant).nullable(),
});

/** What a plan record's data holds: every field of the plan but `stale` and `staleReason`. */
export function planData(
  plan: Omit<StudyPlan, "stale" | "staleReason">,
): Record<string, unknown> {
  return {
    id: plan.id,
    status: plan.status,
    reason: plan.reason,
    timeZone: plan.timeZone,
    startDate: plan.startDate,
    days: plan.days,
    blocks: plan.blocks,
    remaining: plan.remaining,
    warnings: plan.warnings,
    totalMinutes: plan.totalMinutes,
    createdAt: plan.createdAt,
    appliedAt: plan.appliedAt,
  };
}

/**
 * Where a plan's blocks begin and end, as instants, so the store can answer "applied plans in this
 * range" from two columns. Null for a plan with no blocks.
 */
export function planSpan(
  blocks: readonly StudyBlock[],
  timeZone: string,
): { startsAt: Date | null; endsAt: Date | null } {
  if (blocks.length === 0) return { startsAt: null, endsAt: null };
  const starts = blocks.map((block) =>
    zonedInstant(block.date, block.start, timeZone).getTime(),
  );
  const ends = blocks.map((block) =>
    zonedInstant(block.date, block.end, timeZone).getTime(),
  );
  return {
    startsAt: new Date(Math.min(...starts)),
    endsAt: new Date(Math.max(...ends)),
  };
}

/**
 * A stored plan, read back. Why it is stale is the caller's, worked out against the plans applied
 * since and the clock (isStale), and only ever kept for a plan still waiting for Apply; `stale` is
 * whether there is a reason. Throws when the record cannot be read, which is ours to fix, not the
 * student's.
 */
export function planFromRecord(
  record: StudyRecord,
  staleReason: PlanStaleReason | null = null,
): StudyPlan {
  const parsed = storedSchema.safeParse(record.data);
  const column = PLAN_STATUSES.find((status) => status === record.status);
  const status = column ?? (parsed.success ? parsed.data.status : undefined);
  if (!parsed.success || !status)
    throw new Error("A saved study plan couldn't be read.");
  const plan = parsed.data;
  return {
    id: record.id,
    status,
    reason: plan.reason,
    timeZone: plan.timeZone,
    startDate: plan.startDate,
    days: plan.days,
    blocks: plan.blocks,
    remaining: plan.remaining,
    warnings: plan.warnings,
    totalMinutes: plan.totalMinutes,
    createdAt: plan.createdAt,
    appliedAt: plan.appliedAt,
    stale: status === "proposed" && staleReason !== null,
    staleReason: status === "proposed" ? staleReason : null,
  };
}

/**
 * The person's applied plans that are still running at or after `from`: every block that can still
 * matter to a new plan, Apply or a calendar from then on. A plan is applied only with blocks still
 * ahead of it, so this also holds every plan applied since `from`.
 *
 * A record that cannot be read is left out and logged rather than failing the student's request:
 * its blocks are study time, and losing sight of them costs at worst an overlap Apply then shows.
 */
export async function appliedPlans(
  store: StudyStore,
  owner: string,
  from: Date,
  to: Date = new Date(from.getTime() + HORIZON_MS),
): Promise<StudyPlan[]> {
  const records = await store.list(owner, "plan", {
    status: "applied",
    overlapping: { from, to },
    limit: 500,
  });
  const plans: StudyPlan[] = [];
  for (const record of records) {
    try {
      plans.push(planFromRecord(record));
    } catch {
      console.error(
        JSON.stringify({
          type: "openduet-study-plan-unreadable",
          plan: record.id,
          timestamp: new Date().toISOString(),
        }),
      );
    }
  }
  return plans;
}

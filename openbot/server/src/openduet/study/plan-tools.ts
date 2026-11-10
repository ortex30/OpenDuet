import { randomUUID } from "node:crypto";
import {
  PLAN_TOOL,
  type PlanToolResult,
  type StudyPlan,
} from "@openbot/shared/study";
import type { GrantedTool } from "@openbot/toolkit/granted-tool";
import { z } from "zod";
import { REFUSAL_MARKER } from "../../plugins/tools";
import { loadEnabledPack } from "../private-pack";
import { readCalendar } from "./calendar-source";
import {
  type StudyContext,
  StudyInputError,
  type StudyToolDeps,
} from "./contracts";
import { eveningSummary, planTonight } from "./craft";
import {
  appliedPlans,
  busyFrom,
  planData,
  planSpan,
  resolvePriority,
  tasksFrom,
} from "./plans";
import {
  DEFAULT_CLASS_BUFFER_MIN,
  defaultAvailability,
  makePlan,
  PlanDateError,
  type PlanDraft,
  type PlanInput,
} from "./scheduler";
import {
  addDays,
  isTimeZone,
  weekdayOf,
  zonedInstant,
  zonedParts,
} from "./time";

/*
 * propose_study_plan: study sessions for the student's open work, fitted around their classes,
 * practices and the study time they already applied, and saved as a plan waiting for Apply. The app
 * draws it as a card with Apply and Not now (lib/copilot/study-plan-card-tool.tsx); nothing reaches
 * their calendar until they press Apply there (plan-routes.ts).
 *
 * No teacher's rule pauses it: planning time for a "No help" essay is not help with the essay.
 *
 * The answer is small on purpose. A tool's result is replayed to the model on every later turn, and
 * the card reads the plan itself by id, so the model hears only what it needs to say one sentence
 * about it: the first day, how many sessions, how long, what did not fit, and the warnings.
 *
 * The model has no clock. A later day can be asked for as startInDays, counted from the student's
 * today, and every refusal about a day says what today is.
 */

export const PLAN_TOOL_REF = `openduet/${PLAN_TOOL}`;

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Days by name, Sunday first, as weekdayOf counts them. */
const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A clock or a date the model may leave blank. `""` and null mean "left out": the tool schema is
 * checked before `withoutBlanks` runs, and a blank used to fail that check and push the model into
 * inventing a date.
 */
function optionalPattern(pattern: RegExp) {
  return z.union([z.literal(""), z.null(), z.string().regex(pattern)]);
}

const parameters = z.object({
  minutes: z
    .number()
    .int()
    .min(15)
    .max(600)
    .describe(
      "Total minutes of study to plan across all the days, from 15 to 600: the time the student says they have.",
    ),
  startTime: optionalPattern(CLOCK)
    .optional()
    .describe(
      "The earliest start on the first day, HH:mm on the student's clock, such as 16:30. Leave it out to start after school, or now.",
    ),
  endTime: optionalPattern(CLOCK)
    .optional()
    .describe("The latest end on any day, HH:mm, such as 21:30."),
  startDate: optionalPattern(DAY)
    .optional()
    .describe(
      "The first day to plan, YYYY-MM-DD. Leave it out for today, or give startInDays instead.",
    ),
  startDay: z
    .enum(["today", "tomorrow", ...WEEKDAYS])
    .optional()
    .describe(
      "The first day to plan by name, on the student's own calendar: today, tomorrow, or a weekday such as saturday for the next Saturday (today, if today is Saturday). The easiest way to name a day; when given, it counts over startInDays and startDate.",
    ),
  startInDays: z
    .number()
    .int()
    .min(0)
    .max(30)
    .optional()
    .describe(
      "The first day to plan, counted from the student's today: 0 for today, 1 for tomorrow, up to 30. Easier than startDate, because it needs no date. When both are given, this one counts.",
    ),
  days: z
    .number()
    .int()
    .min(1)
    .max(7)
    .optional()
    .describe(
      "How many days to plan: 1 for today or tonight, up to 7 for the week. Defaults to 1.",
    ),
  priority: z
    .array(z.string().trim().min(1).max(200))
    .max(8)
    .optional()
    .describe(
      "Assignments to do first, in order, each by its title as the Classroom notice names it.",
    ),
  reason: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe(
      "One short sentence for the student on why the plan looks the way it does, such as what is due first.",
    ),
});

type Request = z.infer<typeof parameters>;

const DAY_NAME = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/**
 * "Today is Thu, Nov 5 (2026-11-05).", for every refusal about a day: the model has no clock, so
 * without it a wrong date is one it cannot fix.
 */
function todayIs(today: string): string {
  return `Today is ${DAY_NAME.format(new Date(`${today}T12:00:00Z`))} (${today}).`;
}

/**
 * The date a day's name means from the student's today: "tomorrow" the next day, a weekday the next
 * one on or after today, so "saturday" on a Saturday is today.
 */
function dayNamed(
  name: NonNullable<Request["startDay"]>,
  today: string,
): string {
  if (name === "today") return today;
  if (name === "tomorrow") return addDays(today, 1);
  const ahead = (WEEKDAYS.indexOf(name) - weekdayOf(today) + 7) % 7;
  return addDays(today, ahead);
}

/** What to fix, per argument, in a sentence the model can act on. A day's says what today is. */
function fixes(today: string): Record<keyof Request, string> {
  return {
    minutes: "Ask for between 15 and 600 minutes of study, as a whole number.",
    startTime: "Write startTime as HH:mm, such as 15:30.",
    endTime: "Write endTime as HH:mm, such as 21:00.",
    startDate: `Write startDate as YYYY-MM-DD, such as ${addDays(today, 1)}, or give startInDays instead. ${todayIs(today)}`,
    startDay: `Give startDay as today, tomorrow, or a weekday in lower case, such as saturday. ${todayIs(today)}`,
    startInDays: `Give startInDays as a whole number of days from today, 0 to 30: 0 for today, 1 for tomorrow. ${todayIs(today)}`,
    days: "Plan between 1 and 7 days at a time.",
    priority:
      "Name at most 8 assignments to do first, each by its title, or leave priority out.",
    reason: "Give a reason of one short sentence, under 300 characters.",
  };
}

const AGAIN = `Fix it and call ${PLAN_TOOL} again.`;

/** Models write null or "" for an argument they mean to leave out; read either as left out. */
function withoutBlanks(args: unknown): unknown {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  return Object.fromEntries(
    Object.entries(args).filter(
      ([, value]) =>
        value !== null && !(typeof value === "string" && value.trim() === ""),
    ),
  );
}

function filled(value: string | null | undefined): string | undefined {
  if (value == null || value.trim() === "") return undefined;
  return value;
}

function refused(sentence: string): string {
  return `${REFUSAL_MARKER} ${sentence}`;
}

/** The first thing wrong with the arguments, said as what to change. */
function fixFor(
  issues: readonly { path: PropertyKey[] }[],
  today: string,
): string {
  const field = issues[0]?.path[0];
  const all = fixes(today);
  const fix =
    typeof field === "string" && Object.hasOwn(all, field)
      ? all[field as keyof Request]
      : "Give minutes and a reason, and only the arguments this tool takes.";
  return `${fix} ${AGAIN}`;
}

/**
 * A one-day plan that starts today uses the same evening planner as Tonight.
 *
 * `startDay` wins over `startInDays` and `startDate`, which is how the planner reads them. A model
 * that also sends a guessed date, or `startInDays: 0`, is still planning today.
 */
export function usesSharedEvening(
  request: {
    days?: number;
    startDate?: string | null;
    startDay?: string | null;
    startInDays?: number | null;
  },
  today: string,
  weekdayName: string,
): boolean {
  if ((request.days ?? 1) !== 1) return false;
  const named = request.startDay ?? undefined;
  if (named === "today" || named === weekdayName) return true;
  if (
    named !== undefined &&
    (named === "tomorrow" || (WEEKDAYS as readonly string[]).includes(named))
  ) {
    return dayNamed(named as NonNullable<Request["startDay"]>, today) === today;
  }
  if (named !== undefined) return false;
  if ((request.startInDays ?? 0) > 0) return false;
  const startDate = filled(request.startDate);
  if (startDate !== undefined) return startDate === today;
  return true;
}

/** The time the student actually named, when the reason says it and minutes does not. */
export function statedMinutes(reason: string, fallback: number): number {
  const text = reason.toLowerCase();
  const hours = /(\d+)\s*hours?/.exec(text);
  const fromHours = hours ? Number(hours[1]) * 60 : undefined;
  const words = /\btwo hours\b/.test(text)
    ? 120
    : /\b(an|one) hour\b/.test(text)
      ? 60
      : undefined;
  const mins = /(\d+)\s*min/.exec(text);
  const fromMins = mins ? Number(mins[1]) : undefined;
  const stated = fromHours ?? words ?? fromMins;
  if (stated === undefined || !Number.isFinite(stated)) return fallback;
  return Math.min(600, Math.max(15, Math.round(stated)));
}

async function propose(deps: StudyToolDeps, args: unknown): Promise<string> {
  const context: StudyContext = {
    actorId: deps.actorId,
    botId: deps.botId,
    initiator: deps.initiator,
  };
  const now = deps.now?.() ?? new Date();
  const { snapshot, why } = await deps.school.current(context);
  if (!snapshot)
    return refused(
      `${why ?? "Your classes couldn't be read."} A plan is made from their classes, so tell the student in one sentence and don't call ${PLAN_TOOL} again until that's fixed.`,
    );

  const timeZone = isTimeZone(snapshot.timeZone) ? snapshot.timeZone : "UTC";
  const { date: today, minute: nowMinute } = zonedParts(now, timeZone);
  // Read once the student's today is known, so a refusal about a day can say what today is.
  const parsed = parameters.safeParse(args);
  if (!parsed.success) return refused(fixFor(parsed.error.issues, today));
  const request = parsed.data;
  const pack = loadEnabledPack();
  // One day from the school pack is tonight's plan, even if the model
  // also sent today's date, a start time, or a priority list.
  const eveningToday = pack ? zonedParts(now, pack.timeZone).date : today;
  const thisEvening =
    pack !== null &&
    usesSharedEvening(
      request,
      eveningToday,
      WEEKDAYS[weekdayOf(eveningToday)] ?? "today",
    );
  if (pack && thisEvening) {
    const draft = planTonight(pack, now, {
      minutes: statedMinutes(request.reason, request.minutes),
    });
    const plan: Omit<StudyPlan, "stale" | "staleReason"> = {
      id: randomUUID(),
      status: "proposed",
      reason: eveningSummary(draft),
      timeZone: isTimeZone(pack.timeZone) ? pack.timeZone : "UTC",
      startDate: draft.startDate,
      days: draft.days,
      blocks: draft.blocks,
      remaining: draft.remaining,
      warnings: draft.warnings,
      totalMinutes: draft.totalMinutes,
      createdAt: now.toISOString(),
      appliedAt: null,
    };
    await deps.store.put(deps.actorId, {
      id: plan.id,
      kind: "plan",
      botId: deps.botId,
      status: plan.status,
      ...planSpan(plan.blocks, plan.timeZone),
      data: planData(plan),
    });
    const result: PlanToolResult & { startDate: string } = {
      kind: "plan",
      id: plan.id,
      startDate: plan.startDate,
      blocks: plan.blocks.length,
      totalMinutes: plan.totalMinutes,
      remainingMinutes: plan.remaining.reduce(
        (sum, item) => sum + item.minutes,
        0,
      ),
      warnings: plan.warnings,
    };
    return JSON.stringify(result);
  }
  const ask: Omit<PlanInput, "tasks" | "busy"> = {
    today,
    nowMinute,
    availability: defaultAvailability,
    classBufferMin: DEFAULT_CLASS_BUFFER_MIN,
    minutes: request.minutes,
    startDate:
      request.startDay !== undefined
        ? dayNamed(request.startDay, today)
        : request.startInDays === undefined
          ? filled(request.startDate)
          : addDays(today, request.startInDays),
    days: request.days,
    startTime: filled(request.startTime),
    endTime: filled(request.endTime),
  };
  // The request alone first, so one the planner would refuse costs no calendar reads.
  let shape: PlanDraft;
  try {
    shape = makePlan({ ...ask, tasks: [], busy: [] }, { newId: randomUUID });
  } catch (error) {
    if (error instanceof PlanDateError)
      return refused(`${error.message} ${todayIs(today)} ${AGAIN}`);
    throw error;
  }

  const tasks = tasksFrom(snapshot, now);
  const first = resolvePriority(request.priority ?? [], tasks);
  if (!first.ok) return refused(`${first.reason} ${AGAIN}`);

  const calendar = await readCalendar(
    deps.callTool,
    context,
    {
      from: shape.startDate,
      to: addDays(shape.startDate, shape.days - 1),
    },
    { timeZone, classes: snapshot.classes },
  );
  // From the start of today, so blocks already done today still count toward today's cap.
  const applied = await appliedPlans(
    deps.store,
    deps.actorId,
    zonedInstant(today, "00:00", timeZone),
  );
  const draft = makePlan(
    {
      ...ask,
      tasks,
      busy: busyFrom(calendar.events, applied),
      priority: first.ids,
    },
    { newId: randomUUID },
  );

  const plan: Omit<StudyPlan, "stale" | "staleReason"> = {
    id: randomUUID(),
    status: "proposed",
    reason: request.reason,
    timeZone,
    startDate: draft.startDate,
    days: draft.days,
    blocks: draft.blocks,
    remaining: draft.remaining,
    // The scheduler's own first, then what it could not see, so a thin plan says why.
    warnings: [
      ...new Set([
        ...draft.warnings,
        ...calendar.couldNotRead,
        // The classes were the copy kept from the last read, which this one could not refresh.
        ...(why ? [`Your assignments may be out of date. ${why}`] : []),
      ]),
    ],
    totalMinutes: draft.totalMinutes,
    createdAt: now.toISOString(),
    appliedAt: null,
  };
  await deps.store.put(deps.actorId, {
    id: plan.id,
    kind: "plan",
    botId: deps.botId,
    status: plan.status,
    ...planSpan(plan.blocks, timeZone),
    data: planData(plan),
  });
  // startDate is more than the card reads (its schema drops it): the day planned, as a date, so the
  // model can say "tomorrow" or "Saturday" right without a clock of its own.
  const result: PlanToolResult & { startDate: string } = {
    kind: "plan",
    id: plan.id,
    startDate: plan.startDate,
    blocks: plan.blocks.length,
    totalMinutes: plan.totalMinutes,
    remainingMinutes: plan.remaining.reduce(
      (sum, item) => sum + item.minutes,
      0,
    ),
    warnings: plan.warnings,
  };
  return JSON.stringify(result);
}

/** propose_study_plan, as a Bot holds it for one run. */
export function planTools(deps: StudyToolDeps): GrantedTool[] {
  return [
    {
      name: PLAN_TOOL,
      ref: PLAN_TOOL_REF,
      initiator: deps.initiator,
      description: [
        "Plan the student's study time. For tonight, pass minutes as the time they said they have. Tomorrow morning's tests and quests come before homework due at 11:59. Never plan drafting an in-class essay. The minutes you pass are the plan's length.",
        "To start on another day, give startDay by name (tomorrow, or a weekday such as saturday) or startInDays (1 for tomorrow) rather than working out a date; the result's startDate is the first day it planned.",
        "It shows as a card that lists every session with an Apply button, so never list the sessions or their times in the chat: say in one sentence what the plan covers and what didn't fit.",
        "Nothing goes on their calendar until they press Apply on the card, so never say it is on their calendar.",
        "Missing work is planned as catch-up and marked late; the deadline does not change. A teacher's rule never pauses planning.",
        `If it is refused, fix what it names and call ${PLAN_TOOL} again.`,
      ].join(" "),
      parameters,
      async execute(args) {
        try {
          return await propose(deps, withoutBlanks(args ?? {}));
        } catch (error) {
          if (error instanceof StudyInputError)
            return refused(`${error.message} ${AGAIN}`);
          console.error(
            JSON.stringify({
              type: "openduet-study-plan-failed",
              tool: PLAN_TOOL,
              error: error instanceof Error ? error.name : "unknown",
              timestamp: new Date().toISOString(),
            }),
          );
          return refused(
            "The plan couldn't be made just now. Tell the student in one sentence and offer to try again.",
          );
        }
      },
    },
  ];
}

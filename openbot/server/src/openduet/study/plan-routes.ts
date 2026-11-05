import type {
  CalendarDeadline,
  CalendarView,
  HelpLevel,
  StudyBlock,
  StudyPlan,
} from "@openbot/shared/study";
import { Hono } from "hono";
import type { AppVariables } from "../../auth/guards";
import { readCalendar } from "./calendar-source";
import {
  StudyConflictError,
  type StudyContext,
  StudyInputError,
  StudyNotFoundError,
  type StudyRecord,
  type StudyRouteDeps,
} from "./contracts";
import { appliedPlans, busyFrom, isStale, planFromRecord } from "./plans";
import { studyContextOf } from "./routes";
import { checkApply, PASSED } from "./scheduler";
import { addDays, isDate, isTimeZone, zonedInstant, zonedParts } from "./time";

/*
 * A study plan the plan tool proposed (plan-tools.ts), its Apply, its Not now and its Remove (off
 * the calendar again, once applied), and the calendar the Calendar tab draws: the student's Google
 * Calendar, the study blocks they applied and what is due, for a run of their own days.
 *
 * Apply is the only way a plan reaches the calendar, and it checks the plan against the calendar as
 * it is at that moment, not as it was when the plan was made: a practice moved onto the evening, or
 * another plan applied in the meantime, is a refusal saying so, never a session on top of it.
 *
 * Mounted by routes.ts, which signs the person in, limits the body and turns the Study*Error classes
 * thrown here into answers. So this adds none of the three, and has no error handler of its own.
 */

const DISMISSED = "You dismissed this plan. Ask for a new one.";
const REMOVED = "You took this plan off your calendar. Ask for a new one.";
const CHANGED =
  "Your schedule changed since this plan was made. Ask for a fresh one.";
const NOTHING_FITS = "Nothing in this plan fits on your calendar.";
const ON_CALENDAR = "This plan is already on your calendar.";

/** The most days the Calendar tab may ask for at once: two weeks, so a week view can look ahead. */
const MOST_CALENDAR_DAYS = 14;

/**
 * Each person's applies (and removals) one after another in this server, so two plans made from the
 * same calendar cannot both pass their checks before either lands. The store's row lock keeps one
 * plan from being applied twice; this keeps two plans from being applied over each other.
 */
function oneAtATime() {
  const running = new Map<string, Promise<void>>();
  return <T>(owner: string, work: () => Promise<T>): Promise<T> => {
    const result = (running.get(owner) ?? Promise.resolve()).then(work);
    const done = result.then(
      () => undefined,
      () => undefined,
    );
    running.set(owner, done);
    void done.then(() => {
      if (running.get(owner) === done) running.delete(owner);
    });
    return result;
  };
}

/** The first and last day a plan's blocks fall on. */
function daysOf(blocks: readonly StudyBlock[]): { from: string; to: string } {
  const dates = blocks.map((block) => block.date).sort();
  return { from: dates[0] ?? "", to: dates.at(-1) ?? "" };
}

function byTime(a: StudyBlock, b: StudyBlock): number {
  return (
    a.date.localeCompare(b.date) ||
    a.start.localeCompare(b.start) ||
    a.end.localeCompare(b.end) ||
    a.id.localeCompare(b.id)
  );
}

export function planRoutes(deps: StudyRouteDeps) {
  const clock = () => deps.now?.() ?? new Date();
  const applying = oneAtATime();

  async function recordOf(owner: string, id: string): Promise<StudyRecord> {
    const record = await deps.store.get(owner, "plan", id);
    if (!record) throw new StudyNotFoundError();
    return record;
  }

  /** The plan, with why it is stale when it is: the plans applied since it was made, or the clock. */
  async function current(
    owner: string,
    record: StudyRecord,
    now: Date,
  ): Promise<StudyPlan> {
    const plan = planFromRecord(record);
    if (plan.status !== "proposed") return plan;
    const since = await appliedPlans(
      deps.store,
      owner,
      new Date(plan.createdAt),
    );
    return planFromRecord(record, isStale(plan, since, now));
  }

  async function apply(
    owner: string,
    id: string,
    study: StudyContext,
  ): Promise<StudyPlan> {
    const now = clock();
    const record = await recordOf(owner, id);
    const plan = await current(owner, record, now);
    if (plan.status === "applied") return plan;
    if (plan.status === "discarded")
      throw new StudyConflictError(plan.appliedAt ? REMOVED : DISMISSED);
    // Said as what happened: a session that has begun is time passing, not the schedule changing.
    if (plan.stale)
      throw new StudyConflictError(
        plan.staleReason === "started" ? PASSED : CHANGED,
      );
    if (plan.blocks.length === 0) throw new StudyConflictError(NOTHING_FITS);

    // Google first, outside any transaction: a row lock is never held across a network call.
    const days = daysOf(plan.blocks);
    const calendar = await readCalendar(deps.callTool, study, days, {
      timeZone: plan.timeZone,
    });
    // A calendar that could not be read cannot show a clash, so nothing is added on a guess.
    const [unread] = calendar.couldNotRead;
    if (unread)
      throw new StudyConflictError(
        `${unread} Nothing was added to your calendar.`,
      );
    const others = (
      await appliedPlans(
        deps.store,
        owner,
        zonedInstant(days.from, "00:00", plan.timeZone),
        zonedInstant(days.to, "24:00", plan.timeZone),
      )
    ).filter((other) => other.id !== plan.id);
    const { date: today, minute: nowMinute } = zonedParts(now, plan.timeZone);
    const clash = checkApply({
      today,
      nowMinute,
      blocks: plan.blocks,
      busy: busyFrom(calendar.events, others),
    });
    if (clash) throw new StudyConflictError(clash);

    const saved = await deps.store.update(owner, "plan", id, (stored) => {
      // Applied meanwhile, in another tab: the same answer, and nothing to write.
      if (stored.status === "applied") return {};
      if (stored.status !== "proposed") throw new StudyConflictError(DISMISSED);
      return {
        status: "applied",
        // Stamped as it lands, after the calendar read, so a plan made during that read is stale.
        data: {
          ...stored.data,
          status: "applied",
          appliedAt: clock().toISOString(),
        },
      };
    });
    return planFromRecord(saved);
  }

  /**
   * Takes a plan off the calendar, or out of the way if it never got there. An applied plan becomes
   * "discarded", so its blocks stop being busy time, covered minutes and calendar blocks, and keeps
   * its appliedAt, so the card can say it was on the calendar and was taken off; removedAt says when.
   * A plan already discarded answers as it is.
   */
  async function remove(owner: string, id: string): Promise<StudyPlan> {
    const saved = await deps.store.update(owner, "plan", id, (stored) => {
      if (stored.status === "discarded") return {};
      return {
        status: "discarded",
        data: {
          ...stored.data,
          status: "discarded",
          ...(stored.status === "applied"
            ? { removedAt: clock().toISOString() }
            : {}),
        },
      };
    });
    return planFromRecord(saved);
  }

  return new Hono<{ Variables: AppVariables }>()
    .get("/plans/:id", async (context) => {
      const owner = context.var.actor.id;
      const record = await recordOf(owner, context.req.param("id"));
      return context.json({ plan: await current(owner, record, clock()) });
    })
    .post("/plans/:id/apply", async (context) => {
      const owner = context.var.actor.id;
      const id = context.req.param("id");
      const study = studyContextOf(context, deps);
      const plan = await applying(owner, () => apply(owner, id, study));
      return context.json({ plan });
    })
    .post("/plans/:id/discard", async (context) => {
      const owner = context.var.actor.id;
      const saved = await deps.store.update(
        owner,
        "plan",
        context.req.param("id"),
        (stored) => {
          if (stored.status === "applied")
            throw new StudyConflictError(ON_CALENDAR);
          if (stored.status === "discarded") return {};
          return {
            status: "discarded",
            data: { ...stored.data, status: "discarded" },
          };
        },
      );
      return context.json({ plan: planFromRecord(saved) });
    })
    .post("/plans/:id/remove", async (context) => {
      const owner = context.var.actor.id;
      const id = context.req.param("id");
      const plan = await applying(owner, () => remove(owner, id));
      return context.json({ plan });
    })
    .get("/calendar", async (context) => {
      const from = context.req.query("from") ?? "";
      const to = context.req.query("to") ?? "";
      if (!isDate(from) || !isDate(to))
        throw new StudyInputError(
          "Choose the days to show, written as YYYY-MM-DD.",
        );
      if (from > to)
        throw new StudyInputError(
          "Choose a first day that comes before the last one.",
        );
      if (addDays(from, MOST_CALENDAR_DAYS - 1) < to)
        throw new StudyInputError(
          `Show at most ${MOST_CALENDAR_DAYS} days at a time.`,
        );

      const owner = context.var.actor.id;
      const study = studyContextOf(context, deps);
      const now = clock();
      const { snapshot, why } = await deps.school.current(study);
      const calendar = await readCalendar(
        deps.callTool,
        study,
        { from, to },
        {
          ...(snapshot && isTimeZone(snapshot.timeZone)
            ? { timeZone: snapshot.timeZone }
            : {}),
          classes: snapshot?.classes ?? [],
        },
      );
      const { timeZone } = calendar;
      const { date: today, minute: nowMinute } = zonedParts(now, timeZone);

      // The level each assignment's study tools obey, as the Teacher rules screen shows it.
      const levels = new Map<string, HelpLevel>();
      if (snapshot) {
        const rules = await deps.rules.view(owner, snapshot, {
          canLoosen: false,
          now,
        });
        for (const schoolClass of rules.classes)
          for (const assignment of schoolClass.assignments)
            levels.set(assignment.assignmentId, assignment.level);
      }
      const deadlines: CalendarDeadline[] = (snapshot?.assignments ?? [])
        .flatMap((assignment) =>
          assignment.status !== "returned" &&
          assignment.dueDate !== null &&
          from <= assignment.dueDate &&
          assignment.dueDate <= to
            ? [
                {
                  assignmentId: assignment.id,
                  classId: assignment.classId,
                  title: assignment.title,
                  date: assignment.dueDate,
                  time: assignment.dueTime,
                  kind: assignment.kind,
                  help: levels.get(assignment.id) ?? null,
                },
              ]
            : [],
        )
        .sort(
          (a, b) =>
            a.date.localeCompare(b.date) ||
            (a.time ?? "99:99").localeCompare(b.time ?? "99:99") ||
            a.title.localeCompare(b.title, "en"),
        );

      const applied = await appliedPlans(
        deps.store,
        owner,
        zonedInstant(from, "00:00", timeZone),
        zonedInstant(to, "24:00", timeZone),
      );
      const blocks = new Map<string, StudyBlock>();
      for (const plan of applied)
        for (const block of plan.blocks)
          if (from <= block.date && block.date <= to && !blocks.has(block.id))
            blocks.set(block.id, block);

      const view: CalendarView = {
        timeZone,
        today,
        nowMinute,
        from,
        to,
        classes: snapshot?.classes ?? [],
        events: calendar.events,
        allDay: calendar.allDay,
        blocks: [...blocks.values()].sort(byTime),
        deadlines,
        couldNotRead: [
          ...new Set([
            ...(why ? [why] : []),
            ...(snapshot?.couldNotRead ?? []),
            ...calendar.couldNotRead,
          ]),
        ],
      };
      return context.json({ calendar: view });
    });
}

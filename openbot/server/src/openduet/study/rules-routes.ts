import { HELP_LEVELS, type RulesChange } from "@openbot/shared/study";
import { type Context, Hono } from "hono";
import { z } from "zod";
import type { AppVariables } from "../../auth/guards";
import {
  type SchoolRead,
  StudyInputError,
  type StudyRouteDeps,
} from "./contracts";
import { canLoosen, studyContextOf } from "./routes";

/*
 * The Teacher rules screen's routes: the rules as the screen shows them, a change to them, and the
 * Classroom read behind both. Mounted by routes.ts, which signs the person in, limits the body and
 * maps the errors, so this adds none of the three and only throws the study errors.
 *
 *   GET  /rules         { rules }                  the screen
 *   PUT  /rules         { rules }                  set or clear overrides, then the screen again
 *   GET  /school        { school, why }            the classes and assignments read from Classroom
 *   POST /school/sync   { school, why, rules }     read Classroom again now, and the screen with it
 */

/** At most this many classes, and as many assignments, in one change: more than any student has. */
const MAX_CHANGES = 50;

/** Longer than any id Classroom or a slug gives, so a longer one is not one of the person's. */
const MAX_ID = 128;

const TOO_MANY = `Change at most ${MAX_CHANGES} classes and ${MAX_CHANGES} assignments at a time.`;

const CANT_READ =
  "Choose Full help, Hints only or No help for each class or assignment you change.";

const UNKNOWN = {
  classes:
    "One of those classes isn't in your list anymore. Refresh your classes and try again.",
  assignments:
    "One of those assignments isn't in your list anymore. Refresh your classes and try again.",
} as const;

const levels = z
  .record(z.string().min(1).max(MAX_ID), z.enum(HELP_LEVELS).nullable())
  .refine((entries) => Object.keys(entries).length <= MAX_CHANGES, {
    error: TOO_MANY,
  });

const changeSchema = z
  .object({ classes: levels.optional(), assignments: levels.optional() })
  .strict() satisfies z.ZodType<RulesChange>;

/** The change a PUT sent, or StudyInputError in a sentence the person can act on. */
function changeOf(body: unknown): RulesChange {
  const parsed = changeSchema.safeParse(body);
  if (!parsed.success)
    throw new StudyInputError(
      parsed.error.issues.find((issue) => issue.code === "custom")?.message ??
        CANT_READ,
    );
  // zod's record leaves out a key it can't keep, such as "__proto__", so a count that shrank means
  // an id went unseen. Every id sent is checked against the person's own, or the change is refused.
  const sent = body as Record<string, unknown>;
  for (const kind of ["classes", "assignments"] as const) {
    const given = sent[kind];
    if (
      given &&
      typeof given === "object" &&
      Object.keys(given).length !== Object.keys(parsed.data[kind] ?? {}).length
    )
      throw new StudyInputError(UNKNOWN[kind]);
  }
  return parsed.data;
}

export function rulesRoutes(deps: StudyRouteDeps) {
  const routes = new Hono<{ Variables: AppVariables }>();
  const clock = () => (deps.now ? { now: deps.now() } : {});

  /**
   * The person's classes: the stored copy, or Classroom read again when that copy is old or when
   * `force` asks. A read that failed falls back to the stored copy and says why.
   */
  const school = (
    context: Context<{ Variables: AppVariables }>,
    force = false,
  ) =>
    deps.school.current(
      studyContextOf(context, deps),
      force ? { force: true } : undefined,
    );

  /** The screen over those classes, with why a fresh read failed among what couldn't be read. */
  const screen = (
    context: Context<{ Variables: AppVariables }>,
    read: SchoolRead,
  ) =>
    deps.rules.view(context.var.actor.id, read.snapshot, {
      canLoosen: canLoosen(context),
      couldNotRead: read.why ? [read.why] : [],
      ...clock(),
    });

  routes.get("/rules", async (context) =>
    context.json({ rules: await screen(context, await school(context)) }),
  );

  routes.put("/rules", async (context) => {
    // A body that can't be a change is answered before anything is read from Gmail.
    const change = changeOf(await context.req.json().catch(() => null));
    const read = await school(context);
    // Checked against the notices as they are now, so a student can't loosen past a new No help.
    await deps.rules.change(context.var.actor.id, change, {
      canLoosen: canLoosen(context),
      snapshot: read.snapshot,
      ...clock(),
    });
    return context.json({ rules: await screen(context, read) });
  });

  routes.get("/school", async (context) => {
    const read = await school(context);
    return context.json({ school: read.snapshot, why: read.why });
  });

  routes.post("/school/sync", async (context) => {
    const read = await school(context, true);
    return context.json({
      school: read.snapshot,
      why: read.why,
      rules: await screen(context, read),
    });
  });

  return routes;
}

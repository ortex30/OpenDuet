import { describe, expect, spyOn, test } from "bun:test";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppVariables } from "../src/auth/guards";
import {
  StudyConflictError,
  StudyForbiddenError,
  StudyInputError,
  StudyNotFoundError,
  type StudyRouteDeps,
  type StudyStore,
} from "../src/openduet/study/contracts";
import {
  canLoosen,
  createStudyRoutes,
  mountStudyRoutes,
  type StudyRoutes,
  studyContextOf,
} from "../src/openduet/study/routes";

/**
 * /api/openduet/study's shared front: one sign-in, one body limit, and one mapping from the study
 * errors to answers, which has to hold for an error thrown inside any router mounted under it.
 */

const PATH = "/api/openduet/study";

/** Signs in as the given person, the way the app's guard sets the actor, or answers 401. */
function signedIn(
  userId: string | null,
  role: "user" | "admin" = "user",
): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (context, next) => {
    if (!userId) return context.json({ error: "Sign in" }, 401);
    context.set("actor", { id: userId, email: `${userId}@example.com`, role });
    await next();
  };
}

/** A sub-router like the real ones, whose handlers throw each study error. */
function throwingRouter(): StudyRoutes {
  return new Hono<{ Variables: AppVariables }>()
    .get("/quizzes/:id", () => {
      throw new StudyNotFoundError();
    })
    .post("/plans/:id/apply", async () => {
      await Promise.resolve();
      throw new StudyConflictError(
        "Something changed since this plan was made. Make a new one.",
      );
    })
    .put("/rules", () => {
      throw new StudyForbiddenError(
        "Only a teacher or an admin can loosen a teacher's rule. You can make it stricter.",
      );
    })
    .get("/calendar", () => {
      throw new StudyInputError("Pick a range of 62 days or fewer.");
    })
    .get("/broken", () => {
      throw new TypeError("connection reset");
    });
}

/** Mounted the way app.ts mounts it: under a parent app that has an error handler of its own. */
function appWith(
  routers: StudyRoutes[],
  user: MiddlewareHandler<{ Variables: AppVariables }> = signedIn("jordan"),
) {
  const app = new Hono();
  app.onError((_error, context) => context.json({ error: "parent" }, 500));
  return app.route(PATH, mountStudyRoutes(routers, user));
}

/** What `run` answered, and what it logged with console.error read as JSON, silenced. */
async function logged<T>(
  run: () => Promise<T>,
): Promise<{ answer: T; lines: unknown[] }> {
  const quiet = spyOn(console, "error").mockImplementation(() => {});
  try {
    const answer = await run();
    return {
      answer,
      lines: quiet.mock.calls.map(([line]) => JSON.parse(String(line))),
    };
  } finally {
    quiet.mockRestore();
  }
}

describe("the study routes", () => {
  test("answer an error thrown inside a mounted router with its own status and sentence", async () => {
    // The second router, as well as the first, so the mapping is not one router's alone.
    const app = appWith([
      new Hono<{ Variables: AppVariables }>(),
      throwingRouter(),
    ]);
    const answers = await Promise.all(
      [
        app.request(`${PATH}/quizzes/quiz-1`),
        app.request(`${PATH}/plans/plan-1/apply`, { method: "POST" }),
        app.request(`${PATH}/rules`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ classes: { chem2: "full" } }),
        }),
        app.request(`${PATH}/calendar?from=2026-01-01&to=2026-12-31`),
      ].map(async (pending) => {
        const response = await pending;
        return { status: response.status, body: await response.json() };
      }),
    );
    expect(answers).toEqual([
      { status: 404, body: { error: "That isn't here anymore." } },
      {
        status: 409,
        body: {
          error: "Something changed since this plan was made. Make a new one.",
        },
      },
      {
        status: 403,
        body: {
          error:
            "Only a teacher or an admin can loosen a teacher's rule. You can make it stricter.",
        },
      },
      { status: 400, body: { error: "Pick a range of 62 days or fewer." } },
    ]);
  });

  test("answer anything else with a sentence and log it, never the error itself", async () => {
    const app = appWith([throwingRouter()]);
    const { answer, lines } = await logged(async () => {
      const response = await app.request(`${PATH}/broken`);
      return { status: response.status, body: await response.json() };
    });
    expect(answer).toEqual({
      status: 503,
      body: { error: "Couldn't reach your study data. Try again." },
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      type: "openduet-study-route-error",
      error: "TypeError",
      context: { route: `${PATH}/broken` },
    });
    expect(
      Number.isNaN(Date.parse((lines[0] as { timestamp: string }).timestamp)),
    ).toBe(false);
  });

  test("sign the person in before any router is asked", async () => {
    const asked: string[] = [];
    const router = new Hono<{ Variables: AppVariables }>().get(
      "/plans",
      (context) => {
        asked.push(context.var.actor.id);
        return context.json({ plans: [] });
      },
    );
    const out = await appWith([router], signedIn(null)).request(
      `${PATH}/plans`,
    );
    expect(out.status).toBe(401);
    const signed = await appWith([router]).request(`${PATH}/plans`);
    expect(await signed.json()).toEqual({ plans: [] });
    expect(asked).toEqual(["jordan"]);
  });

  test("turn away a body over 32 KB in the same { error } shape, and take one under it", async () => {
    const router = new Hono<{ Variables: AppVariables }>().put(
      "/rules",
      async (context) =>
        context.json({ size: (await context.req.text()).length }),
    );
    const app = appWith([router]);
    const send = (size: number) =>
      app.request(`${PATH}/rules`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: "x".repeat(size) }),
      });
    const over = await send(40_000);
    expect(over.status).toBe(413);
    expect(await over.json()).toEqual({
      error: "That's too much to send at once.",
    });
    const under = await send(1_000);
    expect(under.status).toBe(200);
    expect(await under.json()).toEqual({ size: 1_000 + '{"note":""}'.length });
  });

  test("say who a route works for, and that only an admin may loosen a rule", async () => {
    const router = new Hono<{ Variables: AppVariables }>().get(
      "/who",
      (context) =>
        context.json({
          canLoosen: canLoosen(context),
          context: studyContextOf(context, { primaryBot: "academic-os" }),
        }),
    );
    const who = async (role: "user" | "admin") =>
      (
        await appWith([router], signedIn("jordan", role)).request(`${PATH}/who`)
      ).json();
    expect(await who("user")).toEqual({
      canLoosen: false,
      context: {
        actorId: "jordan",
        botId: "academic-os",
        initiator: { kind: "person" },
      },
    });
    expect(await who("admin")).toMatchObject({ canLoosen: true });
  });

  test("mount the real routers behind the same front", async () => {
    const unused = async (): Promise<never> => {
      throw new Error("not used");
    };
    const store: StudyStore = {
      get: unused,
      put: unused,
      insertOnce: unused,
      list: unused,
      update: unused,
    };
    const deps: StudyRouteDeps = {
      store,
      school: { current: unused, stored: unused },
      rules: {
        overrides: unused,
        change: unused,
        view: unused,
        target: unused,
      },
      callTool: unused,
      upNext: unused,
      primaryBot: "academic-os",
    };
    const app = (user: MiddlewareHandler<{ Variables: AppVariables }>) =>
      new Hono().route(PATH, createStudyRoutes(deps, user));
    expect((await app(signedIn(null)).request(`${PATH}/anything`)).status).toBe(
      401,
    );
    expect(
      (await app(signedIn("jordan")).request(`${PATH}/anything`)).status,
    ).toBe(404);
  });
});

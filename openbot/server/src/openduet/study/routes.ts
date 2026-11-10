import { type Context, Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { PERSON_INITIATOR } from "../../audit";
import type { AppVariables } from "../../auth/guards";
import {
  StudyConflictError,
  type StudyContext,
  StudyForbiddenError,
  StudyInputError,
  StudyNotFoundError,
  type StudyRouteDeps,
} from "./contracts";
import { craftRoutes } from "./craft-routes";
import { planRoutes } from "./plan-routes";
import { quizRoutes } from "./quiz-routes";
import { rulesRoutes } from "./rules-routes";

/*
 * /api/openduet/study: quizzes, flashcards and practice (quiz-routes.ts), study plans and the
 * calendar (plan-routes.ts), and the Teacher rules screen (rules-routes.ts), behind one sign-in,
 * one body limit and one error mapping. The sub-routers add none of the three themselves.
 */

export type StudyRoutes = Hono<{ Variables: AppVariables }>;

/** Only an admin may loosen a teacher's rule; anybody may make one stricter. */
export function canLoosen(context: Context<{ Variables: AppVariables }>) {
  return context.var.actor.role === "admin";
}

/**
 * Who a route works for, and the Bot it reads Gmail and Calendar through: the person signed in,
 * acting themselves, through the tenant's primary Bot.
 */
export function studyContextOf(
  context: Context<{ Variables: AppVariables }>,
  deps: Pick<StudyRouteDeps, "primaryBot">,
): StudyContext {
  return {
    actorId: context.var.actor.id,
    botId: deps.primaryBot,
    initiator: PERSON_INITIATOR,
  };
}

/**
 * The given sub-routers under the study routes' sign-in, body limit and error mapping.
 * `createStudyRoutes` mounts the real three; a test mounts its own.
 *
 * THE MAPPING HOLDS ONLY WHILE A SUB-ROUTER HAS NO `onError` OF ITS OWN. Hono copies a mounted
 * router's routes into this one, wrapped in that router's error handler when it set one, so a
 * sub-router's own `onError` would answer before this one is asked.
 */
export function mountStudyRoutes(
  routers: StudyRoutes[],
  requireUser: MiddlewareHandler<{ Variables: AppVariables }>,
): StudyRoutes {
  const routes = new Hono<{ Variables: AppVariables }>();
  routes.use(
    "*",
    requireUser,
    bodyLimit({
      maxSize: 32_768,
      // In the `{ error }` shape every other answer here has, so the app can show the sentence.
      onError: (context) =>
        context.json({ error: "That's too much to send at once." }, 413),
    }),
  );
  routes.onError((error, context) => {
    if (error instanceof StudyNotFoundError)
      return context.json({ error: error.message }, 404);
    if (error instanceof StudyConflictError)
      return context.json({ error: error.message }, 409);
    if (error instanceof StudyForbiddenError)
      return context.json({ error: error.message }, 403);
    if (error instanceof StudyInputError)
      return context.json({ error: error.message }, 400);
    // Hono's own answers (a malformed request, say) are already the right ones.
    if (error instanceof HTTPException) return error.getResponse();
    console.error(
      JSON.stringify({
        type: "openduet-study-route-error",
        error: error.name,
        context: { route: context.req.path },
        timestamp: new Date().toISOString(),
      }),
    );
    return context.json(
      { error: "Couldn't reach your study data. Try again." },
      503,
    );
  });
  for (const router of routers) routes.route("/", router);
  return routes;
}

export function createStudyRoutes(
  deps: StudyRouteDeps,
  requireUser: MiddlewareHandler<{ Variables: AppVariables }>,
) {
  return mountStudyRoutes(
    [quizRoutes(deps), planRoutes(deps), rulesRoutes(deps), craftRoutes(deps)],
    requireUser,
  );
}

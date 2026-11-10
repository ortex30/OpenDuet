import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { Hono } from "hono";
import type { AppVariables } from "../../auth/guards";
import type { PageBlock } from "../page-content";
import { loadEnabledPack, type PrivatePack } from "../private-pack";
import {
  StudyForbiddenError,
  StudyInputError,
  type StudyRouteDeps,
} from "./contracts";
import {
  checkTeachBack,
  craftGuide,
  craftQuiz,
  craftTutor,
  craftWritten,
  type GuideInput,
  gradeWritten,
  planTonight,
  polishGuide,
  polishTutor,
} from "./craft";
import {
  attemptData,
  attemptFromRecord,
  attemptIdOf,
  gradeQuiz,
  newQuiz,
  quizData,
  quizFromRecord,
} from "./quizzes";

/**
 * Notes-first study tools: a guide, a quiz, a tutor check, and tonight's plan.
 * Mounted with the other study routes, so sign-in and errors are already handled.
 */

export function craftRoutes(deps: StudyRouteDeps) {
  const routes = new Hono<{ Variables: AppVariables }>();
  const now = () => deps.now?.() ?? new Date();

  routes.post("/workshop/guide", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      classId?: string;
      focus?: string;
    } | null;
    const pack = requirePack();
    const input = guideInput(pack, body?.classId, body?.focus);
    const guide = await polishGuide(
      craftGuide(input),
      joined(input),
      process.env,
      fetch,
      input,
    );
    if (!deps.pages) {
      return context.json({
        title: guide.title,
        markdown: guide.markdown,
        dropped: guide.dropped,
      });
    }
    const owner = context.var.actor.id;
    const saved = await deps.pages.save(owner, deps.primaryBot, {
      kind: "doc",
      title: guide.title,
      summary: guide.summary,
      theme: "editorial",
      blocks: guide.blocks,
    });
    return context.json({
      pageId: saved.id,
      title: guide.title,
      markdown: guide.markdown,
      dropped: guide.dropped,
    });
  });

  routes.post("/workshop/quiz", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      classId?: string;
      focus?: string;
    } | null;
    const pack = requirePack();
    const input = guideInput(pack, body?.classId, body?.focus);
    const made = craftQuiz(input);
    if ("refused" in made) throw new StudyForbiddenError(made.refused);
    const written = craftWritten(input);
    const writtenQuestions = "refused" in written ? [] : written.questions;
    const owner = context.var.actor.id;
    const quiz = {
      ...newQuiz(
        {
          title: made.title,
          class: input.className,
          questions: made.questions,
        },
        {
          classId: input.classId,
          className: input.className,
          assignmentId: null,
        },
        { id: randomUUID(), at: now() },
      ),
      ...(writtenQuestions.length > 0 ? { written: writtenQuestions } : {}),
    };
    await deps.store.insertOnce(owner, {
      id: quiz.id,
      kind: "quiz",
      botId: deps.primaryBot,
      classId: quiz.classId,
      data: quizData(quiz),
    });
    return context.json({
      quizId: quiz.id,
      title: quiz.title,
      written: writtenQuestions.map(({ id, kind, prompt, topic }) => ({
        id,
        kind,
        prompt,
        topic,
      })),
    });
  });

  routes.post("/workshop/quizzes/:id/grade", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      answers?: number[];
      written?: { id: string; text: string }[];
    } | null;
    const answers = body?.answers;
    if (!answers?.length) throw new StudyInputError("Answer every question.");
    const owner = context.var.actor.id;
    const id = context.req.param("id");
    const record = await deps.store.get(owner, "quiz", id);
    if (!record) throw new StudyInputError("That quiz isn't here anymore.");
    const quiz = quizFromRecord(record);
    if (answers.length !== quiz.questions.length)
      throw new StudyInputError("Answer every question.");
    const graded = gradeQuiz(quiz, answers, {
      id: attemptIdOf(quiz.id),
      at: now(),
    });
    const written = gradeWritten(quiz.written ?? [], body?.written ?? []);
    const saved = await deps.store.insertOnce(owner, {
      id: graded.id,
      kind: "attempt",
      botId: deps.primaryBot,
      classId: quiz.classId,
      refId: quiz.id,
      data: attemptData(graded, quiz.className),
    });
    if (saved.created && deps.memory) {
      await deps.memory.record(owner, deps.primaryBot, [
        ...graded.results.map((question) => ({
          subject: quiz.className,
          topic: question.topic,
          result: question.correct ? ("correct" as const) : ("missed" as const),
          activity: "quiz" as const,
          ...(question.correct
            ? {}
            : { misconception: question.explanation.slice(0, 200) }),
        })),
        ...written.map((question) => ({
          subject: quiz.className,
          topic: question.topic,
          result: question.correct
            ? ("correct" as const)
            : question.partial
              ? ("partly" as const)
              : ("missed" as const),
          activity: "quiz" as const,
          ...(question.correct
            ? {}
            : { misconception: question.explanation.slice(0, 200) }),
        })),
      ]);
    }
    return context.json({
      attempt: saved.created ? graded : attemptFromRecord(saved.record),
      written,
      already: !saved.created,
    });
  });

  routes.post("/workshop/tutor", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      classId?: string;
      topic?: string;
    } | null;
    const pack = requirePack();
    const input = guideInput(pack, body?.classId, body?.topic);
    const drafted = craftTutor(input, body?.topic?.trim() || input.focus);
    if ("refused" in drafted) throw new StudyForbiddenError(drafted.refused);
    const step = await polishTutor(drafted, joined(input), process.env);
    return context.json({ tutor: step });
  });

  routes.post("/workshop/tutor/check", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      topic?: string;
      explanation?: string;
      check?: string;
      expects?: string[];
      answer?: string;
    } | null;
    if (!body?.answer?.trim() || !body.expects?.length || !body.topic)
      throw new StudyInputError("Write an answer first.");
    const result = checkTeachBack(
      {
        topic: body.topic,
        explanation: body.explanation ?? "",
        check: body.check ?? "",
        expects: body.expects,
      },
      body.answer,
    );
    if (deps.memory && body.explanation) {
      await deps.memory.record(context.var.actor.id, deps.primaryBot, [
        {
          subject: "Tutor",
          topic: body.topic,
          result: result.understood ? "correct" : "partly",
          activity: "teach-back",
        },
      ]);
    }
    return context.json({ check: result });
  });

  routes.post("/workshop/tonight", async (context) => {
    const pack = requirePack();
    const plan = planTonight(pack, now());
    return context.json({
      plan: {
        totalMinutes: plan.totalMinutes,
        warnings: plan.warnings,
        blocks: plan.blocks,
      },
    });
  });

  return routes;
}

function requirePack(): PrivatePack {
  const pack = loadEnabledPack();
  if (!pack)
    throw new StudyInputError(
      "Add your class notes under data/private, then try again.",
    );
  return pack;
}

function guideInput(
  pack: PrivatePack,
  classId: string | undefined,
  focus: string | undefined,
): GuideInput {
  const schoolClass =
    pack.classes.find((row) => row.id === classId) ??
    pack.classes.find((row) =>
      focus ? row.name.toLowerCase().includes(focus.toLowerCase()) : false,
    ) ??
    pack.classes[0];
  if (!schoolClass) throw new StudyInputError("Pick one of your classes.");
  const upcoming = pack.assignments
    .filter((item) => item.classId === schoolClass.id)
    .sort((a, b) => a.due.localeCompare(b.due));
  const named = focus
    ? upcoming.find((item) =>
        item.title.toLowerCase().includes(focus.toLowerCase()),
      )
    : (upcoming.find((item) => item.kind !== "assignment") ?? upcoming[0]);
  const files = readNotes(pack, schoolClass.materials);
  return {
    classId: schoolClass.id,
    className: schoolClass.name,
    help: named?.help ?? schoolClass.help,
    focus: named?.title ?? schoolClass.name,
    due: named?.due ?? null,
    notes: "",
    files,
  };
}

function readNotes(pack: PrivatePack, materials: readonly string[]) {
  return materials.flatMap((path) => {
    const full = resolve(pack.dir, path);
    const root = resolve(pack.dir);
    if (relative(root, full).startsWith("..")) return [];
    try {
      return [{ path, markdown: readFileSync(full, "utf8") }];
    } catch {
      return [];
    }
  });
}

function joined(input: GuideInput): string {
  return input.files.map((file) => file.markdown).join("\n");
}

export type { PageBlock };

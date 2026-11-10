import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { stricterLevel } from "@openbot/shared/study";
import { Hono } from "hono";
import type { AppVariables } from "../../auth/guards";
import type { PageBlock } from "../page-content";
import { loadEnabledPack, type PrivatePack } from "../private-pack";
import { practiceView } from "./coach-tools";
import {
  StudyForbiddenError,
  StudyInputError,
  type StudyRouteDeps,
} from "./contracts";
import {
  checkTeachBack,
  craftGuide,
  craftQuiz,
  craftWritten,
  eveningSummary,
  type GuideInput,
  gradeWritten,
  planTonight,
  polishGuide,
  schoolSnapshotFromPack,
} from "./craft";
import { notesForGuide } from "./guide-write";
import { buildGuideInput } from "./notes-input";
import { planData, planSpan } from "./plans";
import { type PracticeAnswer, storedPracticeSchema } from "./practice";
import { gradePractice, writePractice } from "./practice-model";
import {
  attemptData,
  attemptFromRecord,
  attemptIdOf,
  gradeQuiz,
  newQuiz,
  quizData,
  quizFromRecord,
} from "./quizzes";
import { answerTutor, openTutor } from "./tutor-session";

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
    const owner = context.var.actor.id;
    const input = await ruledInput(
      deps,
      owner,
      pack,
      guideInput(pack, body?.classId, body?.focus),
    );
    const drafted = craftGuide(input);
    const guide =
      input.help === "none"
        ? drafted
        : await polishGuide(drafted, joined(input), process.env, fetch, input);
    if (!deps.pages) {
      return context.json({
        title: guide.title,
        markdown: guide.markdown,
        dropped: guide.dropped,
      });
    }
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
    const input = await ruledInput(
      deps,
      context.var.actor.id,
      pack,
      guideInput(pack, body?.classId, body?.focus),
    );
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

  routes.post("/workshop/practice", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      classId?: string;
      focus?: string;
      mode?: string;
    } | null;
    const pack = requirePack();
    const input = await ruledInput(
      deps,
      context.var.actor.id,
      pack,
      buildGuideInput(pack, {
        ...(body?.classId ? { classId: body.classId } : {}),
        ...(body?.focus?.trim() ? { focus: body.focus.trim() } : {}),
      }),
    );
    const mode = body?.mode === "test" ? "test" : "quiz";
    const made = await writePractice(input, mode, process.env);
    if ("refused" in made) throw new StudyForbiddenError(made.refused);
    const id = randomUUID();
    const record = {
      title: made.title,
      classId: input.classId,
      className: input.className,
      focus: input.focus,
      subject: made.subject,
      mode: made.mode,
      suggestedMinutes: made.suggestedMinutes,
      items: made.items,
      createdAt: now().toISOString(),
      result: null,
    };
    await deps.store.insertOnce(context.var.actor.id, {
      id,
      kind: "practice",
      botId: deps.primaryBot,
      classId: input.classId,
      data: record,
    });
    return context.json({ practice: practiceView(record, id) });
  });

  routes.get("/workshop/practice/:id", async (context) => {
    const record = await deps.store.get(
      context.var.actor.id,
      "practice",
      context.req.param("id"),
    );
    if (!record) throw new StudyInputError("That practice isn't here anymore.");
    return context.json({ practice: practiceView(record.data, record.id) });
  });

  routes.post("/workshop/practice/:id/grade", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      answers?: PracticeAnswer[];
    } | null;
    const owner = context.var.actor.id;
    const id = context.req.param("id");
    const record = await deps.store.get(owner, "practice", id);
    if (!record) throw new StudyInputError("That practice isn't here anymore.");
    const parsed = storedPracticeSchema.safeParse(record.data);
    if (!parsed.success)
      throw new StudyInputError("That practice isn't here anymore.");
    if (parsed.data.result) {
      return context.json({
        practice: practiceView(record.data, id),
        result: parsed.data.result,
      });
    }
    const answers = body?.answers ?? [];
    if (answers.length === 0) throw new StudyInputError("Answer a question.");
    let won = false;
    const claimed = await deps.store.update(
      owner,
      "practice",
      id,
      (current) => {
        const data = storedPracticeSchema.safeParse(current.data);
        if (!data.success)
          throw new StudyInputError("That practice isn't here anymore.");
        if (data.data.result || data.data.grading) return { data: data.data };
        won = true;
        return { data: { ...data.data, grading: true } };
      },
    );
    const held = storedPracticeSchema.safeParse(claimed.data);
    if (!held.success)
      throw new StudyInputError("That practice isn't here anymore.");
    if (held.data.result) {
      return context.json({
        practice: practiceView(claimed.data, id),
        result: held.data.result,
      });
    }
    if (!won) throw new StudyInputError("That quiz is already being checked.");
    const pack = requirePack();
    const input = buildGuideInput(pack, {
      classId: held.data.classId,
      focus: held.data.focus,
    });
    let result: Awaited<ReturnType<typeof gradePractice>>;
    try {
      result = await gradePractice(
        held.data.items,
        answers,
        notesForGuide(input),
        process.env,
      );
    } catch (error) {
      await deps.store
        .update(owner, "practice", id, (current) => {
          const data = storedPracticeSchema.safeParse(current.data);
          if (!data.success || data.data.result) return {};
          return { data: { ...data.data, grading: false } };
        })
        .catch(() => undefined);
      throw error;
    }
    const data = { ...held.data, grading: false, result };
    const saved = await deps.store.update(owner, "practice", id, (current) => {
      const latest = storedPracticeSchema.safeParse(current.data);
      if (latest.success && latest.data.result) return { data: latest.data };
      return { data };
    });
    const finalData = storedPracticeSchema.safeParse(saved.data);
    const finalResult =
      finalData.success && finalData.data.result
        ? finalData.data.result
        : result;
    if (deps.memory) {
      await deps.memory.record(
        owner,
        deps.primaryBot,
        result.items.map((item) => ({
          subject: parsed.data.className,
          topic: item.topic,
          result: item.correct
            ? ("correct" as const)
            : item.partial
              ? ("partly" as const)
              : ("missed" as const),
          activity: "quiz" as const,
          ...(item.correct
            ? {}
            : { misconception: item.feedback.slice(0, 200) }),
        })),
      );
    }
    return context.json({
      practice: practiceView(finalData.success ? finalData.data : data, id),
      result: finalResult,
    });
  });

  routes.post("/workshop/tutor", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      classId?: string;
      topic?: string;
    } | null;
    const pack = requirePack();
    const input = await ruledInput(
      deps,
      context.var.actor.id,
      pack,
      buildGuideInput(pack, {
        ...(body?.classId ? { classId: body.classId } : {}),
        ...(body?.topic?.trim() ? { focus: body.topic.trim() } : {}),
      }),
    );
    const step = await openTutor(
      input,
      body?.topic?.trim() || input.focus,
      process.env,
    );
    if ("refused" in step) throw new StudyForbiddenError(step.refused);
    return context.json({ tutor: step });
  });

  routes.post("/workshop/tutor/turn", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      classId?: string;
      topic?: string;
      explanation?: string;
      example?: string;
      check?: string;
      expects?: string[];
      answer?: string;
      phase?: string;
    } | null;
    if (!body?.answer?.trim() || !body.topic)
      throw new StudyInputError("Write an answer first.");
    const pack = requirePack();
    const input = await ruledInput(
      deps,
      context.var.actor.id,
      pack,
      buildGuideInput(pack, {
        ...(body.classId ? { classId: body.classId } : {}),
        focus: body.topic,
      }),
    );
    if (input.help === "none") {
      throw new StudyForbiddenError(
        `${input.className} doesn't allow AI help. Review your own notes, and don't ask for the graded work.`,
      );
    }
    const phase = body.phase === "teach" ? "teach" : "check";
    const turn = await answerTutor(
      {
        opening: {
          topic: body.topic,
          explanation: body.explanation ?? "",
          example: body.example ?? "",
          check: body.check ?? "",
          expects: body.expects ?? [],
        },
        answer: body.answer,
        phase,
        notes: notesForGuide(input),
      },
      process.env,
    );
    if (deps.memory) {
      await deps.memory.record(context.var.actor.id, deps.primaryBot, [
        {
          subject: input.className,
          topic: body.topic,
          result: turn.understood ? "correct" : "partly",
          activity: phase === "teach" ? "teach-back" : "tutor",
        },
      ]);
    }
    return context.json({ turn });
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
    const body = (await context.req.json().catch(() => null)) as {
      skip?: unknown;
      save?: unknown;
      planId?: unknown;
      minutes?: unknown;
    } | null;
    const skip = Array.isArray(body?.skip)
      ? body.skip.filter((id): id is string => typeof id === "string")
      : [];
    const minutes =
      typeof body?.minutes === "number" ? body.minutes : undefined;
    const plan = planTonight(pack, now(), { skip, minutes });
    const save = body?.save === true;
    let planId: string | null = null;
    if (save) {
      const owner = context.var.actor.id;
      const id =
        typeof body?.planId === "string" && body.planId.trim()
          ? body.planId.trim()
          : randomUUID();
      const stamp = now().toISOString();
      const earlier = await deps.store.list(owner, "plan", {
        status: "applied",
      });
      for (const row of earlier) {
        if (row.id === id) continue;
        await deps.store.update(owner, "plan", row.id, (stored) => {
          if (stored.status !== "applied") return {};
          return {
            status: "discarded",
            data: {
              ...stored.data,
              status: "discarded",
              removedAt: stamp,
            },
          };
        });
      }
      const stored = {
        id,
        status: "applied" as const,
        reason: eveningSummary(plan),
        timeZone: pack.timeZone,
        startDate: plan.startDate,
        days: plan.days,
        blocks: plan.blocks,
        remaining: plan.remaining,
        warnings: plan.warnings,
        totalMinutes: plan.totalMinutes,
        createdAt: stamp,
        appliedAt: stamp,
      };
      const span = planSpan(stored.blocks, pack.timeZone);
      await deps.store.put(owner, {
        id,
        kind: "plan",
        botId: deps.primaryBot,
        status: "applied",
        startsAt: span.startsAt,
        endsAt: span.endsAt,
        data: planData(stored),
      });
      planId = id;
    }
    return context.json({
      planId,
      plan: {
        totalMinutes: plan.totalMinutes,
        warnings: plan.warnings,
        remaining: plan.remaining,
        blocks: plan.blocks,
        summary: eveningSummary(plan),
      },
    });
  });

  return routes;
}

async function ruledInput(
  deps: StudyRouteDeps,
  owner: string,
  pack: PrivatePack,
  input: GuideInput,
): Promise<GuideInput> {
  const at = deps.now?.() ?? new Date();
  const target = await deps.rules.target(
    owner,
    schoolSnapshotFromPack(pack, at),
    { className: input.className },
    at,
  );
  if (!target.ok) throw new StudyInputError(target.reason);
  return { ...input, help: stricterLevel(input.help, target.level) };
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

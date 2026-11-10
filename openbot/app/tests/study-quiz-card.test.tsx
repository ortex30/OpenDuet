import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { QuizAttempt, QuizPublic } from "@openbot/shared/study";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuizCard } from "@/components/duet/study";
import { settleReactWork } from "./settle-react-work";

/*
 * The quiz card on its own, as the tool renderer will draw it: a question at a time with a native
 * radio group, "Check" handing the choices up, and the attempt the server graded drawn as
 * the score and each answer with its explanation.
 */

beforeAll(() => GlobalRegistrator.register({ url: "http://localhost/" }));
afterEach(() => cleanup());
afterAll(async () => {
  await settleReactWork();
  GlobalRegistrator.unregister();
});

const quiz: QuizPublic = {
  id: "quiz-1",
  title: "Causes of the Civil War",
  classId: "apush",
  className: "AP US History",
  assignmentId: null,
  createdAt: "2026-11-04T15:00:00.000Z",
  questions: [
    {
      id: "q1",
      question: "Which compromise admitted California as a free state?",
      choices: [
        "Missouri Compromise",
        "Compromise of 1850",
        "Kansas-Nebraska Act",
        "Crittenden Compromise",
      ],
      topic: "Sectionalism",
    },
    {
      id: "q2",
      question: "What did the Dred Scott decision rule?",
      choices: [
        "Slavery was banned in the territories",
        "States could leave the Union",
        "Congress could not ban slavery in the territories",
        "Enslaved people who escaped were free",
      ],
      topic: "The courts",
    },
    {
      id: "q3",
      question: "Which party nominated Lincoln in 1860?",
      choices: ["Whig", "Republican", "Democratic", "Free Soil"],
      topic: "Elections",
    },
  ],
};

const attempt: QuizAttempt = {
  id: "attempt-1",
  quizId: "quiz-1",
  classId: "apush",
  correct: 2,
  total: 3,
  at: "2026-11-04T15:10:00.000Z",
  reviewTaskAdded: true,
  results: [
    {
      questionId: "q1",
      topic: "Sectionalism",
      question: quiz.questions[0]!.question,
      choices: quiz.questions[0]!.choices,
      selected: 1,
      correctIndex: 1,
      correct: true,
      explanation:
        "It admitted California free and passed a new Fugitive Slave Act.",
    },
    {
      questionId: "q2",
      topic: "The courts",
      question: quiz.questions[1]!.question,
      choices: quiz.questions[1]!.choices,
      selected: 0,
      correctIndex: 2,
      correct: false,
      explanation:
        "Taney's court said Congress had no power to ban slavery in a territory.",
    },
    {
      questionId: "q3",
      topic: "Elections",
      question: quiz.questions[2]!.question,
      choices: quiz.questions[2]!.choices,
      selected: 1,
      correctIndex: 1,
      correct: true,
      explanation: "Lincoln ran as a Republican.",
    },
  ],
};

function drawQuiz(
  props: Partial<Parameters<typeof QuizCard>[0]> = {},
): ReturnType<typeof render> & { submitted: number[][] } {
  const submitted: number[][] = [];
  const view = render(
    <QuizCard
      attempt={null}
      error={null}
      onSubmit={(answers) => submitted.push(answers)}
      quiz={quiz}
      submitting={false}
      {...props}
    />,
  );
  return Object.assign(view, { submitted });
}

const button = (view: ReturnType<typeof render>, name: string) =>
  view.getByRole("button", { name }) as HTMLButtonElement;

const choose = (view: ReturnType<typeof render>, choice: string) =>
  fireEvent.click(view.getByRole("radio", { name: choice }));

describe("before an attempt", () => {
  test("one question at a time, with its count, topic and progress", () => {
    const view = drawQuiz();

    const card = view.getByRole("region", {
      name: "Quiz: Causes of the Civil War",
    });
    expect(within(card).getByText("AP US History")).toBeTruthy();
    expect(within(card).getByText("Causes of the Civil War")).toBeTruthy();
    expect(view.getByText("1 / 3")).toBeTruthy();
    expect(view.getByText("Sectionalism")).toBeTruthy();
    // The question names its group of choices, so a screen reader reads it on the way in.
    const group = view.getByRole("group", {
      name: "Which compromise admitted California as a free state?",
    });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((radio) => radio.getAttribute("value")),
    ).toEqual(["0", "1", "2", "3"]);
    expect(
      view.getByRole("radio", { name: "Compromise of 1850" }),
    ).toBeTruthy();
    expect(
      view.queryByText("What did the Dred Scott decision rule?"),
    ).toBeNull();
    expect(
      view.container
        .querySelector("[data-quiz-progress]")
        ?.getAttribute("data-quiz-progress"),
    ).toBe(String(1 / 3));
    expect(button(view, "Back").disabled).toBe(true);
    expect(button(view, "Next").disabled).toBe(true);
    expect(view.queryByRole("button", { name: "Check" })).toBeNull();
  });

  test("every choice is one native radio of the same group, a whole row to tap", () => {
    const view = drawQuiz();
    const radios = view.getAllByRole("radio") as HTMLInputElement[];

    expect(radios).toHaveLength(4);
    expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);
    for (const radio of radios) {
      expect(radio.type).toBe("radio");
      // The label is the target, and it is at least 44px tall.
      const label = radio.closest("label");
      expect(label?.className).toContain("min-h-[52px]");
    }
    // The letter is drawn for the eye; the choice's words are its name.
    expect(radios[0]!.closest("label")?.textContent).toBe(
      "AMissouri Compromise",
    );
  });

  test("choosing enables Next; Next and Back move, keep the choices and put focus on them", () => {
    const view = drawQuiz();

    choose(view, "Compromise of 1850");
    expect(
      (
        view.getByRole("radio", {
          name: "Compromise of 1850",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(button(view, "Next").disabled).toBe(false);
    fireEvent.click(button(view, "Next"));

    expect(view.getByText("2 / 3")).toBeTruthy();
    expect(view.getByText("The courts")).toBeTruthy();
    expect(button(view, "Back").disabled).toBe(false);
    expect(button(view, "Next").disabled).toBe(true);
    // Focus went to the new question's first choice, not left on the button.
    expect(document.activeElement).toBe(
      view.getByRole("radio", {
        name: "Slavery was banned in the territories",
      }),
    );

    fireEvent.click(button(view, "Back"));
    expect(view.getByText("1 / 3")).toBeTruthy();
    const kept = view.getByRole("radio", {
      name: "Compromise of 1850",
    }) as HTMLInputElement;
    expect(kept.checked).toBe(true);
    expect(document.activeElement).toBe(kept);
  });

  test("arrow keys move the choice inside the group, as a radio group's do", async () => {
    const user = userEvent.setup({ document });
    const view = drawQuiz();

    await user.tab();
    expect(document.activeElement).toBe(
      view.getByRole("radio", { name: "Missouri Compromise" }),
    );
    await user.keyboard("{ArrowDown}");

    const second = view.getByRole("radio", {
      name: "Compromise of 1850",
    }) as HTMLInputElement;
    expect(second.checked).toBe(true);
    expect(document.activeElement).toBe(second);
    expect(button(view, "Next").disabled).toBe(false);
  });

  test("Check waits for every answer, then hands them up in order", () => {
    const view = drawQuiz();

    choose(view, "Compromise of 1850");
    fireEvent.click(button(view, "Next"));
    choose(view, "Congress could not ban slavery in the territories");
    fireEvent.click(button(view, "Next"));

    expect(view.getByText("3 / 3")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Next" })).toBeNull();
    expect(button(view, "Check").disabled).toBe(true);
    choose(view, "Republican");
    expect(button(view, "Check").disabled).toBe(false);
    fireEvent.click(button(view, "Check"));

    expect(view.submitted).toEqual([[1, 2, 1]]);
  });

  test("while it is checking, nothing can change and the button says so", () => {
    const view = drawQuiz();
    choose(view, "Compromise of 1850");
    fireEvent.click(button(view, "Next"));
    choose(view, "States could leave the Union");
    fireEvent.click(button(view, "Next"));
    choose(view, "Whig");

    view.rerender(
      <QuizCard
        attempt={null}
        error={null}
        onSubmit={() => {}}
        quiz={quiz}
        submitting
      />,
    );

    expect(button(view, "Checking…").disabled).toBe(true);
    expect(button(view, "Back").disabled).toBe(true);
    for (const radio of view.getAllByRole("radio") as HTMLInputElement[])
      expect(radio.disabled).toBe(true);
    // The choices were kept through the rerender.
    expect(
      (view.getByRole("radio", { name: "Whig" }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  test("an error is said as an alert", () => {
    const view = drawQuiz({ error: "Couldn't check your answers. Try again." });

    expect(view.getByRole("alert").textContent).toBe(
      "Couldn't check your answers. Try again.",
    );
  });
});

describe("after an attempt", () => {
  test("the score, then each answer with the right one and why, done or problem toned", () => {
    const view = drawQuiz({ attempt });

    expect(view.getByText("2 / 3")).toBeTruthy();
    expect(view.getByText("2 out of 3 correct").className).toContain("sr-only");
    expect(view.getByText("1 to look at.")).toBeTruthy();
    expect(view.queryByRole("radio")).toBeNull();
    expect(view.queryByRole("button", { name: "Check" })).toBeNull();

    const rows = Array.from(
      view.container.querySelectorAll<HTMLElement>("[data-result]"),
    );
    expect(rows.map((row) => row.getAttribute("data-result"))).toEqual([
      "correct",
      "missed",
      "correct",
    ]);

    const missed = within(rows[1]!);
    expect(missed.getByText("2. The courts")).toBeTruthy();
    expect(missed.getByText("Missed").className).toContain(
      "text-duet-status-problem",
    );
    expect(
      missed.getByText("You said Slavery was banned in the territories"),
    ).toBeTruthy();
    expect(
      missed.getByText("Congress could not ban slavery in the territories"),
    ).toBeTruthy();
    expect(
      missed.getByText(
        "Taney's court said Congress had no power to ban slavery in a territory.",
      ),
    ).toBeTruthy();

    const right = within(rows[0]!);
    expect(right.getByText("Correct").className).toContain(
      "text-duet-status-done",
    );
    expect(right.getByText("Compromise of 1850")).toBeTruthy();
    expect(right.queryByText(/^You chose/)).toBeNull();

    expect(view.getByText("Review task added.")).toBeTruthy();
  });

  test("Explain and Try again call back", () => {
    const explain = mock(() => {});
    const retry = mock(() => {});
    const view = drawQuiz({ attempt, onExplain: explain, onRetry: retry });

    fireEvent.click(button(view, "Explain"));
    fireEvent.click(button(view, "Try again"));

    expect(explain).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  test("with nothing missed there is nothing to explain, and no review task line", () => {
    const perfect: QuizAttempt = {
      ...attempt,
      correct: 3,
      reviewTaskAdded: false,
      results: attempt.results.map((result) => ({
        ...result,
        selected: result.correctIndex,
        correct: true,
      })),
    };
    const view = drawQuiz({
      attempt: perfect,
      onExplain: () => {},
      onRetry: () => {},
    });

    expect(view.getByText("3 / 3")).toBeTruthy();
    expect(view.getByText("Perfect score.")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Explain" })).toBeNull();
    // Alone, Try again is the card's one primary action.
    expect(button(view, "Try again").className).toContain("bg-duet-black");
    expect(view.queryByText(/review task/)).toBeNull();
  });

  test("where the conversation cannot take a message, neither button is drawn", () => {
    const view = drawQuiz({ attempt, onExplain: null, onRetry: null });

    expect(view.queryByRole("button")).toBeNull();
  });

  test("results that replace the questions take focus; read back from history they don't", () => {
    const view = drawQuiz();
    choose(view, "Compromise of 1850");
    fireEvent.click(button(view, "Next"));
    choose(view, "Slavery was banned in the territories");
    fireEvent.click(button(view, "Next"));
    choose(view, "Republican");
    fireEvent.click(button(view, "Check"));

    view.rerender(
      <QuizCard
        attempt={attempt}
        error={null}
        onSubmit={() => {}}
        quiz={quiz}
        submitting={false}
      />,
    );
    expect(document.activeElement?.textContent).toBe("2 / 32 out of 3 correct");
    cleanup();

    drawQuiz({ attempt });
    expect(document.activeElement).toBe(document.body);
  });
});

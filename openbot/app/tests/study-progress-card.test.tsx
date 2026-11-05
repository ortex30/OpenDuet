import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import {
  PROGRESS_NOTE,
  type ProgressSummary,
  type ProgressTopic,
} from "@openbot/shared/study";
import { ProgressCard, weakestFirst } from "@/components/duet/study";
import { settleReactWork } from "./settle-react-work";

/*
 * What the practice quizzes add up to: totals, each topic weakest first, the latest misses, and the
 * note that this counts practice and is not a grade.
 */

beforeAll(() => GlobalRegistrator.register({ url: "http://localhost/" }));
afterEach(() => cleanup());
afterAll(async () => {
  await settleReactWork();
  GlobalRegistrator.unregister();
});

const topic = (
  name: string,
  correct: number,
  total: number,
  classId = "apush",
  className = "AP US History",
): ProgressTopic => ({ classId, className, topic: name, correct, total });

const everything: ProgressSummary = {
  classId: null,
  attempts: 3,
  answered: 12,
  correct: 8,
  topics: [
    topic("Sectionalism", 3, 4),
    topic("The courts", 1, 3),
    topic("Cells", 4, 4, "bio", "AP Biology"),
    topic("Genetics", 0, 1, "bio", "AP Biology"),
  ],
  recentMisses: [
    {
      quizId: "quiz-2",
      classId: "bio",
      topic: "Genetics",
      question: "What does a Punnett square predict?",
      at: "2026-11-04T15:00:00.000Z",
    },
    {
      quizId: "quiz-1",
      classId: "apush",
      topic: "The courts",
      question: "What did the Dred Scott decision rule?",
      at: "2026-11-03T15:00:00.000Z",
    },
  ],
  note: PROGRESS_NOTE,
};

const topicOrder = (view: ReturnType<typeof render>) =>
  Array.from(view.container.querySelectorAll("[data-topic]"), (row) =>
    row.getAttribute("data-topic"),
  );

/** The number a term in the totals stands for. */
const total = (view: ReturnType<typeof render>, term: string) =>
  view.getByText(term).nextElementSibling?.textContent;

test("the totals: quizzes, questions and correct answers, term first for a screen reader", () => {
  const view = render(<ProgressCard summary={everything} />);

  expect(view.getByRole("region", { name: "Practice progress" })).toBeTruthy();
  expect(view.getByText("All classes")).toBeTruthy();
  expect(view.getByText("Quizzes").tagName).toBe("DT");
  expect(total(view, "Quizzes")).toBe("3");
  expect(total(view, "Questions")).toBe("12");
  expect(total(view, "Correct")).toBe("8");
  expect(view.getByText("Quizzes").nextElementSibling?.className).toContain(
    "tabular-nums",
  );
});

test("topics are listed weakest first, each with right out of answered", () => {
  const view = render(<ProgressCard summary={everything} />);

  expect(topicOrder(view)).toEqual([
    "Genetics",
    "The courts",
    "Sectionalism",
    "Cells",
  ]);
  const courts = within(
    view.container.querySelector<HTMLElement>('[data-topic="The courts"]')!,
  );
  expect(courts.getByText("1 / 3")).toBeTruthy();
  expect(courts.getByText("1 of 3 correct").className).toContain("sr-only");
  // Across every class, each topic names its class.
  expect(courts.getByText("AP US History")).toBeTruthy();
});

test("a tie goes to the topic with more questions behind it, then to the name", () => {
  expect(
    weakestFirst([
      topic("Beta", 1, 2),
      topic("Alpha", 1, 2),
      topic("Gamma", 2, 4),
      topic("Unanswered", 0, 0),
      topic("Delta", 0, 2),
    ]).map((entry) => entry.topic),
  ).toEqual(["Delta", "Gamma", "Alpha", "Beta", "Unanswered"]);
});

test("the latest misses, with their topic and class", () => {
  const view = render(<ProgressCard summary={everything} />);

  expect(view.getByText("What does a Punnett square predict?")).toBeTruthy();
  expect(view.getByText("Genetics · AP Biology")).toBeTruthy();
  expect(view.getByText("The courts · AP US History")).toBeTruthy();
});

test("one class's card names the class once, not on every row", () => {
  const view = render(
    <ProgressCard
      summary={{
        ...everything,
        classId: "apush",
        topics: everything.topics.filter((entry) => entry.classId === "apush"),
        recentMisses: everything.recentMisses.filter(
          (miss) => miss.classId === "apush",
        ),
      }}
    />,
  );

  expect(view.getAllByText("AP US History")).toHaveLength(1);
  expect(view.queryByText("All classes")).toBeNull();
  expect(
    view.getByText("The courts", { selector: "p.type-caption" }),
  ).toBeTruthy();
});

test("a long list folds after five, and Show more opens the rest", () => {
  const many = Array.from({ length: 7 }, (_, index) =>
    topic(`Topic ${index + 1}`, index, 7),
  );
  const view = render(
    <ProgressCard summary={{ ...everything, topics: many }} />,
  );

  expect(topicOrder(view)).toHaveLength(5);
  fireEvent.click(view.getByRole("button", { name: "Show 2 more in Topics" }));
  expect(topicOrder(view)).toHaveLength(7);
  expect(view.queryByRole("button", { name: /Show \d+ more/ })).toBeNull();
});

test("with no quizzes yet it says how to start, and still carries the note", () => {
  const view = render(
    <ProgressCard
      summary={{
        classId: null,
        attempts: 0,
        answered: 0,
        correct: 0,
        topics: [],
        recentMisses: [],
        note: PROGRESS_NOTE,
      }}
    />,
  );

  expect(
    view.getByText(
      "No practice quizzes yet. Ask for a quiz, and how you did shows up here.",
    ),
  ).toBeTruthy();
  expect(view.queryByText("Quizzes")).toBeNull();
  expect(view.container.querySelector("[data-topic]")).toBeNull();
  expect(view.getByText(PROGRESS_NOTE)).toBeTruthy();
});

test("the note that this is practice, not a grade, is always on the card", () => {
  const view = render(<ProgressCard summary={everything} />);

  expect(view.getByText(PROGRESS_NOTE)).toBeTruthy();
  expect(document.body.textContent).not.toContain("%");
});

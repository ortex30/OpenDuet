import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, render } from "@testing-library/react";
import {
  HELP_LEVELS,
  readTeacherRuleBlock,
  type TeacherRuleBlock,
  teacherRuleText,
} from "@openbot/shared/study";
import {
  HelpLevelPill,
  TeacherRuleNotice,
  teacherRuleSentence,
} from "@/components/duet/study";
import { settleReactWork } from "./settle-react-work";

/*
 * The notice drawn where a quiz or a deck would have been when a teacher's "No help" paused it, and
 * the pill that names a level the way the Classroom notice does.
 */

beforeAll(() => GlobalRegistrator.register({ url: "http://localhost/" }));
afterEach(() => cleanup());
afterAll(async () => {
  await settleReactWork();
  GlobalRegistrator.unregister();
});

const block: TeacherRuleBlock = {
  classId: "apush",
  className: "AP US History",
  level: "none",
  assignment: "DBQ essay",
  teacher: "Mr. Grant",
  source: "notice",
};

test("with an assignment and a teacher: the level, who set it, and what is paused", () => {
  const view = render(<TeacherRuleNotice block={block} what="Quiz" />);

  expect(view.getByRole("region", { name: "Quiz paused" })).toBeTruthy();
  expect(view.getByText("No help")).toBeTruthy();
  expect(view.getByText("Set by Mr. Grant")).toBeTruthy();
  expect(
    view.getByText(
      "AI quizzes and flashcards are paused for AP US History while “DBQ essay” is open. Planning still works.",
    ),
  ).toBeTruthy();
});

test("without an assignment, the class alone", () => {
  const { assignment: _, ...whole } = block;
  const view = render(<TeacherRuleNotice block={whole} what="Flashcards" />);

  expect(view.getByRole("region", { name: "Flashcards paused" })).toBeTruthy();
  expect(
    view.getByText(
      "AI quizzes and flashcards are paused for AP US History. Planning still works.",
    ),
  ).toBeTruthy();
});

test("a notice with no teacher's name is still the teacher's", () => {
  const { teacher: _, ...unnamed } = block;
  const view = render(<TeacherRuleNotice block={unnamed} what="Quiz" />);

  expect(view.getByText("Set by your teacher")).toBeTruthy();
  expect(view.queryByText(/Mr\. Grant/)).toBeNull();
});

test("a rule changed on Teacher rules is not put in the teacher's name", () => {
  const view = render(
    <TeacherRuleNotice block={{ ...block, source: "override" }} what="Quiz" />,
  );

  expect(view.getByText("Set in Teacher rules")).toBeTruthy();
  expect(view.queryByText("Set by Mr. Grant")).toBeNull();
});

test("a level nobody set names nobody", () => {
  const view = render(
    <TeacherRuleNotice block={{ ...block, source: "default" }} what="Quiz" />,
  );

  expect(view.queryByText(/^Set /)).toBeNull();
  expect(view.getByText("No help")).toBeTruthy();
});

test("drawn from the server's refusal, through the shared reader", () => {
  const refusal = `Refused. ${teacherRuleText(block, "The teacher set AP US History to No help, so nothing was made.")}`;
  const read = readTeacherRuleBlock(refusal);

  expect(read).not.toBeNull();
  const view = render(<TeacherRuleNotice block={read!} what="Quiz" />);
  expect(view.getByText(teacherRuleSentence(block))).toBeTruthy();
  // The model's sentence is for the model; the card writes its own.
  expect(document.body.textContent).not.toContain("so nothing was made");
});

test("each level in the notice's words, coloured only as status", () => {
  const view = render(
    <div>
      {HELP_LEVELS.map((level) => (
        <HelpLevelPill key={level} level={level} />
      ))}
    </div>,
  );
  const pill = (level: string) =>
    view.container.querySelector<HTMLElement>(`[data-help-level="${level}"]`)!;

  expect(pill("none").textContent).toBe("No help");
  expect(pill("none").className).toContain("text-duet-status-problem");
  expect(pill("none").querySelector("svg")).toBeTruthy();
  expect(pill("hints").textContent).toBe("Hints only");
  expect(pill("hints").className).toContain("text-duet-status-needs");
  expect(pill("hints").querySelector("svg")).toBeTruthy();
  expect(pill("full").textContent).toBe("Full help");
  // Full help asks nothing of the student, so it is grey and plain.
  expect(pill("full").className).toContain("text-duet-ink-2");
  expect(pill("full").className).not.toContain("status");
  expect(pill("full").querySelector("svg")).toBeNull();
});

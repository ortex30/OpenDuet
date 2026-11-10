import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { CommandOption } from "@/components/channels/composer";
import {
  STUDY_ACTIONS,
  StudyHome,
  studyDraft,
} from "@/components/shell/study-actions";
import { settleReactWork } from "./settle-react-work";

beforeAll(() => GlobalRegistrator.register({ url: "http://localhost:3010" }));
afterEach(() => cleanup());
afterAll(async () => {
  await settleReactWork();
  GlobalRegistrator.unregister();
});

const quiz = STUDY_ACTIONS.find((action) => action.slug === "quiz-me");
if (!quiz) throw new Error("Quiz me is missing from the study actions.");

const granted: CommandOption = {
  id: "quiz-me",
  name: "quiz-me",
  description: "A short practice quiz",
  kind: "chip",
  prompt: "Ask one question at a time.",
};

describe("a study tap", () => {
  test("attaches the granted skill and the words the student would have typed", () => {
    const draft = studyDraft(quiz, [granted]);
    expect(draft.commandIds).toEqual(["quiz-me"]);
    expect(draft.text).toContain("Quiz me on my nearest test.");
    expect(draft.isEmpty).toBe(false);
  });

  test("still sends the words when that skill is not granted", () => {
    const draft = studyDraft(quiz, []);
    expect(draft.commandIds).toEqual([]);
    expect(draft.text).toBe("Quiz me on my nearest test.");
  });

  test("the empty chat offers the study loop and the teacher's rule", () => {
    const picked: string[] = [];
    const view = render(
      <StudyHome onPick={(action) => picked.push(action.slug)} />,
    );
    expect(
      view.getByRole("heading", { name: "What should we work on?" }),
    ).toBeTruthy();
    expect(view.getByText(/Full help, hints only, or no help/)).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: /Quiz me/ }));
    expect(picked).toEqual(["quiz-me"]);
    expect(view.getAllByRole("button")).toHaveLength(STUDY_ACTIONS.length);
  });
});

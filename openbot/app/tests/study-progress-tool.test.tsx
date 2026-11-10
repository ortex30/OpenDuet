import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import type { Message } from "@ag-ui/core";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { PROGRESS_NOTE, type ProgressToolResult } from "@openbot/shared/study";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, within } from "@testing-library/react";
import { ConversationView } from "@/components/channels/conversation-view";
import { ProgressCardTool } from "@/lib/copilot/progress-card-tool";
import { settleReactWork } from "./settle-react-work";

/**
 * Practice so far as a student meets it in Chat: drawn by the real renderer in the real transcript,
 * straight from the tool's result, with nothing to fetch.
 */

/** Every request made to /api/openduet/study: there should be none. */
const asked: string[] = [];

const originalFetch = globalThis.fetch;
beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/" });
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/openduet/study/")) asked.push(url);
      return Response.json({ error: "Not found" }, { status: 404 });
    },
    { preconnect: originalFetch.preconnect },
  );
});
afterEach(() => {
  cleanup();
  asked.length = 0;
});
afterAll(async () => {
  await settleReactWork();
  globalThis.fetch = originalFetch;
  GlobalRegistrator.unregister();
});

const SHOWN: ProgressToolResult = {
  kind: "progress",
  summary: {
    classId: null,
    attempts: 2,
    answered: 6,
    correct: 4,
    topics: [
      {
        classId: "precalc4",
        className: "Precalculus",
        topic: "Quotient identities",
        correct: 0,
        total: 1,
      },
      {
        classId: "chem2",
        className: "Chemistry",
        topic: "Rate laws",
        correct: 2,
        total: 3,
      },
    ],
    recentMisses: [
      {
        quizId: "quiz-1",
        classId: "precalc4",
        topic: "Quotient identities",
        question: "Which one equals tan x?",
        at: "2026-11-04T15:05:00.000Z",
      },
    ],
    note: PROGRESS_NOTE,
  },
};

function asking(result?: string): Message[] {
  return [
    { id: "u1", role: "user", content: "How am I doing?" },
    {
      id: "a1",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call-1",
          type: "function",
          function: { name: "show_progress", arguments: "{}" },
        },
      ],
    },
    ...(result === undefined
      ? []
      : [
          {
            id: "t1",
            role: "tool" as const,
            toolCallId: "call-1",
            content: result,
          },
          {
            id: "a2",
            role: "assistant" as const,
            content: "Quotient identities are the one to review first.",
          },
        ]),
  ];
}

const queries = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function Chat({
  messages,
  busy = false,
}: {
  messages: Message[];
  busy?: boolean;
}) {
  return (
    <QueryClientProvider client={queries}>
      <CopilotKitProvider>
        <ProgressCardTool />
        <ConversationView busy={busy} messages={messages} onSubmit={() => {}} />
      </CopilotKitProvider>
    </QueryClientProvider>
  );
}

describe("the progress card", () => {
  test("while the tool runs, a line says so", async () => {
    const view = render(<Chat busy messages={asking()} />);
    expect(await view.findByText("Checking your practice")).toBeTruthy();
  });

  test("is drawn from the tool's result, under the Bot's line, with nothing fetched", async () => {
    for (const result of [
      JSON.stringify(SHOWN),
      JSON.stringify(JSON.stringify(SHOWN)),
    ]) {
      const view = render(<Chat messages={asking(result)} />);
      const card = await view.findByRole("region", {
        name: "Practice progress",
      });
      expect(within(card).getByText("All classes")).toBeTruthy();
      expect(within(card).getByText("Quotient identities")).toBeTruthy();
      expect(within(card).getByText("Rate laws")).toBeTruthy();
      expect(within(card).getByText("Which one equals tan x?")).toBeTruthy();
      expect(within(card).getByText(PROGRESS_NOTE)).toBeTruthy();
      const line = view.getByText(/the one to review first/);
      expect(
        line.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      cleanup();
    }
    expect(asked).toEqual([]);
  });

  test("a refused call draws nothing", async () => {
    const view = render(
      <Chat
        messages={asking(
          "Refused. \"Biology\" isn't one of the student's classes. Use one of: Chemistry, Precalculus.",
        )}
      />,
    );
    await view.findByText(/the one to review first/);
    expect(
      view.queryByRole("region", { name: "Practice progress" }),
    ).toBeNull();
  });

  test("while the Bot is still writing, it waits under a finished line, then comes in", async () => {
    const messages = asking(JSON.stringify(SHOWN));
    const view = render(<Chat busy messages={messages} />);
    await view.findByText(/the one to review first/);
    const held = view.container.querySelector("[data-card-held]");
    expect(held?.textContent).toContain("Checked your practice");
    expect(
      view.queryByRole("region", { name: "Practice progress" }),
    ).toBeNull();
    await act(async () => view.rerender(<Chat messages={messages} />));
    expect(
      await view.findByRole("region", { name: "Practice progress" }),
    ).toBeTruthy();
  });
});

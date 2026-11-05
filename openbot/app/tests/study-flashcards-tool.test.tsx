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
import {
  type DeckToolResult,
  type FlashcardDeck,
  type TeacherRuleBlock,
  teacherRuleText,
} from "@openbot/shared/study";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComposerDraft } from "@/components/channels/composer/draft";
import { ConversationView } from "@/components/channels/conversation-view";
import {
  DeckToolCard,
  FlashcardsCardTool,
} from "@/lib/copilot/flashcards-card-tool";
import { settleReactWork } from "./settle-react-work";

/**
 * The flashcards as a student meets them in Chat: drawn by the real renderer in the real
 * transcript, read from the server by the id the tool returned, and "Quiz me on these" sent as the
 * student's own words.
 */

type Seen = { method: string; url: string };
/** Every request the card made to /api/openduet/study, in order. */
const seen: Seen[] = [];
/** How the study routes answer, set by each test. */
let respond: (request: Seen) => Response | Promise<Response> = () =>
  Response.json({ error: "Not found" }, { status: 404 });

const originalFetch = globalThis.fetch;
beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/" });
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      // The composer asks the deployment about itself; nothing here depends on the answer.
      if (!url.startsWith("/api/openduet/study/"))
        return Response.json({ error: "Not found" }, { status: 404 });
      const request = { method: init?.method ?? "GET", url };
      seen.push(request);
      return respond(request);
    },
    { preconnect: originalFetch.preconnect },
  );
});
afterEach(() => {
  cleanup();
  seen.length = 0;
  respond = () => Response.json({ error: "Not found" }, { status: 404 });
});
afterAll(async () => {
  await settleReactWork();
  globalThis.fetch = originalFetch;
  GlobalRegistrator.unregister();
});

const DECK: FlashcardDeck = {
  id: "deck-1",
  title: "La comida y la salud",
  classId: "spanish5",
  className: "Spanish III",
  assignmentId: "spanish5-u5test",
  cards: [
    { front: "la manzana", back: "the apple" },
    { front: "el pescado", back: "the fish" },
    { front: "la cena", back: "dinner" },
  ],
  createdAt: "2026-11-04T15:00:00.000Z",
};

const MADE: DeckToolResult = {
  kind: "deck",
  id: "deck-1",
  title: "La comida y la salud",
  className: "Spanish III",
  count: 3,
};

const DECK_PATH = "/api/openduet/study/decks/deck-1";

/** The deck route answering `read()`, and nothing else. */
function serving(read: () => Response | Promise<Response>) {
  respond = (request) =>
    request.method === "GET" && request.url === DECK_PATH
      ? read()
      : Response.json({ error: "Not found" }, { status: 404 });
}

/** The student asks, the Bot calls make_flashcards and then says its line. */
function asked(result?: string): Message[] {
  return [
    { id: "u1", role: "user", content: "Flashcards for my Spanish test?" },
    {
      id: "a1",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call-1",
          type: "function",
          function: {
            name: "make_flashcards",
            arguments: JSON.stringify({
              class: "Spanish III",
              title: "La comida y la salud",
              cards: [{ front: "a draft front", back: "a draft back" }],
            }),
          },
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
            content: "Here are 3 cards for your vocab test.",
          },
        ]),
  ];
}

function Chat({
  messages,
  sent = [],
  busy = false,
  queries,
}: {
  messages: Message[];
  sent?: ComposerDraft[];
  busy?: boolean;
  queries: QueryClient;
}) {
  return (
    <QueryClientProvider client={queries}>
      <CopilotKitProvider>
        <FlashcardsCardTool />
        <ConversationView
          busy={busy}
          messages={messages}
          onSubmit={(draft) => {
            sent.push(draft);
          }}
        />
      </CopilotKitProvider>
    </QueryClientProvider>
  );
}

const fresh = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

const RULE: TeacherRuleBlock = {
  classId: "apush1",
  className: "AP US History",
  level: "none",
  teacher: "Mr. Grant",
  source: "notice",
};
const PAUSED = `Refused. ${teacherRuleText(
  RULE,
  "AP US History is set to No help, so nothing was made.",
)}`;

describe("the flashcards card", () => {
  test("while the tool runs, a line says so, and nothing is drawn from the model's draft", async () => {
    const view = render(<Chat busy messages={asked()} queries={fresh()} />);
    expect(await view.findByText("Making flashcards")).toBeTruthy();
    expect(view.queryByText(/draft/)).toBeNull();
    expect(seen).toEqual([]);
  });

  test("a refused call draws nothing", async () => {
    for (const result of [
      "Refused. make_flashcards couldn't make this deck. cards: Make 8 to 20 cards. Fix it and call make_flashcards again, without mentioning this to the student.",
      JSON.stringify({ kind: "quiz", id: "quiz-1" }),
    ]) {
      const view = render(<Chat messages={asked(result)} queries={fresh()} />);
      await view.findByText(/Here are 3 cards/);
      expect(view.queryByRole("region", { name: /Flashcards/ })).toBeNull();
      cleanup();
    }
    expect(seen).toEqual([]);
  });

  test("a teacher's No help draws the notice in the deck's place, however the result arrived", async () => {
    for (const result of [PAUSED, JSON.stringify(PAUSED)]) {
      const view = render(<Chat messages={asked(result)} queries={fresh()} />);
      const notice = await view.findByRole("region", {
        name: "Flashcards paused",
      });
      expect(within(notice).getByText("No help")).toBeTruthy();
      expect(
        within(notice).getByText(
          "AI quizzes and flashcards are paused for AP US History. Planning still works.",
        ),
      ).toBeTruthy();
      cleanup();
    }
    expect(seen).toEqual([]);
  });

  test("holds its place while it loads, then flips through the saved deck", async () => {
    const reading = Promise.withResolvers<Response>();
    serving(() => reading.promise);
    const view = render(
      <Chat messages={asked(JSON.stringify(MADE))} queries={fresh()} />,
    );
    const placeholder = await view.findByRole("region", {
      name: "Flashcards: La comida y la salud",
    });
    expect(placeholder.getAttribute("aria-busy")).toBe("true");
    expect(within(placeholder).getByText("3 cards")).toBeTruthy();

    await act(async () => reading.resolve(Response.json({ deck: DECK })));
    const face = await view.findByRole("button", { name: /la manzana/ });
    fireEvent.click(face);
    expect(
      await view.findByRole("button", { name: /Answer: the apple/ }),
    ).toBeTruthy();
    expect(view.queryByText(/draft/)).toBeNull();
    expect(seen).toEqual([{ method: "GET", url: DECK_PATH }]);
  });

  test("Quiz me on these asks for a quiz as the student, once", async () => {
    serving(() => Response.json({ deck: DECK }));
    const sent: ComposerDraft[] = [];
    const view = render(
      <Chat
        messages={asked(JSON.stringify(JSON.stringify(MADE)))}
        queries={fresh()}
        sent={sent}
      />,
    );
    fireEvent.click(
      await view.findByRole("button", { name: "Quiz me on these" }),
    );
    await waitFor(() =>
      expect(sent.map((draft) => draft.text)).toEqual([
        'Quiz me on these flashcards: "La comida y la salud".',
      ]),
    );
    expect(view.queryByRole("button", { name: "Quiz me on these" })).toBeNull();
  });

  test("a deck that can't be read says so, and Try again reads it again", async () => {
    let reads = 0;
    serving(() => {
      reads++;
      return reads === 1
        ? Response.json(
            { error: "Those flashcards aren't here anymore." },
            { status: 404 },
          )
        : Response.json({ deck: DECK });
    });
    const view = render(
      <Chat messages={asked(JSON.stringify(MADE))} queries={fresh()} />,
    );
    expect((await view.findByRole("alert")).textContent).toBe(
      "Those flashcards aren't here anymore.",
    );
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    expect(
      await view.findByRole("button", { name: /la manzana/ }),
    ).toBeTruthy();
    expect(reads).toBe(2);
  });

  test("outside a conversation there is nowhere to send, so it offers nothing to send", async () => {
    serving(() => Response.json({ deck: DECK }));
    const view = render(
      <QueryClientProvider client={fresh()}>
        <DeckToolCard made={MADE} />
      </QueryClientProvider>,
    );
    expect(
      await view.findByRole("button", { name: /la manzana/ }),
    ).toBeTruthy();
    expect(view.queryByRole("button", { name: "Quiz me on these" })).toBeNull();
  });
});

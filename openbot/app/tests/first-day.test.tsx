import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import type { Message } from "@ag-ui/core";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { FIRST_DAY_FRAME } from "@openbot/shared/first-day";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import * as ChannelChatModule from "@/components/channels/channel-chat";
import { ChatTranscript } from "@/components/channels/chat-transcript";
import {
  FIRST_DAY_PLAN,
  FIRST_DAY_PLAN_WITHOUT_MAIL,
  FIRST_DAY_REQUEST_WITHOUT_MAIL,
  firstDayPlan,
  firstDayWelcome,
  firstNameOf,
} from "@/components/channels/first-day-greeting";
import { takeFirstMessage } from "@/components/channels/transcript-messages";
import { ChatPresenceProvider } from "@/components/shell/chat-presence";
import { ChatScreen } from "@/components/shell/chat-screen";
import {
  FIRST_DAY_CLOSE,
  FIRST_DAY_REQUEST,
} from "@/components/shell/first-day";
import { agentKeys } from "@/lib/agents/queries";
import { type AuthenticatedUser, authKeys } from "@/lib/auth/queries";
import { frameFirstDay } from "@/lib/channels/first-day";
import { type ChannelSummary, channelKeys } from "@/lib/channels/queries";
import { updateChannelEventCache } from "@/lib/channels/use-channel-events";
import { queryClient as appQueryClient } from "@/query-client";
import { settleReactWork } from "./settle-react-work";

/**
 * Chat waits for the student. An empty conversation shows the study home and sends nothing until
 * they tap or type. A first-day greeting that is already in the thread is still drawn as the Bot's.
 */

/*
 * The conversation itself is not under test here, and drawing it needs a whole CopilotKit runtime.
 * A namespace spy, restorable in `afterAll`, stands in for it and says which channel it was opened
 * on; `takeFirstMessage` then reads what Chat handed it to send, as the real one does on mount.
 */
const channelChat = spyOn(ChannelChatModule, "ChannelChat");

const originalFetch = global.fetch;
type Request = { method: string; path: string; body: unknown };
let requests: Request[] = [];
let answerMe: () => Promise<Response>;
let answerCreate: () => Promise<Response>;
const routeAnswer = () =>
  Response.json({
    agentId: BOT.id,
    name: BOT.name,
    reason: "named by the person asking",
    fallback: false,
    viaMention: true,
  });
let answerRoute: () => Promise<Response> = async () => routeAnswer();
/** What app access says about Gmail and Calendar on the Bot. Ready unless a test says otherwise. */
let answerGmail: () => Promise<Response> = async () =>
  Response.json({ app: { key: "google-workspace", state: "ready" } });
const GMAIL_PATH = "/api/plugins/for/openduet/apps/google-workspace";

const BOT = {
  id: "openduet",
  name: "OpenDuet",
  title: "Your proactive assistant",
  roleDescription: "",
  avatarSeed: "openduet",
  visibility: "private",
  endpoint: null,
  builtIn: true,
  hasAuth: false,
};

const userNamed = (id: string, name: string | null): AuthenticatedUser => ({
  id,
  email: `${id}@example.com`,
  name,
  role: "user",
  onboarding: null,
});

const summary = (id: string, lastMessageAt: string | null): ChannelSummary => ({
  id,
  name: "OpenDuet",
  agentIds: [BOT.id],
  threadId: `thread-${id}`,
  active: true,
  lastMessageAt,
  summary: null,
  lastMessage: lastMessageAt ? "Earlier" : null,
  lastMessageAgentId: null,
  createdAt: "2026-10-22T09:00:00.000Z",
  pinned: false,
  lastReadAt: lastMessageAt,
});

const CREATED = summary("created-channel", null);

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/" });
  channelChat.mockImplementation((({
    channel,
  }: {
    channel: { id: string };
  }) => <div data-channel={channel.id} data-testid="ongoing-chat" />) as never);
});

afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
  requests = [];
  answerRoute = async () => routeAnswer();
  window.localStorage.clear();
  appQueryClient.removeQueries({ queryKey: authKeys.currentUser() });
  answerGmail = async () =>
    Response.json({ app: { key: "google-workspace", state: "ready" } });
});

afterAll(async () => {
  channelChat.mockRestore();
  await settleReactWork();
  GlobalRegistrator.unregister();
});

function serve() {
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    requests.push({ method, path, body });
    if (path === "/api/me") return answerMe();
    if (path === GMAIL_PATH) return answerGmail();
    if (path === "/api/route" && method === "POST") return answerRoute();
    if (path === "/api/channels/first-day" && method === "POST") {
      const response = await answerCreate();
      if (!response.ok) return response;
      const body = await response.json();
      return Response.json({
        start: body.start ?? { channel: body.channel, claimed: true },
      });
    }
    if (path.startsWith("/api/channels"))
      return Response.json({ channels: [], nextCursor: null });
    return Response.json({});
  }) as unknown as typeof fetch;
}

const routed = () =>
  requests.filter((r) => r.path === "/api/route" && r.method === "POST");
const created = () =>
  requests.filter(
    (r) => r.path === "/api/channels/first-day" && r.method === "POST",
  );

/** Chat in the shell, with its Bot and its roster already loaded, as the app opens it. */
function openChat(
  channels: ChannelSummary[],
  {
    user,
    strict = false,
    nextCursor = null,
    transport,
  }: {
    user: AuthenticatedUser | "loading";
    strict?: boolean;
    nextCursor?: string | null;
    transport?: typeof fetch;
  },
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(agentKeys.list(false), [BOT]);
  client.setQueryData(channelKeys.list(), {
    pages: [{ channels, nextCursor }],
    pageParams: [""],
  });
  if (user === "loading") {
    serve();
  } else {
    answerMe = async () => Response.json({ user });
    client.setQueryData(authKeys.currentUser(), user);
    serve();
  }
  if (transport) global.fetch = transport;
  const screen: ReactNode = (
    <QueryClientProvider client={client}>
      <ChatPresenceProvider>
        <ChatScreen />
      </ChatPresenceProvider>
    </QueryClientProvider>
  );
  return Object.assign(
    render(strict ? <StrictMode>{screen}</StrictMode> : screen),
    { client },
  );
}

/** A promise the test settles, for a request that should hang until it says so. */
function held() {
  let settle: (response: Response) => void = () => {};
  const promise = new Promise<Response>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

/** Type into the composer the way its own tests do: a text paste at the caret. */
function typeInto(container: HTMLElement, words: string) {
  const editor = container.querySelector("[contenteditable]") as HTMLElement;
  editor.focus();
  const caret = document.createRange();
  caret.selectNodeContents(editor);
  caret.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(caret);
  const clipboardData = {
    files: [],
    items: [],
    types: ["text/plain"],
    getData: (type: string) => (type === "text/plain" ? words : ""),
  };
  editor.dispatchEvent(
    Object.assign(new Event("paste", { bubbles: true, cancelable: true }), {
      clipboardData,
    }),
  );
}

describe("what Chat asks for on the first day", () => {
  test("mail and calendar, and an invitation to correct it", () => {
    expect(FIRST_DAY_REQUEST).toMatch(/^Get to know me\./);
    expect(FIRST_DAY_REQUEST).toContain("mail");
    expect(FIRST_DAY_REQUEST).toContain("calendar");
    // S11.1's three parts, with the lines the transcript splits them at.
    expect(FIRST_DAY_REQUEST).toContain(
      "three parts, with a blank line between them",
    );
    expect(FIRST_DAY_REQUEST).toContain("no bold or headings");
    expect(FIRST_DAY_REQUEST).toContain("at most 450 characters");
    expect(FIRST_DAY_REQUEST).toContain('"How I\'ll help:"');
    // Under 60 asked, so the answer lands under S11.1's 70: asked for 70, bullets ran to 80.
    expect(FIRST_DAY_REQUEST).toContain("under 60 characters");
    expect(FIRST_DAY_REQUEST).toContain(FIRST_DAY_CLOSE);
    // And nothing about reply buttons, which made the model reach for them.
    expect(FIRST_DAY_REQUEST).not.toMatch(/repl|button|tap/i);
  });
});

describe("what Chat asks for when it can't read mail", () => {
  test("no reading, what it can do now, and the card to connect", () => {
    expect(FIRST_DAY_REQUEST_WITHOUT_MAIL).toMatch(/^Get to know me\./);
    expect(FIRST_DAY_REQUEST_WITHOUT_MAIL).toContain("aren't connected");
    expect(FIRST_DAY_REQUEST_WITHOUT_MAIL).toContain("don't try to read them");
    // Named by its id, so the card's tool can find it.
    expect(FIRST_DAY_REQUEST_WITHOUT_MAIL).toContain(
      "show me the card to connect them: it is one app, google-workspace, but don't write that id to me.",
    );
  });

  test("its plan promises no mail, and every other request keeps the mail plan", () => {
    expect(firstDayPlan(FIRST_DAY_REQUEST_WITHOUT_MAIL)).toBe(
      FIRST_DAY_PLAN_WITHOUT_MAIL,
    );
    expect(FIRST_DAY_PLAN_WITHOUT_MAIL).not.toMatch(/check your|read your/);
    expect(firstDayPlan(FIRST_DAY_REQUEST)).toBe(FIRST_DAY_PLAN);
    // A first day sent before the choice existed is drawn as it was sent.
    expect(firstDayPlan("Get to know me.")).toBe(FIRST_DAY_PLAN);
  });
});

describe("the greeting's words", () => {
  test("greets by first name, and by no name when there is not a real one", () => {
    expect(firstNameOf("Maya Chen")).toBe("Maya");
    expect(firstNameOf("  Maya  ")).toBe("Maya");
    expect(firstNameOf("maya@example.com")).toBeNull();
    expect(firstNameOf("")).toBeNull();
    expect(firstNameOf(null)).toBeNull();
    expect(firstNameOf(undefined)).toBeNull();
  });

  test("the welcome says it is the first day, and that it will learn their classes", () => {
    expect(firstDayWelcome("Maya")).toMatch(/^Welcome, Maya\. /);
    expect(firstDayWelcome(null)).toMatch(/^Welcome\. /);
    for (const welcome of [firstDayWelcome("Maya"), firstDayWelcome(null)]) {
      expect(welcome).toContain("first day");
      expect(welcome).toContain("learn your classes");
    }
  });
});

describe("the transcript on the first day", () => {
  const firstDay: Message = {
    id: "first-day",
    role: "user",
    content: frameFirstDay(FIRST_DAY_REQUEST),
  };

  test("draws the Bot's greeting where the message sits, and no bubble for the person", async () => {
    appQueryClient.setQueryData(
      authKeys.currentUser(),
      userNamed("transcript-maya", "Maya Chen"),
    );
    const view = render(<ChatTranscript messages={[firstDay]} />);
    await settleReactWork();

    expect(
      view.getByText(
        "Welcome, Maya. It's our first day together, and I'll learn your classes as we go.",
      ),
    ).toBeTruthy();
    expect(view.getByText(FIRST_DAY_PLAN)).toBeTruthy();
    // Both in the Bot's column; nothing on the person's side, and nothing of the frame or request.
    const rows = view.container.querySelectorAll('[data-slot="message"]');
    expect(rows.length).toBe(1);
    expect(rows[0]?.getAttribute("data-align")).toBe("start");
    expect(view.container.querySelectorAll('[data-slot="bubble"]').length).toBe(
      2,
    );
    expect(view.container.textContent).not.toContain(FIRST_DAY_FRAME[0]);
    expect(view.container.textContent).not.toContain(FIRST_DAY_REQUEST);
  });

  test("draws the plan that went with the request, so no mail is promised without it", async () => {
    appQueryClient.setQueryData(
      authKeys.currentUser(),
      userNamed("transcript-no-mail", "Maya Chen"),
    );
    const view = render(
      <ChatTranscript
        messages={[
          {
            id: "first-day-no-mail",
            role: "user",
            content: frameFirstDay(FIRST_DAY_REQUEST_WITHOUT_MAIL, {
              mail: false,
            }),
          },
        ]}
      />,
    );
    await settleReactWork();

    expect(view.getByText(FIRST_DAY_PLAN_WITHOUT_MAIL)).toBeTruthy();
    expect(view.queryByText(FIRST_DAY_PLAN)).toBeNull();
    expect(view.container.textContent).not.toContain(
      FIRST_DAY_REQUEST_WITHOUT_MAIL,
    );
  });

  test("says no name when the account's name is only an email address", async () => {
    appQueryClient.setQueryData(
      authKeys.currentUser(),
      userNamed("transcript-email", "maya@example.com"),
    );
    const view = render(<ChatTranscript messages={[firstDay]} />);
    await settleReactWork();

    expect(view.getByText(/^Welcome\. It's our first day/)).toBeTruthy();
    expect(view.container.textContent).not.toContain("maya@example.com");
  });

  test("a person quoting one line of the frame still gets their own bubble", async () => {
    const quoted: Message = {
      id: "quoted",
      role: "user",
      content: FIRST_DAY_FRAME[0],
    };
    const view = render(<ChatTranscript messages={[quoted]} />);
    await settleReactWork();

    expect(view.getByText(FIRST_DAY_FRAME[0])).toBeTruthy();
    const row = view.container.querySelector('[data-slot="message"]');
    expect(row?.getAttribute("data-align")).toBe("end");
    expect(view.queryByText(FIRST_DAY_PLAN)).toBeNull();
  });
});

describe("Chat on the first day", () => {
  test("resumes finding its conversation after a busy event interrupts pagination", async () => {
    const other = { ...summary("other", null), agentIds: ["another-bot"] };
    const target = summary("later-chat", "2026-10-22T10:00:00.000Z");
    const targetPage = { channels: [target], nextCursor: null };
    const page = { channels: [{ ...other, busy: true }], nextCursor: "older" };
    const [obsolete, refresh, next] = [held(), held(), held()];
    let firstSignal: AbortSignal | null | undefined;
    const transport = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === "/api/bots/attention") return Response.json({ bots: [] });
        if (path === "/api/channels") return refresh.promise;
        if (path === "/api/channels?cursor=older") {
          if (!firstSignal) {
            firstSignal = init?.signal;
            return obsolete.promise;
          }
          return next.promise;
        }
        throw new Error(`Unexpected request: ${path}`);
      },
      { preconnect: originalFetch.preconnect },
    );
    const view = openChat([other], {
      user: userNamed("interrupted-search", "Maya"),
      nextCursor: "older",
      transport,
    });
    try {
      await waitFor(() => expect(firstSignal).toBeDefined());
      await act(() => Bun.sleep(0));
      await act(async () =>
        updateChannelEventCache(view.client, {
          channelId: other.id,
          busy: true,
          lastMessage: null,
          lastMessageAt: null,
          lastMessageAgentId: null,
        }),
      );
      // Keep recovery pending through the observer notification and Chat's effect.
      await act(() => Bun.sleep(0));
      expect(firstSignal?.aborted).toBe(true);
      expect(view.queryByTestId("ongoing-chat")).toBeNull();
      await act(async () => obsolete.settle(Response.json(targetPage)));
      await act(async () => {
        refresh.settle(Response.json(page));
        next.settle(Response.json(targetPage));
      });
      await waitFor(() => {
        expect(
          view.getByTestId("ongoing-chat").getAttribute("data-channel"),
        ).toBe(target.id);
        expect(view.client.isFetching()).toBe(0);
      });
      for (const query of view.client.getQueryCache().getAll()) {
        expect(query.state.status).toBe("success");
      }
    } finally {
      view.unmount();
      for (const heldRequest of [obsolete, refresh, next])
        heldRequest.settle(Response.json({ channels: [], nextCursor: null }));
      await view.client.cancelQueries();
      view.client.clear();
      global.fetch = originalFetch;
      await settleReactWork();
    }
  });

  test("with no conversation yet, Chat shows the study home and sends nothing", async () => {
    const view = openChat([], {
      user: userNamed("waits", "Maya"),
      strict: true,
    });

    expect(
      await view.findByRole("heading", { name: "What should we work on?" }),
    ).toBeTruthy();
    await settleReactWork();
    expect(routed()).toHaveLength(0);
    expect(created()).toHaveLength(0);
    expect(view.queryByText(FIRST_DAY_PLAN)).toBeNull();
    expect(view.queryByTestId("ongoing-chat")).toBeNull();
  });

  test("a study tap starts one conversation with those words, and no greeting", async () => {
    answerCreate = async () => Response.json({ channel: CREATED });
    const view = openChat([], {
      user: userNamed("study-tap", "Maya"),
      strict: true,
    });

    await act(async () => {
      view.getByRole("button", { name: /What to work on/ }).click();
    });
    const ongoing = await view.findByTestId("ongoing-chat");
    expect(ongoing.getAttribute("data-channel")).toBe(CREATED.id);
    expect(created()).toHaveLength(1);
    expect(created()[0]?.body).toMatchObject({
      agentId: BOT.id,
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(created()[0]?.body).not.toHaveProperty("greeting");
    expect(routed()).toHaveLength(1);
    expect(routed()[0]?.body).toMatchObject({
      text: "What should I work on now?",
      agentId: BOT.id,
    });
    expect(takeFirstMessage(CREATED.id)).toBe("What should I work on now?");
    await settleReactWork();
    expect(created()).toHaveLength(1);
    expect(routed()).toHaveLength(1);
  });

  test("a conversation that has never had a message stays on the study home", async () => {
    const quiet = summary("quiet-channel", null);
    const view = openChat([quiet], { user: userNamed("quiet", "Maya") });

    expect(
      await view.findByRole("heading", { name: "What should we work on?" }),
    ).toBeTruthy();
    await settleReactWork();
    expect(view.queryByTestId("ongoing-chat")).toBeNull();
    expect(created()).toHaveLength(0);
    expect(routed()).toHaveLength(0);
  });

  test("a failed start releases the composer for another try", async () => {
    const creating = held();
    answerCreate = () => creating.promise;
    const view = openChat([], { user: userNamed("retry", "Maya") });

    await act(async () => typeInto(view.container, "Try this message"));
    const send = view.getByRole("button", { name: "Send message" });
    if (!(send instanceof HTMLButtonElement))
      throw new Error("The Send message control is not a button.");
    await act(async () => send.click());
    await waitFor(() => expect(created()).toHaveLength(1));
    expect(send.disabled).toBe(true);
    await act(async () =>
      creating.settle(
        Response.json(
          { error: "Couldn't start the conversation." },
          { status: 503 },
        ),
      ),
    );
    expect((await view.findByRole("alert")).textContent).toBe(
      "Couldn't start the conversation.",
    );
    expect(send.disabled).toBe(false);

    answerCreate = async () => Response.json({ channel: CREATED });
    await act(async () => send.click());
    await view.findByTestId("ongoing-chat");
    expect(takeFirstMessage(CREATED.id)).toBe("Try this message");
    expect(created()).toHaveLength(2);
    for (const request of created()) {
      expect(request.body).not.toHaveProperty("greeting");
    }
  });

  test("typing sends the student's own words", async () => {
    answerCreate = async () => Response.json({ channel: CREATED });
    const view = openChat([], { user: userNamed("typist", "Maya") });

    await act(async () => typeInto(view.container, "What's on today?"));
    await settleReactWork();
    expect(routed()).toHaveLength(0);
    expect(created()).toHaveLength(0);

    await act(async () => {
      view.getByLabelText("Send message").click();
    });
    await view.findByTestId("ongoing-chat");
    expect(routed()).toHaveLength(1);
    expect(routed()[0]?.body).toMatchObject({ text: "What's on today?" });
    expect(takeFirstMessage(CREATED.id)).toBe("What's on today?");
  });
});

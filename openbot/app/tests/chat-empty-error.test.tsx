import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import type { Message } from "@ag-ui/core";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, render } from "@testing-library/react";
import { ConversationView } from "@/components/channels/conversation-view";
import { ChatPresenceProvider } from "@/components/shell/chat-presence";
import { settleReactWork } from "./settle-react-work";

/**
 * A turn that ended without an answer is said where the person is looking: at the end of the
 * conversation, or, in Chat with nothing in it yet, under its question and over the box.
 */

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/" });
  // The composer asks what this install can do (dictation); nothing here is on.
  global.fetch = (async () => Response.json({})) as unknown as typeof fetch;
});
afterEach(() => cleanup());
afterAll(async () => {
  await settleReactWork();
  GlobalRegistrator.unregister();
});

const FAILED =
  "Couldn't reach your coach. Check your connection and try again.";

function Chat({ messages = [] }: { messages?: Message[] }) {
  return (
    <ChatPresenceProvider>
      <ConversationView
        inShell
        messages={messages}
        onSubmit={() => {}}
        stopped={FAILED}
      />
    </ChatPresenceProvider>
  );
}

test("in an empty Chat, a failure is said under the question, just over the box", () => {
  const view = render(<Chat />);
  const alert = view.getByRole("alert");
  expect(alert.textContent).toBe(FAILED);
  expect(view.queryByTestId("transcript-stopped")).toBeNull();
  const question = view.getByRole("heading", {
    name: "What are we working on?",
  });
  const box = view.getByRole("textbox", { name: "Message" });
  // In reading order: the question, the failure, then the box.
  expect(
    question.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    alert.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

test("in a conversation, it stays at the end of the transcript", () => {
  const view = render(
    <Chat messages={[{ id: "m1", role: "user", content: "What's due?" }]} />,
  );
  expect(view.getByRole("alert").textContent).toBe(FAILED);
  expect(view.getByTestId("transcript-stopped").textContent).toBe(FAILED);
  expect(view.queryByRole("heading", { name: "What are we working on?" })).toBe(
    null,
  );
});

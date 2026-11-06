import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, render, waitFor } from "@testing-library/react";
import { ConversationView } from "@/components/channels/conversation-view";
import { ChatPresenceProvider } from "@/components/shell/chat-presence";
import { settleReactWork } from "./settle-react-work";

/**
 * Chat's message box takes the caret as Chat opens on a computer, so typing comes first, and leaves
 * a phone's keyboard down until the box is tapped.
 */

beforeAll(() => GlobalRegistrator.register({ url: "http://localhost/" }));
let realMatchMedia: typeof window.matchMedia;
beforeAll(() => {
  realMatchMedia = window.matchMedia;
  // The composer asks what this install can do (dictation); nothing here is on.
  global.fetch = (async () => Response.json({})) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  window.matchMedia = realMatchMedia;
});
afterAll(async () => {
  await settleReactWork();
  GlobalRegistrator.unregister();
});

/** The main pointer is a mouse (`fine`) or a finger (`coarse`). */
function pointer(kind: "fine" | "coarse") {
  window.matchMedia = ((query: string) => {
    const list = realMatchMedia.call(window, query);
    if (query.startsWith("(pointer:"))
      Object.defineProperty(list, "matches", {
        value: query === `(pointer: ${kind})`,
      });
    return list;
  }) as typeof window.matchMedia;
}

function Chat({ inShell = true }: { inShell?: boolean }) {
  return (
    <ChatPresenceProvider>
      <ConversationView inShell={inShell} messages={[]} onSubmit={() => {}} />
    </ChatPresenceProvider>
  );
}

test("on a computer, Chat's box has the caret as soon as Chat opens", async () => {
  pointer("fine");
  const view = render(<Chat />);
  const box = view.getByRole("textbox", { name: "Message" });
  await waitFor(() => expect(document.activeElement).toBe(box));
});

test("on a phone it waits to be tapped, so the keyboard stays down", async () => {
  pointer("coarse");
  const view = render(<Chat />);
  view.getByRole("textbox", { name: "Message" });
  await settleReactWork();
  expect(document.activeElement).toBe(document.body);
});

test("a conversation outside the shell takes the caret only when asked", async () => {
  pointer("fine");
  const view = render(<Chat inShell={false} />);
  view.getByRole("textbox", { name: "Message" });
  await settleReactWork();
  expect(document.activeElement).toBe(document.body);
});

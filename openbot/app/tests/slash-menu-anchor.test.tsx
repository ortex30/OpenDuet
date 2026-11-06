import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import type { Message } from "@ag-ui/core";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, render } from "@testing-library/react";
import { ConversationView } from "@/components/channels/conversation-view";
import { ChatPresenceProvider } from "@/components/shell/chat-presence";
import { settleReactWork } from "./settle-react-work";

/**
 * The `/` menu is fixed to the caret's place on the screen. A transform, a translate or a backdrop
 * filter on any box between Chat's message box and the page would become the menu's frame instead,
 * and it would open offset by wherever that box sits: off the bottom of the screen, in an empty
 * Chat. The glass stays, as a layer behind the box rather than the box itself.
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

/** Utilities that make a box the frame its fixed descendants are placed in. */
const FRAMES_FIXED =
  /(?:^|[\s:])(?:-?(?:translate|scale|rotate|skew)-|transform-gpu|backdrop-|blur|drop-shadow|filter|will-change-transform|perspective-|contain-|@container|duet-glass)/;

function Chat({ messages }: { messages: Message[] }) {
  return (
    <ChatPresenceProvider>
      <ConversationView inShell messages={messages} onSubmit={() => {}} />
    </ChatPresenceProvider>
  );
}

for (const [state, messages] of [
  ["an empty Chat", []],
  [
    "a conversation",
    [{ id: "m1", role: "user", content: "What's due?" }] as Message[],
  ],
] as const) {
  test(`in ${state}, nothing around the message box moves the / menu`, () => {
    const view = render(<Chat messages={[...messages]} />);
    const box = view.getByRole("textbox", { name: "Message" });
    const framing: string[] = [];
    for (let el = box.parentElement; el; el = el.parentElement) {
      const classes = el.getAttribute("class") ?? "";
      if (FRAMES_FIXED.test(classes)) framing.push(classes);
    }
    expect(framing).toEqual([]);
    // Still glass: a layer of its own, behind everything in the box.
    const form = box.closest("form");
    const glass = Array.from(form?.children ?? []).find((child) =>
      child.classList.contains("duet-glass"),
    );
    expect(glass?.getAttribute("aria-hidden")).toBe("true");
  });
}

import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, render, waitFor } from "@testing-library/react";
import { act } from "react";
import { ConversationView } from "@/components/channels/conversation-view";
import { ChatCover } from "@/components/shell/chat-cover";
import { ChatPresenceProvider } from "@/components/shell/chat-presence";
import { settleReactWork } from "./settle-react-work";

/**
 * Chat's message box takes the caret as Chat opens on a computer, so typing comes first, and leaves
 * a phone's keyboard down until the box is tapped. Never from a field that has it, and never into a
 * box a screen covers.
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

/**
 * The main pointer is a mouse (`fine`) or a finger (`coarse`). `wide` is the shell's `lg`, where a
 * screen opens beside the chat rather than over it.
 */
function pointer(kind: "fine" | "coarse", wide = true) {
  window.matchMedia = ((query: string) => {
    const list = realMatchMedia.call(window, query);
    if (query.startsWith("(pointer:"))
      Object.defineProperty(list, "matches", {
        value: query === `(pointer: ${kind})`,
      });
    if (query === "(min-width: 64rem)")
      Object.defineProperty(list, "matches", { value: wide });
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

/** Chat beside another field, as a screen's "Add a task" sits beside it on a wide window. */
function Beside({ pending = false, chat = true }) {
  return (
    <ChatPresenceProvider>
      <input aria-label="Add a task" />
      {chat ? (
        <ConversationView
          inShell
          messages={[]}
          onSubmit={() => {}}
          pending={pending}
        />
      ) : null}
    </ChatPresenceProvider>
  );
}

test("Chat opening mid-turn takes the caret when the turn ends, if nobody else did", async () => {
  pointer("fine");
  const view = render(<Beside pending />);
  const box = view.getByRole("textbox", { name: "Message" });
  await settleReactWork();
  // The box waits out the turn: a reload mid-answer, or another tab's turn.
  expect(document.activeElement).toBe(document.body);
  view.rerender(<Beside />);
  await waitFor(() => expect(document.activeElement).toBe(box));
});

test("a field the person moved to while Chat waited keeps the caret when the turn ends", async () => {
  pointer("fine");
  const view = render(<Beside pending />);
  await settleReactWork();
  const field = view.getByRole("textbox", { name: "Add a task" });
  act(() => field.focus());
  view.rerender(<Beside />);
  await settleReactWork();
  expect(document.activeElement).toBe(field);
});

test("a field that has the caret as Chat opens keeps it", async () => {
  pointer("fine");
  const view = render(<Beside chat={false} />);
  const field = view.getByRole("textbox", { name: "Add a task" });
  act(() => field.focus());
  view.rerender(<Beside />);
  view.getByRole("textbox", { name: "Message" });
  await settleReactWork();
  expect(document.activeElement).toBe(field);
});

function Covered({ screen }: { screen: boolean }) {
  return (
    <ChatPresenceProvider>
      <ChatCover screen={screen}>
        <ConversationView inShell messages={[]} onSubmit={() => {}} />
      </ChatCover>
    </ChatPresenceProvider>
  );
}

test("in a narrow window a screen covers Chat, and its box waits until the chat shows again", async () => {
  pointer("fine", false);
  const view = render(<Covered screen />);
  const box = view.getByRole("textbox", { name: "Message" });
  await settleReactWork();
  expect(document.activeElement).toBe(document.body);
  // Closed with Escape, nothing else focused: the chat is back, and typing goes into its box.
  view.rerender(<Covered screen={false} />);
  await waitFor(() => expect(document.activeElement).toBe(box));
});

test("in a wide window a screen opens beside Chat, and the box still takes the caret", async () => {
  pointer("fine");
  const view = render(<Covered screen />);
  const box = view.getByRole("textbox", { name: "Message" });
  await waitFor(() => expect(document.activeElement).toBe(box));
});

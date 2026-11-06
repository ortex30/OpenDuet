import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { type ReactNode, type TouchEvent, useEffect, useRef } from "react";
import { AttentionNotifier } from "@/components/bot-profile/attention";
import { DuetIcon } from "@/components/duet/icons";
import { useChannelEvents } from "@/lib/channels/use-channel-events";
import { cn } from "@/lib/utils";
import {
  ChatPresenceProvider,
  useChatServerBusy,
  useServerWork,
} from "./chat-presence";
import { ChatScreen } from "./chat-screen";
import { DesktopBar } from "./desktop-bar";
import { FinishedForYou } from "./finished-for-you";
import { PageHeader, ShellHeader, useBack } from "./header";
import { PageChromeProvider, usePageChromeState } from "./page-chrome";
import { StartupIntro } from "./startup-intro";
import { type ShellTab, tabForPath } from "./tab-bar";

/**
 * The signed-in app is one chat with the coach, as School Chat was. There are no tabs to find:
 * Tasks, Calendar, Coach, Learn and what the coach made are screens it opens when the student asks
 * (the `open_screen` tool), one at a time. On a wide screen the screen opens beside the chat; on a
 * phone it covers the chat until it is closed. The chat stays mounted under it either way, so
 * nothing typed or streaming is lost.
 *
 * Everything else (Settings, Bots, Connections) is a page pushed over the app, in one chrome
 * (parity-spec 2.9): a back disc and the page's title in a pill.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const tab = tabForPath(pathname);
  // One socket for the app: it keeps the conversation list and its working dots live.
  useChannelEvents();
  // Work the server runs in Chat that this screen did not start, for the pill and the orb.
  const chat = useChatServerBusy(tab !== null);
  const chatServerWork = useServerWork(chat.busy, chat.threadId);

  return (
    <ChatPresenceProvider serverWork={chatServerWork}>
      {/*
       * `duet-touch`: every control drawn in the shell is a 44px target (styles.css). Clipped, not
       * hidden: a clipped box can't be scrolled, so nothing (the `/` menu bringing an item into view,
       * a phone's keyboard) can push the top bar off the screen.
       */}
      <div className="duet-touch flex h-svh flex-col overflow-clip bg-duet-surface">
        <StartupIntro tab={tab} />
        <AttentionNotifier />
        <FinishedForYou />
        <DesktopBar />
        {tab ? (
          <ChatWithScreen
            channel={/^\/channels\/[^/]+\/?$/.test(pathname)}
            tab={tab}
          >
            {children}
          </ChatWithScreen>
        ) : (
          <PageChromeProvider>
            <PageColumn>{children}</PageColumn>
          </PageChromeProvider>
        )}
      </div>
    </ChatPresenceProvider>
  );
}

/** What each screen is called on the bar over it. */
const SCREEN_NAMES: Record<Exclude<ShellTab, "chat">, string> = {
  tasks: "Your tasks",
  calendar: "Your calendar",
  coach: "Today's plan",
  learn: "What to review",
  make: "Made for you",
};

/**
 * The chat, and the one screen the coach opened, if any.
 *
 * The chat is Chat's own conversation, drawn here rather than by the `/` route so it keeps its
 * place, and everything in it, while screens open and close beside it. A channel (`/channels/<id>`)
 * is drawn by its route in the chat's place.
 *
 * Wide: the chat takes what the screen leaves, and the screen a column on the right, wider for the
 * calendar's week. Narrow: the screen covers the chat, under a bar with its name and a close button.
 * Escape closes it too, unless the screen used that Escape to close something of its own.
 */
function ChatWithScreen({
  tab,
  channel,
  children,
}: {
  tab: ShellTab;
  /** A channel's own conversation, drawn by its route in the chat's place. */
  channel: boolean;
  children: ReactNode;
}) {
  const screen = tab === "chat" ? null : tab;
  const navigate = useNavigate();
  useEffect(() => {
    if (!screen) return;
    const onKey = (event: KeyboardEvent) => {
      // A screen that used the Escape itself (the calendar closing an item's details) keeps it.
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !document.querySelector("[role=dialog]")
      )
        void navigate({ to: "/" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, navigate]);
  return (
    <div
      className={cn(
        "relative flex min-h-0 flex-1",
        screen === "calendar"
          ? "lg:grid lg:grid-cols-[minmax(360px,1fr)_minmax(560px,920px)]"
          : screen
            ? "lg:grid lg:grid-cols-[minmax(360px,1fr)_minmax(400px,500px)]"
            : null,
      )}
    >
      <section
        aria-label="Chat"
        className="duet-face relative mx-auto flex min-h-0 w-full max-w-[430px] flex-1 flex-col text-duet-ink [--duet-tab-space:max(env(safe-area-inset-bottom),12px)] lg:max-w-none"
      >
        <ShellHeader floating />
        <main className="flex min-h-0 flex-1 flex-col">
          {channel ? children : <ChatScreen />}
        </main>
      </section>
      {screen ? (
        <aside
          aria-label={SCREEN_NAMES[screen]}
          className="duet-face absolute inset-0 z-30 flex min-h-0 flex-col bg-duet-surface text-duet-ink [--duet-tab-space:max(env(safe-area-inset-bottom),12px)] [--screen-sticky:0px] [--screen-top:16px] motion-safe:animate-in motion-safe:fade-in lg:static lg:z-auto lg:border-duet-hair-2 lg:border-l motion-safe:lg:slide-in-from-right-4"
        >
          {/* The bar shares the content's column, and its 20px inset is the screen text's. */}
          <div className="mx-auto flex min-h-0 w-full max-w-[430px] flex-1 flex-col lg:max-w-none">
            <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-duet-hair-2 border-b px-5">
              <p className="type-sub truncate font-semibold">
                {SCREEN_NAMES[screen]}
              </p>
              <Link
                aria-label={`Close ${SCREEN_NAMES[screen].toLowerCase()}`}
                className="grid size-10 shrink-0 place-items-center rounded-full text-duet-ink-2 transition-colors hover:bg-duet-tile hover:text-duet-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40"
                to="/"
              >
                <DuetIcon name="x" size={20} />
              </Link>
            </div>
            {children}
          </div>
        </aside>
      ) : null}
    </div>
  );
}

/**
 * A page under the page chrome. A conversation keeps to Chat's column; a configuration page keeps
 * the width it was built for. `--duet-tab-space` is the bottom inset with no tab bar to clear, so a
 * conversation docks its reply box at the foot of the screen with Chat's margins.
 */
function PageColumn({ children }: { children: ReactNode }) {
  const chrome = usePageChromeState();
  const swipe = useEdgeSwipeBack();
  return (
    <div
      onTouchEnd={swipe.onTouchEnd}
      onTouchStart={swipe.onTouchStart}
      className={
        chrome?.column === "phone"
          ? "duet-face relative mx-auto flex min-h-0 w-full max-w-[430px] flex-1 flex-col text-duet-ink [--duet-tab-space:max(env(safe-area-inset-bottom),12px)] lg:max-w-3xl"
          : "duet-face relative flex min-h-0 w-full flex-1 flex-col text-duet-ink"
      }
    >
      <PageHeader />
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}

/** How near the left edge a swipe has to start, and how far right it has to travel, to go back. */
const EDGE_PX = 24;
const SWIPE_PX = 64;

/**
 * Back on a swipe in from the left edge (parity-spec 2.9), as the back disc does: a touch that starts
 * within 24px of the page's left edge and travels at least 64px right, more across than down.
 */
export function useEdgeSwipeBack() {
  const back = useBack();
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (event: TouchEvent<HTMLElement>) => {
      const touch = event.touches[0];
      const left = event.currentTarget.getBoundingClientRect().left;
      start.current =
        touch && event.touches.length === 1 && touch.clientX - left <= EDGE_PX
          ? { x: touch.clientX, y: touch.clientY }
          : null;
    },
    onTouchEnd: (event: TouchEvent<HTMLElement>) => {
      const from = start.current;
      start.current = null;
      const touch = event.changedTouches[0];
      if (!from || !touch) return;
      const across = touch.clientX - from.x;
      const down = Math.abs(touch.clientY - from.y);
      if (across >= SWIPE_PX && down < across / 2) back();
    },
  };
}

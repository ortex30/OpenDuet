import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  type ReactNode,
  type RefObject,
  type TouchEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { AttentionNotifier } from "@/components/bot-profile/attention";
import { SelfHostBanner } from "@/components/layout/self-host-banner";
import { useChannelEvents } from "@/lib/channels/use-channel-events";
import { useIsDesktop } from "@/hooks/use-mobile";
import { ChatScreen } from "./chat-screen";
import { DesktopBar } from "./desktop-bar";
import {
  ChatPresenceProvider,
  useChatServerBusy,
  useServerWork,
} from "./chat-presence";
import { FinishedForYou } from "./finished-for-you";
import { PageHeader, ShellHeader, useBack } from "./header";
import { MenuSheet } from "./menu-sheet";
import { PageChromeProvider, usePageChromeState } from "./page-chrome";
import { type ShellTab, TabBar, tabForPath } from "./tab-bar";
import { DuetIcon } from "@/components/duet/icons";

/**
 * The signed-in app. On a phone: one column with the header floating over it and the tabs at its
 * foot. On a wide screen (`lg` and up): one bar across the top and the chat always on screen, with
 * the other screens opening beside it (`DesktopSplit`).
 *
 * Everything that is not a tab is a page pushed over the app, in one chrome (parity-spec 2.9): a
 * back disc, the page's title in a pill, and no menu disc, avatar or tab bar. Bots, Connections,
 * Settings and a conversation opened from the menu all draw it; none draws its own.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const tab = tabForPath(pathname);
  const [menuOpen, setMenuOpen] = useState(false);
  // Any navigation closes the menu, including a conversation picked from inside it.
  const [shownPath, setShownPath] = useState(pathname);
  if (shownPath !== pathname) {
    setShownPath(pathname);
    setMenuOpen(false);
  }
  // One socket for the app: it keeps the conversation list and its working dots live.
  useChannelEvents();
  // Work the server runs in Chat that this screen did not start, for the pill and the orb.
  const chat = useChatServerBusy(tab === "chat");
  const chatServerWork = useServerWork(chat.busy, chat.threadId);

  return (
    <ChatPresenceProvider serverWork={chatServerWork}>
      {/* `duet-touch`: every control drawn in the shell is a 44px target (styles.css). */}
      <div className="duet-touch flex h-svh flex-col overflow-hidden bg-duet-surface">
        <AttentionNotifier />
        <FinishedForYou />
        <SelfHostBanner />
        {/* On a wide screen one bar across the top holds what the phone's header and tab bar do. */}
        <DesktopBar current={tab} />
        {tab ? (
          <TabColumn tab={tab}>
            <ShellHeader
              floating
              menuOpen={menuOpen}
              onMenu={() => setMenuOpen(true)}
            />
            <DesktopSplit tab={tab}>{children}</DesktopSplit>
          </TabColumn>
        ) : (
          <PageChromeProvider>
            <PageColumn>{children}</PageColumn>
          </PageChromeProvider>
        )}
        <MenuSheet onOpenChange={setMenuOpen} open={menuOpen} />
      </div>
    </ChatPresenceProvider>
  );
}

const TAB_NAMES: Record<ShellTab, string> = {
  chat: "Chat",
  tasks: "Tasks",
  calendar: "Calendar",
  coach: "Coach",
  learn: "Learn",
  make: "Make",
};

/**
 * One agent, one place. On a desktop the chat with the coach is always there: alone and centred on
 * Chat, and down the left with any other screen (Tasks, Calendar, Coach, Learn, Make) open beside
 * it, so the student never leaves the conversation to look something up. On a phone each screen
 * is its own tab, as before.
 */
function DesktopSplit({
  tab,
  children,
}: {
  tab: ShellTab;
  children: ReactNode;
}) {
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const panel = desktop && tab !== "chat";
  useEffect(() => {
    if (!panel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("[role=dialog]"))
        void navigate({ to: "/" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, navigate]);
  if (!panel)
    return <main className="flex min-h-0 flex-1 flex-col">{children}</main>;
  return (
    <div className="flex min-h-0 flex-1">
      <section
        aria-label="Chat"
        className="relative flex min-h-0 w-[420px] shrink-0 flex-col border-duet-hair-2 border-r xl:w-[480px]"
      >
        <ChatScreen />
      </section>
      <main className="relative flex min-h-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center justify-between border-duet-hair-2 border-b px-6">
          <p className="type-label font-semibold text-duet-ink-2 uppercase tracking-wide">
            {TAB_NAMES[tab]}
          </p>
          <Link
            aria-label={`Close ${TAB_NAMES[tab]}`}
            className="grid size-9 place-items-center rounded-full text-duet-ink-2 transition-colors hover:bg-duet-tile hover:text-duet-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40"
            to="/"
          >
            <DuetIcon name="x" size={18} />
          </Link>
        </div>
        {children}
      </main>
    </div>
  );
}

/** The tab bar's distance from the foot of the screen. */
const TAB_BAR_GAP = 22;

/**
 * A tab's column. The tab bar floats over its foot, frosted, so what scrolls reaches the bottom of
 * the screen. `--duet-tab-space` is the height the bar covers there: a screen pads its end by it,
 * and Chat docks its composer above it.
 */
function TabColumn({
  tab,
  children,
}: {
  tab: NonNullable<ReturnType<typeof tabForPath>>;
  children: ReactNode;
}) {
  const column = useRef<HTMLDivElement>(null);
  useTabSpace(column);
  return (
    <div
      className="duet-face relative mx-auto flex min-h-0 w-full max-w-[430px] flex-1 flex-col text-duet-ink [--duet-tab-space:86px] lg:max-w-none"
      ref={column}
    >
      {children}
      <TabBar current={tab} />
    </div>
  );
}

/**
 * Keep `--duet-tab-space` at the tab bar's real height plus its gap from the edge.
 *
 * MEASURED, NOT WRITTEN DOWN. It was a fixed 86px (a 64px bar and its 22px gap), but the bar's
 * height is in rem and follows the person's text size: at 200% it is 128px tall, and a fixed inset
 * left it lying over Chat's composer, so nobody could type. The 86px in the class is only the first
 * paint, before the bar has been measured.
 */
export function useTabSpace(column: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const host = column.current;
    const bar = host?.querySelector<HTMLElement>('nav[aria-label="Main"]');
    if (!host || !bar) return;
    // On a wide screen the bar is hidden (the sidebar replaces it): leave only a margin.
    const apply = () => {
      const height = Math.ceil(bar.getBoundingClientRect().height);
      host.style.setProperty(
        "--duet-tab-space",
        `${height > 0 ? height + TAB_BAR_GAP : 16}px`,
      );
    };
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(apply);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [column]);
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

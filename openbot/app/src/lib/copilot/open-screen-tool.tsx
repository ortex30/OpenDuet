import { useFrontendTool } from "@copilotkit/react-core/v2";
import { Link, useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { DuetIcon, type DuetIconName } from "@/components/duet/icons";

/*
 * The coach pulls things up when they are asked for, as School Chat did: the student says "what's on
 * my calendar this week" and the calendar opens beside the chat, one screen at a time. The chat is
 * the whole app; Tasks, Calendar, Coach, Learn and what the coach made are screens it opens, not
 * places the student has to find.
 *
 * A browser tool, because opening a screen is a thing this window does: nothing on the server
 * changes. The call leaves a card in the conversation that opens the same screen again, so a screen
 * closed by mistake is one tap away.
 */

export const OPEN_SCREEN_TOOL = "open_screen";

export const SCREENS = ["tasks", "calendar", "coach", "learn", "made"] as const;
export type Screen = (typeof SCREENS)[number];

const LOOK: Record<
  Screen,
  { title: string; line: string; icon: DuetIconName }
> = {
  tasks: { title: "Your tasks", line: "What's on your list", icon: "tasks" },
  calendar: {
    title: "Your calendar",
    line: "Classes, practices and study time",
    icon: "calendar",
  },
  coach: {
    title: "Today's plan",
    line: "What to do next and this week's load",
    icon: "activity",
  },
  learn: {
    title: "What to review",
    line: "What you know and what's due for review",
    icon: "bulb",
  },
  made: {
    title: "Made for you",
    line: "Pages, plans and guides",
    icon: "sparkle",
  },
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const parameters = z.object({
  screen: z
    .enum(SCREENS)
    .describe(
      "tasks: their task list. calendar: their calendar, a day or a week, with applied study sessions. coach: today's plan, what to do next, this week's workload and assignments. learn: what they know by class, topics due for review and mistakes to fix. made: pages, plans and guides you made for them.",
    ),
  date: z
    .string()
    .optional()
    .describe("calendar only: the day to show, as YYYY-MM-DD. Omit for today."),
  view: z
    .enum(["day", "week"])
    .optional()
    .describe("calendar only: one day or the whole week. Omit for one day."),
});

type OpenScreen = z.infer<typeof parameters>;

/** Where a screen lives. The shell opens these beside the chat. */
export function screenAddress(input: OpenScreen): {
  to: "/tasks" | "/calendar" | "/coach" | "/learn" | "/make";
  search: Record<string, string>;
} {
  switch (input.screen) {
    case "calendar":
      return {
        to: "/calendar",
        search: {
          ...(input.date && DAY.test(input.date) ? { date: input.date } : {}),
          ...(input.view === "week" ? { view: "week" } : {}),
        },
      };
    case "made":
      return { to: "/make", search: {} };
    case "coach":
      return { to: "/coach", search: {} };
    case "learn":
      return { to: "/learn", search: {} };
    default:
      return { to: "/tasks", search: {} };
  }
}

/**
 * Registers `open_screen` for whichever Bot the chat is talking to.
 *
 * The handler reads only the router, which is one object for the app's life: the SDK keeps the
 * first handler it is given and never the ones after it, so anything read from a render here would
 * be read once and then go stale.
 */
export function OpenScreenTool() {
  const router = useRouter();
  useFrontendTool({
    name: OPEN_SCREEN_TOOL,
    description:
      "Open one screen beside the chat so the student can see it: tasks, calendar, coach, learn or made. Call it when they ask to see, show, check or look at something one of these screens holds, such as their calendar, their tasks, what to do next, what to review or something you made. One screen at a time. The screen shows the details, so after calling it say one short sentence and never repeat what it shows.",
    parameters,
    handler: async (input: OpenScreen) => {
      const screen = SCREENS.includes(input.screen) ? input.screen : null;
      if (!screen) return "There is no such screen.";
      const address = screenAddress({ ...input, screen });
      await router.navigate({ to: address.to, search: address.search });
      return `Opened ${LOOK[screen].title.toLowerCase()} beside the chat. The student can see it now, so don't repeat what it shows.`;
    },
    render: ({ args, status }) => {
      const screen = SCREENS.find((name) => name === args?.screen);
      if (!screen) return null;
      return (
        <ScreenCard
          input={{ ...args, screen } as OpenScreen}
          opening={status !== "complete"}
        />
      );
    },
  });
  return null;
}

/** What the call leaves in the conversation: the screen it opened, and a tap to open it again. */
export function ScreenCard({
  input,
  opening = false,
}: {
  input: OpenScreen;
  opening?: boolean;
}) {
  const look = LOOK[input.screen];
  const address = screenAddress(input);
  return (
    <Link
      className="duet-face my-1 flex w-full max-w-[420px] items-center gap-3 rounded-[20px] bg-duet-card px-3.5 py-3 text-left text-duet-ink shadow-duet-card transition-colors hover:bg-duet-tile focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40"
      data-screen-card={input.screen}
      search={address.search}
      to={address.to}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-[14px] bg-duet-tile text-duet-ink">
        <DuetIcon name={look.icon} size={20} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="type-sub truncate font-semibold">{look.title}</span>
        <span className="type-caption truncate text-duet-ink-2">
          {opening ? "Opening…" : look.line}
        </span>
      </span>
      <DuetIcon className="text-duet-ink-3" name="arrowRight" size={18} />
    </Link>
  );
}

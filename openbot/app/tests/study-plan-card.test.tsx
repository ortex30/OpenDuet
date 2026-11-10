import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { SchoolClass, StudyPlan } from "@openbot/shared/study";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import {
  blocksByDay,
  StudyPlanCard,
  studyLinkClassName,
} from "@/components/duet/study";
import { staleSentence } from "@/components/duet/study/study-plan-card";
import { settleReactWork } from "./settle-react-work";

/*
 * A proposed study plan as one card: sessions by day, what did not fit, and Not now or Apply plan,
 * then the line that says what became of it, and Remove from calendar once it is applied.
 */

beforeAll(() => GlobalRegistrator.register({ url: "http://localhost/" }));
afterEach(() => cleanup());
afterAll(async () => {
  await settleReactWork();
  GlobalRegistrator.unregister();
});

const classes: SchoolClass[] = [
  {
    id: "apush",
    name: "AP US History",
    teacher: "Mr. Grant",
    period: "2",
    color: "sky",
  },
  {
    id: "bio",
    name: "AP Biology",
    teacher: null,
    period: null,
    color: "teal",
  },
];

const plan: StudyPlan = {
  id: "plan-1",
  status: "proposed",
  reason: "Your DBQ is due Friday, so it goes first.",
  timeZone: "America/New_York",
  startDate: "2026-11-04",
  days: 3,
  // Out of order on purpose: the card sorts them.
  blocks: [
    {
      id: "b4",
      assignmentId: null,
      classId: null,
      title: "Review: The courts",
      date: "2026-11-06",
      start: "15:00",
      end: "15:30",
    },
    {
      id: "b2",
      assignmentId: "dbq",
      classId: "apush",
      title: "DBQ essay: draft",
      date: "2026-11-04",
      start: "19:00",
      end: "19:45",
    },
    {
      id: "b1",
      assignmentId: "dbq",
      classId: "apush",
      title: "DBQ essay: outline",
      date: "2026-11-04",
      start: "16:05",
      end: "16:50",
    },
    {
      id: "b3",
      assignmentId: "lab",
      classId: "bio",
      title: "Lab report",
      date: "2026-11-05",
      start: "11:30",
      end: "12:15",
      late: true,
    },
  ],
  remaining: [
    {
      assignmentId: "precalc-hw",
      title: "Precalc homework",
      minutes: 45,
      due: "2026-11-05T23:59:00.000Z",
    },
  ],
  warnings: ["Thursday is full after 6 PM.", "Thursday is full after 6 PM."],
  totalMinutes: 165,
  createdAt: "2026-11-04T15:00:00.000Z",
  appliedAt: null,
  stale: false,
  staleReason: null,
};

function drawPlan(props: Partial<Parameters<typeof StudyPlanCard>[0]> = {}) {
  return render(
    <StudyPlanCard
      busy={false}
      error={null}
      onApply={() => {}}
      onDiscard={() => {}}
      plan={plan}
      {...props}
    />,
  );
}

type View = ReturnType<typeof render>;
const days = (view: View) =>
  view.getAllByRole("heading", { level: 2 }).map((day) => day.textContent);
const rowsOf = (view: View) =>
  Array.from(view.container.querySelectorAll("[data-block]"), (row) =>
    row.getAttribute("data-block"),
  );
const button = (view: View, name: string) =>
  view.getByRole("button", { name }) as HTMLButtonElement;

describe("what the plan holds", () => {
  test("a heading with how many sessions and how long, and the Bot's reason", () => {
    const view = drawPlan();

    const card = view.getByRole("region", { name: "Study plan" });
    expect(within(card).getByText("Your plan")).toBeTruthy();
    expect(within(card).getByText("4 sessions · 2 h 45 min")).toBeTruthy();
    expect(
      within(card).getByText("Your DBQ is due Friday, so it goes first."),
    ).toBeTruthy();
  });

  test("sessions by day, in order, named Today and Tomorrow from the student's today", () => {
    const view = drawPlan({ today: "2026-11-04" });

    expect(days(view)).toEqual(["Today", "Tomorrow", "Fri, Nov 6"]);
    expect(rowsOf(view)).toEqual(["b1", "b2", "b3", "b4"]);
  });

  test("without a today, every day is named by its date", () => {
    const view = drawPlan();

    expect(days(view)).toEqual(["Wed, Nov 4", "Thu, Nov 5", "Fri, Nov 6"]);
  });

  test("each session gives its title and time, and a late one says Late", () => {
    const view = drawPlan();
    const row = (id: string) =>
      within(
        view.container.querySelector<HTMLElement>(`[data-block="${id}"]`)!,
      );

    expect(row("b1").getByText("DBQ essay: outline")).toBeTruthy();
    expect(row("b1").getByText("4:05 – 4:50 PM")).toBeTruthy();
    expect(row("b3").getByText("11:30 AM – 12:15 PM")).toBeTruthy();
    expect(row("b3").getByText("Late").className).toContain(
      "text-duet-status-needs",
    );
    expect(row("b3").getByText(", after it was due").className).toContain(
      "sr-only",
    );
    expect(row("b1").queryByText("Late")).toBeNull();
    expect(view.getAllByText("Late")).toHaveLength(1);
  });

  test("given the classes, each session carries its class's colour and name", () => {
    const view = drawPlan({ classes });
    const dot = (id: string) =>
      view.container.querySelector<HTMLElement>(
        `[data-block="${id}"] [data-class-color]`,
      );

    expect(dot("b1")?.getAttribute("data-class-color")).toBe("sky");
    expect(dot("b1")?.style.backgroundColor).toBe("var(--duet-ch-blue)");
    expect(dot("b3")?.getAttribute("data-class-color")).toBe("teal");
    // General study has no class, and keeps the column so the titles still line up.
    expect(dot("b4")?.getAttribute("data-class-color")).toBe("none");
    expect(dot("b4")?.style.backgroundColor).toBe("transparent");
    expect(view.getByText("4:05 – 4:50 PM · AP US History")).toBeTruthy();
    expect(view.getByText("11:30 AM – 12:15 PM · AP Biology")).toBeTruthy();
    expect(view.getByText("3:00 – 3:30 PM")).toBeTruthy();
  });

  test("without classes there are no dots", () => {
    const view = drawPlan();

    expect(view.container.querySelector("[data-class-color]")).toBeNull();
  });

  test("what didn't fit and each warning, once", () => {
    const view = drawPlan();

    expect(view.getByText("45 min of Precalc homework")).toBeTruthy();
    expect(view.getAllByText("Thursday is full after 6 PM.")).toHaveLength(1);
  });

  test("the blocks group by day and sort by start", () => {
    expect(
      blocksByDay(plan.blocks).map((day) => [
        day.date,
        day.blocks.map((block) => block.id),
      ]),
    ).toEqual([
      ["2026-11-04", ["b1", "b2"]],
      ["2026-11-05", ["b3"]],
      ["2026-11-06", ["b4"]],
    ]);
  });
});

describe("answering it", () => {
  test("Not now and Apply plan call back, and Apply plan is the primary", () => {
    const apply = mock(() => {});
    const discard = mock(() => {});
    const view = drawPlan({ onApply: apply, onDiscard: discard });

    expect(button(view, "Add to calendar").className).toContain(
      "bg-duet-black",
    );
    fireEvent.click(button(view, "Add to calendar"));
    fireEvent.click(button(view, "Skip"));

    expect(apply).toHaveBeenCalledTimes(1);
    expect(discard).toHaveBeenCalledTimes(1);
  });

  test("while an answer is on its way, both buttons wait", () => {
    const view = drawPlan({ busy: true });

    expect(button(view, "Add to calendar").disabled).toBe(true);
    expect(button(view, "Skip").disabled).toBe(true);
  });

  test("an error is said as an alert, and the buttons stay to try again", () => {
    const view = drawPlan({ error: "Couldn't add the plan. Try again." });

    expect(view.getByRole("alert").textContent).toBe(
      "Couldn't add the plan. Try again.",
    );
    expect(button(view, "Add to calendar").disabled).toBe(false);
  });

  test("a stale plan says why and can't be applied, but can still be put away", () => {
    const view = drawPlan({
      plan: { ...plan, stale: true, staleReason: "changed" },
    });

    expect(
      view.getByText(
        "Your schedule changed since this plan was made. Ask for a fresh one.",
      ),
    ).toBeTruthy();
    expect(button(view, "Add to calendar").disabled).toBe(true);
    expect(button(view, "Skip").disabled).toBe(false);
  });

  test("a plan whose session has already begun says that, not that the schedule changed", () => {
    const view = drawPlan({
      plan: { ...plan, stale: true, staleReason: "started" },
    });

    expect(view.getByRole("status").textContent).toBe(
      "A session in this plan has already started. Ask for a fresh plan.",
    );
    expect(view.queryByText(/Your schedule changed/)).toBeNull();
    expect(button(view, "Add to calendar").disabled).toBe(true);
  });

  test("each reason a plan is out of date has its own words, and an unnamed one reads as a change", () => {
    expect(staleSentence({ staleReason: "changed" })).toBe(
      "Your schedule changed since this plan was made. Ask for a fresh one.",
    );
    expect(staleSentence({ staleReason: "started" })).toBe(
      "A session in this plan has already started. Ask for a fresh plan.",
    );
    expect(staleSentence({ staleReason: null })).toBe(
      staleSentence({ staleReason: "changed" }),
    );
  });

  test("a plan with no sessions has nothing to apply", () => {
    const view = drawPlan({ plan: { ...plan, blocks: [] } });

    expect(view.getByText("Nothing fit in that time.")).toBeTruthy();
    expect(button(view, "Add to calendar").disabled).toBe(true);
  });

  test("applied, it says so in the done tone beside the calendar link, with no buttons", () => {
    const view = drawPlan({
      calendarLink: (
        <a className={studyLinkClassName} href="/calendar">
          View on calendar
        </a>
      ),
      plan: { ...plan, status: "applied", appliedAt: "2026-11-04T15:05:00Z" },
    });

    const status = view.getByRole("status");
    // The Calendar tab, which is where it went: nothing is written to Google Calendar.
    expect(status.textContent).toBe("On your calendar");
    expect(status.className).toContain("text-duet-status-done");
    expect(
      view.getByRole("link", { name: "View on calendar" }).getAttribute("href"),
    ).toBe("/calendar");
    expect(view.queryByRole("button")).toBeNull();
  });

  test("applied wins over stale: what is on the calendar is what it says", () => {
    const view = drawPlan({
      plan: { ...plan, status: "applied", stale: true, staleReason: "started" },
    });

    expect(view.getByRole("status").textContent).toBe("On your calendar");
    expect(
      view.queryByText(/Your schedule changed|already started/),
    ).toBeNull();
  });

  test("applied, it can come off the calendar again with one press", () => {
    const remove = mock(() => {});
    const view = drawPlan({
      onRemove: remove,
      plan: { ...plan, status: "applied", appliedAt: "2026-11-04T15:05:00Z" },
    });

    expect(
      view.getAllByRole("button").map((pressable) => pressable.textContent),
    ).toEqual(["Remove from calendar"]);
    fireEvent.click(button(view, "Remove from calendar"));
    expect(remove).toHaveBeenCalledTimes(1);
  });

  test("while the removal is on its way it waits, and a refusal is said under the applied line", () => {
    const applied = {
      ...plan,
      status: "applied" as const,
      appliedAt: "2026-11-04T15:05:00Z",
    };
    const waiting = drawPlan({ busy: true, onRemove: () => {}, plan: applied });
    expect(button(waiting, "Remove from calendar").disabled).toBe(true);
    waiting.unmount();

    const refused = drawPlan({
      error: "Couldn't take the plan off your calendar. Try again.",
      onRemove: () => {},
      plan: applied,
    });
    expect(refused.getByRole("alert").textContent).toBe(
      "Couldn't take the plan off your calendar. Try again.",
    );
    expect(refused.getByRole("status").textContent).toBe("On your calendar");
    expect(button(refused, "Remove from calendar").disabled).toBe(false);
  });

  test("put away, it says Not added, with no buttons", () => {
    const view = drawPlan({
      onRemove: () => {},
      plan: { ...plan, status: "discarded" },
    });

    expect(view.getByRole("status").textContent).toBe("Not added");
    expect(view.queryByRole("button")).toBeNull();
  });

  test("taken off the calendar after it was applied, it says so, with no buttons", () => {
    const view = drawPlan({
      calendarLink: <a href="/calendar">View on calendar</a>,
      onRemove: () => {},
      plan: {
        ...plan,
        status: "discarded",
        appliedAt: "2026-11-04T15:05:00Z",
      },
    });

    expect(view.getByRole("status").textContent).toBe(
      "Removed from your calendar",
    );
    expect(view.queryByRole("button")).toBeNull();
    expect(view.queryByRole("link", { name: "View on calendar" })).toBeNull();
  });

  test("answered here, focus moves onto the line that says what happened", () => {
    const view = drawPlan();
    fireEvent.click(button(view, "Add to calendar"));
    view.rerender(
      <StudyPlanCard
        busy={false}
        error={null}
        onApply={() => {}}
        onDiscard={() => {}}
        plan={{ ...plan, status: "applied" }}
      />,
    );

    expect(document.activeElement).toBe(view.getByRole("status"));
  });

  test("removed here, focus waits for the plan to come off, then moves onto the line that says so", () => {
    const applied = {
      ...plan,
      status: "applied" as const,
      appliedAt: "2026-11-04T15:05:00Z",
    };
    const draw = (shown: StudyPlan) => (
      <StudyPlanCard
        busy={false}
        error={null}
        onApply={() => {}}
        onDiscard={() => {}}
        onRemove={() => {}}
        plan={shown}
      />
    );
    const view = render(draw(applied));
    const pressed = button(view, "Remove from calendar");
    pressed.focus();
    fireEvent.click(pressed);
    // Still applied: nothing has happened yet, so focus stays where it was.
    expect(document.activeElement).toBe(pressed);

    view.rerender(draw({ ...applied, status: "discarded" }));
    const status = view.getByRole("status");
    expect(status.textContent).toBe("Removed from your calendar");
    expect(document.activeElement).toBe(status);
  });

  test("read back already applied, nothing takes focus", () => {
    drawPlan({ plan: { ...plan, status: "applied" } });

    expect(document.activeElement).toBe(document.body);
  });
});

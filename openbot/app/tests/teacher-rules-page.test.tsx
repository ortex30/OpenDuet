import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  setSystemTime,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ClassRules, RulesChange, RulesView } from "@openbot/shared/study";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType, ReactNode } from "react";
import {
  TeacherRulesView,
  type TeacherRulesViewProps,
} from "@/components/duet/study";
import { Route as TeacherRulesRoute } from "@/routes/_authed/settings/teacher-rules";
import { settleReactWork } from "./settle-react-work";

/**
 * The Teacher rules page over the demo student's classes, drawn by the real route with its real
 * queries against a stubbed server: each class's level and where it came from, the choices a
 * student can't make, a stricter choice asked about before it is sent, the server's refusal in its
 * own words, Use the teacher's rule, a fresh read of Classroom, and the page before any classes.
 */

/** Wednesday, November 4, 2026, 3:10 PM in Chicago. */
const NOW = new Date("2026-11-04T21:10:00.000Z");

beforeAll(() => {
  setSystemTime(NOW);
  GlobalRegistrator.register({
    url: "http://localhost:3010/settings/teacher-rules",
  });
});
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});
afterAll(async () => {
  await settleReactWork();
  GlobalRegistrator.unregister();
  setSystemTime();
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const LOOSENING =
  "Only a teacher or an admin can loosen a teacher's rule. You can make it stricter.";

type Row = ClassRules["assignments"][number];

function row(fields: Pick<Row, "assignmentId" | "title"> & Partial<Row>): Row {
  return {
    due: null,
    status: "open",
    notice: null,
    override: null,
    level: "hints",
    source: "notice",
    ...fields,
  };
}

/** Jordan Rivera's rules as the server builds them from scripts/fake-google's Classroom notices. */
function demo(): RulesView {
  return {
    classes: [
      {
        classId: "apush1",
        className: "AP US History",
        teacher: "Mr. Grant",
        level: "none",
        source: "notice",
        override: null,
        assignments: [
          row({
            assignmentId: "apush1-dbq3",
            title: "DBQ essay",
            due: "2026-11-06T14:00:00.000Z",
            notice: "none",
            level: "none",
          }),
          row({
            assignmentId: "apush1-dbqdocs",
            title: "DBQ documents",
            notice: "none",
            level: "none",
          }),
        ],
      },
      {
        classId: "chem2",
        className: "Chemistry",
        teacher: "Dr. Okoro",
        level: "hints",
        source: "notice",
        override: null,
        assignments: [
          row({
            assignmentId: "chem2-lab5",
            title: "Lab 5 report",
            due: "2026-10-29T04:59:00.000Z",
            status: "returned",
          }),
          row({
            assignmentId: "chem2-lab6",
            title: "Lab 6 report",
            due: "2026-11-06T05:59:00.000Z",
            notice: "hints",
          }),
        ],
      },
      {
        classId: "eng11",
        className: "English 11",
        teacher: "Ms. Alvarez",
        level: "hints",
        source: "notice",
        override: null,
        assignments: [
          row({
            assignmentId: "eng11-gatsby",
            title: "Great Gatsby essay",
            due: "2026-11-11T05:59:00.000Z",
            notice: "hints",
          }),
        ],
      },
      {
        classId: "precalc4",
        className: "Precalculus",
        teacher: "Mr. Chen",
        level: "full",
        source: "notice",
        override: null,
        assignments: [
          row({
            assignmentId: "precalc4-hw43",
            title: "Section 4.3 homework",
            due: "2026-11-04T05:59:00.000Z",
            status: "missing",
            notice: "full",
            level: "full",
          }),
          row({
            assignmentId: "precalc4-quiz4",
            title: "Unit 4 quiz",
            due: "2026-11-05T16:45:00.000Z",
            notice: "full",
            level: "full",
          }),
        ],
      },
      {
        classId: "spanish5",
        className: "Spanish III",
        teacher: "Sra. Morales",
        level: "full",
        source: "notice",
        override: null,
        assignments: [
          row({
            assignmentId: "spanish5-u5test",
            title: "Unidad 5 test",
            due: "2026-11-07T18:20:00.000Z",
            notice: "full",
            level: "full",
          }),
        ],
      },
    ],
    timeZone: "America/Chicago",
    canLoosen: false,
    syncedAt: "2026-11-04T21:05:00.000Z",
    couldNotRead: [],
  };
}

/** The view with one class changed. */
function withClass(
  view: RulesView,
  classId: string,
  change: (rules: ClassRules) => ClassRules,
): RulesView {
  return {
    ...view,
    classes: view.classes.map((rules) =>
      rules.classId === classId ? change(rules) : rules,
    ),
  };
}

type Sent = { method: string; url: string; body?: unknown };

/**
 * The study routes as the page calls them. Each answer is a status and a body, or a function of
 * the request; the page's requests are recorded in order.
 */
function serving(routes: {
  rules?: () => [number, unknown];
  put?: (body: unknown) => [number, unknown];
  sync?: () => [number, unknown];
}) {
  const sent: Sent[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      sent.push({ method, url, ...(body === undefined ? {} : { body }) });
      const answer =
        url === "/api/openduet/study/rules" && method === "GET"
          ? routes.rules?.()
          : url === "/api/openduet/study/rules" && method === "PUT"
            ? routes.put?.(body)
            : url === "/api/openduet/study/school/sync" && method === "POST"
              ? routes.sync?.()
              : undefined;
      const [status, payload] = answer ?? [404, { error: "Not found" }];
      return Response.json(payload, { status });
    },
    { preconnect: realFetch.preconnect },
  );
  return {
    sent,
    writes: () => sent.filter((request) => request.method !== "GET"),
  };
}

/** The real route's page, in a router so its links resolve. */
function drawPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const Page = TeacherRulesRoute.options.component as ComponentType;
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <Page /> }),
    history: createMemoryHistory({
      initialEntries: ["/settings/teacher-rules"],
    }),
  });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

const group = (root: HTMLElement, name: string) =>
  within(root).getByRole("radiogroup", { name: `AI help for ${name}` });

const option = (root: HTMLElement, name: string, level: string) =>
  within(group(root, name)).getByRole("radio", { name: level });

/** The level a choice shows as chosen. */
const chosen = (root: HTMLElement, name: string) =>
  within(group(root, name))
    .getAllByRole("radio")
    .filter((radio) => radio.getAttribute("aria-checked") === "true")
    .map((radio) => radio.textContent);

/** Where focus is, as the choice and the option it sits on, so a miss reads as words. */
function focused(): [string | null, string | null] {
  const active = document.activeElement;
  return [
    active?.closest('[role="radiogroup"]')?.getAttribute("aria-label") ?? null,
    active?.textContent ?? null,
  ];
}

/** What each choice offers, and whether this person can choose it. */
const offered = (root: HTMLElement, name: string) =>
  within(group(root, name))
    .getAllByRole("radio")
    .map((radio) => [radio.textContent, !radio.hasAttribute("disabled")]);

const section = (root: HTMLElement, className: string) => {
  const heading = within(root).getByRole("heading", {
    level: 2,
    name: className,
  });
  const found = heading.closest("section");
  if (!found) throw new Error(`no section for ${className}`);
  return found;
};

describe("the Teacher rules page", () => {
  test("draws each class's level, where it came from, and the work it covers", async () => {
    serving({ rules: () => [200, { rules: demo() }] });
    const view = drawPage();
    expect(
      await view.findByRole("heading", { level: 1, name: "Teacher rules" }),
    ).toBeTruthy();
    expect(view.getByText("How much AI help each class allows.")).toBeTruthy();
    await view.findByRole("radiogroup", { name: "AI help for Chemistry" });
    expect(
      view
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual([
      "AP US History",
      "Chemistry",
      "English 11",
      "Precalculus",
      "Spanish III",
    ]);
    const history = section(view.container, "AP US History");
    expect(within(history).getByText("Mr. Grant")).toBeTruthy();
    expect(chosen(history, "AP US History")).toEqual(["No help"]);
    expect(
      within(history).getByText("From Mr. Grant's post: DBQ essay"),
    ).toBeTruthy();
    expect(chosen(history, "DBQ essay")).toEqual(["No help"]);
    const chemistry = section(view.container, "Chemistry");
    expect(chosen(chemistry, "Chemistry")).toEqual(["Hints only"]);
    expect(
      within(chemistry).getByText("From Dr. Okoro's post: Lab 6 report"),
    ).toBeTruthy();
    // Returned work with no rule of its own isn't listed; work still to do is.
    expect(
      within(chemistry)
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(["Whole class", "Lab 6 report"]);
    // The missing homework's past due, so the quiz still to come decides Precalculus.
    expect(
      within(section(view.container, "Precalculus")).getByText(
        "From Mr. Chen's post: Unit 4 quiz",
      ),
    ).toBeTruthy();
    expect(view.getByText("Last read 5 min ago")).toBeTruthy();
    expect(
      view.getByText(
        /No help turns off AI quizzes and flashcards for that assignment/,
      ),
    ).toBeTruthy();
    expect(view.getByText(/Only a teacher can loosen a rule/)).toBeTruthy();
  });

  test("a student can't choose a looser level, and is told why", async () => {
    serving({ rules: () => [200, { rules: demo() }] });
    const view = drawPage();
    await view.findByRole("radiogroup", { name: "AI help for Chemistry" });
    expect(offered(view.container, "AP US History")).toEqual([
      ["Full help", false],
      ["Hints only", false],
      ["No help", true],
    ]);
    expect(offered(view.container, "Chemistry")).toEqual([
      ["Full help", false],
      ["Hints only", true],
      ["No help", true],
    ]);
    expect(offered(view.container, "Precalculus")).toEqual([
      ["Full help", true],
      ["Hints only", true],
      ["No help", true],
    ]);
    // The reason is what the choice is described by, so it is read with it.
    const chemistry = group(view.container, "Chemistry");
    const described = (chemistry.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual([
      "From Dr. Okoro's post: Lab 6 report",
      "Only a teacher or an admin can loosen this.",
    ]);
    expect(
      within(section(view.container, "Precalculus")).queryByText(
        "Only a teacher or an admin can loosen this.",
      ),
    ).toBeNull();
  });

  test("a stricter choice is asked about first, then sent, and the page shows the answer", async () => {
    let asked: unknown = null;
    const server = serving({
      rules: () => [200, { rules: demo() }],
      put: (body) => {
        asked = body;
        return [
          200,
          {
            rules: withClass(demo(), "chem2", (rules) => ({
              ...rules,
              level: "none",
              source: "override",
              override: "none",
              assignments: rules.assignments.map((work) => ({
                ...work,
                level: "none",
                source: "override",
              })),
            })),
          },
        ];
      },
    });
    const user = userEvent.setup({ document });
    const view = drawPage();
    await view.findByRole("radiogroup", { name: "AI help for Chemistry" });
    await user.click(option(view.container, "Chemistry", "No help"));
    expect(
      view.getByText(
        "Make Chemistry No help? Only a teacher or an admin can undo it.",
      ),
    ).toBeTruthy();
    // Nothing is sent until the student says so.
    expect(server.writes()).toEqual([]);
    expect(chosen(view.container, "Chemistry")).toEqual(["No help"]);
    await user.click(view.getByRole("button", { name: "Make it No help" }));
    await waitFor(() =>
      expect(
        within(section(view.container, "Chemistry")).getByText("Set here"),
      ).toBeTruthy(),
    );
    expect(asked).toEqual({ classes: { chem2: "none" } });
    expect(server.writes()).toEqual([
      {
        method: "PUT",
        url: "/api/openduet/study/rules",
        body: { classes: { chem2: "none" } },
      },
    ]);
    expect(chosen(view.container, "Chemistry")).toEqual(["No help"]);
    expect(offered(view.container, "Chemistry")).toEqual([
      ["Full help", false],
      ["Hints only", false],
      ["No help", true],
    ]);
    expect(
      view.queryByText(
        "Make Chemistry No help? Only a teacher or an admin can undo it.",
      ),
    ).toBeNull();
    // Focus is back on the choice, not lost with the buttons that went away.
    expect(focused()).toEqual(["AI help for Chemistry", "No help"]);
  });

  test("Cancel leaves the rule as it was, and sends nothing", async () => {
    const server = serving({ rules: () => [200, { rules: demo() }] });
    const user = userEvent.setup({ document });
    const view = drawPage();
    await view.findByRole("radiogroup", { name: "AI help for Chemistry" });
    await user.click(option(view.container, "Chemistry", "No help"));
    await user.click(view.getByRole("button", { name: "Cancel" }));
    expect(chosen(view.container, "Chemistry")).toEqual(["Hints only"]);
    expect(view.queryByRole("button", { name: "Make it No help" })).toBeNull();
    expect(server.writes()).toEqual([]);
  });

  test("an assignment's own choice sends the assignment", async () => {
    const server = serving({
      rules: () => [200, { rules: demo() }],
      put: () => [200, { rules: demo() }],
    });
    const user = userEvent.setup({ document });
    const view = drawPage();
    await view.findByRole("radiogroup", { name: "AI help for Chemistry" });
    await user.click(option(view.container, "Great Gatsby essay", "No help"));
    expect(
      view.getByText(
        "Make “Great Gatsby essay” No help? Only a teacher or an admin can undo it.",
      ),
    ).toBeTruthy();
    await user.click(view.getByRole("button", { name: "Make it No help" }));
    await waitFor(() => expect(server.writes()).toHaveLength(1));
    expect(server.writes()[0]?.body).toEqual({
      assignments: { "eng11-gatsby": "none" },
    });
  });

  test("the server's refusal is shown in its words, under the choice it was about", async () => {
    serving({
      rules: () => [200, { rules: demo() }],
      put: () => [403, { error: LOOSENING }],
    });
    const user = userEvent.setup({ document });
    const view = drawPage();
    await view.findByRole("radiogroup", { name: "AI help for Chemistry" });
    await user.click(option(view.container, "Chemistry", "No help"));
    await user.click(view.getByRole("button", { name: "Make it No help" }));
    const alert = await within(section(view.container, "Chemistry")).findByRole(
      "alert",
    );
    expect(alert.textContent).toBe(LOOSENING);
    // Nothing changed, so the choice is the server's again.
    expect(chosen(view.container, "Chemistry")).toEqual(["Hints only"]);
    expect(
      within(section(view.container, "English 11")).queryByRole("alert"),
    ).toBeNull();
  });

  test("Use the teacher's rule clears an override that adds nothing to the notices", async () => {
    // Hints only is what Chemistry's notices say already, so the teacher's post is named.
    const tied = withClass(demo(), "chem2", (rules) => ({
      ...rules,
      override: "hints",
    }));
    const cleared: RulesChange[] = [];
    serving({
      rules: () => [200, { rules: tied }],
      put: (body) => {
        cleared.push(body as RulesChange);
        return [200, { rules: demo() }];
      },
    });
    const user = userEvent.setup({ document });
    const view = drawPage();
    await view.findByRole("radiogroup", { name: "AI help for Chemistry" });
    const chemistry = section(view.container, "Chemistry");
    expect(
      within(chemistry).getByText("Also set here: Hints only"),
    ).toBeTruthy();
    await user.click(
      within(chemistry).getByRole("button", {
        name: "Use the teacher's rule for Chemistry",
      }),
    );
    await waitFor(() =>
      expect(
        within(section(view.container, "Chemistry")).queryByRole("button", {
          name: "Use the teacher's rule for Chemistry",
        }),
      ).toBeNull(),
    );
    expect(cleared).toEqual([{ classes: { chem2: null } }]);
  });

  test("a student's stricter override can't be cleared by them, so it isn't offered", async () => {
    const stricter = withClass(demo(), "spanish5", (rules) => ({
      ...rules,
      level: "none",
      source: "override",
      override: "none",
    }));
    serving({ rules: () => [200, { rules: stricter }] });
    const view = drawPage();
    await view.findByRole("radiogroup", { name: "AI help for Spanish III" });
    const spanish = section(view.container, "Spanish III");
    expect(within(spanish).getByText("Set here")).toBeTruthy();
    expect(
      within(spanish).queryByRole("button", { name: /Use the teacher's rule/ }),
    ).toBeNull();
  });

  test("an admin's choices go straight through, looser ones included", async () => {
    const admin = { ...demo(), canLoosen: true };
    const loosened = withClass(admin, "apush1", (rules) => ({
      ...rules,
      level: "full",
      source: "override",
      override: "full",
    }));
    const server = serving({
      rules: () => [200, { rules: admin }],
      put: (body) =>
        (body as RulesChange).classes?.apush1 === null
          ? [200, { rules: admin }]
          : [200, { rules: loosened }],
    });
    const user = userEvent.setup({ document });
    const view = drawPage();
    await view.findByRole("radiogroup", { name: "AI help for AP US History" });
    expect(view.queryByText("Only a teacher can loosen a rule.")).toBeNull();
    expect(offered(view.container, "AP US History")).toEqual([
      ["Full help", true],
      ["Hints only", true],
      ["No help", true],
    ]);
    await user.click(option(view.container, "AP US History", "Full help"));
    await waitFor(() =>
      expect(chosen(view.container, "AP US History")).toEqual(["Full help"]),
    );
    expect(
      view.queryByText(/Only a teacher or an admin can undo it/),
    ).toBeNull();
    const history = section(view.container, "AP US History");
    // Their own loosening, so it says here rather than naming an admin.
    await within(history).findByText("Loosened here");
    // The DBQ's own No help still stands, and an admin can put the class back.
    expect(chosen(view.container, "DBQ essay")).toEqual(["No help"]);
    await user.click(
      within(history).getByRole("button", {
        name: "Use the teacher's rule for AP US History",
      }),
    );
    await waitFor(() =>
      expect(chosen(view.container, "AP US History")).toEqual(["No help"]),
    );
    expect(server.writes().map((request) => request.body)).toEqual([
      { classes: { apush1: "full" } },
      { classes: { apush1: null } },
    ]);
  });

  test("Refresh from Classroom reads Classroom again, and shows what it found", async () => {
    const why =
      "Gmail needs reconnecting, so your classes couldn't be read. Reconnect Google on the Connections page.";
    const server = serving({
      rules: () => [200, { rules: demo() }],
      sync: () => [
        200,
        {
          school: null,
          why,
          rules: {
            ...demo(),
            syncedAt: NOW.toISOString(),
            couldNotRead: [why],
          },
        },
      ],
    });
    const user = userEvent.setup({ document });
    const view = drawPage();
    await view.findByText("Last read 5 min ago");
    await user.click(
      view.getByRole("button", { name: "Refresh from Classroom" }),
    );
    await view.findByText("Last read just now");
    expect(server.writes()).toEqual([
      { method: "POST", url: "/api/openduet/study/school/sync" },
    ]);
    const note = view.getByRole("note", {
      name: "Not everything could be read",
    });
    expect(within(note).getByText(why)).toBeTruthy();
    expect(
      within(note)
        .getByRole("link", { name: "Open Connections" })
        .getAttribute("href"),
    ).toBe("/connections");
  });

  test("before any classes were read: why, and the way to Connections", async () => {
    const why =
      "Gmail isn't connected, so your classes couldn't be read. Connect Google on the Connections page.";
    serving({
      rules: () => [
        200,
        {
          rules: {
            classes: [],
            timeZone: "UTC",
            canLoosen: false,
            syncedAt: null,
            couldNotRead: [why],
          },
        },
      ],
    });
    const view = drawPage();
    expect(
      await view.findByText("Your classes haven't been read yet"),
    ).toBeTruthy();
    expect(view.getByText(why)).toBeTruthy();
    expect(view.getByText("Not read yet")).toBeTruthy();
    expect(view.queryAllByRole("radiogroup")).toEqual([]);
    expect(
      view
        .getAllByRole("link", { name: "Open Connections" })
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/connections"]);
    expect(
      view.getByRole("button", { name: "Refresh from Classroom" }),
    ).toBeTruthy();
  });

  test("says when it is loading, and when it couldn't load, with a way to try again", async () => {
    let answer: [number, unknown] = [
      503,
      { error: "Couldn't reach your study data. Try again." },
    ];
    const server = serving({ rules: () => answer });
    const user = userEvent.setup({ document });
    const view = drawPage();
    expect((await view.findByRole("status")).textContent).toBe(
      "Loading your teacher rules…",
    );
    expect((await view.findByRole("alert")).textContent).toBe(
      "Couldn't reach your study data. Try again.",
    );
    answer = [200, { rules: demo() }];
    await user.click(view.getByRole("button", { name: "Try again" }));
    await view.findByRole("radiogroup", { name: "AI help for Chemistry" });
    expect(
      server.sent.filter((request) => request.method === "GET"),
    ).toHaveLength(2);
  });

  test("due dates are read in the student's own zone from their rules, not this device's", async () => {
    // Tokyo is neither this machine's zone nor UTC, so a date read in either would show here.
    serving({
      rules: () => [200, { rules: { ...demo(), timeZone: "Asia/Tokyo" } }],
    });
    const view = drawPage();
    await view.findByRole("radiogroup", { name: "AI help for Chemistry" });
    for (const [title, due] of [
      // It is already Thursday morning there, so Friday is tomorrow: 14:00 UTC is 11 PM in Tokyo.
      ["DBQ essay", "Due tomorrow, 11:00 PM"],
      ["Unit 4 quiz", "Due tomorrow, 1:45 AM"],
      // 11:59 PM Tuesday in Chicago is the next afternoon in Tokyo.
      ["Great Gatsby essay", "Due Wed, Nov 11, 2:59 PM"],
    ]) {
      const item = view
        .getByRole("heading", { level: 3, name: title })
        .closest("li");
      expect({
        title,
        due: item ? within(item).queryByText(due) !== null : false,
      }).toEqual({ title, due: true });
    }
  });
});

describe("TeacherRulesView alone", () => {
  /** The view with stand-in callbacks, recording what was sent. */
  function drawView(
    rules: RulesView,
    props: Partial<TeacherRulesViewProps> = {},
  ) {
    const changes: RulesChange[] = [];
    const link: TeacherRulesViewProps["connections"] = ({
      className,
      children,
    }) => (
      <a className={className} href="/connections">
        {children as ReactNode}
      </a>
    );
    const view = render(
      <TeacherRulesView
        connections={link}
        failed={null}
        loadError={null}
        now={NOW}
        onChange={(change) => changes.push(change)}
        onRefresh={() => {}}
        onReload={() => {}}
        refreshError={null}
        refreshing={false}
        rules={rules}
        saving={[]}
        timeZone="America/Chicago"
        {...props}
      />,
    );
    return { view, changes };
  }

  test("says when each piece of work is due, in the student's time zone", () => {
    const { view } = drawView(demo());
    for (const [title, due] of [
      ["DBQ essay", "Due Fri, Nov 6, 8:00 AM"],
      ["DBQ documents", "No due date"],
      ["Lab 6 report", "Due tomorrow, 11:59 PM"],
      ["Great Gatsby essay", "Due Tue, Nov 10, 11:59 PM"],
      ["Section 4.3 homework", "Missing · was due Tue, Nov 3, 11:59 PM"],
      ["Unit 4 quiz", "Due tomorrow, 10:45 AM"],
      ["Unidad 5 test", "Due Sat, Nov 7, 12:20 PM"],
    ]) {
      const item = view
        .getByRole("heading", { level: 3, name: title })
        .closest("li");
      expect({
        title,
        due: item ? within(item).queryByText(due) !== null : false,
      }).toEqual({
        title,
        due: true,
      });
    }
    // The teacher's own level for each, read-only.
    const lab = view
      .getByRole("heading", { level: 3, name: "Lab 6 report" })
      .closest("li") as HTMLElement;
    expect(
      lab.querySelector("[data-help-level]")?.getAttribute("data-help-level"),
    ).toBe("hints");
  });

  test("given no zone, due times are read in the zone the rules came with", () => {
    const { view } = drawView(
      { ...demo(), timeZone: "Asia/Tokyo" },
      { timeZone: undefined },
    );
    const quiz = view
      .getByRole("heading", { level: 3, name: "Unit 4 quiz" })
      .closest("li") as HTMLElement;
    expect(within(quiz).getByText("Due tomorrow, 1:45 AM")).toBeTruthy();
  });

  test("names the default when no notice says anything, and an override set here", () => {
    const later = withClass(
      withClass(demo(), "spanish5", (rules) => ({
        ...rules,
        level: "hints",
        source: "default",
        assignments: [],
      })),
      "eng11",
      (rules) => ({
        ...rules,
        assignments: rules.assignments.map((work) => ({
          ...work,
          override: "none",
          level: "none",
          source: "override",
        })),
      }),
    );
    const { view } = drawView(later);
    const spanish = section(view.container, "Spanish III");
    expect(within(spanish).getByText("Default: Hints only")).toBeTruthy();
    // No work listed, so the class's own choice is all there is.
    expect(within(spanish).queryByRole("list")).toBeNull();
    const english = section(view.container, "English 11");
    expect(within(english).getByText("Set here")).toBeTruthy();
    expect(chosen(english, "Great Gatsby essay")).toEqual(["No help"]);
  });

  test("an admin's loosening is locked for a student, with its own reason", () => {
    const loosened = withClass(demo(), "apush1", (rules) => ({
      ...rules,
      level: "full",
      source: "override",
      override: "full",
    }));
    const { view } = drawView(loosened);
    const history = section(view.container, "AP US History");
    expect(within(history).getByText("Loosened by an admin")).toBeTruthy();
    expect(
      within(history).getByText(
        "An admin loosened this rule, so only an admin can change it.",
      ),
    ).toBeTruthy();
    expect(offered(history, "AP US History")).toEqual([
      ["Full help", true],
      ["Hints only", false],
      ["No help", false],
    ]);
    expect(
      within(history).queryByRole("button", { name: /Use the teacher's rule/ }),
    ).toBeNull();
  });

  test("arrow keys move the choice past the ones a student can't make", async () => {
    const user = userEvent.setup({ document });
    const { view, changes } = drawView(demo());
    option(view.container, "Chemistry", "Hints only").focus();
    await user.keyboard("{ArrowRight}");
    expect(chosen(view.container, "Chemistry")).toEqual(["No help"]);
    expect(focused()).toEqual(["AI help for Chemistry", "No help"]);
    // Full help is off for a student, so the next step wraps to Hints only, which cancels.
    await user.keyboard("{ArrowRight}");
    expect(chosen(view.container, "Chemistry")).toEqual(["Hints only"]);
    expect(view.queryByRole("button", { name: /Make it/ })).toBeNull();
    expect(changes).toEqual([]);
  });

  test("an admin's arrow key sends the change it lands on", async () => {
    const user = userEvent.setup({ document });
    const { view, changes } = drawView({ ...demo(), canLoosen: true });
    option(view.container, "Chemistry", "Hints only").focus();
    await user.keyboard("{ArrowLeft}");
    expect(changes).toEqual([{ classes: { chem2: "full" } }]);
  });

  test("a change on its way shows as chosen and says so, and takes no other choice meanwhile", async () => {
    const user = userEvent.setup({ document });
    const { view, changes } = drawView(
      { ...demo(), canLoosen: true },
      { saving: [{ classes: { chem2: "none" } }] },
    );
    const chemistry = section(view.container, "Chemistry");
    expect(chosen(chemistry, "Chemistry")).toEqual(["No help"]);
    expect(group(chemistry, "Chemistry").getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(within(chemistry).getByText("Saving…")).toBeTruthy();
    await user.click(option(chemistry, "Chemistry", "Full help"));
    expect(changes).toEqual([]);
  });

  test("a failed refresh says why", () => {
    const { view } = drawView(demo(), {
      refreshError: "Couldn't read Classroom just now. Try again.",
      refreshing: false,
    });
    expect(view.getByRole("alert").textContent).toBe(
      "Couldn't read Classroom just now. Try again.",
    );
  });

  test("while refreshing, the button says so and doesn't ask twice", async () => {
    let asked = 0;
    const user = userEvent.setup({ document });
    const { view } = drawView(demo(), {
      refreshing: true,
      onRefresh: () => {
        asked += 1;
      },
    });
    const button = view.getByRole("button", { name: "Refreshing…" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    await user.click(button);
    expect(asked).toBe(0);
  });
});

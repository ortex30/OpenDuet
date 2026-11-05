import { describe, expect, test } from "bun:test";
import { CLASS_COLORS } from "@openbot/shared/study";
import {
  buildSnapshot,
  type ClassroomMessage,
  carriedNotices,
  defaultMinutes,
  isClassroomSender,
  type ParsedNotice,
  parseClassroomNotice,
  slugOf,
} from "../src/openduet/study/notices";

/*
 * The Classroom notice parser, against notices written the way the demo mailbox and Classroom's own
 * mail write them. What it reads decides whether make_quiz is paused for a class, so these pin the
 * teacher's words to the level they give, and the merge to what a student would expect to see.
 */

const CHICAGO = { timeZone: "America/Chicago" };
const OKORO = '"Dr. Okoro (Google Classroom)" <no-reply@classroom.google.com>';

function message(
  body: string[] | string,
  overrides: Partial<ClassroomMessage> = {},
): ClassroomMessage {
  return {
    id: "msg-1",
    from: OKORO,
    subject: 'New assignment: "Lab 6 report: Reaction Rates"',
    date: "2026-11-02T21:10:00.000Z",
    body: Array.isArray(body) ? body.join("\n") : body,
    ...overrides,
  };
}

function parse(
  body: string[] | string,
  overrides: Partial<ClassroomMessage> = {},
): ParsedNotice {
  const notice = parseClassroomNotice(message(body, overrides), CHICAGO);
  if (!notice) throw new Error("the notice did not parse");
  return notice;
}

const LAB6 = [
  "Chemistry · Period 2 · Dr. Okoro",
  "New assignment",
  "Lab 6 report: Reaction Rates",
  "Due: Thu, Nov 5, 2026, 11:59 PM",
  "Points: 40",
  "Estimated time: 90 min",
  "AI help: Hints only",
  "",
  "Include a data table, a rate graph and a conclusion. You may ask an AI to explain concepts, but every sentence must be yours.",
  "",
  "Open: https://classroom.google.com/c/chem2/a/lab6",
];

describe("parseClassroomNotice", () => {
  test("reads every line of a full notice", () => {
    expect(parse(LAB6)).toEqual({
      noticeId: "msg-1",
      receivedAt: "2026-11-02T21:10:00.000Z",
      type: "New assignment",
      className: "Chemistry",
      teacher: "Dr. Okoro",
      period: "Period 2",
      courseId: "chem2",
      classId: "chem2",
      itemId: "lab6",
      title: "Lab 6 report: Reaction Rates",
      assignmentId: "chem2-lab6",
      kind: "assignment",
      status: "open",
      // 11:59 PM in Chicago, which is CST by November 5th: 05:59 UTC the next day.
      due: "2026-11-06T05:59:00.000Z",
      dueDate: "2026-11-05",
      dueTime: "23:59",
      points: 40,
      grade: null,
      help: "hints",
      statedMinutes: 90,
      minutes: 90,
      link: "https://classroom.google.com/c/chem2/a/lab6",
      text: "Include a data table, a rate graph and a conclusion. You may ask an AI to explain concepts, but every sentence must be yours.",
    });
  });

  test("reads a notice with Windows line endings the same", () => {
    expect(parse(LAB6.join("\r\n"))).toEqual(parse(LAB6));
  });

  test("reads an HTML notice as the lines a person would see", () => {
    const html = [
      "<html><head><style>p { color: #333 }</style></head><body>",
      "<p>Chemistry &middot; Period&nbsp;2 &middot; Dr. Okoro<br>New assignment<br><b>Lab 6 report: Reaction\nRates</b><br>",
      "Due: Thu, Nov 5, 2026, 11:59&nbsp;PM<br>Points: 40<br>Estimated time: 90 min<br>AI help: Hints only</p>",
      "<p>Include a data table, a rate graph and a conclusion. You may ask an AI to explain concepts, but every sentence must be yours.</p>",
      '<p>Open: <a href="https://classroom.google.com/c/chem2/a/lab6">https://classroom.google.com/c/chem2/a/lab6</a></p>',
      "</body></html>",
    ].join("\n");
    expect(parse(html)).toEqual(parse(LAB6));
  });

  test("reads a returned notice's grade, and a missing notice as missing", () => {
    const returned = parse(
      [
        "Chemistry · Period 2 · Dr. Okoro",
        "Returned",
        "Lab 5 report: Concentration and Rate",
        "Points: 40",
        "Grade: 34/40",
        "",
        'Private comment: "Use collision theory next time."',
        "",
        "Open: https://classroom.google.com/c/chem2/a/lab5",
      ],
      { subject: 'Returned: "Lab 5 report: Concentration and Rate"' },
    );
    expect(returned).toMatchObject({
      type: "Returned",
      status: "returned",
      grade: "34/40",
      points: 40,
      due: null,
      help: null,
      assignmentId: "chem2-lab5",
    });

    const missing = parse(
      [
        "Precalculus · Period 4 · Mr. Chen",
        "Missing",
        "Section 4.3 homework",
        "Due: Tue, Nov 3, 2026, 11:59 PM",
        "AI help: Full help",
        "",
        "Open: https://classroom.google.com/c/precalc4/a/hw43",
      ],
      { from: '"Mr. Chen (Google Classroom)" <no-reply@classroom.google.com>' },
    );
    expect(missing).toMatchObject({
      status: "missing",
      kind: "assignment",
      help: "full",
      minutes: 45,
      dueDate: "2026-11-03",
    });
  });

  test("reads every level from the AI help line, and only from it", () => {
    const level = (line: string) =>
      parse([...LAB6.slice(0, 6), line, ...LAB6.slice(7)]).help;
    expect(level("AI help: Full help")).toBe("full");
    expect(level("AI help: Hints only")).toBe("hints");
    expect(level("AI help: No help")).toBe("none");
    expect(level("AI help: No AI help on this assignment.")).toBe("none");
    expect(level("AI help: Ask me in class")).toBeNull();

    // The teacher's text saying "no help" is not the rule: only the AI help line is.
    const noLine = parse([
      ...LAB6.slice(0, 6),
      "",
      "No help from friends or AI on the conclusion.",
      "",
      "Open: https://classroom.google.com/c/chem2/a/lab6",
    ]);
    expect(noLine.help).toBeNull();
    expect(noLine.text).toBe("No help from friends or AI on the conclusion.");
  });

  test("leaves out what a notice leaves out, and fills the teacher from the sender", () => {
    const bare = parse(
      [
        "Chemistry",
        "New assignment",
        "Safety contract",
        "",
        "Sign and return it.",
      ],
      { subject: 'New assignment: "Safety contract"' },
    );
    expect(bare).toMatchObject({
      className: "Chemistry",
      period: null,
      // Not on the class line, so the From header's name.
      teacher: "Dr. Okoro",
      courseId: null,
      // With no link the ids are slugs of the class and the title.
      classId: "chemistry",
      itemId: null,
      assignmentId: "chemistry-safety-contract",
      due: null,
      dueDate: null,
      dueTime: null,
      points: null,
      grade: null,
      help: null,
      statedMinutes: null,
      minutes: 45,
      link: null,
      text: "Sign and return it.",
    });
  });

  test("tells a period from a teacher when only one of them is on the class line", () => {
    expect(
      parse(["English 11 · Ms. Alvarez", "New assignment", "Reading log"]),
    ).toMatchObject({ teacher: "Ms. Alvarez", period: null });
    expect(
      parse(["English 11 · 3rd period", "New assignment", "Reading log"]),
    ).toMatchObject({ teacher: "Dr. Okoro", period: "3rd period" });
  });

  test("a due date without a time is 11:59 PM, and without a year is the nearest one", () => {
    const due = (line: string, date = "2026-11-02T21:10:00.000Z") =>
      parse([...LAB6.slice(0, 3), line, ...LAB6.slice(4)], { date });
    expect(due("Due: Nov 6, 2026")).toMatchObject({
      dueDate: "2026-11-06",
      dueTime: "23:59",
    });
    expect(due("Due: Friday, November 6 at 8:00 AM")).toMatchObject({
      dueDate: "2026-11-06",
      dueTime: "08:00",
      due: "2026-11-06T14:00:00.000Z",
    });
    expect(due("Due: Nov 6, 12:20 PM")).toMatchObject({ dueTime: "12:20" });
    expect(due("Due: Nov 6, 12:05 AM")).toMatchObject({ dueTime: "00:05" });
    expect(due("Due: 2026-11-06 07:30")).toMatchObject({
      dueDate: "2026-11-06",
      dueTime: "07:30",
    });
    // A January due date in a December notice is next January.
    expect(due("Due: Jan 8", "2026-12-18T15:00:00.000Z").dueDate).toBe(
      "2027-01-08",
    );
    expect(due("Due: Feb 30, 2026")).toMatchObject({
      due: null,
      dueDate: null,
    });
    expect(due("Due: whenever you can")).toMatchObject({ due: null });
  });

  test("reads an estimate in minutes or hours, and falls back to the kind's default", () => {
    const minutes = (line: string) =>
      parse([...LAB6.slice(0, 5), line, ...LAB6.slice(6)]).minutes;
    expect(minutes("Estimated time: 90 min")).toBe(90);
    expect(minutes("Estimated time: 1 hr")).toBe(60);
    expect(minutes("Estimated time: 1.5 hours")).toBe(90);
    expect(minutes("Estimated time: 1 hr 30 min")).toBe(90);
    expect(minutes("Estimated time: 2.5 hours")).toBe(150);
    expect(minutes("Estimated time: 45")).toBe(45);
    // Unreadable: a lab report's default.
    expect(minutes("Estimated time: a while")).toBe(90);
  });

  test("knows quizzes and tests by their notice or their title", () => {
    const kind = (type: string, title: string) =>
      parse(["Precalculus · Mr. Chen", type, title]).kind;
    expect(kind("New quiz", "Unit 4 check-in")).toBe("quiz");
    expect(kind("New test", "Unidad 5 vocab")).toBe("test");
    expect(kind("Due soon", "Unit 4 quiz: Trig identities")).toBe("quiz");
    expect(kind("New assignment", "Chapter 7 test")).toBe("test");
    expect(kind("New assignment", "Midterm exam")).toBe("test");
    expect(kind("New assignment", "Practice quiz for the unit test")).toBe(
      "quiz",
    );
    expect(kind("New assignment", "Contest entry")).toBe("assignment");
    // What a material or an announcement is about does not make it the test.
    expect(kind("Material", "Unit test review sheet")).toBe("material");
  });

  test("gives each kind of work its usual time when the notice gives none", () => {
    expect(defaultMinutes("test", "Unit test")).toBe(90);
    expect(defaultMinutes("quiz", "Unit quiz")).toBe(60);
    expect(defaultMinutes("assignment", "DBQ essay")).toBe(120);
    expect(defaultMinutes("assignment", "Research paper")).toBe(120);
    expect(defaultMinutes("assignment", "Lab 6 report")).toBe(90);
    expect(defaultMinutes("assignment", "Science fair project")).toBe(120);
    expect(defaultMinutes("assignment", "Worksheet 3")).toBe(45);
    expect(defaultMinutes("announcement", "Room change")).toBe(0);
    expect(defaultMinutes("material", "Lab essay rubric")).toBe(0);
  });

  test("an announcement with no item names only its class", () => {
    const announcement = parse(
      [
        "Spanish III · Sra. Morales",
        "Announcement",
        "",
        "Conversation practice moves to the library tomorrow.",
        "",
        "Open: https://classroom.google.com/c/spanish5/p/conv1",
      ],
      {
        from: '"Sra. Morales (Google Classroom)" <no-reply@classroom.google.com>',
        subject: "New announcement: Conversation practice moves",
      },
    );
    expect(announcement).toMatchObject({
      type: "Announcement",
      kind: "announcement",
      classId: "spanish5",
      title: null,
      assignmentId: null,
      minutes: 0,
      text: "Conversation practice moves to the library tomorrow.",
    });
    // Right under the type line, the same words are the announcement's item.
    expect(
      parse(["Spanish III · Sra. Morales", "Announcement", "Field trip forms"])
        .title,
    ).toBe("Field trip forms");
  });

  test("takes the type from the subject when the body leaves it out", () => {
    expect(
      parse(
        [
          "Chemistry · Period 2",
          "Lab 6 report: Reaction Rates",
          "Due: Nov 5, 2026",
        ],
        {
          subject: 'Due tomorrow: "Lab 6 report: Reaction Rates"',
        },
      ),
    ).toMatchObject({
      type: "Due soon",
      title: "Lab 6 report: Reaction Rates",
      dueDate: "2026-11-05",
    });
  });

  test("reads a real Classroom link's course and item, wherever the notice puts it", () => {
    expect(
      parse([
        ...LAB6.slice(0, 8),
        "See https://classroom.google.com/u/1/c/NjI3ODk3NjU0MzIx/a/NjI3ODk4MDEyMzQ1/details for the rubric.",
      ]),
    ).toMatchObject({
      courseId: "NjI3ODk3NjU0MzIx",
      itemId: "NjI3ODk4MDEyMzQ1",
      assignmentId: "NjI3ODk3NjU0MzIx-NjI3ODk4MDEyMzQ1",
    });
  });

  test("is null for mail that is not a Classroom notice", () => {
    // Somebody else, even with a notice's words.
    expect(
      parseClassroomNotice(
        message(LAB6, {
          from: "Sam Torres <sam.torres@students.lakeviewhs.org>",
        }),
        CHICAGO,
      ),
    ).toBeNull();
    // A lookalike domain is not Classroom.
    expect(
      parseClassroomNotice(
        message(LAB6, {
          from: "Classroom <no-reply@classroom.google.com.example.net>",
        }),
        CHICAGO,
      ),
    ).toBeNull();
    // Classroom's other mail, with no class line and notice type to read.
    expect(
      parseClassroomNotice(
        message(["Mr. Chen invited you to join Precalculus.", "", "Join"], {
          subject: "Class invitation: Precalculus",
        }),
        CHICAGO,
      ),
    ).toBeNull();
    expect(parseClassroomNotice(message(""), CHICAGO)).toBeNull();
    expect(
      parseClassroomNotice(
        message(["New assignment", "Lab 6 report"]),
        CHICAGO,
      ),
    ).toBeNull();
  });

  test("keeps an odd email from filling the record", () => {
    const long = parse([
      `${"Chemistry ".repeat(40)}· Period 2`,
      "New assignment",
      "T".repeat(500),
      "",
      "x".repeat(5_000),
    ]);
    expect(long.className.length).toBeLessThanOrEqual(100);
    expect(long.title?.length).toBeLessThanOrEqual(200);
    expect(long.text.length).toBeLessThanOrEqual(1_000);
  });
});

describe("isClassroomSender and slugOf", () => {
  test("only Classroom's own domain is Classroom", () => {
    expect(isClassroomSender(OKORO)).toBe(true);
    expect(isClassroomSender("no-reply@classroom.google.com")).toBe(true);
    expect(
      isClassroomSender("Classroom <x@classroom.google.com.evil.example>"),
    ).toBe(false);
    expect(isClassroomSender("classroom.google.com <a@b.example>")).toBe(false);
  });

  test("a From that may have been cut, or that holds two addresses, is not Classroom's", () => {
    // The adapter cuts a header at 1,000 code units, or 999 when that would split an emoji. A long
    // display name can then end right after an address it only quotes, the real one cut away.
    const quoted = "<no-reply@classroom.google.com>";
    for (const length of [999, 1_000]) {
      const cut = `"${"x".repeat(length - 1 - quoted.length)}${quoted}`;
      expect(cut).toHaveLength(length);
      expect(isClassroomSender(cut)).toBe(false);
    }
    // Shorter than any cut, the same form is read as before.
    const long = `"${"x".repeat(960)}" ${quoted}`;
    expect(long.length).toBeLessThan(999);
    expect(isClassroomSender(long)).toBe(true);

    for (const from of [
      "classmate@gmail.example, no-reply@classroom.google.com",
      "classmate@gmail.example, <no-reply@classroom.google.com>",
      "Classroom <help> <no-reply@classroom.google.com>",
    ])
      expect(isClassroomSender(from)).toBe(false);
  });

  test("slugs fold accents and keep names with no letters stable", () => {
    expect(slugOf("AP US History")).toBe("ap-us-history");
    expect(slugOf("Español III")).toBe("espanol-iii");
    expect(slugOf("物理")).toBe(slugOf("物理"));
    expect(slugOf("物理")).toMatch(/^x[0-9a-f]{8}$/);
  });
});

/** A parsed notice with only what a test cares about given. */
function notice(overrides: Partial<ParsedNotice>): ParsedNotice {
  return {
    noticeId: "n",
    receivedAt: "2026-11-01T12:00:00.000Z",
    type: "New assignment",
    className: "Chemistry",
    teacher: "Dr. Okoro",
    period: "Period 2",
    courseId: "chem2",
    classId: "chem2",
    itemId: "lab6",
    title: "Lab 6 report",
    assignmentId: "chem2-lab6",
    kind: "assignment",
    status: "open",
    due: null,
    dueDate: null,
    dueTime: null,
    points: null,
    grade: null,
    help: null,
    statedMinutes: null,
    minutes: 90,
    link: null,
    text: "",
    ...overrides,
  };
}

const META = {
  timeZone: "America/Chicago",
  syncedAt: "2026-11-04T15:00:00.000Z",
  couldNotRead: [],
};
const DUE_FRIDAY = {
  due: "2026-11-07T05:59:00.000Z",
  dueDate: "2026-11-06",
  dueTime: "23:59",
};

describe("buildSnapshot", () => {
  test("keeps one entry per assignment, the newest notice deciding what it says", () => {
    const posted = notice({
      noticeId: "posted",
      receivedAt: "2026-11-01T12:00:00.000Z",
      ...DUE_FRIDAY,
      points: 40,
      help: "hints",
      statedMinutes: 90,
    });
    // The reminder moves the due date and tightens the rule, and says nothing of points or time.
    const reminder = notice({
      noticeId: "reminder",
      type: "Due soon",
      receivedAt: "2026-11-04T12:00:00.000Z",
      due: "2026-11-06T05:59:00.000Z",
      dueDate: "2026-11-05",
      dueTime: "23:59",
      help: "none",
    });
    const snapshot = buildSnapshot([reminder, posted], META);
    expect(snapshot.assignments).toEqual([
      {
        id: "chem2-lab6",
        classId: "chem2",
        title: "Lab 6 report",
        kind: "assignment",
        status: "open",
        due: "2026-11-06T05:59:00.000Z",
        dueDate: "2026-11-05",
        dueTime: "23:59",
        points: 40,
        grade: null,
        help: "none",
        minutes: 90,
        link: null,
        noticeId: "reminder",
      },
    ]);
  });

  test("a newer notice without an AI help line does not erase the teacher's rule", () => {
    const snapshot = buildSnapshot(
      [
        notice({ noticeId: "a", help: "none" }),
        notice({
          noticeId: "b",
          type: "Due soon",
          receivedAt: "2026-11-03T12:00:00.000Z",
        }),
      ],
      META,
    );
    expect(snapshot.assignments[0]?.help).toBe("none");
  });

  test("returned work stays returned, whatever reminder comes after it", () => {
    const returned = notice({
      noticeId: "returned",
      type: "Returned",
      status: "returned",
      grade: "34/40",
      receivedAt: "2026-11-03T12:00:00.000Z",
    });
    const lateReminder = notice({
      noticeId: "late",
      type: "Due soon",
      receivedAt: "2026-11-04T12:00:00.000Z",
      ...DUE_FRIDAY,
    });
    const earlyReminder = notice({
      noticeId: "early",
      type: "Due soon",
      receivedAt: "2026-11-01T12:00:00.000Z",
    });
    for (const order of [
      [returned, lateReminder, earlyReminder],
      [earlyReminder, lateReminder, returned],
    ]) {
      const [only] = buildSnapshot(order, META).assignments;
      expect(only).toMatchObject({ status: "returned", grade: "34/40" });
    }
  });

  test("an open assignment more than a day past due is missing; one due less than a day ago, or a quiz or test whose time has passed, is not", () => {
    const snapshot = buildSnapshot(
      [
        notice({
          assignmentId: "chem2-old",
          title: "Lab 4 report",
          due: "2026-11-03T14:59:00.000Z",
        }),
        notice({
          assignmentId: "chem2-recent",
          title: "Lab 5 prelab",
          due: "2026-11-03T15:01:00.000Z",
        }),
        notice({
          assignmentId: "chem2-notes",
          title: "Lab 4 notes",
          kind: "material",
          type: "Material",
          due: "2026-10-20T15:00:00.000Z",
        }),
        // Taken in class: once its time has passed it was sat, not missed.
        notice({
          assignmentId: "chem2-quiz",
          title: "Unit 3 quiz",
          kind: "quiz",
          type: "New quiz",
          due: "2026-11-02T14:55:00.000Z",
        }),
        notice({
          assignmentId: "chem2-test",
          title: "Unit 3 test",
          kind: "test",
          type: "New test",
          due: "2026-10-30T14:55:00.000Z",
        }),
        // Classroom's own Missing notice still says so, whatever the kind.
        notice({
          assignmentId: "chem2-retake",
          title: "Unit 2 quiz retake",
          kind: "quiz",
          type: "Missing",
          status: "missing",
          due: "2026-11-02T14:55:00.000Z",
        }),
      ],
      META,
    );
    const status = Object.fromEntries(
      snapshot.assignments.map((entry) => [entry.id, entry.status]),
    );
    expect(status).toEqual({
      "chem2-old": "missing",
      "chem2-recent": "open",
      "chem2-notes": "open",
      "chem2-quiz": "open",
      "chem2-test": "open",
      "chem2-retake": "missing",
    });
  });

  test("never lets a vaguer notice overrule a quiz or a test", () => {
    const snapshot = buildSnapshot(
      [
        notice({ noticeId: "quiz", type: "New quiz", kind: "quiz" }),
        notice({
          noticeId: "reminder",
          type: "Due soon",
          kind: "assignment",
          receivedAt: "2026-11-03T12:00:00.000Z",
        }),
      ],
      META,
    );
    expect(snapshot.assignments[0]).toMatchObject({
      kind: "quiz",
      minutes: 60,
    });
  });

  test("an announcement makes its class, and classes take colours in name order", () => {
    const snapshot = buildSnapshot(
      [
        notice({
          className: "Spanish III",
          courseId: "spanish5",
          classId: "spanish5",
          teacher: "Sra. Morales",
          period: null,
          type: "Announcement",
          kind: "announcement",
          title: null,
          assignmentId: null,
        }),
        notice({}),
        notice({
          className: "AP US History",
          courseId: "apush1",
          classId: "apush1",
          teacher: "Mr. Grant",
          period: "Period 1",
          assignmentId: "apush1-dbq3",
          title: "DBQ essay",
        }),
      ],
      META,
    );
    expect(snapshot.classes).toEqual([
      {
        id: "apush1",
        name: "AP US History",
        teacher: "Mr. Grant",
        period: "Period 1",
        color: CLASS_COLORS[0],
      },
      {
        id: "chem2",
        name: "Chemistry",
        teacher: "Dr. Okoro",
        period: "Period 2",
        color: CLASS_COLORS[1],
      },
      {
        id: "spanish5",
        name: "Spanish III",
        teacher: "Sra. Morales",
        period: null,
        color: CLASS_COLORS[2],
      },
    ]);
    expect(snapshot.assignments.map((entry) => entry.id)).toEqual([
      "apush1-dbq3",
      "chem2-lab6",
    ]);
  });

  test("a notice without a link joins the class and item a linked notice named", () => {
    const snapshot = buildSnapshot(
      [
        notice({ noticeId: "linked", ...DUE_FRIDAY, help: "hints" }),
        notice({
          noticeId: "unlinked",
          receivedAt: "2026-11-03T12:00:00.000Z",
          courseId: null,
          itemId: null,
          classId: "chemistry",
          assignmentId: "chemistry-lab-6-report",
          type: "Missing",
          status: "missing",
        }),
      ],
      META,
    );
    expect(snapshot.classes.map((entry) => entry.id)).toEqual(["chem2"]);
    expect(snapshot.assignments).toHaveLength(1);
    expect(snapshot.assignments[0]).toMatchObject({
      id: "chem2-lab6",
      status: "missing",
      help: "hints",
      noticeId: "unlinked",
    });
  });

  test("gives the same snapshot whatever order the notices arrive in", () => {
    const notices = [
      notice({ noticeId: "a", ...DUE_FRIDAY }),
      notice({
        noticeId: "b",
        receivedAt: "2026-11-02T12:00:00.000Z",
        help: "full",
      }),
      notice({
        noticeId: "c",
        className: "Precalculus",
        courseId: "precalc4",
        classId: "precalc4",
        assignmentId: "precalc4-quiz4",
        title: "Unit 4 quiz",
        kind: "quiz",
        due: "2026-11-05T16:45:00.000Z",
      }),
      // Same moment as "b": the notice id breaks the tie.
      notice({
        noticeId: "d",
        receivedAt: "2026-11-02T12:00:00.000Z",
        help: "none",
      }),
    ];
    const expected = buildSnapshot(notices, META);
    expect(
      expected.assignments.find((entry) => entry.id === "chem2-lab6")?.help,
    ).toBe("none");
    for (const order of [
      [...notices].reverse(),
      [notices[2], notices[0], notices[3], notices[1]],
      [notices[3], notices[1], notices[2], notices[0]],
    ])
      expect(buildSnapshot(order as ParsedNotice[], META)).toEqual(expected);
  });

  test("lists due work soonest first and undated work last, and carries what could not be read", () => {
    const couldNotRead = ["Gmail needs reconnecting."];
    const snapshot = buildSnapshot(
      [
        notice({ assignmentId: "x-undated", title: "Reading", due: null }),
        notice({ assignmentId: "x-later", title: "Essay", ...DUE_FRIDAY }),
        notice({
          assignmentId: "x-sooner",
          title: "Quiz",
          due: "2026-11-05T16:45:00.000Z",
        }),
      ],
      { ...META, couldNotRead },
    );
    expect(snapshot.assignments.map((entry) => entry.id)).toEqual([
      "x-sooner",
      "x-later",
      "x-undated",
    ]);
    expect(snapshot).toMatchObject({
      syncedAt: META.syncedAt,
      timeZone: META.timeZone,
      couldNotRead,
    });
    expect(snapshot.couldNotRead).not.toBe(couldNotRead);
  });
});

describe("carriedNotices", () => {
  const AT = { at: new Date("2026-11-04T15:00:00.000Z"), limit: 100 };
  const ids = (notices: ParsedNotice[]) =>
    notices.map((entry) => entry.noticeId).sort();
  /** One item's first notice, with the teacher's No help. */
  const posted = (name: string, overrides: Partial<ParsedNotice> = {}) =>
    notice({
      noticeId: name,
      itemId: name,
      title: `Lab ${name}`,
      assignmentId: `chem2-${name}`,
      help: "none",
      ...overrides,
    });

  test("a notice whose email is gone stands while its work is still to do", () => {
    const unlisted = [
      posted("upcoming", { due: "2026-11-06T05:59:00.000Z" }),
      // Less than two days past its due date it still stands; more than two, and it is gone.
      posted("late", { due: "2026-11-02T15:01:00.000Z" }),
      posted("over", { due: "2026-11-02T14:59:00.000Z" }),
      // Returned work is done, whichever of its notices says what.
      posted("graded", { due: "2026-11-06T05:59:00.000Z" }),
      posted("graded", {
        noticeId: "graded-back",
        type: "Returned",
        status: "returned",
        receivedAt: "2026-11-03T12:00:00.000Z",
      }),
      // Undated work stands for thirty days from its newest notice.
      posted("reading", { receivedAt: "2026-10-05T15:01:00.000Z" }),
      posted("oldreading", { receivedAt: "2026-10-05T14:59:00.000Z" }),
      // An announcement names no item, so it holds no rule to keep.
      notice({
        noticeId: "news",
        type: "Announcement",
        kind: "announcement",
        title: null,
        itemId: null,
        assignmentId: null,
      }),
    ];
    expect(ids(carriedNotices([], unlisted, AT))).toEqual([
      "late",
      "reading",
      "upcoming",
    ]);
  });

  test("a notice about work still listed stands however late it is, and the listed notices still win", () => {
    // Long past due, but Classroom's Missing notice about it is still listed: the No help stays.
    const rule = posted("dbq", {
      due: "2026-10-20T04:59:00.000Z",
      receivedAt: "2026-10-10T12:00:00.000Z",
    });
    const missing = posted("dbq", {
      noticeId: "dbq-missing",
      type: "Missing",
      status: "missing",
      help: null,
      receivedAt: "2026-11-03T12:00:00.000Z",
    });
    expect(ids(carriedNotices([missing], [rule], AT))).toEqual(["dbq"]);
    expect(buildSnapshot([missing, rule], META).assignments[0]).toMatchObject({
      help: "none",
      status: "missing",
      noticeId: "dbq-missing",
    });

    // A newer notice still replaces what a carried one says, and a Returned one still ends it.
    const lab = posted("lab", { due: "2026-11-06T05:59:00.000Z" });
    const loosened = posted("lab", {
      noticeId: "lab-loosened",
      type: "Due soon",
      help: "hints",
      receivedAt: "2026-11-04T12:00:00.000Z",
    });
    const returned = posted("lab", {
      noticeId: "lab-back",
      type: "Returned",
      status: "returned",
      help: null,
      grade: "34/40",
      receivedAt: "2026-11-04T13:00:00.000Z",
    });
    for (const [listed, expected] of [
      [loosened, { help: "hints", status: "open" }],
      [returned, { help: "none", status: "returned", grade: "34/40" }],
    ] as const) {
      const carried = carriedNotices([listed], [lab], AT);
      expect(ids(carried)).toEqual(["lab"]);
      expect(
        buildSnapshot([listed, ...carried], META).assignments[0],
      ).toMatchObject(expected);
    }

    // A newer notice whose email was deleted still outranks an older one still listed.
    const older = posted("essay", {
      help: "full",
      receivedAt: "2026-10-30T12:00:00.000Z",
    });
    const newer = posted("essay", {
      noticeId: "essay-tightened",
      type: "Due soon",
      receivedAt: "2026-11-03T12:00:00.000Z",
    });
    expect(
      buildSnapshot([older, ...carriedNotices([older], [newer], AT)], META)
        .assignments[0]?.help,
    ).toBe("none");
  });

  test("files a notice without a link under the item a linked notice named, as buildSnapshot does", () => {
    const linked = notice({
      noticeId: "linked",
      type: "Due soon",
      receivedAt: "2026-11-03T12:00:00.000Z",
    });
    const unlinked = notice({
      noticeId: "unlinked",
      courseId: null,
      itemId: null,
      classId: "chemistry",
      assignmentId: "chemistry-lab-6-report",
      help: "none",
      due: "2026-10-20T04:59:00.000Z",
    });
    expect(ids(carriedNotices([linked], [unlinked], AT))).toEqual(["unlinked"]);
  });

  test("keeps at most the limit, the newest first", () => {
    const many = Array.from({ length: 5 }, (_, index) =>
      notice({
        noticeId: `n${index}`,
        receivedAt: new Date(
          Date.parse("2026-11-01T00:00:00.000Z") + index * 3_600_000,
        ).toISOString(),
        ...DUE_FRIDAY,
      }),
    );
    expect(
      carriedNotices([], many, { ...AT, limit: 3 }).map(
        (entry) => entry.noticeId,
      ),
    ).toEqual(["n4", "n3", "n2"]);
  });
});

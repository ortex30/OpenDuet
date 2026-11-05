import { describe, expect, test } from "bun:test";
import type { Database } from "../src/db/client";
import {
  StudyConflictError,
  StudyNotFoundError,
  type StudyRecordInput,
  type StudyStore,
} from "../src/openduet/study/contracts";
import { createMemoryStudyStore } from "../src/openduet/study/memory-store";
import { createStudyStore, listLimit } from "../src/openduet/study/store";

/*
 * The study store's contract, against the memory store that other unit tests stand on. The same
 * rules run against Postgres in openduet-study-store.integration.test.ts, in CI.
 */

const ALEX = "alex";
const BLAIR = "blair";

/** A clock that moves only when told, so "newest first" is about order, not timing. */
function clock(start = "2026-11-04T15:00:00.000Z") {
  let now = new Date(start);
  return {
    now: () => now,
    tick(minutes = 1) {
      now = new Date(now.getTime() + minutes * 60_000);
      return now;
    },
  };
}

function fixture() {
  const time = clock();
  const store = createMemoryStudyStore({ now: time.now });
  return { store, time };
}

const quiz = (id: string, extra: Partial<StudyRecordInput> = {}) =>
  ({
    id,
    kind: "quiz",
    data: { title: `Quiz ${id}`, questions: [{ id: "q1", topic: "rates" }] },
    ...extra,
  }) satisfies StudyRecordInput;

const plan = (id: string, from: string, to: string, status = "proposed") =>
  ({
    id,
    kind: "plan",
    status,
    startsAt: new Date(from),
    endsAt: new Date(to),
    data: { blocks: [] },
  }) satisfies StudyRecordInput;

/** Settles everything already queued, so a test can see what is waiting and what is not. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("building the store", () => {
  test("touches nothing until it is used, so tools can be built with no database", () => {
    const untouchable = new Proxy(
      {},
      {
        get() {
          throw new Error("the database was touched");
        },
      },
    ) as Database;
    expect(() => createStudyStore(untouchable)).not.toThrow();
    expect(() => createStudyStore({} as Database)).not.toThrow();
  });

  test("a list's limit defaults to 200 and never passes 500", () => {
    expect(listLimit(undefined)).toBe(200);
    expect(listLimit(Number.NaN)).toBe(200);
    expect(listLimit(25)).toBe(25);
    expect(listLimit(10_000)).toBe(500);
    expect(listLimit(0)).toBe(1);
    expect(listLimit(2.7)).toBe(2);
  });
});

describe("put and get", () => {
  test("a put is read back by its owner, by kind and id", async () => {
    const { store } = fixture();
    const saved = await store.put(ALEX, quiz("quiz-1", { classId: "chem2" }));
    expect(saved).toEqual({
      id: "quiz-1",
      ownerUserId: ALEX,
      botId: null,
      kind: "quiz",
      classId: "chem2",
      refId: null,
      status: null,
      startsAt: null,
      endsAt: null,
      data: { title: "Quiz quiz-1", questions: [{ id: "q1", topic: "rates" }] },
      createdAt: new Date("2026-11-04T15:00:00.000Z"),
      updatedAt: new Date("2026-11-04T15:00:00.000Z"),
    });
    expect(await store.get(ALEX, "quiz", "quiz-1")).toEqual(saved);
  });

  test("another person's record, or the wrong kind, is no record at all", async () => {
    const { store } = fixture();
    await store.put(ALEX, quiz("quiz-1"));
    expect(await store.get(BLAIR, "quiz", "quiz-1")).toBeNull();
    expect(await store.get(ALEX, "deck", "quiz-1")).toBeNull();
    expect(await store.get(ALEX, "quiz", "nothing")).toBeNull();
  });

  test("a put replaces the owner's record whole, keeping when it was made", async () => {
    const { store, time } = fixture();
    await store.put(
      ALEX,
      quiz("quiz-1", { classId: "chem2", refId: "ref", botId: "bot" }),
    );
    time.tick(5);
    const replaced = await store.put(ALEX, {
      id: "quiz-1",
      kind: "quiz",
      data: { title: "Second" },
    });
    expect(replaced).toMatchObject({
      classId: null,
      refId: null,
      botId: null,
      data: { title: "Second" },
      createdAt: new Date("2026-11-04T15:00:00.000Z"),
      updatedAt: new Date("2026-11-04T15:05:00.000Z"),
    });
  });

  test("a put of somebody else's id is refused, and their record is left alone", async () => {
    const { store } = fixture();
    await store.put(ALEX, quiz("quiz-1"));
    await expect(
      store.put(BLAIR, quiz("quiz-1", { data: { stolen: true } })),
    ).rejects.toBeInstanceOf(StudyNotFoundError);
    expect((await store.get(ALEX, "quiz", "quiz-1"))?.data).toEqual(
      quiz("quiz-1").data,
    );
  });

  test("what is stored cannot be changed through an object a caller holds", async () => {
    const { store } = fixture();
    const input = quiz("quiz-1");
    const saved = await store.put(ALEX, input);
    input.data.title = "changed after the put";
    saved.data.title = "changed on the result";
    saved.createdAt.setFullYear(1999);
    const read = await store.get(ALEX, "quiz", "quiz-1");
    expect(read?.data.title).toBe("Quiz quiz-1");
    expect(read?.createdAt.getFullYear()).toBe(2026);
    if (read) read.data.title = "changed on a read";
    expect((await store.get(ALEX, "quiz", "quiz-1"))?.data.title).toBe(
      "Quiz quiz-1",
    );
  });

  test("data is stored as JSON, as jsonb stores it", async () => {
    const { store } = fixture();
    const saved = await store.put(ALEX, {
      id: "deck-1",
      kind: "deck",
      data: {
        at: new Date("2026-11-04T15:00:00.000Z"),
        skipped: undefined,
        cards: [{ front: "a", back: "b" }],
      },
    });
    expect(saved.data).toEqual({
      at: "2026-11-04T15:00:00.000Z",
      cards: [{ front: "a", back: "b" }],
    });
  });

  // Postgres refuses the whole record over either one inside jsonb, so both stores keep the same mend.
  const unstorable = {
    title: "Lab\u0000 6",
    warnings: [
      "Gatsby essay \ud83d",
      ["\udc4d nested", { deep: "x\u0000\ud800y" }],
    ],
    "key\u0000": "a NUL in a key",
    "half \ud83d": "a lone surrogate in a key",
    whole: "📚 stays",
    count: 3,
    none: null,
  };
  const mended = {
    title: "Lab 6",
    warnings: ["Gatsby essay \ufffd", ["\ufffd nested", { deep: "x\ufffdy" }]],
    key: "a NUL in a key",
    "half \ufffd": "a lone surrogate in a key",
    whole: "📚 stays",
    count: 3,
    none: null,
  };

  test("a NUL is taken out of data and half an emoji becomes U+FFFD, in values and keys at any depth", async () => {
    const { store } = fixture();
    const saved = await store.put(ALEX, {
      id: "deck-1",
      kind: "deck",
      data: unstorable,
    });
    expect(saved.data).toEqual(mended);
    expect(JSON.stringify(saved.data)).not.toMatch(/\\u0000|\\ud[89a-f]/);
    expect((await store.get(ALEX, "deck", "deck-1"))?.data).toEqual(mended);
  });

  test("the same mend on an update and on insertOnce", async () => {
    const { store } = fixture();
    await store.put(ALEX, { id: "plan-1", kind: "plan", data: {} });
    const updated = await store.update(ALEX, "plan", "plan-1", () => ({
      data: unstorable,
    }));
    expect(updated.data).toEqual(mended);
    const { record } = await store.insertOnce(ALEX, {
      id: "attempt:quiz-1",
      kind: "attempt",
      data: unstorable,
    });
    expect(record.data).toEqual(mended);
  });

  test('a "__proto__" key in data stays a key, and changes no prototype', async () => {
    const { store } = fixture();
    const saved = await store.put(ALEX, {
      id: "quiz-1",
      kind: "quiz",
      data: JSON.parse('{"__proto__": {"polluted": true}, "x": 1}'),
    });
    expect(Object.hasOwn(saved.data, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(saved.data)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(saved.data.x).toBe(1);
  });
});

describe("insertOnce", () => {
  test("inserts the first time and returns what is stored after that", async () => {
    const { store, time } = fixture();
    const first = await store.insertOnce(ALEX, {
      id: "attempt:quiz-1",
      kind: "attempt",
      refId: "quiz-1",
      data: { correct: 3 },
    });
    expect(first.created).toBe(true);
    time.tick();
    const again = await store.insertOnce(ALEX, {
      id: "attempt:quiz-1",
      kind: "attempt",
      refId: "quiz-1",
      data: { correct: 0 },
    });
    expect(again).toEqual({ record: first.record, created: false });
  });

  test("two at once make one record", async () => {
    const { store } = fixture();
    const results = await Promise.all(
      [1, 2, 3].map((correct) =>
        store.insertOnce(ALEX, {
          id: "attempt:quiz-1",
          kind: "attempt",
          data: { correct },
        }),
      ),
    );
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(
      new Set(results.map((result) => result.record.data.correct)).size,
    ).toBe(1);
    expect(await store.list(ALEX, "attempt")).toHaveLength(1);
  });

  test("somebody else's id, or the owner's of another kind, is refused", async () => {
    const { store } = fixture();
    await store.put(ALEX, quiz("shared-id"));
    await expect(
      store.insertOnce(BLAIR, quiz("shared-id")),
    ).rejects.toBeInstanceOf(StudyNotFoundError);
    await expect(
      store.insertOnce(ALEX, { id: "shared-id", kind: "attempt", data: {} }),
    ).rejects.toBeInstanceOf(StudyNotFoundError);
  });
});

describe("list", () => {
  test("is the owner's records of one kind, newest first, ties broken by id", async () => {
    const { store, time } = fixture();
    await store.put(ALEX, quiz("quiz-a"));
    time.tick();
    await store.put(ALEX, quiz("quiz-b"));
    await store.put(ALEX, quiz("quiz-c"));
    time.tick();
    await store.put(ALEX, quiz("quiz-d"));
    await store.put(BLAIR, quiz("quiz-e"));
    await store.put(ALEX, { id: "deck-1", kind: "deck", data: {} });
    expect((await store.list(ALEX, "quiz")).map((record) => record.id)).toEqual(
      ["quiz-d", "quiz-c", "quiz-b", "quiz-a"],
    );
    expect(
      (await store.list(BLAIR, "quiz")).map((record) => record.id),
    ).toEqual(["quiz-e"]);
  });

  test('ties are broken by the id\'s UTF-8 bytes, as collate "C" orders them, past the BMP too', async () => {
    const { store } = fixture();
    // As UTF-16 units the emoji (D83D...) sorts below "ｚ" (FF5A); as bytes (F0... against EF...) above.
    for (const id of ["z", "\uff5a", "\u{1f600}"])
      await store.put(ALEX, quiz(id));
    expect((await store.list(ALEX, "quiz")).map((record) => record.id)).toEqual(
      ["\u{1f600}", "\uff5a", "z"],
    );
  });

  test("filters by class, by what a record answers, and by status", async () => {
    const { store, time } = fixture();
    await store.put(ALEX, quiz("quiz-1", { classId: "chem2" }));
    time.tick();
    await store.put(ALEX, quiz("quiz-2", { classId: "apush1" }));
    await store.put(ALEX, {
      id: "attempt:quiz-1",
      kind: "attempt",
      refId: "quiz-1",
      classId: "chem2",
      data: {},
    });
    await store.put(
      ALEX,
      plan("plan-1", "2026-11-04T20:00:00Z", "2026-11-04T21:00:00Z", "applied"),
    );
    await store.put(
      ALEX,
      plan("plan-2", "2026-11-05T20:00:00Z", "2026-11-05T21:00:00Z"),
    );
    const ids = async (...args: Parameters<StudyStore["list"]>) =>
      (await store.list(...args)).map((record) => record.id);
    expect(await ids(ALEX, "quiz", { classId: "chem2" })).toEqual(["quiz-1"]);
    expect(await ids(ALEX, "attempt", { refId: "quiz-1" })).toEqual([
      "attempt:quiz-1",
    ]);
    expect(await ids(ALEX, "attempt", { refId: "quiz-2" })).toEqual([]);
    expect(await ids(ALEX, "plan", { status: "applied" })).toEqual(["plan-1"]);
  });

  test("overlapping is half-open, and a record with no span overlaps nothing", async () => {
    const { store } = fixture();
    await store.put(
      ALEX,
      plan("monday", "2026-11-02T20:00:00Z", "2026-11-02T22:00:00Z"),
    );
    await store.put(
      ALEX,
      plan("tuesday", "2026-11-03T20:00:00Z", "2026-11-03T22:00:00Z"),
    );
    await store.put(ALEX, { id: "unplanned", kind: "plan", data: {} });
    const overlapping = async (from: string, to: string) =>
      (
        await store.list(ALEX, "plan", {
          overlapping: { from: new Date(from), to: new Date(to) },
        })
      )
        .map((record) => record.id)
        .sort();
    expect(
      await overlapping("2026-11-02T00:00:00Z", "2026-11-04T00:00:00Z"),
    ).toEqual(["monday", "tuesday"]);
    expect(
      await overlapping("2026-11-02T21:00:00Z", "2026-11-02T21:30:00Z"),
    ).toEqual(["monday"]);
    // Touching is not overlapping, at either end.
    expect(
      await overlapping("2026-11-02T22:00:00Z", "2026-11-03T20:00:00Z"),
    ).toEqual([]);
    expect(
      await overlapping("2026-11-02T18:00:00Z", "2026-11-02T20:00:00Z"),
    ).toEqual([]);
  });

  test("returns at most the limit, newest first", async () => {
    const { store, time } = fixture();
    for (let index = 0; index < 5; index++) {
      await store.put(ALEX, quiz(`quiz-${index}`));
      time.tick();
    }
    expect(
      (await store.list(ALEX, "quiz", { limit: 2 })).map((record) => record.id),
    ).toEqual(["quiz-4", "quiz-3"]);
    expect(await store.list(ALEX, "quiz")).toHaveLength(5);
  });

  test("caps a list at 500", async () => {
    const { store } = fixture();
    for (let index = 0; index < 501; index++)
      await store.insertOnce(ALEX, {
        id: `a-${index}`,
        kind: "attempt",
        data: {},
      });
    expect(await store.list(ALEX, "attempt", { limit: 10_000 })).toHaveLength(
      500,
    );
    expect(await store.list(ALEX, "attempt")).toHaveLength(200);
  });
});

describe("update", () => {
  test("writes only what the change names, with a new updatedAt", async () => {
    const { store, time } = fixture();
    await store.put(ALEX, {
      ...plan("plan-1", "2026-11-04T20:00:00Z", "2026-11-04T21:00:00Z"),
      classId: "chem2",
      botId: "bot",
    });
    time.tick(3);
    const updated = await store.update(ALEX, "plan", "plan-1", (current) => ({
      status: "applied",
      classId: null,
      data: { ...current.data, appliedAt: "now" },
    }));
    expect(updated).toMatchObject({
      status: "applied",
      classId: null,
      botId: "bot",
      startsAt: new Date("2026-11-04T20:00:00Z"),
      data: { blocks: [], appliedAt: "now" },
      createdAt: new Date("2026-11-04T15:00:00.000Z"),
      updatedAt: new Date("2026-11-04T15:03:00.000Z"),
    });
    expect(await store.get(ALEX, "plan", "plan-1")).toEqual(updated);
  });

  test("a change that throws writes nothing, and the error reaches the caller", async () => {
    const { store, time } = fixture();
    const before = await store.put(
      ALEX,
      plan("plan-1", "2026-11-04T20:00:00Z", "2026-11-04T21:00:00Z"),
    );
    time.tick();
    await expect(
      store.update(ALEX, "plan", "plan-1", async (current) => {
        current.data.blocks = ["mutated before throwing"];
        throw new StudyConflictError("This plan is out of date.");
      }),
    ).rejects.toThrow("This plan is out of date.");
    await settle();
    expect(await store.get(ALEX, "plan", "plan-1")).toEqual(before);
  });

  test("somebody else's record, or one of another kind, is not found and never changed", async () => {
    const { store } = fixture();
    await store.put(
      ALEX,
      plan("plan-1", "2026-11-04T20:00:00Z", "2026-11-04T21:00:00Z"),
    );
    let called = false;
    const change = () => {
      called = true;
      return { status: "applied" };
    };
    await expect(
      store.update(BLAIR, "plan", "plan-1", change),
    ).rejects.toBeInstanceOf(StudyNotFoundError);
    await expect(
      store.update(ALEX, "quiz", "plan-1", change),
    ).rejects.toBeInstanceOf(StudyNotFoundError);
    await expect(
      store.update(ALEX, "plan", "missing", change),
    ).rejects.toBeInstanceOf(StudyNotFoundError);
    await settle();
    expect(called).toBe(false);
    expect((await store.get(ALEX, "plan", "plan-1"))?.status).toBe("proposed");
  });

  test("two updates of one record run one after the other, the second seeing the first", async () => {
    const { store } = fixture();
    await store.put(ALEX, { id: "rules", kind: "rules", data: { count: 0 } });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: number[] = [];
    const first = store.update(ALEX, "rules", "rules", async (current) => {
      seen.push(current.data.count as number);
      await gate;
      return { data: { count: (current.data.count as number) + 1 } };
    });
    const second = store.update(ALEX, "rules", "rules", async (current) => {
      seen.push(current.data.count as number);
      return { data: { count: (current.data.count as number) + 1 } };
    });
    await settle();
    // The second waits for the first, as a row lock makes it; a plain read does not wait.
    expect(seen).toEqual([0]);
    expect((await store.get(ALEX, "rules", "rules"))?.data.count).toBe(0);
    release();
    await Promise.all([first, second]);
    expect(seen).toEqual([0, 1]);
    expect((await store.get(ALEX, "rules", "rules"))?.data.count).toBe(2);
  });

  test("an update that fails releases the record for the next one", async () => {
    const { store } = fixture();
    await store.put(ALEX, { id: "rules", kind: "rules", data: { count: 0 } });
    const failing = store.update(ALEX, "rules", "rules", () => {
      throw new Error("no");
    });
    const next = store.update(ALEX, "rules", "rules", (current) => ({
      data: { count: (current.data.count as number) + 1 },
    }));
    await expect(failing).rejects.toThrow("no");
    expect((await next).data.count).toBe(1);
  });

  test("a put of a record being updated waits for the update to finish", async () => {
    const { store } = fixture();
    await store.put(ALEX, {
      id: "school:alex",
      kind: "school",
      data: { v: 1 },
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const update = store.update(ALEX, "school", "school:alex", async () => {
      await gate;
      return { data: { v: 2 } };
    });
    const put = store.put(ALEX, {
      id: "school:alex",
      kind: "school",
      data: { v: 3 },
    });
    await settle();
    expect((await store.get(ALEX, "school", "school:alex"))?.data.v).toBe(1);
    release();
    await Promise.all([update, put]);
    // The put came second, so it is what is stored.
    expect((await store.get(ALEX, "school", "school:alex"))?.data.v).toBe(3);
  });

  test("updates of different records do not wait for each other", async () => {
    const { store } = fixture();
    await store.put(ALEX, { id: "one", kind: "rules", data: {} });
    await store.put(ALEX, { id: "two", kind: "rules", data: {} });
    const never = new Promise<never>(() => {});
    void store.update(ALEX, "rules", "one", () => never);
    const other = await store.update(ALEX, "rules", "two", () => ({
      status: "done",
    }));
    expect(other.status).toBe("done");
  });
});

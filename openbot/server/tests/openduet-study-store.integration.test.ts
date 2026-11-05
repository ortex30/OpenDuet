import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { createDatabase } from "../src/db/client";
import { users } from "../src/db/schema/core";
import { openduetStudyRecords } from "../src/db/schema/openduet";
import {
  StudyConflictError,
  StudyNotFoundError,
  type StudyRecordInput,
} from "../src/openduet/study/contracts";
import { createStudyStore } from "../src/openduet/study/store";
import { TEST_POOL, testDatabaseUrl } from "./support/database";

/*
 * The study store against Postgres: the same rules openduet-study-store.test.ts holds the memory
 * store to, and the parts only SQL can show. Owner scoping by the conditional upsert, insertOnce
 * under a primary-key conflict, the overlap filter's NULL handling, the row lock that keeps two
 * updates of one plan apart, and the rollback when a change throws. Runs in CI, where TEST_DATABASE_URL
 * names a migrated database.
 */

const database = createDatabase(testDatabaseUrl(), TEST_POOL);
const prefix = `study-${randomUUID()}`;
const alex = `${prefix}-alex`;
const blair = `${prefix}-blair`;
const id = (name: string) => `${prefix}:${name}`;

let clock = new Date("2026-11-04T15:00:00.000Z");
const tick = (minutes = 1) => {
  clock = new Date(clock.getTime() + minutes * 60_000);
  return clock;
};
const store = createStudyStore(database, { now: () => clock });

const quiz = (name: string, extra: Partial<StudyRecordInput> = {}) =>
  ({
    id: id(name),
    kind: "quiz",
    data: { title: name, questions: [{ id: "q1", topic: "rates" }] },
    ...extra,
  }) satisfies StudyRecordInput;

const plan = (name: string, from: string, to: string) =>
  ({
    id: id(name),
    kind: "plan",
    status: "proposed",
    startsAt: new Date(from),
    endsAt: new Date(to),
    data: { blocks: [] },
  }) satisfies StudyRecordInput;

beforeAll(async () => {
  await database.insert(users).values([
    { id: alex, email: `${alex}@example.test` },
    { id: blair, email: `${blair}@example.test` },
  ]);
});

afterAll(async () => {
  // The records go with their owners, by the cascade.
  await database.delete(users).where(inArray(users.id, [alex, blair]));
  await database.$client.close();
});

describe("put and get", () => {
  test("stores data as a JSON object and reads it back for its owner only", async () => {
    const saved = await store.put(alex, quiz("one", { classId: "chem2" }));
    expect(saved).toMatchObject({
      id: id("one"),
      ownerUserId: alex,
      kind: "quiz",
      classId: "chem2",
      botId: null,
      data: { title: "one" },
    });
    expect(await store.get(alex, "quiz", id("one"))).toEqual(saved);
    expect(await store.get(blair, "quiz", id("one"))).toBeNull();
    expect(await store.get(alex, "deck", id("one"))).toBeNull();

    const [row] = await database.execute<{ shape: string; title: string }>(
      sql`select jsonb_typeof(data) as shape, data->>'title' as title
          from openduet_study_records where id = ${id("one")}`,
    );
    expect(row).toEqual({ shape: "object", title: "one" });
  });

  test("an upsert replaces the owner's record and keeps when it was made", async () => {
    await store.put(alex, quiz("replaced", { classId: "chem2", refId: "r" }));
    const made = clock;
    tick(5);
    const replaced = await store.put(alex, {
      id: id("replaced"),
      kind: "quiz",
      data: { title: "second" },
    });
    expect(replaced).toMatchObject({
      classId: null,
      refId: null,
      data: { title: "second" },
      createdAt: made,
      updatedAt: clock,
    });
  });

  test("an upsert of somebody else's id is refused and changes nothing", async () => {
    await store.put(alex, quiz("theirs"));
    await expect(
      store.put(blair, quiz("theirs", { data: { title: "taken" } })),
    ).rejects.toBeInstanceOf(StudyNotFoundError);
    const [row] = await database
      .select()
      .from(openduetStudyRecords)
      .where(inArray(openduetStudyRecords.id, [id("theirs")]));
    expect(row).toMatchObject({ ownerUserId: alex, data: { title: "theirs" } });
  });

  test("data jsonb would refuse is mended first: a NUL taken out, half an emoji made U+FFFD", async () => {
    const saved = await store.put(alex, {
      id: id("mended"),
      kind: "deck",
      data: {
        title: "Lab\u0000 6",
        warnings: ["Gatsby essay \ud83d", { deep: "\udc4d" }],
        "key\u0000": "a NUL in a key",
        whole: "📚 stays",
      },
    });
    const mended = {
      title: "Lab 6",
      warnings: ["Gatsby essay \ufffd", { deep: "\ufffd" }],
      key: "a NUL in a key",
      whole: "📚 stays",
    };
    expect(saved.data).toEqual(mended);
    expect((await store.get(alex, "deck", id("mended")))?.data).toEqual(mended);
    const updated = await store.update(alex, "deck", id("mended"), () => ({
      data: { title: "half \ud83d\u0000" },
    }));
    expect(updated.data).toEqual({ title: "half \ufffd" });
  });
});

describe("insertOnce", () => {
  test("inserts once; every later call returns what was stored first", async () => {
    const first = await store.insertOnce(alex, {
      id: id("attempt"),
      kind: "attempt",
      refId: id("one"),
      data: { correct: 3 },
    });
    expect(first.created).toBe(true);
    const again = await store.insertOnce(alex, {
      id: id("attempt"),
      kind: "attempt",
      refId: id("one"),
      data: { correct: 0 },
    });
    expect(again).toEqual({ record: first.record, created: false });
  });

  test("two at once make one row", async () => {
    const results = await Promise.all(
      [1, 2].map((correct) =>
        store.insertOnce(alex, {
          id: id("racing-attempt"),
          kind: "attempt",
          data: { correct },
        }),
      ),
    );
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results[0]?.record.data).toEqual(results[1]?.record.data);
  });

  test("somebody else's id is refused", async () => {
    await expect(
      store.insertOnce(blair, {
        id: id("attempt"),
        kind: "attempt",
        data: {},
      }),
    ).rejects.toBeInstanceOf(StudyNotFoundError);
  });
});

describe("list", () => {
  test("is newest first, filtered, and overlapping is half-open with no-span rows left out", async () => {
    tick();
    await store.put(
      alex,
      plan("monday", "2026-11-02T20:00:00Z", "2026-11-02T22:00:00Z"),
    );
    tick();
    await store.put(
      alex,
      plan("tuesday", "2026-11-03T20:00:00Z", "2026-11-03T22:00:00Z"),
    );
    tick();
    await store.put(alex, { id: id("unplanned"), kind: "plan", data: {} });
    await store.put(
      blair,
      plan("blairs", "2026-11-02T20:00:00Z", "2026-11-02T22:00:00Z"),
    );

    const ids = async (from: string, to: string) =>
      (
        await store.list(alex, "plan", {
          overlapping: { from: new Date(from), to: new Date(to) },
        })
      ).map((record) => record.id);
    expect(await ids("2026-11-02T00:00:00Z", "2026-11-04T00:00:00Z")).toEqual([
      id("tuesday"),
      id("monday"),
    ]);
    expect(await ids("2026-11-02T22:00:00Z", "2026-11-03T20:00:00Z")).toEqual(
      [],
    );
    expect((await store.list(alex, "plan")).map((record) => record.id)).toEqual(
      [id("unplanned"), id("tuesday"), id("monday")],
    );
    expect(
      (await store.list(alex, "plan", { status: "proposed", limit: 1 })).map(
        (record) => record.id,
      ),
    ).toEqual([id("tuesday")]);
    expect(
      (await store.list(alex, "attempt", { refId: id("one") })).map(
        (record) => record.id,
      ),
    ).toEqual([id("attempt")]);
  });

  test("ties are broken by the id's bytes, past the BMP too, as the memory store breaks them", async () => {
    tick();
    for (const name of ["z", "\uff5a", "\u{1f600}"])
      await store.put(alex, quiz(name, { classId: "tie-break" }));
    expect(
      (await store.list(alex, "quiz", { classId: "tie-break" })).map(
        (record) => record.id,
      ),
    ).toEqual([id("\u{1f600}"), id("\uff5a"), id("z")]);
  });
});

describe("update", () => {
  test("writes only the columns a change names", async () => {
    await store.put(alex, {
      ...plan("apply", "2026-11-05T20:00:00Z", "2026-11-05T21:00:00Z"),
      classId: "chem2",
    });
    tick();
    const updated = await store.update(
      alex,
      "plan",
      id("apply"),
      (current) => ({
        status: "applied",
        data: { ...current.data, appliedAt: clock.toISOString() },
      }),
    );
    expect(updated).toMatchObject({
      status: "applied",
      classId: "chem2",
      startsAt: new Date("2026-11-05T20:00:00Z"),
      data: { blocks: [], appliedAt: clock.toISOString() },
      updatedAt: clock,
    });
  });

  test("a change that throws rolls back, and somebody else's record is not found", async () => {
    await store.put(
      alex,
      plan("stale", "2026-11-05T20:00:00Z", "2026-11-05T21:00:00Z"),
    );
    await expect(
      store.update(alex, "plan", id("stale"), () => {
        throw new StudyConflictError("This plan is out of date.");
      }),
    ).rejects.toBeInstanceOf(StudyConflictError);
    expect((await store.get(alex, "plan", id("stale")))?.status).toBe(
      "proposed",
    );
    await expect(
      store.update(blair, "plan", id("stale"), () => ({ status: "applied" })),
    ).rejects.toBeInstanceOf(StudyNotFoundError);
  });

  test("the row lock makes two updates of one record take turns", async () => {
    await store.put(alex, {
      id: id("counter"),
      kind: "rules",
      data: { count: 0 },
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: number[] = [];
    const bump = (wait: boolean) =>
      store.update(alex, "rules", id("counter"), async (current) => {
        const count = current.data.count as number;
        seen.push(count);
        if (wait) await gate;
        return { data: { count: count + 1 } };
      });
    const first = bump(true);
    const second = bump(false);
    // Long enough for the second to reach the lock and wait on it.
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    await Promise.all([first, second]);
    // Without the lock both would have read 0 and the count would be 1.
    expect(seen.sort()).toEqual([0, 1]);
    expect((await store.get(alex, "rules", id("counter")))?.data.count).toBe(2);
  });
});

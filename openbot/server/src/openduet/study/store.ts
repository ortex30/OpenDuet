import { and, desc, eq, gt, lt, type SQL, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { openduetStudyRecords } from "../../db/schema/openduet";
import {
  type StudyKind,
  type StudyListFilter,
  StudyNotFoundError,
  type StudyRecord,
  type StudyRecordChange,
  type StudyRecordInput,
  type StudyStore,
} from "./contracts";

/*
 * Every study record in one owner-scoped table (openduet_study_records). Every read and write names
 * its owner, and another person's record is answered exactly as no record is: a get finds nothing,
 * a write is StudyNotFoundError. Ids are the table's primary key, so they are unique across owners;
 * that is what lets an attempt's id be derived from its quiz's and inserted once.
 *
 * The memory store (memory-store.ts) keeps the same rules for unit tests, and shares the helpers
 * below so the two cannot drift apart on what a filter, a limit, a change or stored data means.
 */

export const DEFAULT_LIST_LIMIT = 200;
export const MAX_LIST_LIMIT = 500;

/** A list's limit: 200 when none is given or it is not a number, and never more than 500. */
export function listLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIST_LIMIT;
  return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(limit)));
}

/**
 * A string as jsonb can hold it. Postgres refuses the whole record over a NUL character anywhere in
 * it, or a lone surrogate (half an emoji, as a cut at a fixed length leaves one), so the NUL is
 * taken out and the half emoji becomes U+FFFD, the mark for a character that couldn't be read.
 */
function storable(text: string): string {
  return text.toWellFormed().replaceAll("\u0000", "");
}

function storableJson(value: unknown): unknown {
  if (typeof value === "string") return storable(value);
  if (Array.isArray(value)) return value.map(storableJson);
  if (value !== null && typeof value === "object")
    // fromEntries, not assignment, so a "__proto__" key stays a key and never becomes a prototype.
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        storable(key),
        storableJson(item),
      ]),
    );
  return value;
}

/**
 * Data as both stores keep it: JSON, as jsonb stores it (a Date becomes its ISO string, undefined is
 * left out), with every string in it, keys too, one Postgres accepts. Done here, where both stores
 * share it, so the memory store keeps exactly what Postgres would rather than what it would refuse.
 */
function storableData(data: Record<string, unknown>): Record<string, unknown> {
  return storableJson(JSON.parse(JSON.stringify(data))) as Record<
    string,
    unknown
  >;
}

/** A text column as Postgres accepts it: text refuses a NUL character just as jsonb does. */
function storableText<T extends string | null | undefined>(value: T): T {
  return (typeof value === "string" ? storable(value) : value) as T;
}

/** The columns an input sets. A replace writes all of them, so nothing of the old record is left. */
export function columnsOf(record: StudyRecordInput) {
  return {
    kind: record.kind,
    botId: storableText(record.botId ?? null),
    classId: storableText(record.classId ?? null),
    refId: storableText(record.refId ?? null),
    status: storableText(record.status ?? null),
    startsAt: record.startsAt ?? null,
    endsAt: record.endsAt ?? null,
    data: storableData(record.data),
  };
}

/**
 * The columns a change names, and only those. A field left out, or given as undefined, is left as
 * it was; null clears it. Picked by name, so a caller cannot change an id, a kind or an owner. Data
 * is made storable as columnsOf makes it.
 */
export function changedColumns(change: StudyRecordChange): StudyRecordChange {
  const out: StudyRecordChange = {};
  if (change.botId !== undefined) out.botId = storableText(change.botId);
  if (change.classId !== undefined) out.classId = storableText(change.classId);
  if (change.refId !== undefined) out.refId = storableText(change.refId);
  if (change.status !== undefined) out.status = storableText(change.status);
  if (change.startsAt !== undefined) out.startsAt = change.startsAt;
  if (change.endsAt !== undefined) out.endsAt = change.endsAt;
  if (change.data !== undefined) out.data = storableData(change.data);
  return out;
}

type Row = typeof openduetStudyRecords.$inferSelect;

function recordOf(row: Row): StudyRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    botId: row.botId,
    kind: row.kind,
    classId: row.classId,
    refId: row.refId,
    status: row.status,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    data: row.data,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * The study store over Postgres. Building it touches nothing: the tools are built per run, and a
 * test builds them with no database at all.
 */
export function createStudyStore(
  database: Database,
  options: { now?: () => Date } = {},
): StudyStore {
  const now = options.now ?? (() => new Date());
  const table = openduetStudyRecords;
  const owned = (owner: string, kind: StudyKind, id: string) =>
    and(eq(table.ownerUserId, owner), eq(table.kind, kind), eq(table.id, id));

  async function get(
    owner: string,
    kind: StudyKind,
    id: string,
  ): Promise<StudyRecord | null> {
    const [row] = await database
      .select()
      .from(table)
      .where(owned(owner, kind, id))
      .limit(1);
    return row ? recordOf(row) : null;
  }

  return {
    get,

    async put(owner, record) {
      const at = now();
      const columns = columnsOf(record);
      /*
       * One statement, so two writers of the same id cannot both insert. The update is conditional
       * on the owner: when the id is somebody else's, Postgres writes nothing and returns no row,
       * which is how that case is told apart without a second query that could race.
       */
      const [row] = await database
        .insert(table)
        .values({
          id: record.id,
          ownerUserId: owner,
          ...columns,
          createdAt: at,
          updatedAt: at,
        })
        .onConflictDoUpdate({
          target: table.id,
          set: { ...columns, updatedAt: at },
          setWhere: eq(table.ownerUserId, owner),
        })
        .returning();
      if (!row) throw new StudyNotFoundError();
      return recordOf(row);
    },

    async insertOnce(owner, record) {
      const at = now();
      const [inserted] = await database
        .insert(table)
        .values({
          id: record.id,
          ownerUserId: owner,
          ...columnsOf(record),
          createdAt: at,
          updatedAt: at,
        })
        .onConflictDoNothing({ target: table.id })
        .returning();
      if (inserted) return { record: recordOf(inserted), created: true };
      // Somebody's record already has the id. Only the person's own, of the same kind, is returned.
      const existing = await get(owner, record.kind, record.id);
      if (!existing) throw new StudyNotFoundError();
      return { record: existing, created: false };
    },

    async list(owner, kind, filter: StudyListFilter = {}) {
      const conditions: SQL[] = [
        eq(table.ownerUserId, owner),
        eq(table.kind, kind),
      ];
      if (filter.classId !== undefined)
        conditions.push(eq(table.classId, filter.classId));
      if (filter.refId !== undefined)
        conditions.push(eq(table.refId, filter.refId));
      if (filter.status !== undefined)
        conditions.push(eq(table.status, filter.status));
      // Half-open spans overlap when each starts before the other ends. A record with no span has
      // nothing to overlap, and a comparison with NULL is never true, so it is left out.
      if (filter.overlapping)
        conditions.push(
          lt(table.startsAt, filter.overlapping.to),
          gt(table.endsAt, filter.overlapping.from),
        );
      const rows = await database
        .select()
        .from(table)
        .where(and(...conditions))
        // Ids compared byte by byte, as the memory store compares them, whatever the collation.
        .orderBy(desc(table.createdAt), desc(sql`${table.id} collate "C"`))
        .limit(listLimit(filter.limit));
      return rows.map(recordOf);
    },

    async update(owner, kind, id, change) {
      return database.transaction(async (transaction) => {
        // Locked until the transaction ends, so a second update of the same record waits here and
        // then reads what the first one wrote: two tabs cannot both apply one plan.
        const [row] = await transaction
          .select()
          .from(table)
          .where(owned(owner, kind, id))
          .for("update");
        if (!row) throw new StudyNotFoundError();
        // A throw here rolls the transaction back, so the record is left exactly as it was.
        const patch = changedColumns(await change(recordOf(row)));
        const [updated] = await transaction
          .update(table)
          .set({ ...patch, updatedAt: now() })
          .where(owned(owner, kind, id))
          .returning();
        if (!updated) throw new StudyNotFoundError();
        return recordOf(updated);
      });
    },
  };
}

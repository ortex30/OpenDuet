import {
  StudyNotFoundError,
  type StudyRecord,
  type StudyRecordInput,
  type StudyStore,
} from "./contracts";
import { changedColumns, columnsOf, listLimit } from "./store";

/*
 * The study store in memory, for unit tests that have no Postgres. It keeps the Postgres store's
 * rules rather than approximating them, because tests of the tools and routes stand on it:
 *
 * - Ids are unique across owners, as a primary key is. Another person's id is never read, and
 *   writing it is StudyNotFoundError.
 * - Data goes in and comes out as JSON, as jsonb stores it: a caller holding a record cannot change
 *   what is stored by changing the object, and a Date inside data comes back as its ISO string. Its
 *   strings are mended as Postgres needs them (store.ts columnsOf), so neither store keeps a NUL or
 *   half an emoji the other would refuse.
 * - Lists are newest first, ties broken by id compared byte by byte in UTF-8, as `collate "C"` makes
 *   the SQL order them. Comparing the strings themselves would compare UTF-16 units, which order an
 *   emoji before "ｚ" where Postgres puts it after.
 * - Writes to one id wait for each other, as a row lock makes them, so an update whose change awaits
 *   is never interleaved with another update of the same record. Reads never wait: a get during an
 *   update sees the record as it was, as a read beside an open transaction does.
 */

const json = (data: Record<string, unknown>): Record<string, unknown> =>
  JSON.parse(JSON.stringify(data));

const at = (date: Date | null) => (date ? new Date(date.getTime()) : null);

function copy(record: StudyRecord): StudyRecord {
  return {
    ...record,
    startsAt: at(record.startsAt),
    endsAt: at(record.endsAt),
    data: json(record.data),
    createdAt: new Date(record.createdAt.getTime()),
    updatedAt: new Date(record.updatedAt.getTime()),
  };
}

function stored(
  owner: string,
  input: StudyRecordInput,
  createdAt: Date,
  updatedAt: Date,
): StudyRecord {
  const columns = columnsOf(input);
  return {
    id: input.id,
    ownerUserId: owner,
    ...columns,
    startsAt: at(columns.startsAt),
    endsAt: at(columns.endsAt),
    data: json(columns.data),
    createdAt,
    updatedAt,
  };
}

export function createMemoryStudyStore(
  options: { now?: () => Date } = {},
): StudyStore {
  const now = options.now ?? (() => new Date());
  const records = new Map<string, StudyRecord>();
  const queues = new Map<string, Promise<void>>();

  /** Runs `work` after every earlier write to the same id has finished, whether it worked or not. */
  function exclusive<T>(id: string, work: () => Promise<T>): Promise<T> {
    const result = (queues.get(id) ?? Promise.resolve()).then(work);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    queues.set(id, settled);
    void settled.then(() => {
      if (queues.get(id) === settled) queues.delete(id);
    });
    return result;
  }

  const own = (owner: string, kind: StudyRecord["kind"], id: string) => {
    const record = records.get(id);
    return record && record.ownerUserId === owner && record.kind === kind
      ? record
      : null;
  };

  return {
    async get(owner, kind, id) {
      const record = own(owner, kind, id);
      return record ? copy(record) : null;
    },

    put(owner, input) {
      return exclusive(input.id, async () => {
        const existing = records.get(input.id);
        if (existing && existing.ownerUserId !== owner)
          throw new StudyNotFoundError();
        const time = now();
        const record = stored(
          owner,
          input,
          existing ? existing.createdAt : new Date(time.getTime()),
          new Date(time.getTime()),
        );
        records.set(input.id, record);
        return copy(record);
      });
    },

    async insertOnce(owner, input) {
      const existing = records.get(input.id);
      if (!existing) {
        const time = now();
        const record = stored(
          owner,
          input,
          new Date(time.getTime()),
          new Date(time.getTime()),
        );
        records.set(input.id, record);
        return { record: copy(record), created: true };
      }
      if (existing.ownerUserId !== owner || existing.kind !== input.kind)
        throw new StudyNotFoundError();
      return { record: copy(existing), created: false };
    },

    async list(owner, kind, filter = {}) {
      const { overlapping } = filter;
      return [...records.values()]
        .filter(
          (record) =>
            record.ownerUserId === owner &&
            record.kind === kind &&
            (filter.classId === undefined ||
              record.classId === filter.classId) &&
            (filter.refId === undefined || record.refId === filter.refId) &&
            (filter.status === undefined || record.status === filter.status) &&
            (!overlapping ||
              (record.startsAt !== null &&
                record.endsAt !== null &&
                record.startsAt.getTime() < overlapping.to.getTime() &&
                record.endsAt.getTime() > overlapping.from.getTime())),
        )
        .sort(
          (a, b) =>
            b.createdAt.getTime() - a.createdAt.getTime() ||
            Buffer.compare(Buffer.from(b.id), Buffer.from(a.id)),
        )
        .slice(0, listLimit(filter.limit))
        .map(copy);
    },

    update(owner, kind, id, change) {
      return exclusive(id, async () => {
        const current = own(owner, kind, id);
        if (!current) throw new StudyNotFoundError();
        // A throw from `change` leaves before anything is written.
        const patch = changedColumns(await change(copy(current)));
        const next: StudyRecord = {
          ...current,
          ...patch,
          startsAt:
            patch.startsAt === undefined
              ? current.startsAt
              : at(patch.startsAt),
          endsAt:
            patch.endsAt === undefined ? current.endsAt : at(patch.endsAt),
          data: patch.data === undefined ? current.data : json(patch.data),
          updatedAt: new Date(now().getTime()),
        };
        records.set(id, next);
        return copy(next);
      });
    },
  };
}

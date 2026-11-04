/**
 * Small typed repository factories.
 *
 * - Every write validates the full domain object with its Zod schema and
 *   passes the server-side write gate first.
 * - Every read re-validates the row through the same schema (no silent drift).
 * - `appendOnlyRepository` exposes create/read ONLY: no update or delete
 *   helpers exist. (Simulations are additionally removed by the database
 *   cascade when their incident is deleted via `incidents.deleteForDemoReset`.)
 */
import type * as z from "zod";
import { NotFoundError, mapPrismaError, parseOrThrow } from "./errors";

export type WriteGate = () => void;

type Codec<T, Row, Data> = {
  entity: string;
  schema: z.ZodType<T>;
  toData: (value: T) => Data;
  fromRow: (row: Row) => unknown;
};

type ReadOps<Row> = {
  findUnique: (id: string) => Promise<Row | null>;
  findMany: () => Promise<Row[]>;
};

type CreateOps<Row, Data> = ReadOps<Row> & {
  create: (data: Data) => Promise<Row>;
};

type MutableOps<Row, Data> = CreateOps<Row, Data> & {
  update: (id: string, data: Data) => Promise<Row>;
  delete: (id: string) => Promise<Row>;
};

export type ReadRepository<T> = {
  getById(id: string): Promise<T>;
  findById(id: string): Promise<T | null>;
  list(): Promise<T[]>;
};

export type AppendOnlyRepository<T> = ReadRepository<T> & {
  create(input: unknown): Promise<T>;
};

export type MutableRepository<T extends { id: string }> = AppendOnlyRepository<T> & {
  /** Merge-and-revalidate update. `id` cannot change. */
  update(id: string, patch: Partial<Omit<T, "id">>): Promise<T>;
  delete(id: string): Promise<void>;
};

export type Hooks<T> = {
  /** Runs after validation and before every create/update (`existing` is null on create). Throw to reject. */
  beforeWrite?: (next: T, existing: T | null) => Promise<void> | void;
  /** Runs before update with the stored and proposed values. Throw to reject. */
  beforeUpdate?: (existing: T, next: T) => Promise<void> | void;
};

function readRepository<T, Row, Data>(codec: Codec<T, Row, Data>, ops: ReadOps<Row>): ReadRepository<T> {
  const decode = decoder(codec);
  return {
    async findById(id) {
      const row = await ops.findUnique(id);
      return row === null ? null : decode(row);
    },
    async getById(id) {
      const row = await ops.findUnique(id);
      if (row === null) throw new NotFoundError(codec.entity, id);
      return decode(row);
    },
    async list() {
      return (await ops.findMany()).map(decode);
    },
  };
}

function decoder<T, Row, Data>(codec: Codec<T, Row, Data>) {
  return (row: Row): T => parseOrThrow(codec.schema, codec.fromRow(row), `stored ${codec.entity}`);
}

export function appendOnlyRepository<T, Row, Data>(
  codec: Codec<T, Row, Data>,
  ops: CreateOps<Row, Data>,
  writeGate: WriteGate,
  hooks: Hooks<T> = {},
): AppendOnlyRepository<T> {
  const decode = decoder(codec);
  const read = readRepository(codec, ops);
  // Explicit object literal: only these keys exist. No update/delete.
  return Object.freeze({
    getById: read.getById,
    findById: read.findById,
    list: read.list,
    async create(input: unknown): Promise<T> {
      writeGate();
      const value = parseOrThrow(codec.schema, input, codec.entity);
      await hooks.beforeWrite?.(value, null);
      try {
        return decode(await ops.create(codec.toData(value)));
      } catch (e) {
        mapPrismaError(e, codec.entity);
      }
    },
  });
}

export function mutableRepository<T extends { id: string }, Row, Data>(
  codec: Codec<T, Row, Data>,
  ops: MutableOps<Row, Data>,
  writeGate: WriteGate,
  hooks: Hooks<T> = {},
): MutableRepository<T> {
  const decode = decoder(codec);
  const base = appendOnlyRepository(codec, ops, writeGate, hooks);
  return Object.freeze({
    ...base,
    async update(id: string, patch: Partial<Omit<T, "id">>): Promise<T> {
      writeGate();
      const existing = await base.getById(id);
      const next = parseOrThrow(codec.schema, { ...existing, ...patch, id }, codec.entity);
      await hooks.beforeUpdate?.(existing, next);
      await hooks.beforeWrite?.(next, existing);
      try {
        return decode(await ops.update(id, codec.toData(next)));
      } catch (e) {
        mapPrismaError(e, codec.entity);
      }
    },
    async delete(id: string): Promise<void> {
      writeGate();
      try {
        await ops.delete(id);
      } catch (e) {
        mapPrismaError(e, codec.entity);
      }
    },
  });
}

export { decoder };

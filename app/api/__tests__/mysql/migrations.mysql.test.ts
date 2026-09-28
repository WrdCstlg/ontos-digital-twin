/**
 * The migrations build the database schema.ts describes: its tables, columns,
 * defaults, indexes and foreign keys, and nothing else. A change to schema.ts
 * without its migration fails here; the in-memory database the other tests
 * use cannot notice one. And they run again as a no-op, as the bootstrap runs
 * them on every start.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { is, SQL } from "drizzle-orm";
import { getTableConfig, MySqlDialect, MySqlTable, type MySqlColumn } from "drizzle-orm/mysql-core";
import * as schema from "@db/schema";

const migrationsFolder = path.resolve(import.meta.dirname, "../../../db/migrations");
const journal = JSON.parse(readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
const declared = (Object.values(schema) as unknown[])
  .filter((v): v is MySqlTable => is(v, MySqlTable))
  .map(getTableConfig);
const dialect = new MySqlDialect();

let conn: mysql.Connection;
beforeAll(async () => {
  conn = await mysql.createConnection(process.env.DATABASE_URL!);
});
afterAll(async () => {
  await conn?.end();
});

async function rows<T>(query: string): Promise<T[]> {
  const [result] = await conn.query(query);
  return result as T[];
}
const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const OURS = "table_schema = database() and table_name <> '__drizzle_migrations'";

/** A column as information_schema would describe it, from its declaration. */
function describeDeclared(c: MySqlColumn) {
  const type = c.getSQLType();
  return {
    type: type === "boolean" ? "tinyint(1)" : type,
    nullable: !c.notNull,
    default: declaredDefault(c),
    autoIncrement: Boolean((c as { autoIncrement?: boolean }).autoIncrement),
  };
}

function declaredDefault(c: MySqlColumn): string | null {
  if (c.default === undefined || c.default === null) return null;
  if (is(c.default, SQL)) return dialect.sqlToQuery(c.default).sql.replace(/^\((.*)\)$/, "$1");
  if (typeof c.default === "boolean") return c.default ? "1" : "0";
  return String(c.default);
}

/** MySQL shows `default (now())` on a timestamp as CURRENT_TIMESTAMP. */
const normaliseDefault = (d: string | null) => (d === "CURRENT_TIMESTAMP" ? "now()" : d);

describe("the migrated database is the one schema.ts describes", () => {
  it("has exactly the tables schema.ts declares", async () => {
    const tables = await rows<{ t: string }>(`select table_name as t from information_schema.tables where ${OURS} and table_type = 'BASE TABLE'`);
    expect(tables.map((r) => r.t).sort(byName)).toEqual(declared.map((t) => t.name).sort(byName));
  });

  it("and in each, exactly the columns declared, with their types, nullability and defaults", async () => {
    const cols = await rows<{ t: string; c: string; type: string; nullable: string; dflt: string | null; extra: string }>(
      `select table_name as t, column_name as c, column_type as type, is_nullable as nullable, column_default as dflt, extra as extra
       from information_schema.columns where ${OURS}`,
    );
    const actual = Object.fromEntries(
      cols.map((r) => [
        `${r.t}.${r.c}`,
        { type: r.type, nullable: r.nullable === "YES", default: normaliseDefault(r.dflt), autoIncrement: r.extra.includes("auto_increment") },
      ]),
    );
    const expected = Object.fromEntries(declared.flatMap((t) => t.columns.map((c) => [`${t.name}.${c.name}`, describeDeclared(c)])));
    expect(actual).toEqual(expected);
  });

  it("with the indexes declared, and otherwise only those MySQL makes for a foreign key", async () => {
    const indexes = await rows<{ t: string; i: string; nonUnique: number; cols: string }>(
      `select table_name as t, index_name as i, non_unique as nonUnique, group_concat(column_name order by seq_in_index) as cols
       from information_schema.statistics where ${OURS} group by table_name, index_name, non_unique`,
    );
    const fkNames = new Set(
      (await rows<{ t: string; name: string }>(
        `select table_name as t, constraint_name as name from information_schema.referential_constraints where constraint_schema = database()`,
      )).map((r) => `${r.t}.${r.name}`),
    );
    const actual = indexes
      .filter((r) => !fkNames.has(`${r.t}.${r.i}`))
      .map((r) => `${r.t}.${r.i} ${Number(r.nonUnique) ? "index" : "unique"} (${r.cols})`)
      .sort(byName);
    const expected = declared
      .flatMap((t) => [
        `${t.name}.PRIMARY unique (${t.columns.filter((c) => c.primary).map((c) => c.name).join(",")})`,
        ...t.columns.filter((c) => c.isUnique).map((c) => `${t.name}.${c.uniqueName} unique (${c.name})`),
        ...t.indexes.map(
          (i) =>
            `${t.name}.${i.config.name} ${i.config.unique ? "unique" : "index"} (${i.config.columns.map((c) => (c as MySqlColumn).name).join(",")})`,
        ),
      ])
      .sort(byName);
    expect(actual).toEqual(expected);
  });

  it("and the foreign keys declared, each deleting as declared", async () => {
    const fks = await rows<{ t: string; cols: string; rt: string; rcols: string; onDelete: string; onUpdate: string }>(
      `select k.table_name as t, group_concat(k.column_name order by k.ordinal_position) as cols,
              k.referenced_table_name as rt, group_concat(k.referenced_column_name order by k.ordinal_position) as rcols,
              r.delete_rule as onDelete, r.update_rule as onUpdate
       from information_schema.key_column_usage k
       join information_schema.referential_constraints r
         on r.constraint_schema = k.constraint_schema and r.constraint_name = k.constraint_name and r.table_name = k.table_name
       where k.table_schema = database() and k.referenced_table_name is not null
       group by k.table_name, k.constraint_name, k.referenced_table_name, r.delete_rule, r.update_rule`,
    );
    const actual = fks.map((r) => `${r.t}(${r.cols}) -> ${r.rt}(${r.rcols}) on delete ${r.onDelete} on update ${r.onUpdate}`).sort(byName);
    const expected = declared
      .flatMap((t) =>
        t.foreignKeys.map((fk) => {
          const ref = fk.reference();
          const rule = (r: string | undefined) => (r ?? "no action").toUpperCase();
          return `${t.name}(${ref.columns.map((c) => c.name).join(",")}) -> ${getTableConfig(ref.foreignTable).name}(${ref.foreignColumns
            .map((c) => c.name)
            .join(",")}) on delete ${rule(fk.onDelete)} on update ${rule(fk.onUpdate)}`;
        }),
      )
      .sort(byName);
    expect(actual).toEqual(expected);
  });
});

describe("the migrations", () => {
  it("were all applied, and run again as a no-op", async () => {
    const applied = () => rows<{ id: number; hash: string; created_at: string }>("select id, hash, created_at from __drizzle_migrations order by id");
    const before = await applied();
    expect(before).toHaveLength(journal.entries.length);
    await migrate(drizzle(conn), { migrationsFolder });
    expect(await applied()).toEqual(before);
  });
});

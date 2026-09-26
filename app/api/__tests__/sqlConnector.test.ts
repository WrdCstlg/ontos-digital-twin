import { afterEach, describe, expect, it, vi } from "vitest";

// The drivers are replaced by fakes that record how they were asked to connect.
const seen = vi.hoisted(() => ({ mysql: [] as Record<string, unknown>[], pg: [] as Record<string, unknown>[], queries: [] as { sql: string; params: unknown[] }[] }));

vi.mock("mysql2/promise", () => ({
  default: {
    createPool: (opts: Record<string, unknown>) => {
      seen.mysql.push(opts);
      return {
        query: async (sql: string, params: unknown[] = []) => {
          seen.queries.push({ sql, params });
          return [[{ v: "8.4.0" }]];
        },
        end: async () => undefined,
      };
    },
  },
}));

vi.mock("pg", () => ({
  Pool: class {
    constructor(opts: Record<string, unknown>) {
      seen.pg.push(opts);
    }
    async query(sql: string, params: unknown[] = []) {
      seen.queries.push({ sql, params });
      return { rows: [{ v: "PostgreSQL 16.4, compiled by gcc" }], fields: [] };
    }
    async end() {}
  },
}));

import { fetchRows, parseSqlConfig, testConnection } from "../services/sqlConnector";

afterEach(() => {
  seen.mysql.length = 0;
  seen.pg.length = 0;
  seen.queries.length = 0;
});

describe("parseSqlConfig", () => {
  it("needs a known driver, a host and a database", () => {
    expect(parseSqlConfig(null)).toBeNull();
    expect(parseSqlConfig({ host: "h", database: "d" })).toBeNull();
    expect(parseSqlConfig({ driver: "oracle", host: "h", database: "d" })).toBeNull();
    expect(parseSqlConfig({ driver: "mysql", database: "d" })).toBeNull();
    expect(parseSqlConfig({ driver: "mysql", host: "h", database: "d", port: "3306", ssl: "yes" })).toEqual({
      driver: "mysql",
      host: "h",
      database: "d",
      port: undefined,
      user: undefined,
      password: undefined,
      ssl: false,
      schema: undefined,
    });
  });
});

describe("TLS", () => {
  it("checks the server's certificate when a MySQL connection asks for TLS", async () => {
    await testConnection({ driver: "mysql", host: "db.acme.corp", database: "hr", ssl: true });
    expect(seen.mysql[0].ssl).toEqual({ rejectUnauthorized: true });
  });

  it("checks the server's certificate when a PostgreSQL connection asks for TLS", async () => {
    const result = await testConnection({ driver: "postgresql", host: "db.acme.corp", database: "hr", ssl: true });
    expect(result.ok).toBe(true);
    expect(seen.pg[0].ssl).toEqual({ rejectUnauthorized: true });
  });

  it("uses no TLS when none is asked for", async () => {
    await testConnection({ driver: "mysql", host: "db.acme.corp", database: "hr" });
    expect(seen.mysql[0].ssl).toBeUndefined();
  });
});

describe("fetchRows", () => {
  it("keeps a table name to letters, digits and underscores, and passes limits as parameters", async () => {
    await fetchRows({ driver: "mysql", host: "h", database: "d" }, "users`; DROP TABLE x; --", 10, 20);
    expect(seen.queries[0].sql).toBe("SELECT * FROM `usersDROPTABLEx` LIMIT ? OFFSET ?");
    expect(seen.queries[0].params).toEqual([11, 20]);
  });

  it("does the same for a PostgreSQL schema and table", async () => {
    await fetchRows({ driver: "postgresql", host: "h", database: "d", schema: 'public"; --' }, 'a"b', 5, 0);
    expect(seen.queries[0].sql).toBe('SELECT * FROM "public"."ab" LIMIT $1 OFFSET $2');
    expect(seen.queries[0].params).toEqual([6, 0]);
  });
});

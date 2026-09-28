import mysql from "mysql2/promise";

/** Every database these tests make is named so, and they empty or drop no other. */
export const TEST_DATABASE_PREFIX = "ontos_test_";

/**
 * The server ONTOS_TEST_DATABASE_URL names, or null when it is unset. It must
 * name a server alone: a database in its path is refused rather than guessed
 * around, and its options (a query string) are kept.
 */
export function testServer(): URL | null {
  const raw = process.env.ONTOS_TEST_DATABASE_URL;
  if (!raw) return null;
  const url = new URL(raw);
  if (url.pathname && url.pathname !== "/") {
    throw new Error(`ONTOS_TEST_DATABASE_URL names a database (${url.pathname}): name the server alone, e.g. mysql://root:pw@127.0.0.1:3306`);
  }
  url.pathname = "";
  return url;
}

/** The URL of `database` on `server`, with the server's options. */
export function onDatabase(server: URL, database: string): string {
  const url = new URL(server);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * This run's database: made by globalSetup, dropped when the run ends. Each run
 * has its own, so two runs on one server (two worktrees, say) never drop or
 * empty each other's. vitest.mysql.config.ts names it once per run and hands
 * it on through ONTOS_TEST_DATABASE.
 */
export function testDatabase(): string {
  const name = process.env.ONTOS_TEST_DATABASE;
  if (!name || !name.startsWith(TEST_DATABASE_PREFIX) || !/^[a-z0-9_]{1,64}$/.test(name)) {
    throw new Error(`ONTOS_TEST_DATABASE must name this run's test database (${TEST_DATABASE_PREFIX}…): run these tests with npm run test:mysql`);
  }
  return name;
}

/**
 * Empties every table the migrations made, so each test starts from nothing.
 * It refuses any database but this run's: whatever DATABASE_URL names, a test
 * run never deletes anyone's data.
 */
export async function emptyDatabase(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: run these tests with npm run test:mysql");
  const conn = await mysql.createConnection(url);
  try {
    const [[{ name }]] = await conn.query<mysql.RowDataPacket[]>("select database() as name");
    if (name !== testDatabase()) throw new Error(`refusing to empty '${name}': these tests only ever empty this run's ${testDatabase()}`);
    const [tables] = await conn.query<mysql.RowDataPacket[]>(
      "select table_name as t from information_schema.tables where table_schema = database() and table_type = 'BASE TABLE' and table_name <> '__drizzle_migrations'",
    );
    // Foreign key checks are the session's: off on this connection only.
    await conn.query("set foreign_key_checks = 0");
    for (const { t } of tables) await conn.query(`delete from \`${t}\``);
    await conn.query("set foreign_key_checks = 1");
  } finally {
    await conn.end();
  }
}

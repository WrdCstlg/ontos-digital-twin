import mysql from "mysql2/promise";

/** The only database these tests will ever write to or empty. */
export const TEST_DATABASE = "ontos_test";

/**
 * Empties every table the migrations made, so each test starts from nothing.
 * It refuses any database but ontos_test: whatever DATABASE_URL names, a test
 * run never deletes anyone's data.
 */
export async function emptyDatabase(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: run these tests with npm run test:mysql");
  const conn = await mysql.createConnection(url);
  try {
    const [[{ name }]] = await conn.query<mysql.RowDataPacket[]>("select database() as name");
    if (name !== TEST_DATABASE) throw new Error(`refusing to empty '${name}': these tests only ever empty ${TEST_DATABASE}`);
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

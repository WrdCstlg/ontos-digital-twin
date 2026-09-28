import path from "node:path";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { TEST_DATABASE } from "./database";

/**
 * Creates ontos_test afresh on the server ONTOS_TEST_DATABASE_URL names and
 * applies every migration, as db/bootstrap.ts does; drops it afterwards.
 */
export default async function setup() {
  const server = process.env.ONTOS_TEST_DATABASE_URL?.replace(/\/$/, "");
  if (!server) {
    throw new Error(
      `ONTOS_TEST_DATABASE_URL is not set: these tests need a MySQL 8.4 server on which they may create and drop the database ${TEST_DATABASE}, e.g. mysql://root:pw@127.0.0.1:3306`,
    );
  }
  const admin = await connectWhenReady(server);
  await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DATABASE}\``);
  await admin.query(`CREATE DATABASE \`${TEST_DATABASE}\``);
  await admin.end();

  const conn = await mysql.createConnection(`${server}/${TEST_DATABASE}`);
  await migrate(drizzle(conn), { migrationsFolder: path.resolve(import.meta.dirname, "../../../db/migrations") });
  await conn.end();

  return async () => {
    const c = await mysql.createConnection(server);
    await c.query(`DROP DATABASE IF EXISTS \`${TEST_DATABASE}\``);
    await c.end();
  };
}

/** A server that has just started may refuse connections for a while: try for a minute. */
async function connectWhenReady(url: string): Promise<mysql.Connection> {
  let last: unknown;
  for (let i = 0; i < 60; i++) {
    try {
      const c = await mysql.createConnection(url);
      await c.query("SELECT 1");
      return c;
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`MySQL at ONTOS_TEST_DATABASE_URL did not answer within a minute: ${last instanceof Error ? last.message : String(last)}`);
}

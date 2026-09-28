import path from "node:path";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { onDatabase, testDatabase, testServer } from "./database";

/**
 * Creates this run's database on the server ONTOS_TEST_DATABASE_URL names and
 * applies every migration, as db/bootstrap.ts does; drops it when the run ends.
 * A run killed before then leaves its ontos_test_… database behind, to drop by
 * hand.
 *
 * ONTOS_TEST_SESSION_TIME_ZONE (e.g. +05:00), when set, is the time zone the
 * server's sessions are meant to run in, off UTC, so that a time taken from the
 * app's clock where the queue should take the database's shows. Setup checks
 * it and changes nothing: the server is started in that zone (CI's MySQL
 * service runs with TZ=PKT-5), never switched to it, which would switch every
 * other client of the server too.
 */
export default async function setup() {
  const server = testServer();
  if (!server) {
    throw new Error(
      "ONTOS_TEST_DATABASE_URL is not set: these tests need a MySQL 8.4 server on which they may create and drop databases named ontos_test_…, e.g. mysql://root:pw@127.0.0.1:3306",
    );
  }
  const database = testDatabase();
  const admin = await connectWhenReady(server.toString());
  try {
    const zone = process.env.ONTOS_TEST_SESSION_TIME_ZONE;
    if (zone) await expectSessionsIn(server.toString(), zone);
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.query(`CREATE DATABASE \`${database}\``);
    const conn = await mysql.createConnection(onDatabase(server, database));
    try {
      await migrate(drizzle(conn), { migrationsFolder: path.resolve(import.meta.dirname, "../../../db/migrations") });
    } finally {
      await conn.end();
    }
  } catch (err) {
    await dropDatabase(admin, database);
    throw err;
  }
  await admin.end();

  return async () => dropDatabase(await mysql.createConnection(server.toString()), database);
}

async function dropDatabase(conn: mysql.Connection, database: string) {
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${database}\``);
  } finally {
    await conn.end();
  }
}

/** A new session starts in `zone` (±HH:MM): its offset from UTC is that zone's. */
async function expectSessionsIn(url: string, zone: string) {
  const offset = /^([+-])(\d{2}):(\d{2})$/.exec(zone);
  if (!offset) throw new Error(`ONTOS_TEST_SESSION_TIME_ZONE must be an offset such as +05:00, not '${zone}'`);
  const expected = (offset[1] === "-" ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3]));
  const probe = await mysql.createConnection(url);
  try {
    const [[{ minutes }]] = await probe.query<mysql.RowDataPacket[]>("select timestampdiff(minute, utc_timestamp(), now()) as minutes");
    if (Number(minutes) !== expected) {
      throw new Error(`the server's sessions are ${minutes} minutes from UTC, not ${expected} (${zone}): start it in that zone (e.g. TZ=PKT-5 for +05:00)`);
    }
  } finally {
    await probe.end();
  }
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

import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { env } from "../lib/env";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

type AppDatabase = MySql2Database<typeof fullSchema>;

let instance: AppDatabase | undefined;
let pool: mysql.Pool | undefined;

export function getDb(): AppDatabase {
  if (!instance) {
    pool = mysql.createPool({
      uri: env.databaseUrl,
      waitForConnections: true,
      connectionLimit: 20,
      queueLimit: 0,
      idleTimeout: 60000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
    });
    instance = drizzle(pool, {
      schema: fullSchema,
      mode: "default",
    });
  }
  return instance;
}

/**
 * A connection of the pool's for the caller alone, for what must stay on one
 * session (a named lock). Release it, or destroy it if it may be broken.
 */
export async function getPoolConnection(): Promise<mysql.PoolConnection> {
  getDb();
  return pool!.getConnection();
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
    instance = undefined;
  }
}

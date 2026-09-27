/**
 * SQL Connector Service — connects to external PostgreSQL and MySQL databases.
 *
 * Provides three capabilities:
 *   1. testConnection  — validates credentials and connectivity
 *   2. discoverSchema  — lists tables and their columns (for the mapping editor)
 *   3. fetchRows       — pulls rows from a table (for the sync pipeline)
 *
 * Each call opens a short-lived connection pool, uses it, then tears it down.
 * The connector's configJson carries the connection parameters, its password
 * sealed (lib/secretBox.ts): it is opened here, only to connect.
 */

import mysql from "mysql2/promise";
import { connectorEndpoint, readSecret, secretContext } from "../lib/secretBox";

/* ── types ────────────────────────────────────────────────────── */

export type SqlDriver = "postgresql" | "mysql" | "sqlserver";

export interface SqlConnectorConfig {
  driver: SqlDriver;
  host: string;
  port?: number;
  database: string;
  user?: string;
  password?: string;
  ssl?: boolean;
  /** Optional: restrict to a named schema (Postgres). Defaults to "public". */
  schema?: string;
}

export interface SqlTableInfo {
  name: string;
  schema: string;
  rowCountEstimate: number | null;
}

export interface SqlColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
}

export interface SqlTestResult {
  ok: boolean;
  serverVersion: string | null;
  error: string | null;
  latencyMs: number;
}

export interface SqlFetchResult {
  columns: string[];
  rows: Record<string, unknown>[];
  totalFetched: number;
  truncated: boolean;
}

/* ── helpers ──────────────────────────────────────────────────── */

function defaultPort(driver: SqlDriver): number {
  switch (driver) {
    case "postgresql": return 5432;
    case "mysql": return 3306;
    case "sqlserver": return 1433;
  }
}

/**
 * Parse a stored connector's configJson into typed SqlConnectorConfig, its
 * password opened for use. Returns null if the config is missing required
 * fields; throws SecretUnreadableError if the password cannot be opened.
 */
export function parseSqlConfig(raw: unknown, workspaceId: number): SqlConnectorConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const cfg = raw as Record<string, unknown>;
  const driver = cfg.driver as string | undefined;
  const host = cfg.host as string | undefined;
  const database = cfg.database as string | undefined;
  if (!driver || !host || !database) return null;
  if (!["postgresql", "mysql", "sqlserver"].includes(driver)) return null;
  return {
    driver: driver as SqlDriver,
    host,
    port: typeof cfg.port === "number" ? cfg.port : undefined,
    database,
    user: typeof cfg.user === "string" ? cfg.user : undefined,
    // Bound to where it is sent: a row whose host was changed opens nothing.
    password: readSecret(cfg.password, secretContext.connector(workspaceId, "password", connectorEndpoint(cfg))),
    ssl: cfg.ssl === true,
    schema: typeof cfg.schema === "string" ? cfg.schema : undefined,
  };
}

/** What to tell someone whose connector's stored password this server cannot open. */
export function unreadablePasswordMessage(err: Error): string {
  return `The connector's stored password cannot be read: ${err.message}. A workspace admin can enter it again (Mapping, the connector, Update password).`;
}

/**
 * TLS when the connector asks for it, always checking the server's certificate
 * against the system's trusted authorities: an unchecked certificate would let
 * anyone on the path read the credentials and the rows.
 */
function tls(cfg: SqlConnectorConfig): { rejectUnauthorized: true } | undefined {
  return cfg.ssl ? { rejectUnauthorized: true } : undefined;
}

/* ── MySQL adapter ───────────────────────────────────────────── */

async function mysqlPool(cfg: SqlConnectorConfig): Promise<mysql.Pool> {
  return mysql.createPool({
    host: cfg.host,
    port: cfg.port ?? defaultPort("mysql"),
    database: cfg.database,
    user: cfg.user ?? "root",
    password: cfg.password ?? "",
    ssl: tls(cfg),
    waitForConnections: true,
    connectionLimit: 2,
    connectTimeout: 8_000,
  });
}

async function testMysql(cfg: SqlConnectorConfig): Promise<SqlTestResult> {
  const start = performance.now();
  let pool: mysql.Pool | null = null;
  try {
    pool = await mysqlPool(cfg);
    const [rows] = await pool.query("SELECT VERSION() AS v");
    const version = (rows as { v: string }[])[0]?.v ?? null;
    return {
      ok: true,
      serverVersion: version ? `MySQL ${version}` : "MySQL",
      error: null,
      latencyMs: Math.round(performance.now() - start),
    };
  } catch (err) {
    return {
      ok: false,
      serverVersion: null,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Math.round(performance.now() - start),
    };
  } finally {
    await pool?.end();
  }
}

async function discoverMysqlTables(cfg: SqlConnectorConfig): Promise<SqlTableInfo[]> {
  let pool: mysql.Pool | null = null;
  try {
    pool = await mysqlPool(cfg);
    const [rows] = await pool.query(
      `SELECT TABLE_NAME AS name, TABLE_SCHEMA AS \`schema\`, TABLE_ROWS AS rowCountEstimate
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`,
      [cfg.database],
    );
    return (rows as SqlTableInfo[]).map((r) => ({
      name: r.name,
      schema: r.schema,
      rowCountEstimate: r.rowCountEstimate != null ? Number(r.rowCountEstimate) : null,
    }));
  } finally {
    await pool?.end();
  }
}

async function discoverMysqlColumns(cfg: SqlConnectorConfig, table: string): Promise<SqlColumnInfo[]> {
  let pool: mysql.Pool | null = null;
  try {
    pool = await mysqlPool(cfg);
    const [rows] = await pool.query(
      `SELECT COLUMN_NAME AS name, DATA_TYPE AS dataType,
              IS_NULLABLE = 'YES' AS nullable,
              COLUMN_KEY = 'PRI' AS isPrimaryKey
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [cfg.database, table],
    );
    return (rows as SqlColumnInfo[]).map((r) => ({
      name: r.name,
      dataType: r.dataType,
      nullable: !!r.nullable,
      isPrimaryKey: !!r.isPrimaryKey,
    }));
  } finally {
    await pool?.end();
  }
}

async function fetchMysqlRows(
  cfg: SqlConnectorConfig,
  table: string,
  limit: number,
  offset: number,
): Promise<SqlFetchResult> {
  let pool: mysql.Pool | null = null;
  try {
    pool = await mysqlPool(cfg);
    // Sanitize table name — only allow alphanumeric + underscores
    const safeTable = table.replace(/[^a-zA-Z0-9_]/g, "");
    const [rows] = await pool.query(
      `SELECT * FROM \`${safeTable}\` LIMIT ? OFFSET ?`,
      [limit + 1, offset],
    );
    const arr = rows as Record<string, unknown>[];
    const truncated = arr.length > limit;
    const data = truncated ? arr.slice(0, limit) : arr;
    const columns = data.length > 0 ? Object.keys(data[0]) : [];
    return { columns, rows: data, totalFetched: data.length, truncated };
  } finally {
    await pool?.end();
  }
}

/* ── PostgreSQL adapter ──────────────────────────────────────── */
// For the demo/evaluation build we implement Postgres support using a dynamic
// import of the `pg` package. If `pg` is not installed, the adapter falls back
// to a clear error message guiding the user to install it.

let pgAvailable: boolean | null = null;

async function getPg(): Promise<typeof import("pg")> {
  if (pgAvailable === false) {
    throw new Error("PostgreSQL driver not available — install the 'pg' package: npm i pg @types/pg");
  }
  try {
    const mod = await import("pg");
    pgAvailable = true;
    return mod;
  } catch {
    pgAvailable = false;
    throw new Error("PostgreSQL driver not available — install the 'pg' package: npm i pg @types/pg");
  }
}

async function testPostgres(cfg: SqlConnectorConfig): Promise<SqlTestResult> {
  const start = performance.now();
  try {
    const { Pool } = await getPg();
    const pool = new Pool({
      host: cfg.host,
      port: cfg.port ?? defaultPort("postgresql"),
      database: cfg.database,
      user: cfg.user ?? "postgres",
      password: cfg.password ?? "",
      ssl: tls(cfg),
      max: 1,
      connectionTimeoutMillis: 8_000,
    });
    try {
      const res = await pool.query("SELECT version() AS v");
      const version = res.rows[0]?.v ?? null;
      return {
        ok: true,
        serverVersion: version ? String(version).split(",")[0] : "PostgreSQL",
        error: null,
        latencyMs: Math.round(performance.now() - start),
      };
    } finally {
      await pool.end();
    }
  } catch (err) {
    return {
      ok: false,
      serverVersion: null,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Math.round(performance.now() - start),
    };
  }
}

async function discoverPostgresTables(cfg: SqlConnectorConfig): Promise<SqlTableInfo[]> {
  const { Pool } = await getPg();
  const pool = new Pool({
    host: cfg.host,
    port: cfg.port ?? defaultPort("postgresql"),
    database: cfg.database,
    user: cfg.user ?? "postgres",
    password: cfg.password ?? "",
    ssl: tls(cfg),
    max: 1,
    connectionTimeoutMillis: 8_000,
  });
  try {
    const schema = cfg.schema ?? "public";
    const res = await pool.query(
      `SELECT c.relname AS name,
              n.nspname AS schema,
              c.reltuples::bigint AS "rowCountEstimate"
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relkind = 'r'
       ORDER BY c.relname`,
      [schema],
    );
    return res.rows.map((r: Record<string, unknown>) => ({
      name: String(r.name),
      schema: String(r.schema),
      rowCountEstimate: r.rowCountEstimate != null ? Number(r.rowCountEstimate) : null,
    }));
  } finally {
    await pool.end();
  }
}

async function discoverPostgresColumns(cfg: SqlConnectorConfig, table: string): Promise<SqlColumnInfo[]> {
  const { Pool } = await getPg();
  const pool = new Pool({
    host: cfg.host,
    port: cfg.port ?? defaultPort("postgresql"),
    database: cfg.database,
    user: cfg.user ?? "postgres",
    password: cfg.password ?? "",
    ssl: tls(cfg),
    max: 1,
    connectionTimeoutMillis: 8_000,
  });
  try {
    const schema = cfg.schema ?? "public";
    const res = await pool.query(
      `SELECT c.column_name AS name,
              c.data_type AS "dataType",
              c.is_nullable = 'YES' AS nullable,
              COALESCE(tc.constraint_type = 'PRIMARY KEY', false) AS "isPrimaryKey"
       FROM information_schema.columns c
       LEFT JOIN information_schema.key_column_usage kcu
         ON kcu.table_schema = c.table_schema
         AND kcu.table_name = c.table_name
         AND kcu.column_name = c.column_name
       LEFT JOIN information_schema.table_constraints tc
         ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
         AND tc.constraint_type = 'PRIMARY KEY'
       WHERE c.table_schema = $1 AND c.table_name = $2
       ORDER BY c.ordinal_position`,
      [schema, table],
    );
    return res.rows.map((r: Record<string, unknown>) => ({
      name: String(r.name),
      dataType: String(r.dataType),
      nullable: !!r.nullable,
      isPrimaryKey: !!r.isPrimaryKey,
    }));
  } finally {
    await pool.end();
  }
}

async function fetchPostgresRows(
  cfg: SqlConnectorConfig,
  table: string,
  limit: number,
  offset: number,
): Promise<SqlFetchResult> {
  const { Pool } = await getPg();
  const pool = new Pool({
    host: cfg.host,
    port: cfg.port ?? defaultPort("postgresql"),
    database: cfg.database,
    user: cfg.user ?? "postgres",
    password: cfg.password ?? "",
    ssl: tls(cfg),
    max: 1,
    connectionTimeoutMillis: 8_000,
  });
  try {
    const schema = cfg.schema ?? "public";
    // Sanitize table/schema names
    const safeSchema = schema.replace(/[^a-zA-Z0-9_]/g, "");
    const safeTable = table.replace(/[^a-zA-Z0-9_]/g, "");
    const res = await pool.query(
      `SELECT * FROM "${safeSchema}"."${safeTable}" LIMIT $1 OFFSET $2`,
      [limit + 1, offset],
    );
    const truncated = res.rows.length > limit;
    const data = truncated ? res.rows.slice(0, limit) : res.rows;
    const columns = data.length > 0 ? Object.keys(data[0]) : (res.fields?.map((f) => f.name) ?? []);
    return { columns, rows: data, totalFetched: data.length, truncated };
  } finally {
    await pool.end();
  }
}

/* ── unified dispatcher ──────────────────────────────────────── */

export async function testConnection(cfg: SqlConnectorConfig): Promise<SqlTestResult> {
  switch (cfg.driver) {
    case "mysql": return testMysql(cfg);
    case "postgresql": return testPostgres(cfg);
    case "sqlserver":
      return {
        ok: false,
        serverVersion: null,
        error: "SQL Server driver not yet implemented — PostgreSQL and MySQL are available",
        latencyMs: 0,
      };
  }
}

export async function listTables(cfg: SqlConnectorConfig): Promise<SqlTableInfo[]> {
  switch (cfg.driver) {
    case "mysql": return discoverMysqlTables(cfg);
    case "postgresql": return discoverPostgresTables(cfg);
    case "sqlserver": throw new Error("SQL Server not yet implemented");
  }
}

export async function listColumns(cfg: SqlConnectorConfig, table: string): Promise<SqlColumnInfo[]> {
  switch (cfg.driver) {
    case "mysql": return discoverMysqlColumns(cfg, table);
    case "postgresql": return discoverPostgresColumns(cfg, table);
    case "sqlserver": throw new Error("SQL Server not yet implemented");
  }
}

export async function fetchRows(
  cfg: SqlConnectorConfig,
  table: string,
  limit = 1000,
  offset = 0,
): Promise<SqlFetchResult> {
  switch (cfg.driver) {
    case "mysql": return fetchMysqlRows(cfg, table, limit, offset);
    case "postgresql": return fetchPostgresRows(cfg, table, limit, offset);
    case "sqlserver": throw new Error("SQL Server not yet implemented");
  }
}

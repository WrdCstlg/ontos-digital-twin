/**
 * An in-memory stand-in for the database, for tests that check what a
 * procedure reads and writes rather than the shape of its queries: rows live
 * in tables by name, and each query's WHERE is rendered through drizzle's MySQL
 * dialect and evaluated against them. It understands conjunctions of
 * `col = ?`, `col = other_col`, `col in (...)` and `col is [not] null`, inner
 * joins on an equality, projections to tables or columns, ordering by columns,
 * limit and offset; anything else throws, so a test never passes on a
 * predicate or ordering it ignored. As in SQL, an update or delete without a
 * WHERE touches every row: a test that holds two workspaces sees a missing
 * scope as the damage it would do. Ordering follows MySQL's for NULLs (first
 * when ascending) but compares strings by code unit, not by a collation.
 *
 * A transaction runs its body against the same tables and, if the body
 * throws, puts them back as they were. There is no isolation and no lock: a
 * locking read (`.for("update")`) reads as any other. An update that sets a
 * column to itself plus a number (`col = col + 1`) is evaluated; any other SQL
 * value it sets (`now()`) is stored as given, unevaluated.
 *
 * Use it from vi.mock:
 *   const store = vi.hoisted(() => ({ tables: new Map<string, Row[]>() }));
 *   vi.mock("../queries/connection", async () => ({
 *     getDb: (await import("./memoryDb")).memoryDbFor(store.tables),
 *   }));
 */
import { Column, getTableName, is, SQL, Table } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";

export type Row = Record<string, unknown>;
type Tables = Map<string, Row[]>;
/** The rows a query sees: each table's current row, by table name. */
type Scope = Record<string, Row>;

const dialect = new MySqlDialect();

/** Top-level AND terms of a rendered predicate, each with its own params. */
function conjuncts(sql: string, params: unknown[]): { sql: string; params: unknown[] }[] {
  let s = sql.trim();
  while (s.startsWith("(") && closingParen(s, 0) === s.length - 1) s = s.slice(1, -1).trim();
  const out: { sql: string; params: unknown[] }[] = [];
  let depth = 0;
  let start = 0;
  let p = 0;
  let pStart = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === "?") p++;
    else if (depth === 0 && s.startsWith(" and ", i)) {
      out.push({ sql: s.slice(start, i).trim(), params: params.slice(pStart, p) });
      start = i + 5;
      pStart = p;
      i += 4;
    }
  }
  out.push({ sql: s.slice(start).trim(), params: params.slice(pStart, p) });
  return out.flatMap((c) => (c.sql.startsWith("(") && closingParen(c.sql, 0) === c.sql.length - 1 ? conjuncts(c.sql, c.params) : [c]));
}

function closingParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

const COL = "`([\\w]+)`\\.`([\\w]+)`";
const same = (a: unknown, b: unknown) => a !== undefined && a !== null && b !== undefined && b !== null && String(a) === String(b);

function holds(term: { sql: string; params: unknown[] }, scope: Scope): boolean {
  const value = (t: string, c: string) => {
    if (!(t in scope)) throw new Error(`memoryDb: predicate names table ${t}, not in this query: ${term.sql}`);
    return scope[t][c];
  };
  let m = new RegExp(`^${COL} = \\?$`).exec(term.sql);
  if (m) return same(value(m[1], m[2]), term.params[0]);
  m = new RegExp(`^${COL} = ${COL}$`).exec(term.sql);
  if (m) return same(value(m[1], m[2]), value(m[3], m[4]));
  m = new RegExp(`^${COL} in \\(([?, ]+)\\)$`).exec(term.sql);
  if (m) return term.params.some((p) => same(value(m![1], m![2]), p));
  m = new RegExp(`^${COL} is (not )?null$`).exec(term.sql);
  if (m) return (value(m[1], m[2]) === null || value(m[1], m[2]) === undefined) !== Boolean(m[3]);
  throw new Error(`memoryDb: unsupported predicate: ${term.sql}`);
}

function matches(where: unknown, scope: Scope): boolean {
  if (where === undefined) return true;
  if (!is(where, SQL)) throw new Error("memoryDb: WHERE must be a drizzle SQL expression");
  const { sql, params } = dialect.sqlToQuery(where);
  return conjuncts(sql, params).every((t) => holds(t, scope));
}

/** One ORDER BY term: a column, bare or through asc() or desc(). */
function orderTerm(spec: unknown): { table: string; column: string; desc: boolean } {
  if (is(spec, Column)) return { table: getTableName(spec.table), column: spec.name, desc: false };
  if (is(spec, SQL)) {
    const m = new RegExp(`^${COL}(?: (asc|desc))?$`).exec(dialect.sqlToQuery(spec).sql.trim());
    if (m) return { table: m[1], column: m[2], desc: m[3] === "desc" };
  }
  throw new Error("memoryDb: unsupported ORDER BY term");
}

/** MySQL's order for the values tests hold: NULL lowest, then numbers and dates by value, strings by code unit. */
function compareValues(a: unknown, b: unknown): number {
  const nil = (v: unknown) => v === null || v === undefined;
  if (nil(a) || nil(b)) return nil(a) === nil(b) ? 0 : nil(a) ? -1 : 1;
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  if (typeof x === "number" && typeof y === "number") return x - y;
  const [s, t] = [String(x), String(y)];
  return s < t ? -1 : s > t ? 1 : 0;
}

function sortScopes(scopes: Scope[], order: unknown[]): Scope[] {
  const terms = order.map(orderTerm);
  const value = (s: Scope, t: { table: string; column: string }) => {
    if (!(t.table in s)) throw new Error(`memoryDb: ORDER BY names table ${t.table}, not in this query`);
    return s[t.table][t.column];
  };
  return [...scopes].sort((p, q) => {
    for (const t of terms) {
      const c = compareValues(value(p, t), value(q, t));
      if (c !== 0) return t.desc ? -c : c;
    }
    return 0;
  });
}

/** A selected `count(*)`: the whole query answers one row of counts. */
const isCount = (f: unknown) => is(f, SQL) && dialect.sqlToQuery(f).sql.trim().toLowerCase() === "count(*)";

function project(fields: Record<string, unknown> | undefined, scope: Scope, base: string, joined: boolean): Row {
  if (!fields) return joined ? { ...scope } : scope[base];
  const out: Row = {};
  for (const [alias, f] of Object.entries(fields)) {
    if (is(f, Table)) out[alias] = scope[getTableName(f)];
    else if (is(f, Column)) out[alias] = scope[getTableName(f.table)]?.[f.name];
    else throw new Error(`memoryDb: unsupported selected field ${alias}`);
  }
  return out;
}

/** A query that runs when awaited, with the chain methods the app uses. */
function awaitable<T>(run: () => T, extra: Record<string, unknown> = {}) {
  const q: Record<string, unknown> = {
    ...extra,
    then: (ok?: (v: T) => unknown, fail?: (e: unknown) => unknown) => {
      try {
        return Promise.resolve(run()).then(ok, fail);
      } catch (err) {
        return Promise.reject(err).then(ok, fail);
      }
    },
    catch: (fail: (e: unknown) => unknown) => (q.then as (a: undefined, b: typeof fail) => Promise<unknown>)(undefined, fail),
  };
  return q;
}

/** An update's values for one row: `col + n`, a column of the row's own, evaluated; the rest as given. */
function evaluatePatch(patch: Row, row: Row, table: string): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(patch)) {
    out[key] = value;
    if (!is(value, SQL)) continue;
    const { sql, params } = dialect.sqlToQuery(value);
    const m = new RegExp(`^${COL} \\+ (\\?|\\d+)$`).exec(sql.trim());
    if (m && m[1] === table) out[key] = Number(row[m[2]] ?? 0) + Number(m[3] === "?" ? params[0] : m[3]);
  }
  return out;
}

export function memoryDb(tables: Tables) {
  const rowsOf = (t: Table) => {
    const name = getTableName(t);
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };
  const db = {
    select(fields?: Record<string, unknown>) {
      return {
        from(base: Table) {
          const baseName = getTableName(base);
          const joins: { table: Table; on: unknown }[] = [];
          let where: unknown;
          let order: unknown[] = [];
          let limit = Infinity;
          let offset = 0;
          const run = () => {
            let scopes: Scope[] = rowsOf(base).map((r) => ({ [baseName]: r }));
            for (const j of joins) {
              const name = getTableName(j.table);
              scopes = scopes.flatMap((s) => rowsOf(j.table).map((r) => ({ ...s, [name]: r })).filter((s2) => matches(j.on, s2)));
            }
            const hits = sortScopes(scopes.filter((s) => matches(where, s)), order);
            if (fields && Object.values(fields).some(isCount)) {
              if (!Object.values(fields).every(isCount)) throw new Error("memoryDb: count(*) beside other fields needs groupBy, unsupported");
              return [Object.fromEntries(Object.keys(fields).map((k) => [k, hits.length]))];
            }
            return hits.slice(offset, offset + limit).map((s) => project(fields, s, baseName, joins.length > 0));
          };
          const chain: Record<string, unknown> = awaitable(run);
          Object.assign(chain, {
            innerJoin: (table: Table, on: unknown) => (joins.push({ table, on }), chain),
            where: (w: unknown) => ((where = w), chain),
            orderBy: (...terms: unknown[]) => ((order = terms), chain),
            groupBy: () => {
              throw new Error("memoryDb: GROUP BY is unsupported");
            },
            limit: (n: number) => ((limit = n), chain),
            offset: (n: number) => ((offset = n), chain),
            // No locks in memory: a locking read reads.
            for: () => chain,
          });
          return chain;
        },
      };
    },
    insert(t: Table) {
      return {
        values(v: Row | Row[]) {
          const rows = rowsOf(t);
          const added = (Array.isArray(v) ? v : [v]).map((r) => {
            const id = Math.max(0, ...rows.map((x) => Number(x.id) || 0)) + 1;
            const row = { id, ...r };
            rows.push(row);
            return row;
          });
          const result = () => [{ insertId: added[0]?.id, affectedRows: added.length }];
          return awaitable(result, {
            $returningId: () => Promise.resolve(added.map((r) => ({ id: r.id }))),
            // Rows are added as given: it does not detect duplicates, so a test
            // that relies on an upsert updating a row must not start with one.
            onDuplicateKeyUpdate: () => awaitable(result),
          });
        },
      };
    },
    update(t: Table) {
      return {
        set(patch: Row) {
          let where: unknown;
          const chain: Record<string, unknown> = awaitable(() => {
            const name = getTableName(t);
            const hit = rowsOf(t).filter((r) => matches(where, { [name]: r }));
            for (const r of hit) Object.assign(r, evaluatePatch(patch, r, name));
            return [{ affectedRows: hit.length }];
          });
          chain.where = (w: unknown) => ((where = w), chain);
          return chain;
        },
      };
    },
    delete(t: Table) {
      let where: unknown;
      const chain: Record<string, unknown> = awaitable(() => {
        const name = getTableName(t);
        const rows = rowsOf(t);
        const keep = rows.filter((r) => !matches(where, { [name]: r }));
        const removed = rows.length - keep.length;
        rows.splice(0, rows.length, ...keep);
        return [{ affectedRows: removed }];
      });
      chain.where = (w: unknown) => ((where = w), chain);
      return chain;
    },
  };
  return Object.assign(db, {
    /**
     * Runs `body` against these tables, as a real transaction would: if it
     * throws, they are put back as they were. Nothing here takes a row's
     * lock, so two calls racing each other are not what a real transaction
     * guarantees; those run on a real MySQL (__tests__/mysql).
     */
    async transaction<T>(body: (tx: typeof db) => Promise<T>): Promise<T> {
      const saved = [...tables].map(([name, rows]) => [name, rows.map((r) => ({ ...r }))] as const);
      try {
        return await body(db);
      } catch (err) {
        tables.clear();
        for (const [name, rows] of saved) tables.set(name, rows);
        throw err;
      }
    },
  });
}

/** For vi.mock: a getDb that serves `tables`. */
export const memoryDbFor = (tables: Tables) => () => memoryDb(tables);

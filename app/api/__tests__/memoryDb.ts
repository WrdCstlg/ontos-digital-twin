/**
 * An in-memory stand-in for the database, for tests that check what a
 * procedure reads and writes rather than the shape of its queries: rows live
 * in tables by name, and each query's WHERE is rendered through drizzle's MySQL
 * dialect and evaluated against them. It understands conjunctions of
 * `col = ?`, `col = other_col`, `col in (...)` and `col is [not] null`, inner
 * joins on an equality, projections to tables or columns, limit and offset;
 * anything else throws, so a test never passes on a predicate it ignored.
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

export function memoryDb(tables: Tables) {
  const rowsOf = (t: Table) => {
    const name = getTableName(t);
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };
  return {
    select(fields?: Record<string, unknown>) {
      return {
        from(base: Table) {
          const baseName = getTableName(base);
          const joins: { table: Table; on: unknown }[] = [];
          let where: unknown;
          let limit = Infinity;
          let offset = 0;
          const run = () => {
            let scopes: Scope[] = rowsOf(base).map((r) => ({ [baseName]: r }));
            for (const j of joins) {
              const name = getTableName(j.table);
              scopes = scopes.flatMap((s) => rowsOf(j.table).map((r) => ({ ...s, [name]: r })).filter((s2) => matches(j.on, s2)));
            }
            const hits = scopes.filter((s) => matches(where, s));
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
            orderBy: () => chain,
            groupBy: () => chain,
            limit: (n: number) => ((limit = n), chain),
            offset: (n: number) => ((offset = n), chain),
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
          return awaitable(() => [{ insertId: added[0]?.id, affectedRows: added.length }], {
            $returningId: () => Promise.resolve(added.map((r) => ({ id: r.id }))),
          });
        },
      };
    },
    update(t: Table) {
      return {
        set(patch: Row) {
          return {
            where(w: unknown) {
              return awaitable(() => {
                const name = getTableName(t);
                const hit = rowsOf(t).filter((r) => matches(w, { [name]: r }));
                for (const r of hit) Object.assign(r, patch);
                return [{ affectedRows: hit.length }];
              });
            },
          };
        },
      };
    },
    delete(t: Table) {
      return {
        where(w: unknown) {
          return awaitable(() => {
            const name = getTableName(t);
            const rows = rowsOf(t);
            const keep = rows.filter((r) => !matches(w, { [name]: r }));
            const removed = rows.length - keep.length;
            rows.splice(0, rows.length, ...keep);
            return [{ affectedRows: removed }];
          });
        },
      };
    },
  };
}

/** For vi.mock: a getDb that serves `tables`. */
export const memoryDbFor = (tables: Tables) => () => memoryDb(tables);

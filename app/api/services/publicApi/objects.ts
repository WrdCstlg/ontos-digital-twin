import { and, asc, eq, gt, inArray, isNull, like, or, sql, type SQL } from "drizzle-orm";
import { kgEdges, kgNodes, type KgNode } from "@db/schema";
import { getDb } from "../../queries/connection";
import { classWithDescendants } from "../actions/definitions";
import { apiProperties, localName, namespacesOf, type ObjectTypeModel, type OntologyModel } from "./model";

/** Objects as the public API returns them. */

export type ApiObject = {
  iri: string;
  objectType: string;
  label: string;
  properties: Record<string, unknown>;
  /** Outgoing links by the predicate's local name: the IRIs they point to. */
  links: Record<string, string[]>;
  source: { mappingId: number | null; submissionId: number | null };
  createdAt: string;
  updatedAt: string;
};

export const MAX_PAGE = 200;
const FILTER_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

async function linksOf(workspaceId: number, nodeIds: number[]): Promise<Map<number, Record<string, string[]>>> {
  const out = new Map<number, Record<string, string[]>>();
  if (nodeIds.length === 0) return out;
  const db = getDb();
  const edges = await db
    .select({ from: kgEdges.fromNodeId, to: kgEdges.toNodeId, predicate: kgEdges.predicateIri })
    .from(kgEdges)
    .where(and(eq(kgEdges.workspaceId, workspaceId), inArray(kgEdges.fromNodeId, nodeIds), isNull(kgEdges.deletedAt)));
  const targetIds = [...new Set(edges.map((e) => e.to))];
  const targets = targetIds.length
    ? await db.select({ id: kgNodes.id, iri: kgNodes.iri }).from(kgNodes).where(and(inArray(kgNodes.id, targetIds), isNull(kgNodes.deletedAt)))
    : [];
  const iriById = new Map(targets.map((t) => [t.id, t.iri]));
  for (const e of edges) {
    const to = iriById.get(e.to);
    if (!to) continue;
    const links = out.get(e.from) ?? {};
    const key = localName(e.predicate);
    (links[key] ??= []).push(to);
    out.set(e.from, links);
  }
  for (const links of out.values()) for (const k of Object.keys(links)) links[k].sort();
  return out;
}

/**
 * Gives declared properties their declared types where the stored value
 * allows it: imports store "536000" and "true" as text. A value that does not
 * convert is returned as stored.
 */
export function coerceDeclared(props: Record<string, unknown>, type: ObjectTypeModel | undefined): Record<string, unknown> {
  if (!type) return props;
  const out = { ...props };
  for (const p of type.properties) {
    const v = out[p.key];
    if (typeof v !== "string") continue;
    if ((p.type === "number" || p.type === "integer") && v.trim() !== "" && Number.isFinite(Number(v))) {
      const n = Number(v);
      if (p.type === "number" || Number.isInteger(n)) out[p.key] = n;
    } else if (p.type === "boolean" && (v === "true" || v === "false")) {
      out[p.key] = v === "true";
    }
  }
  return out;
}

function toApiObject(model: OntologyModel, n: KgNode, links: Record<string, string[]> | undefined): ApiObject {
  const type = model.objectTypes.find((t) => t.iri === n.classIri);
  return {
    iri: n.iri,
    objectType: n.classIri,
    label: n.label,
    properties: coerceDeclared(apiProperties((n.propsJson as Record<string, unknown> | null) ?? {}, namespacesOf(model, n.moduleKey)), type),
    links: links ?? {},
    source: { mappingId: n.sourceMappingId, submissionId: n.sourceSubmissionId },
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}

export class BadQuery extends Error {}

export type ListQuery = {
  limit: number;
  /** The last id of the previous page. */
  cursor: number | null;
  q: string | null;
  /** Equality on properties, by API name. */
  filters: Record<string, string>;
};

/** Objects of a type and its subtypes, in id order, a page at a time. */
export async function listObjects(
  model: OntologyModel,
  type: ObjectTypeModel,
  query: ListQuery,
): Promise<{ data: ApiObject[]; nextCursor: string | null }> {
  const ws = model.workspace.id;
  const conds: SQL[] = [
    eq(kgNodes.workspaceId, ws),
    isNull(kgNodes.deletedAt),
    inArray(kgNodes.classIri, await classWithDescendants(ws, type.iri)),
  ];
  if (query.cursor != null) conds.push(gt(kgNodes.id, query.cursor));
  if (query.q) {
    const pattern = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(or(like(kgNodes.label, pattern), like(kgNodes.iri, pattern)) as SQL);
  }
  for (const [key, value] of Object.entries(query.filters)) {
    if (!FILTER_KEY.test(key)) throw new BadQuery(`"${key}" is not a property name`);
    // A property may be stored under its short name or prefixed with the object's module.
    const candidates = [key, `${type.prefix}:${key}`, `${type.module.key}:${key}`];
    conds.push(
      or(...[...new Set(candidates)].map((k) => sql`JSON_UNQUOTE(JSON_EXTRACT(${kgNodes.propsJson}, ${`$."${k}"`})) = ${value}`)) as SQL,
    );
  }
  const rows = await getDb()
    .select()
    .from(kgNodes)
    .where(and(...conds))
    .orderBy(asc(kgNodes.id))
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const links = await linksOf(ws, page.map((r) => r.id));
  return {
    data: page.map((r) => toApiObject(model, r, links.get(r.id))),
    nextCursor: rows.length > query.limit ? String(page[page.length - 1].id) : null,
  };
}

export async function getObject(model: OntologyModel, iri: string): Promise<ApiObject | null> {
  const [n] = await getDb()
    .select()
    .from(kgNodes)
    .where(and(eq(kgNodes.workspaceId, model.workspace.id), eq(kgNodes.iri, iri), isNull(kgNodes.deletedAt)))
    .limit(1);
  if (!n) return null;
  const links = await linksOf(model.workspace.id, [n.id]);
  return toApiObject(model, n, links.get(n.id));
}

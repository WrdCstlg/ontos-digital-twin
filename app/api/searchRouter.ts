/**
 * Global Search Router — ⌘K search across the entire workspace.
 *
 * Searches 6 entity types in parallel and returns categorized results:
 *   1. Knowledge Graph nodes (instances)
 *   2. Ontology classes
 *   3. Ontology properties
 *   4. Insights (anomalies, analytics)
 *   5. Action types
 *   6. Connectors & mappings
 *
 * Each result carries a `category`, `href`, and display fields so the
 * frontend can render them immediately and link to the right page.
 */

import { z } from "zod";
import { and, eq, isNull, like, or, sql } from "drizzle-orm";
import {
  kgNodes,
  ontologyClasses,
  ontologyProperties,
  ontologyModules,
  insights,
  actionTypes,
  connectors,
} from "@db/schema";
import { createRouter, workspaceQuery } from "./middleware";
import { getDb } from "./queries/connection";

/* ── result types ────────────────────────────────────────────── */

export type SearchCategory =
  | "instance"
  | "class"
  | "property"
  | "insight"
  | "action"
  | "connector";

export interface SearchResult {
  id: number;
  category: SearchCategory;
  title: string;
  subtitle: string;
  /** Module key for coloring (hr, legal, compliance, etc.) */
  moduleKey: string | null;
  /** Deep-link within the app */
  href: string;
  /** Extra metadata for the result */
  meta?: Record<string, unknown>;
}

/* ── router ──────────────────────────────────────────────────── */

const RESULT_LIMIT = 8; // per category

export const searchRouter = createRouter({
  /**
   * Global search: returns up to `RESULT_LIMIT` results per category,
   * sorted by relevance (exact-start match first, then substring).
   */
  global: workspaceQuery
    .input(
      z.object({
        query: z.string().min(1).max(200),
      }),
    )
    .query(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      const db = getDb();
      const q = input.query.trim();
      // The term is matched literally: % and _ in it are not wildcards.
      const literal = q.replace(/[\\%_]/g, (c) => `\\${c}`);
      const pattern = `%${literal}%`;

      // Run all searches in parallel
      const [
        nodeResults,
        classResults,
        propResults,
        insightResults,
        actionResults,
        connectorResults,
      ] = await Promise.all([
        // 1. Knowledge Graph nodes — search label and IRI
        db
          .select({
            id: kgNodes.id,
            label: kgNodes.label,
            iri: kgNodes.iri,
            classIri: kgNodes.classIri,
            moduleKey: kgNodes.moduleKey,
          })
          .from(kgNodes)
          .where(
            and(
              eq(kgNodes.workspaceId, ws.id),
              isNull(kgNodes.deletedAt),
              or(
                like(kgNodes.label, pattern),
                like(kgNodes.iri, pattern),
              ),
            ),
          )
          .orderBy(
            // Prefer exact-start matches
            sql`CASE WHEN ${kgNodes.label} LIKE ${literal + "%"} THEN 0 ELSE 1 END`,
            kgNodes.label,
          )
          .limit(RESULT_LIMIT),

        // 2. Ontology classes — search label, IRI, definition
        db
          .select({
            id: ontologyClasses.id,
            label: ontologyClasses.label,
            iri: ontologyClasses.iri,
            definition: ontologyClasses.definition,
            moduleId: ontologyClasses.moduleId,
          })
          .from(ontologyClasses)
          // Classes belong to a workspace through their module.
          .innerJoin(ontologyModules, eq(ontologyClasses.moduleId, ontologyModules.id))
          .where(
            and(
              eq(ontologyModules.workspaceId, ws.id),
              or(
                like(ontologyClasses.label, pattern),
                like(ontologyClasses.iri, pattern),
                like(ontologyClasses.definition, pattern),
              ),
            ),
          )
          .orderBy(
            sql`CASE WHEN ${ontologyClasses.label} LIKE ${literal + "%"} THEN 0 ELSE 1 END`,
            ontologyClasses.label,
          )
          .limit(RESULT_LIMIT),

        // 3. Ontology properties — search label, IRI
        db
          .select({
            id: ontologyProperties.id,
            label: ontologyProperties.label,
            iri: ontologyProperties.iri,
            kind: ontologyProperties.kind,
            moduleId: ontologyProperties.moduleId,
          })
          .from(ontologyProperties)
          .innerJoin(ontologyModules, eq(ontologyProperties.moduleId, ontologyModules.id))
          .where(
            and(
              eq(ontologyModules.workspaceId, ws.id),
              or(
                like(ontologyProperties.label, pattern),
                like(ontologyProperties.iri, pattern),
              ),
            ),
          )
          .orderBy(
            sql`CASE WHEN ${ontologyProperties.label} LIKE ${literal + "%"} THEN 0 ELSE 1 END`,
            ontologyProperties.label,
          )
          .limit(RESULT_LIMIT),

        // 4. Insights — search title and summary
        db
          .select({
            id: insights.id,
            title: insights.title,
            summary: insights.summary,
            severity: insights.severity,
            ruleId: insights.ruleId,
            status: insights.status,
          })
          .from(insights)
          .where(
            and(
              eq(insights.workspaceId, ws.id),
              or(
                like(insights.title, pattern),
                like(insights.summary, pattern),
              ),
            ),
          )
          .orderBy(
            sql`CASE WHEN ${insights.title} LIKE ${literal + "%"} THEN 0 ELSE 1 END`,
            insights.title,
          )
          .limit(RESULT_LIMIT),

        // 5. Action types — search displayName, description
        db
          .select({
            id: actionTypes.id,
            displayName: actionTypes.displayName,
            description: actionTypes.description,
            key: actionTypes.key,
            moduleId: actionTypes.moduleId,
          })
          .from(actionTypes)
          .where(
            and(
              eq(actionTypes.workspaceId, ws.id),
              or(
                like(actionTypes.displayName, pattern),
                like(actionTypes.description, pattern),
                like(actionTypes.key, pattern),
              ),
            ),
          )
          .orderBy(actionTypes.displayName)
          .limit(RESULT_LIMIT),

        // 6. Connectors — search name
        db
          .select({
            id: connectors.id,
            name: connectors.name,
            type: connectors.type,
            status: connectors.status,
          })
          .from(connectors)
          .where(
            and(
              eq(connectors.workspaceId, ws.id),
              like(connectors.name, pattern),
            ),
          )
          .orderBy(connectors.name)
          .limit(RESULT_LIMIT),
      ]);

      // We need module keys for classes and properties (they have moduleId, not moduleKey)
      const moduleIds = new Set<number>();
      for (const c of classResults) moduleIds.add(c.moduleId);
      for (const p of propResults) moduleIds.add(p.moduleId);
      for (const a of actionResults) moduleIds.add(a.moduleId);

      let moduleKeyMap = new Map<number, string>();
      if (moduleIds.size > 0) {
        const modules = await db
          .select({ id: ontologyModules.id, key: ontologyModules.key })
          .from(ontologyModules)
          .where(eq(ontologyModules.workspaceId, ws.id));
        moduleKeyMap = new Map(modules.map((m) => [m.id, m.key]));
      }

      // Assemble results
      const results: SearchResult[] = [];

      for (const n of nodeResults) {
        results.push({
          id: n.id,
          category: "instance",
          title: n.label,
          subtitle: n.classIri.split(":")[1] ?? n.classIri,
          moduleKey: n.moduleKey,
          href: `/app/explorer?focus=${encodeURIComponent(n.iri)}`,
        });
      }

      for (const c of classResults) {
        const mk = moduleKeyMap.get(c.moduleId) ?? null;
        results.push({
          id: c.id,
          category: "class",
          title: c.label,
          subtitle: c.iri,
          moduleKey: mk,
          href: `/app/studio?class=${encodeURIComponent(c.iri)}`,
          meta: c.definition ? { definition: c.definition } : undefined,
        });
      }

      for (const p of propResults) {
        const mk = moduleKeyMap.get(p.moduleId) ?? null;
        results.push({
          id: p.id,
          category: "property",
          title: p.label,
          subtitle: `${p.kind} · ${p.iri}`,
          moduleKey: mk,
          href: `/app/studio?property=${encodeURIComponent(p.iri)}`,
        });
      }

      for (const i of insightResults) {
        results.push({
          id: i.id,
          category: "insight",
          title: i.title,
          subtitle: `${i.severity} · ${i.status}`,
          moduleKey: null,
          href: `/app/insights?insight=${i.id}`,
          meta: { severity: i.severity, status: i.status, ruleId: i.ruleId },
        });
      }

      for (const a of actionResults) {
        const mk = moduleKeyMap.get(a.moduleId) ?? null;
        results.push({
          id: a.id,
          category: "action",
          title: a.displayName,
          subtitle: a.key,
          moduleKey: mk,
          href: `/app/actions?action=${a.key}`,
        });
      }

      for (const c of connectorResults) {
        results.push({
          id: c.id,
          category: "connector",
          title: c.name,
          subtitle: `${c.type} · ${c.status}`,
          moduleKey: null,
          href: `/app/mapping?connector=${c.id}`,
        });
      }

      return {
        query: q,
        total: results.length,
        results,
      };
    }),
});

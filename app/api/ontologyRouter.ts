import { z } from "zod";
import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  kgEdges,
  kgNodes,
  ontologyClasses,
  ontologyModules,
  ontologyProperties,
  ontologyVersions,
  type Workspace,
} from "@db/schema";
import { createRouter, workspaceQuery, workspaceOntologistMutation } from "./middleware";
import { getDb } from "./queries/connection";
import {
  actorLabelFor,
  writeAudit,
} from "./services/audit";
import { serializeModule } from "./services/serializers";
import { semanticEngine } from "./services/semanticEngine";
import {
  buildPrefixMap,
  moduleToTurtle,
  knowledgeGraphToTurtle,
  shaclJsonToTurtle,
} from "./services/rdfBridge";
import {
  explainShaclReport,
  buildJustificationTree,
  computeViolationSignature,
  generateExplanationAndRemediation,
} from "./services/explainableShacl";

const moduleKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/, "module key must be lowercase slug");

async function requireModule(ws: Workspace, moduleKey: string) {
  const db = getDb();
  const [mod] = await db
    .select()
    .from(ontologyModules)
    .where(
      and(
        eq(ontologyModules.workspaceId, ws.id),
        eq(ontologyModules.key, moduleKey),
      ),
    )
    .limit(1);
  if (!mod)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Module '${moduleKey}' not found`,
    });
  return { ws, mod };
}

async function instanceCountsByModule(workspaceId: number) {
  const db = getDb();
  const rows = await db
    .select({ moduleKey: kgNodes.moduleKey, n: count() })
    .from(kgNodes)
    .where(and(eq(kgNodes.workspaceId, workspaceId), isNull(kgNodes.deletedAt)))
    .groupBy(kgNodes.moduleKey);
  return new Map(rows.map((r) => [r.moduleKey, Number(r.n)]));
}

function bumpMinor(version: string): string {
  const v = version.replace(/^v/, "");
  const m = v.match(/^(\d+)\.(\d+)/);
  if (!m) return `${v}.1`;
  return `${m[1]}.${Number(m[2]) + 1}`;
}

export const ontologyRouter = createRouter({
  listModules: workspaceQuery.query(async ({ ctx }) => {
    const ws = ctx.workspace;
    const db = getDb();
    const mods = await db
      .select()
      .from(ontologyModules)
      .where(eq(ontologyModules.workspaceId, ws.id))
      .orderBy(asc(ontologyModules.key));
    const inst = await instanceCountsByModule(ws.id);
    const moduleIds = mods.map((m) => m.id);
    const classCountRows = moduleIds.length
      ? await db
          .select({ moduleId: ontologyClasses.moduleId, n: count() })
          .from(ontologyClasses)
          .where(inArray(ontologyClasses.moduleId, moduleIds))
          .groupBy(ontologyClasses.moduleId)
      : [];
    const classCountMap = new Map(classCountRows.map((r) => [r.moduleId, Number(r.n)]));

    const propCountRows = moduleIds.length
      ? await db
          .select({ moduleId: ontologyProperties.moduleId, n: count() })
          .from(ontologyProperties)
          .where(inArray(ontologyProperties.moduleId, moduleIds))
          .groupBy(ontologyProperties.moduleId)
      : [];
    const propCountMap = new Map(propCountRows.map((r) => [r.moduleId, Number(r.n)]));

    return mods.map((m) => ({
      ...m,
      classCount: classCountMap.get(m.id) ?? 0,
      propertyCount: propCountMap.get(m.id) ?? 0,
      instanceCount: inst.get(m.key) ?? 0,
    }));
  }),

  getModule: workspaceQuery
    .input(z.object({ key: moduleKeySchema }))
    .query(async ({ ctx, input }) => {
      const { mod } = await requireModule(ctx.workspace, input.key);
      const db = getDb();
      const [c] = await db
        .select({ n: count() })
        .from(ontologyClasses)
        .where(eq(ontologyClasses.moduleId, mod.id));
      const [p] = await db
        .select({ n: count() })
        .from(ontologyProperties)
        .where(eq(ontologyProperties.moduleId, mod.id));
      const inst = await instanceCountsByModule(mod.workspaceId);
      return {
        ...mod,
        classCount: Number(c.n),
        propertyCount: Number(p.n),
        instanceCount: inst.get(mod.key) ?? 0,
      };
    }),

  listClasses: workspaceQuery
    .input(z.object({ moduleKey: moduleKeySchema }))
    .query(async ({ ctx, input }) => {
      const { mod } = await requireModule(ctx.workspace, input.moduleKey);
      const db = getDb();
      const classes = await db
        .select()
        .from(ontologyClasses)
        .where(eq(ontologyClasses.moduleId, mod.id))
        .orderBy(asc(ontologyClasses.iri));
      const parentById = new Map(classes.map((c) => [c.id, c]));
      const counts = await db
        .select({ classIri: kgNodes.classIri, n: count() })
        .from(kgNodes)
        .where(
          and(
            eq(kgNodes.workspaceId, mod.workspaceId),
            eq(kgNodes.moduleKey, mod.key),
            isNull(kgNodes.deletedAt),
          ),
        )
        .groupBy(kgNodes.classIri);
      const countByIri = new Map(counts.map((r) => [r.classIri, Number(r.n)]));
      return classes.map((c) => ({
        ...c,
        parentIri: c.parentId ? (parentById.get(c.parentId)?.iri ?? null) : null,
        instanceCount: countByIri.get(c.iri) ?? 0,
      }));
    }),

  listProperties: workspaceQuery
    .input(z.object({ moduleKey: moduleKeySchema }))
    .query(async ({ ctx, input }) => {
      const { mod } = await requireModule(ctx.workspace, input.moduleKey);
      const db = getDb();
      const props = await db
        .select()
        .from(ontologyProperties)
        .where(eq(ontologyProperties.moduleId, mod.id))
        .orderBy(asc(ontologyProperties.iri));
      const classIds = [
        ...new Set(
          props.flatMap((p) =>
            [p.domainClassId, p.rangeClassId].filter((x): x is number => x != null),
          ),
        ),
      ];
      const classRows = classIds.length
        ? await db
            .select()
            .from(ontologyClasses)
            .where(inArray(ontologyClasses.id, classIds))
        : [];
      const iriById = new Map(classRows.map((c) => [c.id, c.iri]));
      return props.map((p) => ({
        ...p,
        domainIri: p.domainClassId ? (iriById.get(p.domainClassId) ?? null) : null,
        rangeIri: p.rangeClassId ? (iriById.get(p.rangeClassId) ?? null) : null,
      }));
    }),

  listVersions: workspaceQuery
    .input(z.object({ moduleKey: moduleKeySchema }))
    .query(async ({ ctx, input }) => {
      const { mod } = await requireModule(ctx.workspace, input.moduleKey);
      const db = getDb();
      return db
        .select()
        .from(ontologyVersions)
        .where(eq(ontologyVersions.moduleId, mod.id))
        .orderBy(desc(ontologyVersions.publishedAt));
    }),

  createClass: workspaceOntologistMutation
    .input(
      z.object({
        moduleKey: moduleKeySchema,
        label: z
          .string()
          .min(1)
          .max(255)
          .regex(/^[A-Z][A-Za-z0-9]*$/, "label must be PascalCase"),
        parentIri: z.string().max(512).optional(),
        definition: z.string().max(4000).optional(),
        properties: z
          .array(
            z.object({
              name: z
                .string()
                .min(1)
                .max(255)
                .regex(/^[a-z][A-Za-z0-9]*$/, "property name must be camelCase"),
              kind: z.enum(["object", "datatype"]).default("datatype"),
              rangeClassIri: z.string().max(512).optional(),
              rangeDatatype: z.string().max(128).optional(),
              cardinality: z.string().max(32).optional(),
              definition: z.string().max(2000).optional(),
            }),
          )
          .default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { ws, mod } = await requireModule(ctx.workspace, input.moduleKey);
      const db = getDb();
      const iri = `${mod.prefix}:${input.label}`;

      // name conflict check (label or iri already used in this module)
      const existing = await db
        .select()
        .from(ontologyClasses)
        .where(eq(ontologyClasses.moduleId, mod.id));
      if (
        existing.some(
          (c) =>
            c.iri === iri ||
            c.label.toLowerCase() === input.label.toLowerCase(),
        )
      ) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Class '${input.label}' already exists in module '${mod.key}'`,
        });
      }

      // parent resolution (may live in another module for cross-module extension)
      let parentId: number | null = null;
      if (input.parentIri) {
        const moduleIds = (
          await db
            .select({ id: ontologyModules.id })
            .from(ontologyModules)
            .where(eq(ontologyModules.workspaceId, ws.id))
        ).map((m) => m.id);
        const [parent] = await db
          .select()
          .from(ontologyClasses)
          .where(
            and(
              inArray(ontologyClasses.moduleId, moduleIds),
              eq(ontologyClasses.iri, input.parentIri),
            ),
          )
          .limit(1);
        if (!parent)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Parent class '${input.parentIri}' does not exist`,
          });
        if (parent.deprecated)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Parent class '${input.parentIri}' is deprecated — backward-incompatible parent change refused`,
          });
        parentId = parent.id;
      }

      const [{ id: classId }] = await db
        .insert(ontologyClasses)
        .values({
          moduleId: mod.id,
          iri,
          label: input.label,
          parentId,
          definition: input.definition ?? null,
          isCustom: true,
        })
        .$returningId();

      const createdProps: typeof ontologyProperties.$inferSelect[] = [];
      for (const p of input.properties) {
        if (p.kind === "object" && !p.rangeClassIri)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Object property '${p.name}' requires rangeClassIri`,
          });
        let rangeClassId: number | null = null;
        if (p.rangeClassIri) {
          const moduleIds = (
            await db
              .select({ id: ontologyModules.id })
              .from(ontologyModules)
              .where(eq(ontologyModules.workspaceId, ws.id))
          ).map((m) => m.id);
          const [rc] = await db
            .select()
            .from(ontologyClasses)
            .where(
              and(
                inArray(ontologyClasses.moduleId, moduleIds),
                eq(ontologyClasses.iri, p.rangeClassIri),
              ),
            )
            .limit(1);
          if (!rc)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Range class '${p.rangeClassIri}' does not exist`,
            });
          rangeClassId = rc.id;
        }
        const [{ id: propId }] = await db
          .insert(ontologyProperties)
          .values({
            moduleId: mod.id,
            iri: `${mod.prefix}:${p.name}`,
            label: p.name,
            kind: p.kind,
            domainClassId: classId,
            rangeClassId,
            rangeDatatype: p.kind === "datatype" ? (p.rangeDatatype ?? "xsd:string") : null,
            cardinality: p.cardinality ?? null,
            definition: p.definition ?? null,
          })
          .$returningId();
        const [row] = await db
          .select()
          .from(ontologyProperties)
          .where(eq(ontologyProperties.id, propId));
        createdProps.push(row);
      }

      // version bump (minor) + version history entry
      const newVersion = bumpMinor(mod.version);
      await db
        .update(ontologyModules)
        .set({ version: newVersion, updatedAt: new Date() })
        .where(eq(ontologyModules.id, mod.id));
      const diff = {
        added: {
          classes: [{ iri, label: input.label, parentIri: input.parentIri ?? null }],
          properties: createdProps.map((p) => ({ iri: p.iri, label: p.label })),
        },
        removed: { classes: [], properties: [] },
        changed: [],
      };
      await db.insert(ontologyVersions).values({
        moduleId: mod.id,
        version: newVersion,
        changelog: `Added class ${iri}${input.parentIri ? ` (subclass of ${input.parentIri})` : ""} with ${createdProps.length} propert${createdProps.length === 1 ? "y" : "ies"}`,
        diffJson: diff,
        publishedAt: new Date(),
      });

      const audit = await writeAudit({
        workspaceId: ws.id,
        actor: actorLabelFor(ctx.user),
        action: `Published ${mod.key} v${newVersion} — added class ${iri}`,
        entityType: "ontology_class",
        entityId: iri,
        payload: { moduleKey: mod.key, version: newVersion, diff },
      });

      const [cls] = await db
        .select()
        .from(ontologyClasses)
        .where(eq(ontologyClasses.id, classId));
      return { class: cls, properties: createdProps, newVersion, auditId: audit.id };
    }),

  deprecateClass: workspaceOntologistMutation
    .input(z.object({ classIri: z.string().min(1).max(512) }))
    .mutation(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      const db = getDb();
      const mods = await db
        .select()
        .from(ontologyModules)
        .where(eq(ontologyModules.workspaceId, ws.id));
      const [cls] = await db
        .select()
        .from(ontologyClasses)
        .where(
          and(
            inArray(
              ontologyClasses.moduleId,
              mods.map((m) => m.id),
            ),
            eq(ontologyClasses.iri, input.classIri),
          ),
        )
        .limit(1);
      if (!cls)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Class '${input.classIri}' not found`,
        });
      await db
        .update(ontologyClasses)
        .set({ deprecated: true })
        .where(eq(ontologyClasses.id, cls.id));
      const mod = mods.find((m) => m.id === cls.moduleId)!;
      const audit = await writeAudit({
        workspaceId: ws.id,
        actor: actorLabelFor(ctx.user),
        action: `Deprecated class ${input.classIri}`,
        entityType: "ontology_class",
        entityId: input.classIri,
        payload: { moduleKey: mod.key, version: mod.version },
      });
      return { ok: true, auditId: audit.id };
    }),

  diffVersions: workspaceQuery
    .input(
      z.object({
        moduleKey: moduleKeySchema,
        fromVersion: z.string().min(1).max(32),
        toVersion: z.string().min(1).max(32),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { mod } = await requireModule(ctx.workspace, input.moduleKey);
      const db = getDb();
      const versions = await db
        .select()
        .from(ontologyVersions)
        .where(eq(ontologyVersions.moduleId, mod.id))
        .orderBy(asc(ontologyVersions.publishedAt), asc(ontologyVersions.id));
      const parse = (v: string) => {
        const p = v.split(".").map((x) => Number(x) || 0);
        return (p[0] ?? 0) * 1e6 + (p[1] ?? 0) * 1e3 + (p[2] ?? 0);
      };
      const from = parse(input.fromVersion);
      const to = parse(input.toVersion);
      const inRange = versions.filter((v) => {
        const x = parse(v.version);
        return x > from && x <= to;
      });
      type DiffShape = {
        added: { classes: unknown[]; properties: unknown[] };
        removed: { classes: unknown[]; properties: unknown[] };
        changed: unknown[];
      };
      const merged: DiffShape = {
        added: { classes: [], properties: [] },
        removed: { classes: [], properties: [] },
        changed: [],
      };
      for (const v of inRange) {
        const d = v.diffJson as Partial<DiffShape> | null;
        if (!d) continue;
        merged.added.classes.push(...(d.added?.classes ?? []));
        merged.added.properties.push(...(d.added?.properties ?? []));
        merged.removed.classes.push(...(d.removed?.classes ?? []));
        merged.removed.properties.push(...(d.removed?.properties ?? []));
        merged.changed.push(...(d.changed ?? []));
      }
      return {
        moduleKey: mod.key,
        fromVersion: input.fromVersion,
        toVersion: input.toVersion,
        versionsInRange: inRange.map((v) => v.version),
        ...merged,
        summary: {
          classesAdded: merged.added.classes.length,
          propertiesAdded: merged.added.properties.length,
          classesRemoved: merged.removed.classes.length,
          propertiesRemoved: merged.removed.properties.length,
          changed: merged.changed.length,
        },
      };
    }),

  exportModule: workspaceQuery
    .input(
      z.object({
        moduleKey: moduleKeySchema,
        format: z.enum(["turtle", "owl", "jsonld", "rdfxml"]),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { mod } = await requireModule(ctx.workspace, input.moduleKey);
      const db = getDb();
      const classes = await db
        .select()
        .from(ontologyClasses)
        .where(eq(ontologyClasses.moduleId, mod.id));
      const properties = await db
        .select()
        .from(ontologyProperties)
        .where(eq(ontologyProperties.moduleId, mod.id));
      const extIds = [
        ...new Set(
          properties.flatMap((p) =>
            [p.domainClassId, p.rangeClassId].filter((x): x is number => x != null),
          ),
        ),
      ].filter((id) => !classes.some((c) => c.id === id));
      const ext = extIds.length
        ? await db.select().from(ontologyClasses).where(inArray(ontologyClasses.id, extIds))
        : [];
      const content = serializeModule(
        { module: mod, classes: [...classes, ...ext], properties },
        input.format,
      );
      return {
        moduleKey: mod.key,
        version: mod.version,
        format: input.format,
        content,
      };
    }),

  runReasoner: workspaceQuery
    .input(
      z.object({
        moduleKey: moduleKeySchema,
        profile: z.enum(["rdfs", "owl-rl", "owl-rl-ext", "owl-dl"]).default("owl-rl"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { ws, mod } = await requireModule(ctx.workspace, input.moduleKey);
      const db = getDb();
      const classes = await db
        .select()
        .from(ontologyClasses)
        .where(eq(ontologyClasses.moduleId, mod.id));
      const properties = await db
        .select()
        .from(ontologyProperties)
        .where(eq(ontologyProperties.moduleId, mod.id));

      const nodes = await db
        .select()
        .from(kgNodes)
        .where(
          and(
            eq(kgNodes.workspaceId, ws.id),
            eq(kgNodes.moduleKey, mod.key),
            isNull(kgNodes.deletedAt),
          ),
        );
      const edges = await db
        .select()
        .from(kgEdges)
        .where(
          and(
            eq(kgEdges.workspaceId, ws.id),
            eq(kgEdges.moduleKey, mod.key),
            isNull(kgEdges.deletedAt),
          ),
        );

      const startedAt = Date.now();

      // 1. Attempt native reasoning via open-ontologies (Oxigraph)
      const isEngineAlive = await semanticEngine.ensureEngineRunning();
      if (isEngineAlive) {
        try {
          await semanticEngine.clearStore();
          const prefixMap = buildPrefixMap([mod]);
          const modTtl = moduleToTurtle(mod, classes, properties, prefixMap);
          await semanticEngine.loadTurtle(modTtl);

          if (nodes.length > 0) {
            const instTtl = knowledgeGraphToTurtle(nodes, edges, prefixMap);
            await semanticEngine.loadTurtle(instTtl);
          }

          const res = await semanticEngine.runReasoning(input.profile);
          return {
            moduleKey: mod.key,
            version: mod.version,
            reasoner: `open-ontologies (${res.engineVersion} - Oxigraph native ${res.profile})`,
            durationMs: res.durationMs,
            classesClassified: classes.length,
            inferredSubClassOf: res.inferredSubClassOf,
            inferredCount: res.inferredCount,
            initialTriples: res.initialTriples,
            finalTriples: res.finalTriples,
            iterations: res.iterations,
            sampleInferences: res.sampleInferences,
            consistent: res.consistent,
            issues: res.issues,
            warnings: res.warnings,
            log: [
              `native reasoner … ${classes.length} classes, ${properties.length} properties, ${nodes.length} instances`,
              `profile: ${res.profile} (${res.iterations} fixpoint iterations)`,
              `materialized ${res.inferredCount} inferred triples (total ${res.finalTriples})`,
              ...res.sampleInferences.slice(0, 10).map((s) => `inferred: ${s}`),
              `consistent: ${res.consistent}`,
            ],
          };
        } catch (engineErr) {
          console.warn(
            "[ontologyRouter] Semantic engine reasoning failed, falling back to local:",
            engineErr,
          );
        }
      }

      // 2. Fallback deterministic reasoner when engine is offline
      const byId = new Map(classes.map((c) => [c.id, c]));
      const inferred: { child: string; ancestor: string; via: string }[] = [];
      const issues: string[] = [];
      const warnings: string[] = [];

      for (const c of classes) {
        const seen = new Set<number>([c.id]);
        let prev = c;
        let cur = c.parentId ? byId.get(c.parentId) : undefined;
        while (cur) {
          if (seen.has(cur.id)) {
            issues.push(`Cycle detected in subclass hierarchy at ${cur.iri}`);
            break;
          }
          seen.add(cur.id);
          inferred.push({ child: c.iri, ancestor: cur.iri, via: prev.iri });
          if (cur.deprecated)
            warnings.push(`${c.iri} subclasses deprecated class ${cur.iri}`);
          prev = cur;
          cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        }
        if (!c.parentId && c.iri !== `${mod.prefix}:Thing`)
          warnings.push(`${c.iri} is a root class (no declared superclass)`);
        if (!c.definition) warnings.push(`${c.iri} missing rdfs:comment/definition`);
      }

      for (const p of properties) {
        if (p.domainClassId && !byId.has(p.domainClassId)) {
          const [ext] = await db
            .select()
            .from(ontologyClasses)
            .where(eq(ontologyClasses.id, p.domainClassId))
            .limit(1);
          if (!ext) issues.push(`${p.iri} has unresolvable domain class`);
        }
        if (p.kind === "object" && !p.rangeClassId)
          warnings.push(`${p.iri} is an object property without a range`);
      }

      const dedup = new Map<string, { child: string; ancestor: string; via: string }>();
      for (const i of inferred) dedup.set(`${i.child}|${i.ancestor}`, i);
      const inferredList = [...dedup.values()].filter(
        (i) => i.child !== i.ancestor,
      );

      return {
        moduleKey: mod.key,
        version: mod.version,
        reasoner: "ontos-sim (deterministic ELK-style classifier, fallback mode)",
        durationMs: Date.now() - startedAt,
        classesClassified: classes.length,
        inferredSubClassOf: inferredList,
        inferredCount: inferredList.length,
        initialTriples: classes.length + properties.length,
        finalTriples: classes.length + properties.length + inferredList.length,
        iterations: 1,
        sampleInferences: inferredList.slice(0, 10).map((i) => `${i.child} rdfs:subClassOf ${i.ancestor}`),
        consistent: issues.length === 0,
        issues,
        warnings,
        log: [
          `classify (fallback) … ${classes.length} classes, ${properties.length} properties`,
          ...inferredList.slice(0, 12).map((i) => `inferred: ${i.child} ⊑ ${i.ancestor}`),
          `consistent: ${issues.length === 0}`,
        ],
      };
    }),

  validateShacl: workspaceQuery
    .input(z.object({ moduleKey: moduleKeySchema }))
    .query(async ({ ctx, input }) => {
      const { ws, mod } = await requireModule(ctx.workspace, input.moduleKey);
      const db = getDb();
      const classes = await db
        .select()
        .from(ontologyClasses)
        .where(eq(ontologyClasses.moduleId, mod.id));
      const properties = await db
        .select()
        .from(ontologyProperties)
        .where(eq(ontologyProperties.moduleId, mod.id));

      const nodes = await db
        .select()
        .from(kgNodes)
        .where(
          and(
            eq(kgNodes.workspaceId, ws.id),
            eq(kgNodes.moduleKey, mod.key),
            isNull(kgNodes.deletedAt),
          ),
        );
      const edges = await db
        .select()
        .from(kgEdges)
        .where(
          and(
            eq(kgEdges.workspaceId, ws.id),
            eq(kgEdges.moduleKey, mod.key),
            isNull(kgEdges.deletedAt),
          ),
        );

      const prefixMap = buildPrefixMap([mod]);
      const shapesTtl = shaclJsonToTurtle(classes, prefixMap);
      if (!shapesTtl.trim()) {
        return {
          conforms: true,
          focusNodes: 0,
          violationCount: 0,
          violations: [],
          message: "No SHACL constraints configured for module",
        };
      }

      const isEngineAlive = await semanticEngine.ensureEngineRunning();
      if (!isEngineAlive) {
        return {
          conforms: true,
          focusNodes: 0,
          violationCount: 0,
          violations: [],
          message: "Semantic engine offline — SHACL shapes generated but validation skipped",
        };
      }

      await semanticEngine.clearStore();
      const modTtl = moduleToTurtle(mod, classes, properties, prefixMap);
      await semanticEngine.loadTurtle(modTtl);
      if (nodes.length > 0) {
        const instTtl = knowledgeGraphToTurtle(nodes, edges, prefixMap);
        await semanticEngine.loadTurtle(instTtl);
      }

      const report = await semanticEngine.validateShacl(shapesTtl);
      const explained = explainShaclReport(report);
      return {
        ...explained,
        moduleKey: mod.key,
      };
    }),

  explainViolation: workspaceQuery
    .input(
      z.object({
        constraint: z.string(),
        path: z.string().optional(),
        focusNode: z.string().optional(),
        message: z.string().optional(),
      }),
    )
    .query(({ input }) => {
      const sig = computeViolationSignature(input.constraint, input.path);
      const violation = {
        constraint: input.constraint,
        focusNode: input.focusNode || "instance",
        path: input.path,
        message: input.message,
        severity: "Violation" as const,
      };
      const { humanExplanation, remediationAction } =
        generateExplanationAndRemediation(violation, sig);
      const justificationTree = buildJustificationTree(violation, sig);
      return {
        signature: sig,
        humanExplanation,
        remediationAction,
        justificationTree,
      };
    }),
});

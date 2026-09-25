import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  actionSubmissions,
  actionTypes,
  kgEdges,
  kgNodes,
  ontologyClasses,
  ontologyModules,
  type ActionSubmission,
  type ActionType,
  type KgEdge,
  type KgNode,
  type OntologyModule,
} from "@db/schema";
import {
  actionDefinitionSchema,
  checkDefinition,
  type ActionDefinition,
  type ActionRole,
} from "@contracts/actions";
import { getDb } from "../../queries/connection";
import { canonicalize, writeAudit } from "../audit";
import { enqueueJob } from "../jobs/queue";
import { semanticEngine } from "../semanticEngine";
import { buildPrefixMap, knowledgeGraphToTurtle, shaclJsonToTurtle } from "../rdfBridge";
import { explainShaclReport } from "../explainableShacl";
import { ACTION_WEBHOOK_KIND } from "./sideEffects";
import {
  checkObjectParams,
  checkSubmitter,
  coerceParams,
  evaluateCriteria,
  objectParamIris,
  planEdits,
  planIsEmpty,
  resultingObjects,
  type CriterionResult,
  type EditPlan,
  type ObjectSnapshot,
  type ParamValues,
  type Problem,
  type Submitter,
} from "./engine";

/**
 * Action types against the database: loading what a submission names,
 * checking the result against SHACL, and applying the plan in one transaction
 * with the submission record, its audit entry and its side-effect jobs.
 */

export { ACTION_WEBHOOK_KIND };

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** A stored definition that no longer parses is a server fault, not the submitter's. */
export class InvalidStoredDefinition extends Error {}

/** The objects changed between planning and applying. */
export class SubmissionConflict extends Error {}

export function parseDefinition(json: unknown): ActionDefinition {
  const parsed = actionDefinitionSchema.safeParse(json);
  if (!parsed.success) throw new InvalidStoredDefinition(`stored definition does not parse: ${parsed.error.message}`);
  const problems = checkDefinition(parsed.data);
  if (problems.length) throw new InvalidStoredDefinition(`stored definition is inconsistent: ${problems[0].path}: ${problems[0].message}`);
  return parsed.data;
}

export type LoadedActionType = { actionType: ActionType; module: OntologyModule; definition: ActionDefinition };

export async function loadActionType(workspaceId: number, key: string): Promise<LoadedActionType | null> {
  const [row] = await getDb()
    .select({ actionType: actionTypes, module: ontologyModules })
    .from(actionTypes)
    .innerJoin(ontologyModules, eq(actionTypes.moduleId, ontologyModules.id))
    .where(and(eq(actionTypes.workspaceId, workspaceId), eq(actionTypes.key, key)))
    .limit(1);
  if (!row) return null;
  return { ...row, definition: parseDefinition(row.actionType.definitionJson) };
}

/* ── snapshots ───────────────────────────────────────────────── */

async function moduleNamespaces(workspaceId: number): Promise<Map<string, string[]>> {
  const mods = await getDb().select().from(ontologyModules).where(eq(ontologyModules.workspaceId, workspaceId));
  return new Map(mods.map((m) => [m.key, [...new Set([m.key, m.prefix])]]));
}

/** The objects with these IRIs, deleted ones included, with their live outgoing links. */
export async function loadObjects(workspaceId: number, iris: string[], db: Db | Tx = getDb()): Promise<Map<string, ObjectSnapshot>> {
  const out = new Map<string, ObjectSnapshot>();
  if (iris.length === 0) return out;
  const nodes = await db.select().from(kgNodes).where(and(eq(kgNodes.workspaceId, workspaceId), inArray(kgNodes.iri, iris)));
  if (nodes.length === 0) return out;
  const edges = await db
    .select()
    .from(kgEdges)
    .where(and(eq(kgEdges.workspaceId, workspaceId), inArray(kgEdges.fromNodeId, nodes.map((n) => n.id)), isNull(kgEdges.deletedAt)))
    .limit(5000);
  const targetIds = [...new Set(edges.map((e) => e.toNodeId))];
  const targets = targetIds.length
    ? await db.select({ id: kgNodes.id, iri: kgNodes.iri }).from(kgNodes).where(inArray(kgNodes.id, targetIds))
    : [];
  const iriById = new Map(targets.map((t) => [t.id, t.iri]));
  const namespaces = await moduleNamespaces(workspaceId);
  for (const n of nodes) {
    out.set(n.iri, {
      id: n.id,
      iri: n.iri,
      classIri: n.classIri,
      moduleKey: n.moduleKey,
      label: n.label,
      props: (n.propsJson as Record<string, unknown> | null) ?? {},
      deleted: n.deletedAt !== null,
      links: edges
        .filter((e) => e.fromNodeId === n.id && iriById.has(e.toNodeId))
        .map((e) => ({ edgeId: e.id, predicate: e.predicateIri, toIri: iriById.get(e.toNodeId) as string })),
      namespaces: namespaces.get(n.moduleKey) ?? [n.moduleKey],
    });
  }
  return out;
}

/** Every class each class inherits from, through rdfs:subClassOf chains. */
export async function classAncestors(workspaceId: number): Promise<(classIri: string) => Set<string>> {
  const rows = await getDb()
    .select({ id: ontologyClasses.id, iri: ontologyClasses.iri, parentId: ontologyClasses.parentId })
    .from(ontologyClasses)
    .innerJoin(ontologyModules, eq(ontologyClasses.moduleId, ontologyModules.id))
    .where(eq(ontologyModules.workspaceId, workspaceId));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const byIri = new Map(rows.map((r) => [r.iri, r]));
  return (classIri) => {
    const seen = new Set<string>();
    let cur = byIri.get(classIri);
    while (cur?.parentId != null) {
      const parent = byId.get(cur.parentId);
      if (!parent || seen.has(parent.iri)) break;
      seen.add(parent.iri);
      cur = parent;
    }
    return seen;
  };
}

/* ── SHACL ───────────────────────────────────────────────────── */

export type ShaclCheck = {
  status: "conforms" | "violations" | "no_shapes" | "unavailable" | "skipped";
  violations: { focusNode: string; path?: string; severity: string; message: string; remediation?: string }[];
};

/**
 * Checks the objects the plan creates or changes against their classes' SHACL
 * shapes, in this process's engine. Only violations on those objects count;
 * the objects they link to are loaded so links serialise, not judged.
 */
export async function checkShacl(workspaceId: number, plan: EditPlan, objects: Map<string, ObjectSnapshot>): Promise<ShaclCheck> {
  const touched = resultingObjects(plan, objects);
  if (touched.length === 0) return { status: "no_shapes", violations: [] };
  const db = getDb();
  const mods = await db.select().from(ontologyModules).where(eq(ontologyModules.workspaceId, workspaceId));
  const classIris = [...new Set(touched.map((t) => t.classIri))];
  const shaped = (
    await db
      .select({ cls: ontologyClasses })
      .from(ontologyClasses)
      .innerJoin(ontologyModules, eq(ontologyClasses.moduleId, ontologyModules.id))
      .where(and(eq(ontologyModules.workspaceId, workspaceId), inArray(ontologyClasses.iri, classIris)))
  )
    .map((r) => r.cls)
    .filter((c) => c.shaclJson);
  if (shaped.length === 0) return { status: "no_shapes", violations: [] };
  if (!(await semanticEngine.ensureEngineRunning())) return { status: "unavailable", violations: [] };

  // Link targets that are not themselves touched, so their links serialise.
  const touchedIris = new Set(touched.map((t) => t.iri));
  const targetIris = [...new Set(touched.flatMap((t) => t.links.map((l) => l.toIri)))].filter((i) => !touchedIris.has(i));
  const targets = targetIris.length
    ? await db
        .select({ iri: kgNodes.iri, classIri: kgNodes.classIri, moduleKey: kgNodes.moduleKey, label: kgNodes.label })
        .from(kgNodes)
        .where(and(eq(kgNodes.workspaceId, workspaceId), inArray(kgNodes.iri, targetIris)))
    : [];

  let nextId = 1;
  const idByIri = new Map<string, number>();
  const asNode = (o: { iri: string; classIri: string; moduleKey: string; label: string; props?: Record<string, unknown> }): KgNode => {
    const id = nextId++;
    idByIri.set(o.iri, id);
    return {
      id,
      workspaceId,
      moduleKey: o.moduleKey,
      classIri: o.classIri,
      iri: o.iri,
      label: o.label,
      propsJson: o.props ?? {},
      sourceMappingId: null,
      sourceSubmissionId: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  };
  const nodes = [...touched.map(asNode), ...targets.map((t) => asNode(t))];
  const edges: KgEdge[] = [];
  for (const t of touched) {
    for (const l of t.links) {
      const from = idByIri.get(t.iri);
      const to = idByIri.get(l.toIri);
      if (from === undefined || to === undefined) continue;
      edges.push({
        id: edges.length + 1,
        workspaceId,
        fromNodeId: from,
        toNodeId: to,
        predicateIri: l.predicate,
        moduleKey: t.moduleKey,
        sourceMappingId: null,
        sourceSubmissionId: null,
        deletedAt: null,
        createdAt: new Date(),
      });
    }
  }

  const prefixMap = buildPrefixMap(mods);
  const expand = (iri: string) => {
    const colon = iri.indexOf(":");
    const ns = colon > 0 ? prefixMap.get(iri.slice(0, colon)) : undefined;
    return ns ? ns + iri.slice(colon + 1) : iri;
  };
  const judged = new Set([...touchedIris].flatMap((i) => [i, expand(i)]));
  const report = await semanticEngine.exclusive(async () => {
    await semanticEngine.clearStore();
    await semanticEngine.loadTurtle(knowledgeGraphToTurtle(nodes, edges, prefixMap));
    return semanticEngine.validateShacl(shaclJsonToTurtle(shaped, prefixMap));
  });
  if (report.error) return { status: "unavailable", violations: [] };
  const violations = explainShaclReport(report)
    .explainedViolations.filter((v) => judged.has(v.focusNode))
    .map((v) => ({
      focusNode: v.focusNode,
      path: v.path,
      severity: v.severity,
      message: v.humanExplanation || v.rawMessage || v.constraint,
      remediation: v.remediationAction,
    }));
  return { status: violations.some((v) => v.severity === "Violation") ? "violations" : "conforms", violations };
}

/* ── preparing a submission ──────────────────────────────────── */

export type Prepared = {
  loaded: LoadedActionType;
  values: ParamValues;
  objects: Map<string, ObjectSnapshot>;
  criteria: CriterionResult[];
  plan: EditPlan;
  shacl: ShaclCheck;
  problems: Problem[];
};

export type SubmitterInfo = Submitter & { name: string; userId: number | null };

/**
 * Everything short of applying: permission, parameters, the objects they name,
 * criteria, the edit plan, and SHACL. `problems` empty means it can be applied.
 */
export async function prepareSubmission(
  workspaceId: number,
  loaded: LoadedActionType,
  submitter: SubmitterInfo,
  rawParams: Record<string, unknown>,
  now = new Date(),
): Promise<Prepared> {
  const { actionType, module, definition } = loaded;
  const problems: Problem[] = [];
  const fail = (extra: Problem[]): Prepared => ({
    loaded,
    values: {},
    objects: new Map(),
    criteria: [],
    plan: { creates: [], modifies: [], deletes: [], linkAdds: [], linkRemoves: [] },
    shacl: { status: "skipped", violations: [] },
    problems: [...problems, ...extra],
  });

  if (actionType.status !== "active") {
    return fail([{ code: "action_inactive", message: `This action is ${actionType.status}, not active` }]);
  }
  const denied = checkSubmitter(submitter, actionType.minRole as ActionRole, module.key);
  if (denied) return fail([denied]);

  const { values, problems: paramProblems } = coerceParams(definition.parameters, rawParams);
  problems.push(...paramProblems);
  const objects = await loadObjects(workspaceId, objectParamIris(definition, values));
  problems.push(...checkObjectParams(definition.parameters, values, objects, await classAncestors(workspaceId)));
  if (problems.length) return { ...fail([]), values, objects };

  const { plan, problems: planProblems, context } = planEdits(definition, {
    values,
    objects,
    actor: submitter.name,
    now,
    actionModuleKey: module.key,
  });
  const criteria = evaluateCriteria(definition.criteria, context);
  for (const c of criteria) {
    if (!c.passed) problems.push({ code: "criterion_failed", message: c.message, path: `criteria.${c.index}` });
  }
  problems.push(...planProblems);

  // New objects must not collide with live ones created elsewhere.
  if (plan.creates.length) {
    const clash = await getDb()
      .select({ iri: kgNodes.iri })
      .from(kgNodes)
      .where(and(eq(kgNodes.workspaceId, workspaceId), inArray(kgNodes.iri, plan.creates.map((c) => c.iri)), isNull(kgNodes.deletedAt)));
    for (const c of clash) problems.push({ code: "object_exists", message: `An object ${c.iri} already exists` });
  }
  if (!problems.length && planIsEmpty(plan)) {
    problems.push({ code: "no_change", message: "Nothing would change: the objects already look like this" });
  }

  let shacl: ShaclCheck = { status: "skipped", violations: [] };
  if (!problems.length && definition.validation.shacl) {
    shacl = await checkShacl(workspaceId, plan, objects);
    if (shacl.status === "unavailable") {
      problems.push({ code: "shacl_unavailable", message: "This action is checked against SHACL, and the semantic engine is not available" });
    } else if (shacl.status === "violations") {
      for (const v of shacl.violations.filter((x) => x.severity === "Violation")) {
        problems.push({ code: "shacl_violation", message: v.message, path: v.path });
      }
    }
  }
  return { loaded, values, objects, criteria, plan, shacl, problems };
}

/* ── applying ────────────────────────────────────────────────── */

function fingerprint(n: { classIri: string; label: string; propsJson: unknown; deletedAt: Date | null }): string {
  return canonicalize({ c: n.classIri, l: n.label, p: n.propsJson ?? {}, d: n.deletedAt !== null });
}

function snapshotFingerprint(o: ObjectSnapshot): string {
  return canonicalize({ c: o.classIri, l: o.label, p: o.props, d: o.deleted });
}

function isDeadlock(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const x = e as { code?: string; errno?: number };
    if (x.code === "ER_LOCK_DEADLOCK" || x.errno === 1213) return true;
  }
  return false;
}

/** Runs a transaction again when MySQL chose it as a deadlock's victim, as MySQL asks. */
export async function withDeadlockRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await run();
    } catch (err) {
      if (i >= attempts || !isDeadlock(err)) throw err;
      await new Promise((r) => setTimeout(r, 20 * i + Math.random() * 30));
    }
  }
}

export type PlanSummary = {
  created: { iri: string; classIri: string; label: string }[];
  modified: { iri: string; label?: { from: string; to: string }; set: Record<string, { from: unknown; to: unknown }>; unset: string[] }[];
  deleted: { iri: string; label: string }[];
  linksAdded: { from: string; predicate: string; to: string }[];
  linksRemoved: { from: string; predicate: string; to: string }[];
};

export function summarisePlan(plan: EditPlan): PlanSummary {
  return {
    created: plan.creates.map((c) => ({ iri: c.iri, classIri: c.classIri, label: c.label })),
    modified: plan.modifies.map((m) => ({ iri: m.iri, ...(m.label ? { label: m.label } : {}), set: m.set, unset: Object.keys(m.unset) })),
    deleted: plan.deletes.map((d) => ({ iri: d.iri, label: d.label })),
    linksAdded: plan.linkAdds.map((l) => ({ from: l.fromIri, predicate: l.predicate, to: l.toIri })),
    linksRemoved: plan.linkRemoves.map((l) => ({ from: l.fromIri, predicate: l.predicate, to: l.toIri })),
  };
}

function describe(p: PlanSummary): string {
  const parts: string[] = [];
  if (p.created.length) parts.push(`created ${p.created.length}`);
  if (p.modified.length) parts.push(`changed ${p.modified.length}`);
  if (p.deleted.length) parts.push(`deleted ${p.deleted.length}`);
  if (p.linksAdded.length) parts.push(`linked ${p.linksAdded.length}`);
  if (p.linksRemoved.length) parts.push(`unlinked ${p.linksRemoved.length}`);
  return parts.join(", ") || "no change";
}

async function applyPrepared(workspaceId: number, prep: Prepared, submitter: SubmitterInfo): Promise<ActionSubmission> {
  const { actionType, definition } = prep.loaded;
  const summary = summarisePlan(prep.plan);
  return getDb().transaction(async (tx) => {
    // Lock what the plan read and make sure it has not moved since.
    const ids = [...prep.objects.values()].map((o) => o.id);
    if (ids.length) {
      const rows = await tx.select().from(kgNodes).where(inArray(kgNodes.id, ids)).for("update");
      const byIri = new Map(rows.map((r) => [r.iri, r]));
      const liveEdges = await tx
        .select({ id: kgEdges.id, fromNodeId: kgEdges.fromNodeId })
        .from(kgEdges)
        .where(and(inArray(kgEdges.fromNodeId, ids), isNull(kgEdges.deletedAt)))
        .for("update");
      for (const o of prep.objects.values()) {
        const row = byIri.get(o.iri);
        if (!row || fingerprint(row) !== snapshotFingerprint(o)) throw new SubmissionConflict(`${o.iri} changed`);
        const now = liveEdges.filter((e) => e.fromNodeId === o.id).map((e) => e.id).sort((a, b) => a - b);
        const then = o.links.map((l) => l.edgeId).sort((a, b) => a - b);
        if (canonicalize(now) !== canonicalize(then)) throw new SubmissionConflict(`${o.iri}'s links changed`);
      }
    }
    const createIris = prep.plan.creates.map((c) => c.iri);
    const existing = createIris.length
      ? await tx.select().from(kgNodes).where(and(eq(kgNodes.workspaceId, workspaceId), inArray(kgNodes.iri, createIris))).for("update")
      : [];
    if (existing.some((e) => e.deletedAt === null)) throw new SubmissionConflict("an object it creates now exists");

    const [{ id: submissionId }] = await tx
      .insert(actionSubmissions)
      .values({
        workspaceId,
        actionTypeId: actionType.id,
        actionKey: actionType.key,
        actionVersion: actionType.version,
        status: "applied",
        submittedBy: submitter.name,
        userId: submitter.userId,
        paramsJson: prep.values,
        resultJson: summary,
        shaclJson: prep.shacl,
      })
      .$returningId();

    const idByIri = new Map([...prep.objects.values()].map((o) => [o.iri, o.id]));
    const revive = new Map(existing.map((e) => [e.iri, e.id]));
    for (const c of prep.plan.creates) {
      const values = {
        moduleKey: c.moduleKey,
        classIri: c.classIri,
        label: c.label,
        propsJson: c.props,
        sourceMappingId: null,
        sourceSubmissionId: submissionId,
      };
      const old = revive.get(c.iri);
      if (old !== undefined) {
        await tx.update(kgNodes).set({ ...values, deletedAt: null }).where(eq(kgNodes.id, old));
        idByIri.set(c.iri, old);
      } else {
        const [{ id }] = await tx.insert(kgNodes).values({ workspaceId, iri: c.iri, ...values }).$returningId();
        idByIri.set(c.iri, id);
      }
    }
    for (const m of prep.plan.modifies) {
      const props = { ...(prep.objects.get(m.iri)?.props ?? {}) };
      for (const k of Object.keys(m.unset)) delete props[k];
      for (const [k, v] of Object.entries(m.set)) props[k] = v.to;
      await tx
        .update(kgNodes)
        .set({ propsJson: props, ...(m.label ? { label: m.label.to } : {}), sourceSubmissionId: submissionId, updatedAt: sql`now()` })
        .where(eq(kgNodes.id, m.id));
    }
    for (const d of prep.plan.deletes) {
      await tx.update(kgNodes).set({ deletedAt: sql`now()`, sourceSubmissionId: submissionId }).where(eq(kgNodes.id, d.id));
      await tx
        .update(kgEdges)
        .set({ deletedAt: sql`now()`, sourceSubmissionId: submissionId })
        .where(and(or(eq(kgEdges.fromNodeId, d.id), eq(kgEdges.toNodeId, d.id)), isNull(kgEdges.deletedAt)));
    }
    if (prep.plan.linkRemoves.length) {
      await tx
        .update(kgEdges)
        .set({ deletedAt: sql`now()`, sourceSubmissionId: submissionId })
        .where(inArray(kgEdges.id, prep.plan.linkRemoves.map((l) => l.edgeId)));
    }
    for (const l of prep.plan.linkAdds) {
      const from = idByIri.get(l.fromIri);
      const to = idByIri.get(l.toIri);
      if (from === undefined || to === undefined) throw new Error(`cannot resolve link ${l.fromIri} → ${l.toIri}`);
      const moduleKey = prep.plan.creates.find((c) => c.iri === l.fromIri)?.moduleKey ?? prep.objects.get(l.fromIri)?.moduleKey ?? null;
      await tx.insert(kgEdges).values({ workspaceId, fromNodeId: from, toNodeId: to, predicateIri: l.predicate, moduleKey, sourceSubmissionId: submissionId });
    }

    const jobIds: number[] = [];
    for (let index = 0; index < definition.sideEffects.length; index++) {
      jobIds.push(
        await enqueueJob(tx, {
          workspaceId,
          kind: ACTION_WEBHOOK_KIND,
          payload: { submissionId, index },
          createdBy: submitter.name,
        }),
      );
    }
    if (jobIds.length) await tx.update(actionSubmissions).set({ sideEffectJobIds: jobIds }).where(eq(actionSubmissions.id, submissionId));

    await writeAudit(
      {
        workspaceId,
        actor: submitter.name,
        action: `Applied action '${actionType.displayName}' v${actionType.version}: ${describe(summary)}`,
        entityType: "action_submission",
        entityId: submissionId,
        payload: { actionKey: actionType.key, version: actionType.version, params: prep.values, result: summary },
      },
      tx,
    );
    const [row] = await tx.select().from(actionSubmissions).where(eq(actionSubmissions.id, submissionId));
    return row;
  });
}

async function recordRejection(
  workspaceId: number,
  prep: Prepared,
  submitter: SubmitterInfo,
  rawParams: Record<string, unknown>,
): Promise<ActionSubmission> {
  const { actionType } = prep.loaded;
  return getDb().transaction(async (tx) => {
    const [{ id }] = await tx
      .insert(actionSubmissions)
      .values({
        workspaceId,
        actionTypeId: actionType.id,
        actionKey: actionType.key,
        actionVersion: actionType.version,
        status: "rejected",
        submittedBy: submitter.name,
        userId: submitter.userId,
        // What was submitted, since values that failed their checks are not in prep.values.
        paramsJson: rawParams,
        errorsJson: prep.problems,
        shaclJson: prep.shacl,
      })
      .$returningId();
    await writeAudit(
      {
        workspaceId,
        actor: submitter.name,
        action: `Rejected action '${actionType.displayName}' v${actionType.version}: ${prep.problems[0]?.message ?? "rejected"}`,
        entityType: "action_submission",
        entityId: id,
        payload: { actionKey: actionType.key, version: actionType.version, params: rawParams, problems: prep.problems },
      },
      tx,
    );
    const [row] = await tx.select().from(actionSubmissions).where(eq(actionSubmissions.id, id));
    return row;
  });
}

/**
 * Submits an action: prepares it, and either applies it or records why not.
 * A permission refusal is returned without a record, like any refused request.
 * If the objects change between planning and applying, it plans again once.
 */
export async function submitAction(
  workspaceId: number,
  loaded: LoadedActionType,
  submitter: SubmitterInfo,
  rawParams: Record<string, unknown>,
): Promise<{ submission: ActionSubmission | null; prepared: Prepared }> {
  for (let attempt = 1; ; attempt++) {
    const prep = await prepareSubmission(workspaceId, loaded, submitter, rawParams);
    if (prep.problems.some((p) => p.code === "forbidden_role" || p.code === "forbidden_scope" || p.code === "action_inactive")) {
      return { submission: null, prepared: prep };
    }
    if (prep.problems.length) {
      return { submission: await withDeadlockRetry(() => recordRejection(workspaceId, prep, submitter, rawParams)), prepared: prep };
    }
    try {
      return { submission: await withDeadlockRetry(() => applyPrepared(workspaceId, prep, submitter)), prepared: prep };
    } catch (err) {
      if (err instanceof SubmissionConflict && attempt < 2) continue;
      throw err;
    }
  }
}

export async function listSubmissions(
  workspaceId: number,
  opts: { actionKey?: string; status?: "applied" | "rejected"; limit: number },
): Promise<ActionSubmission[]> {
  const conds = [eq(actionSubmissions.workspaceId, workspaceId)];
  if (opts.actionKey) conds.push(eq(actionSubmissions.actionKey, opts.actionKey));
  if (opts.status) conds.push(eq(actionSubmissions.status, opts.status));
  return getDb().select().from(actionSubmissions).where(and(...conds)).orderBy(desc(actionSubmissions.id)).limit(opts.limit);
}

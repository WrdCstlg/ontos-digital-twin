import { and, count, desc, eq, inArray, max } from "drizzle-orm";
import {
  actionSubmissions,
  actionTypeVersions,
  actionTypes,
  ontologyClasses,
  ontologyModules,
  type ActionType,
} from "@db/schema";
import {
  actionDefinitionSchema,
  checkDefinition,
  type ActionDefinition,
  type ActionRole,
  type ActionStatus,
  type DefinitionProblem,
} from "@contracts/actions";
import { getDb } from "../../queries/connection";
import { writeAudit } from "../audit";
import { parseDefinition } from "./service";

/** Creating, changing and listing action types. Every saved change is a new version. */

export class DefinitionInvalid extends Error {
  readonly problems: DefinitionProblem[];
  constructor(problems: DefinitionProblem[]) {
    super(problems.map((p) => `${p.path}: ${p.message}`).join("; "));
    this.problems = problems;
  }
}
export class ActionTypeNotFound extends Error {}
export class ActionTypeConflict extends Error {}

/** Parses and checks a definition, returning every problem found. */
export function validateDefinition(raw: unknown): { definition: ActionDefinition | null; problems: DefinitionProblem[] } {
  const parsed = actionDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      definition: null,
      problems: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    };
  }
  const problems = checkDefinition(parsed.data);
  return { definition: problems.length ? null : parsed.data, problems };
}

function isDuplicate(err: unknown): boolean {
  for (let e: unknown = err, d = 0; e && d < 5; e = (e as { cause?: unknown }).cause, d++) {
    const x = e as { code?: string; errno?: number };
    if (x.code === "ER_DUP_ENTRY" || x.errno === 1062) return true;
  }
  return false;
}

export type ActionTypeInput = {
  key: string;
  displayName: string;
  description?: string | null;
  moduleKey: string;
  minRole: ActionRole;
  status: ActionStatus;
  definition: unknown;
};

export async function createActionType(workspaceId: number, actor: string, input: ActionTypeInput): Promise<ActionType> {
  const { definition, problems } = validateDefinition(input.definition);
  if (!definition) throw new DefinitionInvalid(problems);
  const db = getDb();
  const [module] = await db
    .select()
    .from(ontologyModules)
    .where(and(eq(ontologyModules.workspaceId, workspaceId), eq(ontologyModules.key, input.moduleKey)))
    .limit(1);
  if (!module) throw new ActionTypeNotFound(`module "${input.moduleKey}" not found`);
  try {
    return await db.transaction(async (tx) => {
      const [{ id }] = await tx
        .insert(actionTypes)
        .values({
          workspaceId,
          moduleId: module.id,
          key: input.key,
          displayName: input.displayName,
          description: input.description ?? null,
          status: input.status,
          minRole: input.minRole,
          version: 1,
          definitionJson: definition,
          createdBy: actor,
          updatedBy: actor,
        })
        .$returningId();
      await tx.insert(actionTypeVersions).values({
        actionTypeId: id,
        version: 1,
        displayName: input.displayName,
        description: input.description ?? null,
        minRole: input.minRole,
        definitionJson: definition,
        changedBy: actor,
      });
      await writeAudit(
        {
          workspaceId,
          actor,
          action: `Created action type '${input.displayName}' (${input.key}) in module ${module.key}`,
          entityType: "action_type",
          entityId: id,
          payload: { key: input.key, version: 1, status: input.status, minRole: input.minRole },
        },
        tx,
      );
      const [row] = await tx.select().from(actionTypes).where(eq(actionTypes.id, id));
      return row;
    });
  } catch (err) {
    if (isDuplicate(err)) throw new ActionTypeConflict(`an action type "${input.key}" already exists`);
    throw err;
  }
}

export type ActionTypeChange = {
  displayName?: string;
  description?: string | null;
  minRole?: ActionRole;
  definition?: unknown;
  /** The version the change was made against; a newer one means someone else saved first. */
  expectedVersion: number;
};

export async function updateActionType(workspaceId: number, actor: string, key: string, change: ActionTypeChange): Promise<ActionType> {
  let definition: ActionDefinition | undefined;
  if (change.definition !== undefined) {
    const v = validateDefinition(change.definition);
    if (!v.definition) throw new DefinitionInvalid(v.problems);
    definition = v.definition;
  }
  return getDb().transaction(async (tx) => {
    const [cur] = await tx
      .select()
      .from(actionTypes)
      .where(and(eq(actionTypes.workspaceId, workspaceId), eq(actionTypes.key, key)))
      .for("update");
    if (!cur) throw new ActionTypeNotFound(`action type "${key}" not found`);
    if (cur.version !== change.expectedVersion) {
      throw new ActionTypeConflict(`"${key}" is at version ${cur.version}, not ${change.expectedVersion}: someone saved a change first`);
    }
    const next = {
      displayName: change.displayName ?? cur.displayName,
      description: change.description === undefined ? cur.description : change.description,
      minRole: change.minRole ?? cur.minRole,
      definitionJson: definition ?? cur.definitionJson,
    };
    const version = cur.version + 1;
    await tx.update(actionTypes).set({ ...next, version, updatedBy: actor }).where(eq(actionTypes.id, cur.id));
    await tx.insert(actionTypeVersions).values({ actionTypeId: cur.id, version, changedBy: actor, ...next });
    await writeAudit(
      {
        workspaceId,
        actor,
        action: `Updated action type '${next.displayName}' (${key}) to v${version}`,
        entityType: "action_type",
        entityId: cur.id,
        payload: { key, version, changed: Object.keys(change).filter((k) => k !== "expectedVersion") },
      },
      tx,
    );
    const [row] = await tx.select().from(actionTypes).where(eq(actionTypes.id, cur.id));
    return row;
  });
}

/** Status is operational, not part of the definition, so it does not make a new version. */
export async function setActionTypeStatus(workspaceId: number, actor: string, key: string, status: ActionStatus): Promise<ActionType> {
  return getDb().transaction(async (tx) => {
    const [cur] = await tx
      .select()
      .from(actionTypes)
      .where(and(eq(actionTypes.workspaceId, workspaceId), eq(actionTypes.key, key)))
      .for("update");
    if (!cur) throw new ActionTypeNotFound(`action type "${key}" not found`);
    if (cur.status !== status) {
      await tx.update(actionTypes).set({ status, updatedBy: actor }).where(eq(actionTypes.id, cur.id));
      await writeAudit(
        {
          workspaceId,
          actor,
          action: `Set action type '${cur.displayName}' (${key}) ${status}`,
          entityType: "action_type",
          entityId: cur.id,
          payload: { key, from: cur.status, to: status },
        },
        tx,
      );
    }
    const [row] = await tx.select().from(actionTypes).where(eq(actionTypes.id, cur.id));
    return row;
  });
}

export type ActionTypeListing = ActionType & {
  module: { key: string; name: string; color: string };
  definition: ActionDefinition;
  submissions: { applied: number; rejected: number; lastAt: Date | null };
};

export async function listActionTypes(workspaceId: number): Promise<ActionTypeListing[]> {
  const db = getDb();
  const rows = await db
    .select({ actionType: actionTypes, module: ontologyModules })
    .from(actionTypes)
    .innerJoin(ontologyModules, eq(actionTypes.moduleId, ontologyModules.id))
    .where(eq(actionTypes.workspaceId, workspaceId))
    .orderBy(ontologyModules.key, actionTypes.displayName);
  const stats = rows.length
    ? await db
        .select({ actionTypeId: actionSubmissions.actionTypeId, status: actionSubmissions.status, n: count(), lastAt: max(actionSubmissions.createdAt) })
        .from(actionSubmissions)
        .where(inArray(actionSubmissions.actionTypeId, rows.map((r) => r.actionType.id)))
        .groupBy(actionSubmissions.actionTypeId, actionSubmissions.status)
    : [];
  return rows.map(({ actionType, module }) => {
    const mine = stats.filter((s) => s.actionTypeId === actionType.id);
    const lastAt = mine.reduce<Date | null>((a, s) => (s.lastAt && (!a || s.lastAt > a) ? s.lastAt : a), null);
    return {
      ...actionType,
      module: { key: module.key, name: module.name, color: module.color },
      definition: parseDefinition(actionType.definitionJson),
      submissions: {
        applied: Number(mine.find((s) => s.status === "applied")?.n ?? 0),
        rejected: Number(mine.find((s) => s.status === "rejected")?.n ?? 0),
        lastAt,
      },
    };
  });
}

export async function listVersions(workspaceId: number, key: string) {
  const db = getDb();
  const [cur] = await db
    .select({ id: actionTypes.id })
    .from(actionTypes)
    .where(and(eq(actionTypes.workspaceId, workspaceId), eq(actionTypes.key, key)))
    .limit(1);
  if (!cur) throw new ActionTypeNotFound(`action type "${key}" not found`);
  return db.select().from(actionTypeVersions).where(eq(actionTypeVersions.actionTypeId, cur.id)).orderBy(desc(actionTypeVersions.version));
}

/** The class and every class below it, for finding objects an object parameter accepts. */
export async function classWithDescendants(workspaceId: number, classIri: string): Promise<string[]> {
  const rows = await getDb()
    .select({ id: ontologyClasses.id, iri: ontologyClasses.iri, parentId: ontologyClasses.parentId })
    .from(ontologyClasses)
    .innerJoin(ontologyModules, eq(ontologyClasses.moduleId, ontologyModules.id))
    .where(eq(ontologyModules.workspaceId, workspaceId));
  const out = new Set([classIri]);
  const ids = new Set(rows.filter((r) => r.iri === classIri).map((r) => r.id));
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of rows) {
      if (r.parentId !== null && ids.has(r.parentId) && !ids.has(r.id)) {
        ids.add(r.id);
        out.add(r.iri);
        grew = true;
      }
    }
  }
  return [...out];
}

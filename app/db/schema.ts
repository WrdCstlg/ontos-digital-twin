import {
  mysqlTable,
  mysqlEnum,
  varchar,
  char,
  text,
  timestamp,
  bigint,
  int,
  tinyint,
  double,
  boolean,
  json,
  index,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: bigint("id", { mode: "number", unsigned: true })
    .autoincrement()
    .primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  avatar: text("avatar"),
  passwordHash: varchar("passwordHash", { length: 255 }),
  role: mysqlEnum("role", ["user", "admin", "viewer", "ontologist", "editor"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/* ─────────────────────────────────────────────────────────────
 * Ontos — ontology management + living knowledge graph tables
 * ───────────────────────────────────────────────────────────── */

export const workspaces = mysqlTable("workspaces", {
  id: bigint("id", { mode: "number", unsigned: true })
    .autoincrement()
    .primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  plan: varchar("plan", { length: 64 }).notNull().default("enterprise"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Workspace = typeof workspaces.$inferSelect;

export const workspaceMembers = mysqlTable(
  "workspace_members",
  {
    id: bigint("id", { mode: "number", unsigned: true })
      .autoincrement()
      .primaryKey(),
    workspaceId: bigint("workspaceId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: bigint("userId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: mysqlEnum("role", ["viewer", "editor", "ontologist", "admin"])
      .notNull()
      .default("viewer"),
    moduleScope: json("moduleScope"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("workspace_members_ws_user_unique").on(table.workspaceId, table.userId),
    index("workspace_members_ws_idx").on(table.workspaceId),
    index("workspace_members_user_idx").on(table.userId),
  ],
);
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;

export const ontologyModules = mysqlTable(
  "ontology_modules",
  {
    id: bigint("id", { mode: "number", unsigned: true })
    .autoincrement()
    .primaryKey(),
    workspaceId: bigint("workspaceId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 64 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    prefix: varchar("prefix", { length: 32 }).notNull(),
    color: varchar("color", { length: 32 }).notNull(),
    version: varchar("version", { length: 32 }).notNull(),
    status: mysqlEnum("status", ["active", "draft", "deprecated"])
      .notNull()
      .default("active"),
    description: text("description"),
    documentation: text("documentation"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("ontology_modules_ws_key").on(table.workspaceId, table.key)],
);
export type OntologyModule = typeof ontologyModules.$inferSelect;

export const ontologyClasses = mysqlTable(
  "ontology_classes",
  {
    id: bigint("id", { mode: "number", unsigned: true })
    .autoincrement()
    .primaryKey(),
    moduleId: bigint("moduleId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => ontologyModules.id, { onDelete: "cascade" }),
    iri: varchar("iri", { length: 512 }).notNull(),
    label: varchar("label", { length: 255 }).notNull(),
    parentId: bigint("parentId", { mode: "number", unsigned: true }),
    definition: text("definition"),
    isCustom: boolean("isCustom").notNull().default(false),
    deprecated: boolean("deprecated").notNull().default(false),
    shaclJson: json("shaclJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("ontology_classes_module_iri").on(table.moduleId, table.iri)],
);
export type OntologyClass = typeof ontologyClasses.$inferSelect;

export const ontologyProperties = mysqlTable(
  "ontology_properties",
  {
    id: bigint("id", { mode: "number", unsigned: true })
    .autoincrement()
    .primaryKey(),
    moduleId: bigint("moduleId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => ontologyModules.id, { onDelete: "cascade" }),
    iri: varchar("iri", { length: 512 }).notNull(),
    label: varchar("label", { length: 255 }).notNull(),
    kind: mysqlEnum("kind", ["object", "datatype"]).notNull(),
    domainClassId: bigint("domainClassId", { mode: "number", unsigned: true }),
    rangeClassId: bigint("rangeClassId", { mode: "number", unsigned: true }),
    rangeDatatype: varchar("rangeDatatype", { length: 128 }),
    cardinality: varchar("cardinality", { length: 32 }),
    definition: text("definition"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ontology_properties_module_iri").on(table.moduleId, table.iri),
  ],
);
export type OntologyProperty = typeof ontologyProperties.$inferSelect;

export const ontologyVersions = mysqlTable("ontology_versions", {
  id: bigint("id", { mode: "number", unsigned: true })
    .autoincrement()
    .primaryKey(),
  moduleId: bigint("moduleId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => ontologyModules.id, { onDelete: "cascade" }),
  version: varchar("version", { length: 32 }).notNull(),
  changelog: text("changelog"),
  diffJson: json("diffJson"),
  publishedAt: timestamp("publishedAt").defaultNow().notNull(),
});
export type OntologyVersion = typeof ontologyVersions.$inferSelect;

export const connectors = mysqlTable("connectors", {
  id: bigint("id", { mode: "number", unsigned: true })
    .autoincrement()
    .primaryKey(),
  workspaceId: bigint("workspaceId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  type: mysqlEnum("type", ["csv", "sql", "rest"]).notNull(),
  configJson: json("configJson"),
  status: mysqlEnum("status", ["connected", "draft", "error"])
    .notNull()
    .default("draft"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Connector = typeof connectors.$inferSelect;

export const mappings = mysqlTable("mappings", {
  id: bigint("id", { mode: "number", unsigned: true })
    .autoincrement()
    .primaryKey(),
  connectorId: bigint("connectorId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => connectors.id, { onDelete: "cascade" }),
  moduleId: bigint("moduleId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => ontologyModules.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  sourceTable: varchar("sourceTable", { length: 255 }).notNull(),
  classIri: varchar("classIri", { length: 512 }).notNull(),
  columnMapJson: json("columnMapJson"),
  status: mysqlEnum("status", ["draft", "active", "paused"])
    .notNull()
    .default("draft"),
  /**
   * What an import does when the mapped rows fail the class's SHACL shapes:
   * `warn` imports them and records the violations; `block` imports nothing,
   * and nothing unchecked either (services/mappingSync.ts).
   */
  shaclMode: mysqlEnum("shaclMode", ["warn", "block"]).notNull().default("warn"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Mapping = typeof mappings.$inferSelect;

/* ─────────────────────────────────────────────────────────────
 * Background jobs: a durable queue in MySQL. The web app enqueues;
 * worker processes lease a job, renew the lease while they work, and
 * a job whose lease lapses (its worker died) becomes claimable again.
 * ───────────────────────────────────────────────────────────── */
export const jobs = mysqlTable(
  "jobs",
  {
    id: bigint("id", { mode: "number", unsigned: true })
      .autoincrement()
      .primaryKey(),
    workspaceId: bigint("workspaceId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 64 }).notNull(),
    payloadJson: json("payloadJson"),
    status: mysqlEnum("status", ["queued", "running", "succeeded", "failed"])
      .notNull()
      .default("queued"),
    attempts: int("attempts").notNull().default(0),
    maxAttempts: int("maxAttempts").notNull().default(3),
    leaseOwner: varchar("leaseOwner", { length: 128 }),
    leaseExpiresAt: timestamp("leaseExpiresAt"),
    runAfter: timestamp("runAfter").defaultNow().notNull(),
    lastError: text("lastError"),
    resultJson: json("resultJson"),
    createdBy: varchar("createdBy", { length: 255 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    startedAt: timestamp("startedAt"),
    finishedAt: timestamp("finishedAt"),
  },
  (table) => [
    index("jobs_status_run_after").on(table.status, table.runAfter),
    index("jobs_ws_id").on(table.workspaceId, table.id),
  ],
);
export type Job = typeof jobs.$inferSelect;

/** One row per worker process, refreshed by its heartbeat. */
export const workers = mysqlTable("workers", {
  id: varchar("id", { length: 128 }).primaryKey(),
  hostname: varchar("hostname", { length: 255 }).notNull(),
  version: varchar("version", { length: 64 }),
  status: mysqlEnum("status", ["running", "stopping", "stopped"]).notNull().default("running"),
  currentJobId: bigint("currentJobId", { mode: "number", unsigned: true }),
  jobsSucceeded: int("jobsSucceeded").notNull().default(0),
  jobsFailed: int("jobsFailed").notNull().default(0),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
});
export type Worker = typeof workers.$inferSelect;

export const syncJobs = mysqlTable("sync_jobs", {
  id: bigint("id", { mode: "number", unsigned: true })
    .autoincrement()
    .primaryKey(),
  mappingId: bigint("mappingId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => mappings.id, { onDelete: "cascade" }),
  status: mysqlEnum("status", ["queued", "running", "succeeded", "failed"]).notNull(),
  // The queue job that runs this import. Null on rows from before the queue.
  jobId: bigint("jobId", { mode: "number", unsigned: true }).references(() => jobs.id, {
    onDelete: "set null",
  }),
  rowsProcessed: bigint("rowsProcessed", { mode: "number", unsigned: true })
    .notNull()
    .default(0),
  snapshotLabel: varchar("snapshotLabel", { length: 64 }),
  error: text("error"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  finishedAt: timestamp("finishedAt"),
});
export type SyncJob = typeof syncJobs.$inferSelect;

/* ─────────────────────────────────────────────────────────────
 * Action types: named, parameterised edits to the knowledge graph.
 * The definition (parameters, criteria, rules, side effects) is
 * contracts/actions.ts; every saved version is kept, and every
 * submission is recorded with the version it ran.
 * ───────────────────────────────────────────────────────────── */
export const actionTypes = mysqlTable(
  "action_types",
  {
    id: bigint("id", { mode: "number", unsigned: true })
      .autoincrement()
      .primaryKey(),
    workspaceId: bigint("workspaceId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    moduleId: bigint("moduleId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => ontologyModules.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 64 }).notNull(),
    displayName: varchar("displayName", { length: 255 }).notNull(),
    description: text("description"),
    status: mysqlEnum("status", ["active", "draft", "disabled"]).notNull().default("draft"),
    // The lowest workspace role that may submit it.
    minRole: mysqlEnum("minRole", ["viewer", "editor", "ontologist", "admin"]).notNull().default("editor"),
    version: int("version").notNull().default(1),
    definitionJson: json("definitionJson").notNull(),
    createdBy: varchar("createdBy", { length: 255 }),
    updatedBy: varchar("updatedBy", { length: 255 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("action_types_ws_key").on(table.workspaceId, table.key)],
);
export type ActionType = typeof actionTypes.$inferSelect;

export const actionTypeVersions = mysqlTable(
  "action_type_versions",
  {
    id: bigint("id", { mode: "number", unsigned: true })
      .autoincrement()
      .primaryKey(),
    actionTypeId: bigint("actionTypeId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => actionTypes.id, { onDelete: "cascade" }),
    version: int("version").notNull(),
    displayName: varchar("displayName", { length: 255 }).notNull(),
    description: text("description"),
    minRole: mysqlEnum("minRole", ["viewer", "editor", "ontologist", "admin"]).notNull(),
    definitionJson: json("definitionJson").notNull(),
    changedBy: varchar("changedBy", { length: 255 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("action_type_versions_type_version").on(table.actionTypeId, table.version)],
);
export type ActionTypeVersion = typeof actionTypeVersions.$inferSelect;

export const actionSubmissions = mysqlTable(
  "action_submissions",
  {
    id: bigint("id", { mode: "number", unsigned: true })
      .autoincrement()
      .primaryKey(),
    workspaceId: bigint("workspaceId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actionTypeId: bigint("actionTypeId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => actionTypes.id, { onDelete: "cascade" }),
    actionKey: varchar("actionKey", { length: 64 }).notNull(),
    actionVersion: int("actionVersion").notNull(),
    status: mysqlEnum("status", ["applied", "rejected"]).notNull(),
    submittedBy: varchar("submittedBy", { length: 255 }).notNull(),
    userId: bigint("userId", { mode: "number", unsigned: true }),
    paramsJson: json("paramsJson"),
    // What the edits did (applied) or why nothing was done (rejected).
    resultJson: json("resultJson"),
    errorsJson: json("errorsJson"),
    shaclJson: json("shaclJson"),
    sideEffectJobIds: json("sideEffectJobIds"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("action_submissions_ws_id").on(table.workspaceId, table.id),
    index("action_submissions_type_id").on(table.actionTypeId, table.id),
  ],
);
export type ActionSubmission = typeof actionSubmissions.$inferSelect;

/* ─────────────────────────────────────────────────────────────
 * API tokens for the public Ontology API (/api/v1). A token acts
 * in one workspace with a role no higher than its creator's, and
 * optionally a module scope. Only a hash is stored; the token is
 * shown once, when it is created.
 * ───────────────────────────────────────────────────────────── */
export const apiTokens = mysqlTable(
  "api_tokens",
  {
    id: bigint("id", { mode: "number", unsigned: true })
      .autoincrement()
      .primaryKey(),
    workspaceId: bigint("workspaceId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 128 }).notNull(),
    // The token's first characters, shown so people can tell tokens apart.
    prefix: varchar("prefix", { length: 32 }).notNull(),
    tokenHash: varchar("tokenHash", { length: 64 }).notNull(),
    role: mysqlEnum("role", ["viewer", "editor", "ontologist", "admin"]).notNull().default("viewer"),
    // "read" and/or "actions".
    scopes: json("scopes").notNull(),
    moduleScope: json("moduleScope"),
    createdBy: varchar("createdBy", { length: 255 }).notNull(),
    createdByUserId: bigint("createdByUserId", { mode: "number", unsigned: true }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    expiresAt: timestamp("expiresAt"),
    lastUsedAt: timestamp("lastUsedAt"),
    revokedAt: timestamp("revokedAt"),
  },
  (table) => [
    uniqueIndex("api_tokens_hash").on(table.tokenHash),
    index("api_tokens_ws").on(table.workspaceId, table.id),
  ],
);
export type ApiToken = typeof apiTokens.$inferSelect;

export const kgNodes = mysqlTable(
  "kg_nodes",
  {
    id: bigint("id", { mode: "number", unsigned: true })
    .autoincrement()
    .primaryKey(),
    workspaceId: bigint("workspaceId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    moduleKey: varchar("moduleKey", { length: 64 }).notNull(),
    classIri: varchar("classIri", { length: 512 }).notNull(),
    iri: varchar("iri", { length: 512 }).notNull(),
    label: varchar("label", { length: 512 }).notNull(),
    propsJson: json("propsJson"),
    sourceMappingId: bigint("sourceMappingId", {
      mode: "number",
      unsigned: true,
    }),
    // The action submission that created or last changed it, if one did.
    sourceSubmissionId: bigint("sourceSubmissionId", { mode: "number", unsigned: true }),
    deletedAt: timestamp("deletedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("kg_nodes_ws_iri").on(table.workspaceId, table.iri),
    index("kg_nodes_ws_class").on(table.workspaceId, table.classIri),
    index("kg_nodes_ws_module").on(table.workspaceId, table.moduleKey),
  ],
);
export type KgNode = typeof kgNodes.$inferSelect;

export const kgEdges = mysqlTable(
  "kg_edges",
  {
    id: bigint("id", { mode: "number", unsigned: true })
    .autoincrement()
    .primaryKey(),
    workspaceId: bigint("workspaceId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    fromNodeId: bigint("fromNodeId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => kgNodes.id, { onDelete: "cascade" }),
    toNodeId: bigint("toNodeId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => kgNodes.id, { onDelete: "cascade" }),
    predicateIri: varchar("predicateIri", { length: 512 }).notNull(),
    moduleKey: varchar("moduleKey", { length: 64 }),
    sourceMappingId: bigint("sourceMappingId", {
      mode: "number",
      unsigned: true,
    }),
    // The action submission that created or removed it, if one did.
    sourceSubmissionId: bigint("sourceSubmissionId", { mode: "number", unsigned: true }),
    deletedAt: timestamp("deletedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("kg_edges_ws_from").on(table.workspaceId, table.fromNodeId),
    index("kg_edges_ws_to").on(table.workspaceId, table.toNodeId),
    index("kg_edges_ws_predicate").on(table.workspaceId, table.predicateIri),
  ],
);
export type KgEdge = typeof kgEdges.$inferSelect;

export const insights = mysqlTable(
  "insights",
  {
    id: bigint("id", { mode: "number", unsigned: true })
      .autoincrement()
      .primaryKey(),
    workspaceId: bigint("workspaceId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    type: mysqlEnum("type", ["anomaly", "analytics", "narrative"]).notNull(),
    severity: mysqlEnum("severity", ["info", "warn", "risk"]).notNull(),
    ruleId: varchar("ruleId", { length: 128 }),
    title: varchar("title", { length: 512 }).notNull(),
    summary: text("summary"),
    evidenceJson: json("evidenceJson"),
    status: mysqlEnum("status", ["open", "acknowledged"])
      .notNull()
      .default("open"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  // One insight per rule and workspace: reconciliations that run at once (a
  // scan beside live telemetry) meet in the same row (insightsRouter.ts).
  (table) => [uniqueIndex("insights_ws_rule").on(table.workspaceId, table.ruleId)],
);
export type Insight = typeof insights.$inferSelect;

export const auditLog = mysqlTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number", unsigned: true })
    .autoincrement()
    .primaryKey(),
    workspaceId: bigint("workspaceId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actorLabel: varchar("actorLabel", { length: 255 }).notNull(),
    action: varchar("action", { length: 255 }).notNull(),
    entityType: varchar("entityType", { length: 128 }).notNull(),
    entityId: varchar("entityId", { length: 255 }),
    payloadJson: json("payloadJson"),
    hash: varchar("hash", { length: 64 }).notNull(),
    prevHash: varchar("prevHash", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [index("audit_log_ws").on(table.workspaceId, table.id)],
);
export type AuditEntry = typeof auditLog.$inferSelect;

/**
 * One row, locked by every append to an audit chain before it reads its
 * chain's last entry (services/audit.ts): appends take turns on it. Reading the
 * last entry under lock alone took gap locks at the chain's end, which reach
 * into a neighbouring workspace's chain, and on which concurrent appends
 * deadlocked.
 */
export const auditChainLock = mysqlTable("audit_chain_lock", {
  id: tinyint("id", { unsigned: true }).primaryKey(),
});

/**
 * Each workspace's graph version: bumped by every transaction that changes
 * what the workspace's graph renders to, as that transaction's last graph
 * write (services/graphChanges.ts). The row stays locked until the
 * transaction commits, so versions commit in order and none is skipped; a
 * rolled-back change takes its version with it. A semantic engine that holds
 * version V holds every change up to V.
 */
export const graphVersions = mysqlTable("graph_versions", {
  workspaceId: bigint("workspaceId", { mode: "number", unsigned: true })
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  /** The last committed change. */
  version: bigint("version", { mode: "number", unsigned: true }).notNull().default(0),
  /** New whenever the graph was replaced rather than changed (a seed, a restore): engines rebuild. */
  epoch: char("epoch", { length: 36 }).notNull(),
  /** graph_dirty rows up to here may have been pruned: an engine older than this rebuilds. */
  minRetainedVersion: bigint("minRetainedVersion", { mode: "number", unsigned: true }).notNull().default(0),
  /** The last version an engine confirmed it holds. */
  projectedVersion: bigint("projectedVersion", { mode: "number", unsigned: true }).notNull().default(0),
  projectedAt: timestamp("projectedAt", { fsp: 3 }),
});
export type GraphVersion = typeof graphVersions.$inferSelect;

/**
 * What changed, and in which version last: one row per subject, however
 * often it changed, so a twin updated a thousand times is one row. An
 * `incoming` row marks the nodes that link to that node (it came into the
 * graph or left it, and a link renders only to a live node). A `workspace`
 * row (subjectId 0) is a change every subject's rendering may depend on (a
 * module's prefix, a property's range): the graph is rebuilt.
 */
export const graphDirty = mysqlTable(
  "graph_dirty",
  {
    workspaceId: bigint("workspaceId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    subjectKind: mysqlEnum("subjectKind", ["node", "incoming", "class", "property", "workspace"]).notNull(),
    subjectId: bigint("subjectId", { mode: "number", unsigned: true }).notNull(),
    version: bigint("version", { mode: "number", unsigned: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.subjectKind, table.subjectId] }),
    index("graph_dirty_ws_version").on(table.workspaceId, table.version),
  ],
);
export type GraphDirtyRow = typeof graphDirty.$inferSelect;

/* ─────────────────────────────────────────────────────────────
 * Digital twin state history — one row per (twin, telemetry key,
 * timestamp). Current state lives on kg_nodes.propsJson; this table
 * is the append-only time series behind it.
 * ───────────────────────────────────────────────────────────── */
export const twinStateLog = mysqlTable(
  "twin_state_log",
  {
    id: bigint("id", { mode: "number", unsigned: true })
      .autoincrement()
      .primaryKey(),
    nodeId: bigint("nodeId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => kgNodes.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 64 }).notNull(),
    valueNum: double("valueNum"),
    valueText: varchar("valueText", { length: 255 }),
    unit: varchar("unit", { length: 32 }),
    recordedAt: timestamp("recordedAt").notNull(),
  },
  (table) => [
    index("twin_state_log_node_key_time").on(
      table.nodeId,
      table.key,
      table.recordedAt,
    ),
  ],
);
export type TwinStateLogEntry = typeof twinStateLog.$inferSelect;

export const graphSnapshots = mysqlTable("graph_snapshots", {
  id: bigint("id", { mode: "number", unsigned: true })
    .autoincrement()
    .primaryKey(),
  workspaceId: bigint("workspaceId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  label: varchar("label", { length: 64 }).notNull(),
  statsJson: json("statsJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type GraphSnapshot = typeof graphSnapshots.$inferSelect;

/* ─────────────────────────────────────────────────────────────
 * IoT Telemetry Connectors — configuration for external IoT brokers
 * (Generic MQTT, AWS IoT Core, Azure IoT Hub, HTTP Webhook)
 * ───────────────────────────────────────────────────────────── */
export const iotConnectors = mysqlTable(
  "iot_connectors",
  {
    id: bigint("id", { mode: "number", unsigned: true })
      .autoincrement()
      .primaryKey(),
    workspaceId: bigint("workspaceId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    brokerType: mysqlEnum("brokerType", ["mqtt", "aws_iot", "azure_iot", "webhook"]).notNull(),
    endpointUrl: varchar("endpointUrl", { length: 512 }).notNull(),
    topicPattern: varchar("topicPattern", { length: 512 }),
    clientId: varchar("clientId", { length: 255 }),
    authType: mysqlEnum("authType", ["none", "basic", "tls_cert", "sas_token", "api_key"]).notNull().default("none"),
    configJson: json("configJson"),
    // Desired state, set by the workspace's admins: whether it should run, and
    // which edit of its settings. The IoT consumer restarts it when the version
    // moves (services/iot/iotConsumer.ts).
    enabled: boolean("enabled").notNull().default(true),
    configVersion: int("configVersion", { unsigned: true }).notNull().default(1),
    // Observed state, written by the consumer that holds the IoT lease: the
    // status and counters below, the settings version they describe, who
    // reported them and when. Until the version matches, the change is pending.
    status: mysqlEnum("status", ["connected", "disconnected", "error", "disabled"]).notNull().default("disconnected"),
    lastConnectedAt: timestamp("lastConnectedAt"),
    messageCount: bigint("messageCount", { mode: "number", unsigned: true }).default(0).notNull(),
    errorCount: bigint("errorCount", { mode: "number", unsigned: true }).default(0).notNull(),
    lastError: text("lastError"),
    observedVersion: int("observedVersion", { unsigned: true }),
    consumerOwner: varchar("consumerOwner", { length: 128 }),
    observedAt: timestamp("observedAt", { fsp: 3 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("iot_connectors_ws").on(table.workspaceId),
    index("iot_connectors_status").on(table.status),
  ],
);
export type IotConnector = typeof iotConnectors.$inferSelect;
export type InsertIotConnector = typeof iotConnectors.$inferInsert;

/**
 * Broker messages already recorded, by connector: a message the broker
 * delivers again (it does, after a consumer hands over) is recognised and has
 * no second effect. Rows older than a week are pruned (services/iot/iotConsumer.ts).
 */
export const iotMessageSeen = mysqlTable(
  "iot_message_seen",
  {
    // The connector's id; 0 for the broker IOT_BROKER_URL names, which has no row.
    connectorId: bigint("connectorId", { mode: "number", unsigned: true }).notNull(),
    // SHA-256, hex, of the payload's message id when it has one, else of topic and payload.
    fingerprint: char("fingerprint", { length: 64 }).notNull(),
    seenAt: timestamp("seenAt").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.connectorId, table.fingerprint] }),
    index("iot_message_seen_at").on(table.seenAt),
  ],
);

/* ─────────────────────────────────────────────────────────────
 * Leases: work exactly one process may do at a time, whatever the
 * number of processes (the IoT consumer, `iot-consumer`). Held on the
 * database's clock; the generation, raised on every acquisition, fences
 * out a holder that lost it (services/leases.ts).
 * ───────────────────────────────────────────────────────────── */
export const leases = mysqlTable("leases", {
  name: varchar("name", { length: 128 }).primaryKey(),
  // The holding process, as workers.id names one; null once released.
  owner: varchar("owner", { length: 128 }),
  generation: bigint("generation", { mode: "number", unsigned: true }).notNull().default(0),
  expiresAt: timestamp("expiresAt", { fsp: 3 }),
  acquiredAt: timestamp("acquiredAt", { fsp: 3 }),
  renewedAt: timestamp("renewedAt", { fsp: 3 }),
});
export type LeaseRow = typeof leases.$inferSelect;


import {
  mysqlTable,
  mysqlEnum,
  varchar,
  text,
  timestamp,
  bigint,
  double,
  boolean,
  json,
  index,
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

export const workspaceMembers = mysqlTable("workspace_members", {
  id: bigint("id", { mode: "number", unsigned: true })
    .autoincrement()
    .primaryKey(),
  workspaceId: bigint("workspaceId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => workspaces.id),
  userId: bigint("userId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => users.id),
  role: mysqlEnum("role", ["viewer", "editor", "ontologist", "admin"])
    .notNull()
    .default("viewer"),
  moduleScope: json("moduleScope"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;

export const ontologyModules = mysqlTable(
  "ontology_modules",
  {
    id: bigint("id", { mode: "number", unsigned: true })
    .autoincrement()
    .primaryKey(),
    workspaceId: bigint("workspaceId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => workspaces.id),
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
      .references(() => ontologyModules.id),
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
      .references(() => ontologyModules.id),
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
    .references(() => ontologyModules.id),
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
    .references(() => workspaces.id),
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
    .references(() => connectors.id),
  moduleId: bigint("moduleId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => ontologyModules.id),
  name: varchar("name", { length: 255 }).notNull(),
  sourceTable: varchar("sourceTable", { length: 255 }).notNull(),
  classIri: varchar("classIri", { length: 512 }).notNull(),
  columnMapJson: json("columnMapJson"),
  status: mysqlEnum("status", ["draft", "active", "paused"])
    .notNull()
    .default("draft"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Mapping = typeof mappings.$inferSelect;

export const syncJobs = mysqlTable("sync_jobs", {
  id: bigint("id", { mode: "number", unsigned: true })
    .autoincrement()
    .primaryKey(),
  mappingId: bigint("mappingId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => mappings.id),
  status: mysqlEnum("status", ["running", "succeeded", "failed"]).notNull(),
  rowsProcessed: bigint("rowsProcessed", { mode: "number", unsigned: true })
    .notNull()
    .default(0),
  snapshotLabel: varchar("snapshotLabel", { length: 64 }),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  finishedAt: timestamp("finishedAt"),
});
export type SyncJob = typeof syncJobs.$inferSelect;

export const kgNodes = mysqlTable(
  "kg_nodes",
  {
    id: bigint("id", { mode: "number", unsigned: true })
    .autoincrement()
    .primaryKey(),
    workspaceId: bigint("workspaceId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => workspaces.id),
    moduleKey: varchar("moduleKey", { length: 64 }).notNull(),
    classIri: varchar("classIri", { length: 512 }).notNull(),
    iri: varchar("iri", { length: 512 }).notNull(),
    label: varchar("label", { length: 512 }).notNull(),
    propsJson: json("propsJson"),
    sourceMappingId: bigint("sourceMappingId", {
      mode: "number",
      unsigned: true,
    }),
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
      .references(() => workspaces.id),
    fromNodeId: bigint("fromNodeId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => kgNodes.id),
    toNodeId: bigint("toNodeId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => kgNodes.id),
    predicateIri: varchar("predicateIri", { length: 512 }).notNull(),
    moduleKey: varchar("moduleKey", { length: 64 }),
    sourceMappingId: bigint("sourceMappingId", {
      mode: "number",
      unsigned: true,
    }),
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

export const insights = mysqlTable("insights", {
  id: bigint("id", { mode: "number", unsigned: true })
    .autoincrement()
    .primaryKey(),
  workspaceId: bigint("workspaceId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => workspaces.id),
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
});
export type Insight = typeof insights.$inferSelect;

export const auditLog = mysqlTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number", unsigned: true })
    .autoincrement()
    .primaryKey(),
    workspaceId: bigint("workspaceId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => workspaces.id),
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
      .references(() => kgNodes.id),
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
    .references(() => workspaces.id),
  label: varchar("label", { length: 64 }).notNull(),
  statsJson: json("statsJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type GraphSnapshot = typeof graphSnapshots.$inferSelect;

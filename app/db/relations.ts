import { relations } from "drizzle-orm";
import {
  workspaces,
  workspaceMembers,
  ontologyModules,
  ontologyClasses,
  ontologyProperties,
  ontologyVersions,
  connectors,
  mappings,
  syncJobs,
  kgNodes,
  kgEdges,
  insights,
  auditLog,
  graphSnapshots,
  twinStateLog,
  iotConnectors,
} from "./schema";

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  members: many(workspaceMembers),
  modules: many(ontologyModules),
  connectors: many(connectors),
  iotConnectors: many(iotConnectors),
  nodes: many(kgNodes),
  edges: many(kgEdges),
  insights: many(insights),
  audit: many(auditLog),
  snapshots: many(graphSnapshots),
}));

export const ontologyModulesRelations = relations(
  ontologyModules,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [ontologyModules.workspaceId],
      references: [workspaces.id],
    }),
    classes: many(ontologyClasses),
    properties: many(ontologyProperties),
    versions: many(ontologyVersions),
    mappings: many(mappings),
  }),
);

export const ontologyClassesRelations = relations(
  ontologyClasses,
  ({ one, many }) => ({
    module: one(ontologyModules, {
      fields: [ontologyClasses.moduleId],
      references: [ontologyModules.id],
    }),
    properties: many(ontologyProperties),
  }),
);

export const ontologyPropertiesRelations = relations(
  ontologyProperties,
  ({ one }) => ({
    module: one(ontologyModules, {
      fields: [ontologyProperties.moduleId],
      references: [ontologyModules.id],
    }),
  }),
);

export const connectorsRelations = relations(connectors, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [connectors.workspaceId],
    references: [workspaces.id],
  }),
  mappings: many(mappings),
}));

export const mappingsRelations = relations(mappings, ({ one, many }) => ({
  connector: one(connectors, {
    fields: [mappings.connectorId],
    references: [connectors.id],
  }),
  module: one(ontologyModules, {
    fields: [mappings.moduleId],
    references: [ontologyModules.id],
  }),
  syncJobs: many(syncJobs),
}));

export const syncJobsRelations = relations(syncJobs, ({ one }) => ({
  mapping: one(mappings, {
    fields: [syncJobs.mappingId],
    references: [mappings.id],
  }),
}));

export const kgNodesRelations = relations(kgNodes, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [kgNodes.workspaceId],
    references: [workspaces.id],
  }),
  outgoing: many(kgEdges, { relationName: "from" }),
  incoming: many(kgEdges, { relationName: "to" }),
  stateLog: many(twinStateLog),
}));

export const kgEdgesRelations = relations(kgEdges, ({ one }) => ({
  from: one(kgNodes, {
    fields: [kgEdges.fromNodeId],
    references: [kgNodes.id],
    relationName: "from",
  }),
  to: one(kgNodes, {
    fields: [kgEdges.toNodeId],
    references: [kgNodes.id],
    relationName: "to",
  }),
}));

export const twinStateLogRelations = relations(twinStateLog, ({ one }) => ({
  node: one(kgNodes, {
    fields: [twinStateLog.nodeId],
    references: [kgNodes.id],
  }),
}));

export const iotConnectorsRelations = relations(iotConnectors, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [iotConnectors.workspaceId],
    references: [workspaces.id],
  }),
}));



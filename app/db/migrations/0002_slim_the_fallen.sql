ALTER TABLE `audit_log` DROP FOREIGN KEY `audit_log_workspaceId_workspaces_id_fk`;
--> statement-breakpoint
ALTER TABLE `connectors` DROP FOREIGN KEY `connectors_workspaceId_workspaces_id_fk`;
--> statement-breakpoint
ALTER TABLE `graph_snapshots` DROP FOREIGN KEY `graph_snapshots_workspaceId_workspaces_id_fk`;
--> statement-breakpoint
ALTER TABLE `insights` DROP FOREIGN KEY `insights_workspaceId_workspaces_id_fk`;
--> statement-breakpoint
ALTER TABLE `iot_connectors` DROP FOREIGN KEY `iot_connectors_workspaceId_workspaces_id_fk`;
--> statement-breakpoint
ALTER TABLE `kg_edges` DROP FOREIGN KEY `kg_edges_workspaceId_workspaces_id_fk`;
--> statement-breakpoint
ALTER TABLE `kg_edges` DROP FOREIGN KEY `kg_edges_fromNodeId_kg_nodes_id_fk`;
--> statement-breakpoint
ALTER TABLE `kg_edges` DROP FOREIGN KEY `kg_edges_toNodeId_kg_nodes_id_fk`;
--> statement-breakpoint
ALTER TABLE `kg_nodes` DROP FOREIGN KEY `kg_nodes_workspaceId_workspaces_id_fk`;
--> statement-breakpoint
ALTER TABLE `mappings` DROP FOREIGN KEY `mappings_connectorId_connectors_id_fk`;
--> statement-breakpoint
ALTER TABLE `mappings` DROP FOREIGN KEY `mappings_moduleId_ontology_modules_id_fk`;
--> statement-breakpoint
ALTER TABLE `ontology_modules` DROP FOREIGN KEY `ontology_modules_workspaceId_workspaces_id_fk`;
--> statement-breakpoint
ALTER TABLE `sync_jobs` DROP FOREIGN KEY `sync_jobs_mappingId_mappings_id_fk`;
--> statement-breakpoint
ALTER TABLE `twin_state_log` DROP FOREIGN KEY `twin_state_log_nodeId_kg_nodes_id_fk`;
--> statement-breakpoint
ALTER TABLE `workspace_members` DROP FOREIGN KEY `workspace_members_workspaceId_workspaces_id_fk`;
--> statement-breakpoint
ALTER TABLE `workspace_members` DROP FOREIGN KEY `workspace_members_userId_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_ws_user_unique` UNIQUE(`workspaceId`,`userId`);--> statement-breakpoint
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `connectors` ADD CONSTRAINT `connectors_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `graph_snapshots` ADD CONSTRAINT `graph_snapshots_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `insights` ADD CONSTRAINT `insights_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `iot_connectors` ADD CONSTRAINT `iot_connectors_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `kg_edges` ADD CONSTRAINT `kg_edges_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `kg_edges` ADD CONSTRAINT `kg_edges_fromNodeId_kg_nodes_id_fk` FOREIGN KEY (`fromNodeId`) REFERENCES `kg_nodes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `kg_edges` ADD CONSTRAINT `kg_edges_toNodeId_kg_nodes_id_fk` FOREIGN KEY (`toNodeId`) REFERENCES `kg_nodes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `kg_nodes` ADD CONSTRAINT `kg_nodes_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `mappings` ADD CONSTRAINT `mappings_connectorId_connectors_id_fk` FOREIGN KEY (`connectorId`) REFERENCES `connectors`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `mappings` ADD CONSTRAINT `mappings_moduleId_ontology_modules_id_fk` FOREIGN KEY (`moduleId`) REFERENCES `ontology_modules`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ontology_modules` ADD CONSTRAINT `ontology_modules_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sync_jobs` ADD CONSTRAINT `sync_jobs_mappingId_mappings_id_fk` FOREIGN KEY (`mappingId`) REFERENCES `mappings`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `twin_state_log` ADD CONSTRAINT `twin_state_log_nodeId_kg_nodes_id_fk` FOREIGN KEY (`nodeId`) REFERENCES `kg_nodes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `workspace_members_ws_idx` ON `workspace_members` (`workspaceId`);--> statement-breakpoint
CREATE INDEX `workspace_members_user_idx` ON `workspace_members` (`userId`);
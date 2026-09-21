CREATE TABLE `audit_log` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspaceId` bigint unsigned NOT NULL,
	`actorLabel` varchar(255) NOT NULL,
	`action` varchar(255) NOT NULL,
	`entityType` varchar(128) NOT NULL,
	`entityId` varchar(255),
	`payloadJson` json,
	`hash` varchar(64) NOT NULL,
	`prevHash` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `connectors` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspaceId` bigint unsigned NOT NULL,
	`name` varchar(255) NOT NULL,
	`type` enum('csv','sql','rest') NOT NULL,
	`configJson` json,
	`status` enum('connected','draft','error') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `connectors_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `graph_snapshots` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspaceId` bigint unsigned NOT NULL,
	`label` varchar(64) NOT NULL,
	`statsJson` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `graph_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `insights` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspaceId` bigint unsigned NOT NULL,
	`type` enum('anomaly','analytics','narrative') NOT NULL,
	`severity` enum('info','warn','risk') NOT NULL,
	`ruleId` varchar(128),
	`title` varchar(512) NOT NULL,
	`summary` text,
	`evidenceJson` json,
	`status` enum('open','acknowledged') NOT NULL DEFAULT 'open',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `insights_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `kg_edges` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspaceId` bigint unsigned NOT NULL,
	`fromNodeId` bigint unsigned NOT NULL,
	`toNodeId` bigint unsigned NOT NULL,
	`predicateIri` varchar(512) NOT NULL,
	`moduleKey` varchar(64),
	`sourceMappingId` bigint unsigned,
	`deletedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `kg_edges_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `kg_nodes` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspaceId` bigint unsigned NOT NULL,
	`moduleKey` varchar(64) NOT NULL,
	`classIri` varchar(512) NOT NULL,
	`iri` varchar(512) NOT NULL,
	`label` varchar(512) NOT NULL,
	`propsJson` json,
	`sourceMappingId` bigint unsigned,
	`deletedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `kg_nodes_id` PRIMARY KEY(`id`),
	CONSTRAINT `kg_nodes_ws_iri` UNIQUE(`workspaceId`,`iri`)
);
--> statement-breakpoint
CREATE TABLE `mappings` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`connectorId` bigint unsigned NOT NULL,
	`moduleId` bigint unsigned NOT NULL,
	`name` varchar(255) NOT NULL,
	`sourceTable` varchar(255) NOT NULL,
	`classIri` varchar(512) NOT NULL,
	`columnMapJson` json,
	`status` enum('draft','active','paused') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mappings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ontology_classes` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`moduleId` bigint unsigned NOT NULL,
	`iri` varchar(512) NOT NULL,
	`label` varchar(255) NOT NULL,
	`parentId` bigint unsigned,
	`definition` text,
	`isCustom` boolean NOT NULL DEFAULT false,
	`deprecated` boolean NOT NULL DEFAULT false,
	`shaclJson` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ontology_classes_id` PRIMARY KEY(`id`),
	CONSTRAINT `ontology_classes_module_iri` UNIQUE(`moduleId`,`iri`)
);
--> statement-breakpoint
CREATE TABLE `ontology_modules` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspaceId` bigint unsigned NOT NULL,
	`key` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`prefix` varchar(32) NOT NULL,
	`color` varchar(32) NOT NULL,
	`version` varchar(32) NOT NULL,
	`status` enum('active','draft','deprecated') NOT NULL DEFAULT 'active',
	`description` text,
	`documentation` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ontology_modules_id` PRIMARY KEY(`id`),
	CONSTRAINT `ontology_modules_ws_key` UNIQUE(`workspaceId`,`key`)
);
--> statement-breakpoint
CREATE TABLE `ontology_properties` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`moduleId` bigint unsigned NOT NULL,
	`iri` varchar(512) NOT NULL,
	`label` varchar(255) NOT NULL,
	`kind` enum('object','datatype') NOT NULL,
	`domainClassId` bigint unsigned,
	`rangeClassId` bigint unsigned,
	`rangeDatatype` varchar(128),
	`cardinality` varchar(32),
	`definition` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ontology_properties_id` PRIMARY KEY(`id`),
	CONSTRAINT `ontology_properties_module_iri` UNIQUE(`moduleId`,`iri`)
);
--> statement-breakpoint
CREATE TABLE `ontology_versions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`moduleId` bigint unsigned NOT NULL,
	`version` varchar(32) NOT NULL,
	`changelog` text,
	`diffJson` json,
	`publishedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ontology_versions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sync_jobs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`mappingId` bigint unsigned NOT NULL,
	`status` enum('running','succeeded','failed') NOT NULL,
	`rowsProcessed` bigint unsigned NOT NULL DEFAULT 0,
	`snapshotLabel` varchar(64),
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`finishedAt` timestamp,
	CONSTRAINT `sync_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `twin_state_log` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`nodeId` bigint unsigned NOT NULL,
	`key` varchar(64) NOT NULL,
	`valueNum` double,
	`valueText` varchar(255),
	`unit` varchar(32),
	`recordedAt` timestamp NOT NULL,
	CONSTRAINT `twin_state_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`email` varchar(320) NOT NULL,
	`name` varchar(255),
	`avatar` text,
	`passwordHash` varchar(255),
	`role` enum('user','admin','viewer','ontologist','editor') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	`lastSignInAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspaceId` bigint unsigned NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`role` enum('viewer','editor','ontologist','admin') NOT NULL DEFAULT 'viewer',
	`moduleScope` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `workspace_members_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`slug` varchar(255) NOT NULL,
	`plan` varchar(64) NOT NULL DEFAULT 'enterprise',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `workspaces_id` PRIMARY KEY(`id`),
	CONSTRAINT `workspaces_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `connectors` ADD CONSTRAINT `connectors_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `graph_snapshots` ADD CONSTRAINT `graph_snapshots_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `insights` ADD CONSTRAINT `insights_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `kg_edges` ADD CONSTRAINT `kg_edges_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `kg_edges` ADD CONSTRAINT `kg_edges_fromNodeId_kg_nodes_id_fk` FOREIGN KEY (`fromNodeId`) REFERENCES `kg_nodes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `kg_edges` ADD CONSTRAINT `kg_edges_toNodeId_kg_nodes_id_fk` FOREIGN KEY (`toNodeId`) REFERENCES `kg_nodes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `kg_nodes` ADD CONSTRAINT `kg_nodes_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `mappings` ADD CONSTRAINT `mappings_connectorId_connectors_id_fk` FOREIGN KEY (`connectorId`) REFERENCES `connectors`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `mappings` ADD CONSTRAINT `mappings_moduleId_ontology_modules_id_fk` FOREIGN KEY (`moduleId`) REFERENCES `ontology_modules`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ontology_classes` ADD CONSTRAINT `ontology_classes_moduleId_ontology_modules_id_fk` FOREIGN KEY (`moduleId`) REFERENCES `ontology_modules`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ontology_modules` ADD CONSTRAINT `ontology_modules_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ontology_properties` ADD CONSTRAINT `ontology_properties_moduleId_ontology_modules_id_fk` FOREIGN KEY (`moduleId`) REFERENCES `ontology_modules`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ontology_versions` ADD CONSTRAINT `ontology_versions_moduleId_ontology_modules_id_fk` FOREIGN KEY (`moduleId`) REFERENCES `ontology_modules`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sync_jobs` ADD CONSTRAINT `sync_jobs_mappingId_mappings_id_fk` FOREIGN KEY (`mappingId`) REFERENCES `mappings`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `twin_state_log` ADD CONSTRAINT `twin_state_log_nodeId_kg_nodes_id_fk` FOREIGN KEY (`nodeId`) REFERENCES `kg_nodes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_log_ws` ON `audit_log` (`workspaceId`,`id`);--> statement-breakpoint
CREATE INDEX `kg_edges_ws_from` ON `kg_edges` (`workspaceId`,`fromNodeId`);--> statement-breakpoint
CREATE INDEX `kg_edges_ws_to` ON `kg_edges` (`workspaceId`,`toNodeId`);--> statement-breakpoint
CREATE INDEX `kg_edges_ws_predicate` ON `kg_edges` (`workspaceId`,`predicateIri`);--> statement-breakpoint
CREATE INDEX `kg_nodes_ws_class` ON `kg_nodes` (`workspaceId`,`classIri`);--> statement-breakpoint
CREATE INDEX `kg_nodes_ws_module` ON `kg_nodes` (`workspaceId`,`moduleKey`);--> statement-breakpoint
CREATE INDEX `twin_state_log_node_key_time` ON `twin_state_log` (`nodeId`,`key`,`recordedAt`);
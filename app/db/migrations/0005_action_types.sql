CREATE TABLE `action_submissions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspaceId` bigint unsigned NOT NULL,
	`actionTypeId` bigint unsigned NOT NULL,
	`actionKey` varchar(64) NOT NULL,
	`actionVersion` int NOT NULL,
	`status` enum('applied','rejected') NOT NULL,
	`submittedBy` varchar(255) NOT NULL,
	`userId` bigint unsigned,
	`paramsJson` json,
	`resultJson` json,
	`errorsJson` json,
	`shaclJson` json,
	`sideEffectJobIds` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `action_submissions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `action_type_versions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`actionTypeId` bigint unsigned NOT NULL,
	`version` int NOT NULL,
	`displayName` varchar(255) NOT NULL,
	`description` text,
	`minRole` enum('viewer','editor','ontologist','admin') NOT NULL,
	`definitionJson` json NOT NULL,
	`changedBy` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `action_type_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `action_type_versions_type_version` UNIQUE(`actionTypeId`,`version`)
);
--> statement-breakpoint
CREATE TABLE `action_types` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspaceId` bigint unsigned NOT NULL,
	`moduleId` bigint unsigned NOT NULL,
	`key` varchar(64) NOT NULL,
	`displayName` varchar(255) NOT NULL,
	`description` text,
	`status` enum('active','draft','disabled') NOT NULL DEFAULT 'draft',
	`minRole` enum('viewer','editor','ontologist','admin') NOT NULL DEFAULT 'editor',
	`version` int NOT NULL DEFAULT 1,
	`definitionJson` json NOT NULL,
	`createdBy` varchar(255),
	`updatedBy` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `action_types_id` PRIMARY KEY(`id`),
	CONSTRAINT `action_types_ws_key` UNIQUE(`workspaceId`,`key`)
);
--> statement-breakpoint
ALTER TABLE `kg_edges` ADD `sourceSubmissionId` bigint unsigned;--> statement-breakpoint
ALTER TABLE `kg_nodes` ADD `sourceSubmissionId` bigint unsigned;--> statement-breakpoint
ALTER TABLE `action_submissions` ADD CONSTRAINT `action_submissions_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `action_submissions` ADD CONSTRAINT `action_submissions_actionTypeId_action_types_id_fk` FOREIGN KEY (`actionTypeId`) REFERENCES `action_types`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `action_type_versions` ADD CONSTRAINT `action_type_versions_actionTypeId_action_types_id_fk` FOREIGN KEY (`actionTypeId`) REFERENCES `action_types`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `action_types` ADD CONSTRAINT `action_types_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `action_types` ADD CONSTRAINT `action_types_moduleId_ontology_modules_id_fk` FOREIGN KEY (`moduleId`) REFERENCES `ontology_modules`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `action_submissions_ws_id` ON `action_submissions` (`workspaceId`,`id`);--> statement-breakpoint
CREATE INDEX `action_submissions_type_id` ON `action_submissions` (`actionTypeId`,`id`);
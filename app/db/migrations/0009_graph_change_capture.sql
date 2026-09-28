CREATE TABLE `graph_dirty` (
	`workspaceId` bigint unsigned NOT NULL,
	`subjectKind` enum('node','incoming','class','property','workspace') NOT NULL,
	`subjectId` bigint unsigned NOT NULL,
	`version` bigint unsigned NOT NULL,
	CONSTRAINT `graph_dirty_workspaceId_subjectKind_subjectId_pk` PRIMARY KEY(`workspaceId`,`subjectKind`,`subjectId`)
);
--> statement-breakpoint
CREATE TABLE `graph_versions` (
	`workspaceId` bigint unsigned NOT NULL,
	`version` bigint unsigned NOT NULL DEFAULT 0,
	`epoch` char(36) NOT NULL,
	`minRetainedVersion` bigint unsigned NOT NULL DEFAULT 0,
	`projectedVersion` bigint unsigned NOT NULL DEFAULT 0,
	`projectedAt` timestamp(3),
	CONSTRAINT `graph_versions_workspaceId` PRIMARY KEY(`workspaceId`)
);
--> statement-breakpoint
ALTER TABLE `graph_dirty` ADD CONSTRAINT `graph_dirty_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `graph_versions` ADD CONSTRAINT `graph_versions_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `graph_dirty_ws_version` ON `graph_dirty` (`workspaceId`,`version`);--> statement-breakpoint
-- Every workspace starts at version 0, in an epoch of its own: an engine that
-- holds anything from before rebuilds (services/graphChanges.ts).
INSERT INTO `graph_versions` (`workspaceId`, `version`, `epoch`) SELECT `id`, 0, UUID() FROM `workspaces`;

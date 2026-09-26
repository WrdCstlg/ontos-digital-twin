CREATE TABLE `api_tokens` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspaceId` bigint unsigned NOT NULL,
	`name` varchar(128) NOT NULL,
	`prefix` varchar(32) NOT NULL,
	`tokenHash` varchar(64) NOT NULL,
	`role` enum('viewer','editor','ontologist','admin') NOT NULL DEFAULT 'viewer',
	`scopes` json NOT NULL,
	`moduleScope` json,
	`createdBy` varchar(255) NOT NULL,
	`createdByUserId` bigint unsigned,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp,
	`lastUsedAt` timestamp,
	`revokedAt` timestamp,
	CONSTRAINT `api_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `api_tokens_hash` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
ALTER TABLE `api_tokens` ADD CONSTRAINT `api_tokens_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `api_tokens_ws` ON `api_tokens` (`workspaceId`,`id`);
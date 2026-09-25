CREATE TABLE `jobs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspaceId` bigint unsigned NOT NULL,
	`kind` varchar(64) NOT NULL,
	`payloadJson` json,
	`status` enum('queued','running','succeeded','failed') NOT NULL DEFAULT 'queued',
	`attempts` int NOT NULL DEFAULT 0,
	`maxAttempts` int NOT NULL DEFAULT 3,
	`leaseOwner` varchar(128),
	`leaseExpiresAt` timestamp,
	`runAfter` timestamp NOT NULL DEFAULT (now()),
	`lastError` text,
	`resultJson` json,
	`createdBy` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`startedAt` timestamp,
	`finishedAt` timestamp,
	CONSTRAINT `jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `workers` (
	`id` varchar(128) NOT NULL,
	`hostname` varchar(255) NOT NULL,
	`version` varchar(64),
	`status` enum('running','stopping','stopped') NOT NULL DEFAULT 'running',
	`currentJobId` bigint unsigned,
	`jobsSucceeded` int NOT NULL DEFAULT 0,
	`jobsFailed` int NOT NULL DEFAULT 0,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`lastSeenAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `workers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `sync_jobs` MODIFY COLUMN `status` enum('queued','running','succeeded','failed') NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_jobs` ADD `jobId` bigint unsigned;--> statement-breakpoint
ALTER TABLE `sync_jobs` ADD `error` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `jobs_status_run_after` ON `jobs` (`status`,`runAfter`);--> statement-breakpoint
CREATE INDEX `jobs_ws_id` ON `jobs` (`workspaceId`,`id`);--> statement-breakpoint
ALTER TABLE `sync_jobs` ADD CONSTRAINT `sync_jobs_jobId_jobs_id_fk` FOREIGN KEY (`jobId`) REFERENCES `jobs`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Imports that were running in the web process before the queue existed have no job
-- for a worker to lease, so nothing would ever finish them.
UPDATE `sync_jobs` SET `status` = 'failed', `finishedAt` = now(), `error` = 'abandoned: started before the job queue existed' WHERE `status` = 'running' AND `jobId` IS NULL;

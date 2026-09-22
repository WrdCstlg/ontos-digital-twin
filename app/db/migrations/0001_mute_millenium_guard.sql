CREATE TABLE `iot_connectors` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspaceId` bigint unsigned NOT NULL,
	`name` varchar(255) NOT NULL,
	`brokerType` enum('mqtt','aws_iot','azure_iot','webhook') NOT NULL,
	`endpointUrl` varchar(512) NOT NULL,
	`topicPattern` varchar(512),
	`clientId` varchar(255),
	`authType` enum('none','basic','tls_cert','sas_token','api_key') NOT NULL DEFAULT 'none',
	`configJson` json,
	`status` enum('connected','disconnected','error','disabled') NOT NULL DEFAULT 'disconnected',
	`lastConnectedAt` timestamp,
	`messageCount` bigint unsigned NOT NULL DEFAULT 0,
	`errorCount` bigint unsigned NOT NULL DEFAULT 0,
	`lastError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `iot_connectors_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `iot_connectors` ADD CONSTRAINT `iot_connectors_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `iot_connectors_ws` ON `iot_connectors` (`workspaceId`);--> statement-breakpoint
CREATE INDEX `iot_connectors_status` ON `iot_connectors` (`status`);
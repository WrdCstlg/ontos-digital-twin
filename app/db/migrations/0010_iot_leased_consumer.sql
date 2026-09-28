CREATE TABLE `iot_message_seen` (
	`connectorId` bigint unsigned NOT NULL,
	`fingerprint` char(64) NOT NULL,
	`seenAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `iot_message_seen_connectorId_fingerprint_pk` PRIMARY KEY(`connectorId`,`fingerprint`)
);
--> statement-breakpoint
CREATE TABLE `leases` (
	`name` varchar(128) NOT NULL,
	`owner` varchar(128),
	`generation` bigint unsigned NOT NULL DEFAULT 0,
	`expiresAt` timestamp(3),
	`acquiredAt` timestamp(3),
	`renewedAt` timestamp(3),
	CONSTRAINT `leases_name` PRIMARY KEY(`name`)
);
--> statement-breakpoint
ALTER TABLE `iot_connectors` ADD `enabled` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `iot_connectors` ADD `configVersion` int unsigned DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `iot_connectors` ADD `observedVersion` int unsigned;--> statement-breakpoint
ALTER TABLE `iot_connectors` ADD `consumerOwner` varchar(128);--> statement-breakpoint
ALTER TABLE `iot_connectors` ADD `observedAt` timestamp(3);--> statement-breakpoint
-- Until now a connector's status was what it should do and what it did at once:
-- it was meant to run when it ran, or had failed trying.
UPDATE `iot_connectors` SET `enabled` = (`status` IN ('connected', 'error'));--> statement-breakpoint
-- Reconciliations that ran at once could each insert a rule's insight. Of each
-- such pair keep the newer, the one reconciliation went on updating, so that
-- the key below can hold. Rows without a rule are left alone, as the key does.
DELETE `older` FROM `insights` AS `older` JOIN `insights` AS `newer` ON `newer`.`workspaceId` = `older`.`workspaceId` AND `newer`.`ruleId` = `older`.`ruleId` AND `newer`.`id` > `older`.`id`;--> statement-breakpoint
ALTER TABLE `insights` ADD CONSTRAINT `insights_ws_rule` UNIQUE(`workspaceId`,`ruleId`);--> statement-breakpoint
CREATE INDEX `iot_message_seen_at` ON `iot_message_seen` (`seenAt`);
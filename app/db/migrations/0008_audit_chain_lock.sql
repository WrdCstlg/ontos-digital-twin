CREATE TABLE `audit_chain_lock` (
	`id` tinyint unsigned NOT NULL,
	CONSTRAINT `audit_chain_lock_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
-- Its one row. An append that finds it gone makes it again (services/audit.ts).
INSERT INTO `audit_chain_lock` (`id`) VALUES (1);

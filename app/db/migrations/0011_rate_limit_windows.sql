-- The rate limits and the login lockout (api/lib/rateLimit.ts). ON UPDATE
-- names the column's precision: drizzle-kit leaves it out, and MySQL refuses
-- ON UPDATE CURRENT_TIMESTAMP on a timestamp(3).
CREATE TABLE `rate_limit_windows` (
	`bucket` varchar(32) NOT NULL,
	`subject` char(64) NOT NULL,
	`hits` json NOT NULL,
	`updatedAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `rate_limit_windows_bucket_subject_pk` PRIMARY KEY(`bucket`,`subject`)
);
--> statement-breakpoint
CREATE INDEX `rate_limit_windows_updated` ON `rate_limit_windows` (`updatedAt`);
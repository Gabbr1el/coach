CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`objective` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_opened_at` integer,
	`archived_at` integer,
	CONSTRAINT "workspaces_name_length_check" CHECK(length(trim("workspaces"."name")) between 1 and 80),
	CONSTRAINT "workspaces_status_check" CHECK("workspaces"."status" in ('active', 'archived')),
	CONSTRAINT "workspaces_archive_consistency_check" CHECK(("workspaces"."status" = 'active' and "workspaces"."archived_at" is null) or ("workspaces"."status" = 'archived' and "workspaces"."archived_at" is not null))
);
--> statement-breakpoint
CREATE INDEX `workspaces_status_updated_idx` ON `workspaces` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `workspaces_last_opened_idx` ON `workspaces` (`last_opened_at`);
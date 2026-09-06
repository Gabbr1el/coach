CREATE TABLE `roadmap_modules` (
	`id` text PRIMARY KEY NOT NULL,
	`roadmap_id` text NOT NULL,
	`title` text NOT NULL,
	`objective` text NOT NULL,
	`estimated_minutes` integer NOT NULL,
	`position` integer NOT NULL,
	`status` text DEFAULT 'locked' NOT NULL,
	`outcomes_json` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`roadmap_id`) REFERENCES `roadmaps`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "roadmap_modules_status_check" CHECK("roadmap_modules"."status" in ('locked','available','active','completed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roadmap_modules_position_idx` ON `roadmap_modules` (`roadmap_id`,`position`);--> statement-breakpoint
CREATE TABLE `roadmaps` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`version` integer NOT NULL,
	`provider_id` text,
	`model_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "roadmaps_status_check" CHECK("roadmaps"."status" in ('proposed','accepted','archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roadmaps_workspace_version_idx` ON `roadmaps` (`workspace_id`,`version`);--> statement-breakpoint
CREATE INDEX `roadmaps_workspace_status_idx` ON `roadmaps` (`workspace_id`,`status`);
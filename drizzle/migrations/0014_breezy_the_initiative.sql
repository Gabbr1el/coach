CREATE TABLE `project_builds` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`command` text NOT NULL,
	`exit_code` integer,
	`timed_out` integer DEFAULT false NOT NULL,
	`duration_ms` integer NOT NULL,
	`stdout` text DEFAULT '' NOT NULL,
	`stderr` text DEFAULT '' NOT NULL,
	`diagnostics_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `workspace_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_builds_project_created_idx` ON `project_builds` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `project_files` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`path` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `workspace_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_files_path_check" CHECK(length("project_files"."path") between 1 and 240),
	CONSTRAINT "project_files_revision_check" CHECK("project_files"."revision" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_files_project_path_idx` ON `project_files` (`project_id`,`path`);--> statement-breakpoint
CREATE INDEX `project_files_project_updated_idx` ON `project_files` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `project_ui_states` (
	`project_id` text PRIMARY KEY NOT NULL,
	`active_file_id` text NOT NULL,
	`open_file_ids_json` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `workspace_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`active_file_id`) REFERENCES `project_files`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `workspace_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`language` text NOT NULL,
	`entry_file_path` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspace_projects_name_check" CHECK(length(trim("workspace_projects"."name")) between 1 and 120),
	CONSTRAINT "workspace_projects_language_check" CHECK("workspace_projects"."language" in ('python', 'c', 'java'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_projects_one_per_workspace_idx` ON `workspace_projects` (`workspace_id`);
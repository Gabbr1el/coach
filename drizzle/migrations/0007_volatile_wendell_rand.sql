CREATE TABLE `study_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`focus_seconds` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "study_sessions_status_check" CHECK("study_sessions"."status" in ('active', 'completed')),
	CONSTRAINT "study_sessions_end_check" CHECK(("study_sessions"."status" = 'active' and "study_sessions"."ended_at" is null) or ("study_sessions"."status" = 'completed' and "study_sessions"."ended_at" is not null)),
	CONSTRAINT "study_sessions_focus_check" CHECK("study_sessions"."focus_seconds" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX `study_sessions_one_active_per_workspace_idx` ON `study_sessions` (`workspace_id`) WHERE "study_sessions"."status" = 'active';--> statement-breakpoint
CREATE INDEX `study_sessions_workspace_started_idx` ON `study_sessions` (`workspace_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `study_plan_items` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`session_id` text NOT NULL,
	`title` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`position` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `study_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "study_plan_items_title_check" CHECK(length(trim("study_plan_items"."title")) between 1 and 160),
	CONSTRAINT "study_plan_items_duration_check" CHECK("study_plan_items"."duration_minutes" between 1 and 480),
	CONSTRAINT "study_plan_items_position_check" CHECK("study_plan_items"."position" > 0),
	CONSTRAINT "study_plan_items_status_check" CHECK("study_plan_items"."status" in ('pending', 'active', 'completed'))
);--> statement-breakpoint
CREATE UNIQUE INDEX `study_plan_items_session_position_idx` ON `study_plan_items` (`session_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `study_plan_items_one_active_idx` ON `study_plan_items` (`session_id`) WHERE "study_plan_items"."status" = 'active';--> statement-breakpoint
CREATE INDEX `study_plan_items_workspace_idx` ON `study_plan_items` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `workspace_study_states` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`active_session_id` text NOT NULL,
	`file_name` text NOT NULL,
	`language` text NOT NULL,
	`editor_content` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`share_context_with_ai` integer DEFAULT false NOT NULL,
	`timer_duration_seconds` integer DEFAULT 1500 NOT NULL,
	`timer_remaining_seconds` integer DEFAULT 1500 NOT NULL,
	`timer_status` text DEFAULT 'idle' NOT NULL,
	`timer_started_at` integer,
	`updated_at` integer NOT NULL,
	`document_revision` integer DEFAULT 0 NOT NULL,
	`notes_revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`active_session_id`) REFERENCES `study_sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "workspace_study_states_filename_check" CHECK(length(trim("workspace_study_states"."file_name")) between 1 and 120),
	CONSTRAINT "workspace_study_states_timer_check" CHECK("workspace_study_states"."timer_duration_seconds" between 60 and 10800 and "workspace_study_states"."timer_remaining_seconds" between 0 and "workspace_study_states"."timer_duration_seconds"),
	CONSTRAINT "workspace_study_states_timer_status_check" CHECK("workspace_study_states"."timer_status" in ('idle', 'running', 'paused')),
	CONSTRAINT "workspace_study_states_timer_started_check" CHECK(("workspace_study_states"."timer_status" = 'running' and "workspace_study_states"."timer_started_at" is not null) or ("workspace_study_states"."timer_status" != 'running' and "workspace_study_states"."timer_started_at" is null)),
	CONSTRAINT "workspace_study_states_context_check" CHECK("workspace_study_states"."share_context_with_ai" in (0, 1)),
	CONSTRAINT "workspace_study_states_revision_check" CHECK("workspace_study_states"."document_revision" >= 0 and "workspace_study_states"."notes_revision" >= 0)
);

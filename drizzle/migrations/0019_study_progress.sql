CREATE TABLE `study_progress` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`roadmap_id` text NOT NULL,
	`current_module_id` text NOT NULL,
	`current_topic_id` text NOT NULL,
	`current_lesson_id` text NOT NULL,
	`current_checkpoint_id` text,
	`topic_statuses_json` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `study_progress_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`type` text NOT NULL,
	`module_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`checkpoint_id` text,
	`correct` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `study_progress_events_type_check` CHECK("study_progress_events"."type" in ('TOPIC_STARTED','TOPIC_COMPLETED','CHECKPOINT_ANSWERED','HELP_USED'))
);
--> statement-breakpoint
CREATE INDEX `study_progress_events_workspace_created_idx` ON `study_progress_events` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `study_progress_events_topic_type_idx` ON `study_progress_events` (`topic_id`,`type`);

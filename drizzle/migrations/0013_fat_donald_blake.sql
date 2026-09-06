CREATE TABLE `saved_for_later` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`content` text NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `saved_for_later_workspace_idx` ON `saved_for_later` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `session_topics` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `study_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_topics_session_idx` ON `session_topics` (`session_id`,`occurred_at`);
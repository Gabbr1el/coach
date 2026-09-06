CREATE TABLE `routine_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `study_deadlines` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`due_at` integer NOT NULL,
	`estimated_minutes` integer DEFAULT 120 NOT NULL,
	`mastery_percent` integer DEFAULT 50 NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "study_deadlines_mastery_check" CHECK("study_deadlines"."mastery_percent" between 0 and 100),
	CONSTRAINT "study_deadlines_minutes_check" CHECK("study_deadlines"."estimated_minutes" between 1 and 100000)
);
--> statement-breakpoint
CREATE INDEX `study_deadlines_due_idx` ON `study_deadlines` (`due_at`);
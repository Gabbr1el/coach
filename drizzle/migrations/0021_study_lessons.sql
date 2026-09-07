CREATE TABLE `study_lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`roadmap_id` text NOT NULL,
	`module_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`content_json` text NOT NULL,
	`provider_id` text,
	`model_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `study_lessons_roadmap_topic_unique` ON `study_lessons` (`roadmap_id`,`topic_id`);--> statement-breakpoint
CREATE INDEX `study_lessons_workspace_idx` ON `study_lessons` (`workspace_id`);

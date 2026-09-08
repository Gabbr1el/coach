ALTER TABLE `study_progress` ADD `checkpoint_states_json` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
CREATE TABLE `study_lesson_adaptations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`source_block_id` text NOT NULL,
	`revision` integer NOT NULL,
	`reason` text NOT NULL,
	`mode` text NOT NULL,
	`adapted_block_json` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`provider_id` text,
	`model_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lesson_id`) REFERENCES `study_lessons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `study_lesson_adaptations_lesson_block_idx` ON `study_lesson_adaptations` (`lesson_id`,`source_block_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `study_lesson_adaptations_revision_unique` ON `study_lesson_adaptations` (`lesson_id`,`source_block_id`,`revision`);
--> statement-breakpoint
CREATE UNIQUE INDEX `study_lesson_adaptations_one_active` ON `study_lesson_adaptations` (`lesson_id`,`source_block_id`) WHERE `is_active` = 1;
--> statement-breakpoint
CREATE TABLE `workspace_study_preferences` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`preferences_json` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);

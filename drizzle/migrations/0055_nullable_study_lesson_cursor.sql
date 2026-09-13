PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_study_progress` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`roadmap_id` text NOT NULL,
	`current_module_id` text NOT NULL,
	`current_topic_id` text NOT NULL,
	`current_lesson_id` text,
	`current_checkpoint_id` text,
	`topic_statuses_json` text DEFAULT '{}' NOT NULL,
	`lesson_positions_json` text DEFAULT '{}' NOT NULL,
	`checkpoint_states_json` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_study_progress` (`workspace_id`,`roadmap_id`,`current_module_id`,`current_topic_id`,`current_lesson_id`,`current_checkpoint_id`,`topic_statuses_json`,`lesson_positions_json`,`checkpoint_states_json`,`updated_at`) SELECT `workspace_id`,`roadmap_id`,`current_module_id`,`current_topic_id`,`current_lesson_id`,`current_checkpoint_id`,`topic_statuses_json`,`lesson_positions_json`,`checkpoint_states_json`,`updated_at` FROM `study_progress`;
--> statement-breakpoint
DROP TABLE `study_progress`;
--> statement-breakpoint
ALTER TABLE `__new_study_progress` RENAME TO `study_progress`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;

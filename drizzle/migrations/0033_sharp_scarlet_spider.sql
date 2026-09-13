CREATE TABLE `study_interactive_code_states` (
	`workspace_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`block_id` text NOT NULL,
	`current_code` text NOT NULL,
	`prediction` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_execution_json` text,
	`validation_result_json` text,
	`evidence_granted_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lesson_id`) REFERENCES `study_lessons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `study_interactive_code_states_workspace_lesson_block_idx` ON `study_interactive_code_states` (`workspace_id`,`lesson_id`,`block_id`);
--> statement-breakpoint
CREATE INDEX `study_interactive_code_states_lesson_idx` ON `study_interactive_code_states` (`lesson_id`);

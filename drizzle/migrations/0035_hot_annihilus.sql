CREATE TABLE `exercise_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`source_revision` text NOT NULL,
	`code` text NOT NULL,
	`prediction` text,
	`status` text NOT NULL,
	`public_result_json` text NOT NULL,
	`private_result_json` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_attempts_workspace_key_unique` ON `exercise_attempts` (`workspace_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `exercise_attempts_exercise_created_idx` ON `exercise_attempts` (`exercise_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `exercise_progress` (
	`workspace_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`current_code` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_run_json` text,
	`last_submission_json` text,
	`passed_tests` integer DEFAULT 0 NOT NULL,
	`total_tests` integer DEFAULT 0 NOT NULL,
	`help_used` integer DEFAULT false NOT NULL,
	`first_try_success` integer DEFAULT false NOT NULL,
	`help_count` integer DEFAULT 0 NOT NULL,
	`passed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "exercise_progress_status_check" CHECK("exercise_progress"."status" in ('not_started','in_progress','passed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_progress_workspace_exercise_unique` ON `exercise_progress` (`workspace_id`,`exercise_id`);--> statement-breakpoint
CREATE TABLE `exercise_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`roadmap_id` text NOT NULL,
	`module_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`status` text NOT NULL,
	`provider_id` text,
	`model_id` text,
	`generation_attempts` integer DEFAULT 0 NOT NULL,
	`retry_after` integer,
	`last_error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "exercise_sets_status_check" CHECK("exercise_sets"."status" in ('generating','ready','waiting_for_provider','failed_retryable'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_sets_workspace_topic_unique` ON `exercise_sets` (`workspace_id`,`topic_id`);--> statement-breakpoint
CREATE INDEX `exercise_sets_status_retry_idx` ON `exercise_sets` (`status`,`retry_after`);--> statement-breakpoint
CREATE TABLE `exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`set_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`difficulty` text NOT NULL,
	`title` text NOT NULL,
	`statement` text NOT NULL,
	`input_description` text NOT NULL,
	`output_description` text NOT NULL,
	`language` text NOT NULL,
	`starter_code` text NOT NULL,
	`prediction_prompt` text,
	`code_to_observe` text,
	`required_for_topic_completion` integer DEFAULT false NOT NULL,
	`public_tests_json` text NOT NULL,
	`private_tests_json` text NOT NULL,
	`reference_solution` text,
	`expected_prediction` text,
	`hint` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `exercise_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "exercises_kind_check" CHECK("exercises"."kind" in ('PROGRAMMING_PROBLEM','FIX_CODE','COMPLETE_CODE','PREDICT_OUTPUT')),
	CONSTRAINT "exercises_difficulty_check" CHECK("exercises"."difficulty" in ('introductory','standard','challenge'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercises_set_position_unique` ON `exercises` (`set_id`,`position`);--> statement-breakpoint
CREATE INDEX `exercises_set_idx` ON `exercises` (`set_id`);

CREATE TABLE `exercise_adaptations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`request_id` text NOT NULL,
	`revision` integer NOT NULL,
	`adapted_public_json` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`provider_id` text,
	`model_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_adaptations_request_unique` ON `exercise_adaptations` (`workspace_id`,`request_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_adaptations_revision_unique` ON `exercise_adaptations` (`exercise_id`,`revision`);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_adaptations_one_active` ON `exercise_adaptations` (`exercise_id`) WHERE `is_active` = 1;
--> statement-breakpoint
CREATE INDEX `exercise_adaptations_exercise_idx` ON `exercise_adaptations` (`exercise_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `exercise_hint_requests` (
	`request_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`request_identity` text NOT NULL,
	`help_level` integer NOT NULL,
	`type` text NOT NULL,
	`hint` text,
	`provider_id` text,
	`model_id` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_hint_requests_workspace_request_unique` ON `exercise_hint_requests` (`workspace_id`,`request_id`);
--> statement-breakpoint
CREATE INDEX `exercise_hint_requests_exercise_idx` ON `exercise_hint_requests` (`exercise_id`,`created_at`);

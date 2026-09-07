CREATE TABLE `topic_learning_states` (
	`workspace_id` text NOT NULL REFERENCES `workspaces`(`id`) ON DELETE cascade,
	`topic_id` text NOT NULL,
	`evidence_count` integer DEFAULT 0 NOT NULL,
	`assessments` integer DEFAULT 0 NOT NULL,
	`correct_first_try` integer DEFAULT 0 NOT NULL,
	`correct_after_help` integer DEFAULT 0 NOT NULL,
	`incorrect` integer DEFAULT 0 NOT NULL,
	`hints_used` integer DEFAULT 0 NOT NULL,
	`reinforcement_events` integer DEFAULT 0 NOT NULL,
	`exercises_completed` integer DEFAULT 0 NOT NULL,
	`lessons_completed` integer DEFAULT 0 NOT NULL,
	`difficulty_level` text DEFAULT 'low' NOT NULL,
	`mastery_estimate` integer,
	`confidence` text DEFAULT 'low' NOT NULL,
	`needs_review` integer DEFAULT false NOT NULL,
	`last_practiced_at` integer,
	`last_assessed_at` integer,
	`reasons_json` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `topic_learning_states_workspace_topic_idx` ON `topic_learning_states` (`workspace_id`,`topic_id`);
--> statement-breakpoint
CREATE TABLE `roadmap_adaptations` (
	`id` text PRIMARY KEY NOT NULL,
	`roadmap_id` text NOT NULL REFERENCES `roadmaps`(`id`) ON DELETE cascade,
	`module_id` text NOT NULL REFERENCES `roadmap_modules`(`id`) ON DELETE cascade,
	`topic_id` text NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`reason_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roadmap_adaptations_module_topic_kind_idx` ON `roadmap_adaptations` (`module_id`,`topic_id`,`kind`);

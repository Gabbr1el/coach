CREATE TABLE `checkpoint_reasoning_evidence` (
	`answer_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`checkpoint_id` text NOT NULL,
	`alternative_correct` integer NOT NULL,
	`reasoning_status` text NOT NULL,
	`summary` text,
	`misconception` text,
	`feedback` text,
	`evaluated_at` integer,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`next_retry_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "checkpoint_reasoning_status_check" CHECK(`reasoning_status` in ('coherent','partial','misconception','insufficient','off_topic','reasoning_evaluation_pending'))
);
--> statement-breakpoint
CREATE INDEX `checkpoint_reasoning_workspace_topic_idx` ON `checkpoint_reasoning_evidence` (`workspace_id`,`topic_id`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `checkpoint_reasoning_pending_retry_idx` ON `checkpoint_reasoning_evidence` (`reasoning_status`,`next_retry_at`);

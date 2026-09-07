CREATE TABLE `workspace_learning_path_state` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`active_roadmap_id` text,
	`last_attempt_at` integer,
	`retry_after` integer,
	`last_error_code` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`active_roadmap_id`) REFERENCES `roadmaps`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "learning_path_status_check" CHECK("status" in ('idle','generating','ready','waiting_for_provider','failed_retryable'))
);
--> statement-breakpoint
CREATE INDEX `learning_path_status_retry_idx` ON `workspace_learning_path_state` (`status`,`retry_after`);
--> statement-breakpoint
INSERT INTO `workspace_learning_path_state` (`workspace_id`,`status`,`active_roadmap_id`,`updated_at`)
SELECT `workspace_id`,'ready',`id`,`updated_at` FROM `roadmaps` WHERE `status` = 'accepted';

ALTER TABLE `assessment_variants` ADD `public_payload_json` text NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE `assessment_variants` ADD `evaluator_json` text NOT NULL DEFAULT '{}';
--> statement-breakpoint
CREATE TABLE `review_sessions` (`id` text PRIMARY KEY NOT NULL,`workspace_id` text NOT NULL,`target_size` integer NOT NULL DEFAULT 8,`status` text NOT NULL,`started_at` integer NOT NULL,`completed_at` integer,`updated_at` integer NOT NULL,FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,CONSTRAINT `review_sessions_target_check` CHECK(`target_size` between 4 and 12),CONSTRAINT `review_sessions_status_check` CHECK(`status` in ('active','completed','preparation')));
--> statement-breakpoint
CREATE UNIQUE INDEX `review_sessions_one_current_workspace` ON `review_sessions` (`workspace_id`) WHERE `status` in ('active','preparation');
--> statement-breakpoint
CREATE INDEX `review_sessions_workspace_updated_idx` ON `review_sessions` (`workspace_id`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `review_items` (`id` text PRIMARY KEY NOT NULL,`session_id` text NOT NULL,`position` integer NOT NULL,`concept_id` text NOT NULL,`assessment_intent_id` text NOT NULL,`assessment_variant_id` text NOT NULL,`source_topic_id` text,`source_exercise_id` text,`selection_reason` text NOT NULL,`status` text NOT NULL DEFAULT 'pending',`attempts` integer NOT NULL DEFAULT 0,`help_count` integer NOT NULL DEFAULT 0,`result` text,`answer_json` text,`memory_before_json` text,`memory_after_json` text,`learning_attempt_id` text,`first_seen_at` integer NOT NULL,`answered_at` integer,`created_at` integer NOT NULL,`updated_at` integer NOT NULL,FOREIGN KEY (`session_id`) REFERENCES `review_sessions`(`id`) ON UPDATE no action ON DELETE cascade,FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE restrict,FOREIGN KEY (`assessment_intent_id`) REFERENCES `assessment_intents`(`id`) ON UPDATE no action ON DELETE restrict,FOREIGN KEY (`assessment_variant_id`) REFERENCES `assessment_variants`(`id`) ON UPDATE no action ON DELETE restrict,FOREIGN KEY (`source_exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE set null,FOREIGN KEY (`learning_attempt_id`) REFERENCES `learning_attempts`(`id`) ON UPDATE no action ON DELETE set null,CONSTRAINT `review_items_position_check` CHECK(`position` > 0),CONSTRAINT `review_items_reason_check` CHECK(`selection_reason` in ('due_review','recent_failure','retention_decay','maintenance','deadline_priority','misconception_followup')),CONSTRAINT `review_items_status_check` CHECK(`status` in ('pending','answered')),CONSTRAINT `review_items_result_check` CHECK(`result` is null or `result` in ('correct','incorrect')));
--> statement-breakpoint
CREATE UNIQUE INDEX `review_items_session_position_unique` ON `review_items` (`session_id`,`position`);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_items_session_variant_unique` ON `review_items` (`session_id`,`assessment_variant_id`);
--> statement-breakpoint
CREATE INDEX `review_items_concept_answered_idx` ON `review_items` (`concept_id`,`answered_at`);
--> statement-breakpoint
CREATE TABLE `review_help_events` (`request_id` text PRIMARY KEY NOT NULL,`review_item_id` text NOT NULL,`created_at` integer NOT NULL,FOREIGN KEY (`review_item_id`) REFERENCES `review_items`(`id`) ON UPDATE no action ON DELETE cascade);

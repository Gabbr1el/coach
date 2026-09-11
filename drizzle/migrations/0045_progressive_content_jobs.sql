ALTER TABLE `roadmaps` ADD `content_revision` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `roadmaps` ADD `content_hash` text DEFAULT 'legacy-unavailable' NOT NULL;
--> statement-breakpoint
ALTER TABLE `study_lessons` ADD `content_revision` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `study_lessons` ADD `input_hash` text DEFAULT 'legacy-unavailable' NOT NULL;
--> statement-breakpoint
ALTER TABLE `exercise_sets` ADD `content_revision` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `exercise_sets` ADD `input_hash` text DEFAULT 'legacy-unavailable' NOT NULL;
--> statement-breakpoint
CREATE TABLE `workspace_content_revisions` (
  `workspace_id` text PRIMARY KEY NOT NULL,
  `revision` integer NOT NULL,
  `input_hash` text NOT NULL,
  `roadmap_id` text,
  `first_topic_id` text,
  `first_lesson_id` text,
  `state` text DEFAULT 'provisioning' NOT NULL,
  `cancellation_generation` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `usable_at` integer,
  `fully_provisioned_at` integer,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT `workspace_content_revisions_revision_check` CHECK(`revision` > 0),
  CONSTRAINT `workspace_content_revisions_state_check` CHECK(`state` in ('provisioning','usable','fully_provisioned'))
);
--> statement-breakpoint
CREATE INDEX `workspace_content_revisions_state_idx` ON `workspace_content_revisions` (`state`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `content_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `revision` integer NOT NULL,
  `kind` text NOT NULL,
  `unit_key` text NOT NULL,
  `priority` integer NOT NULL,
  `status` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `input_hash` text NOT NULL,
  `generator_contract_version` text NOT NULL,
  `dependency_keys_json` text DEFAULT '[]' NOT NULL,
  `attempt_count` integer DEFAULT 0 NOT NULL,
  `max_attempts` integer DEFAULT 3 NOT NULL,
  `available_at` integer NOT NULL,
  `lease_owner` text,
  `lease_token` text,
  `lease_expires_at` integer,
  `claimed_cancellation_generation` integer,
  `started_at` integer,
  `completed_at` integer,
  `obsolete_at` integer,
  `last_error_code` text,
  `last_error_message` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT `content_jobs_revision_check` CHECK(`revision` > 0),
  CONSTRAINT `content_jobs_priority_check` CHECK(`priority` >= 0),
  CONSTRAINT `content_jobs_attempts_check` CHECK(`attempt_count` >= 0 and `max_attempts` > 0),
  CONSTRAINT `content_jobs_kind_check` CHECK(`kind` in ('material_extract','material_analyze','roadmap_generate','lesson_generate','exercise_generate','plan_recalculate')),
  CONSTRAINT `content_jobs_status_check` CHECK(`status` in ('pending','queued','generating','ready','failed','obsolete')),
  CONSTRAINT `content_jobs_lease_check` CHECK((`status` = 'generating' and `lease_owner` is not null and `lease_token` is not null and `lease_expires_at` is not null and `claimed_cancellation_generation` is not null) or (`status` <> 'generating' and `lease_owner` is null and `lease_token` is null and `lease_expires_at` is null and `claimed_cancellation_generation` is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_jobs_idempotency_idx` ON `content_jobs` (`idempotency_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_jobs_unit_idx` ON `content_jobs` (`workspace_id`,`revision`,`kind`,`unit_key`);
--> statement-breakpoint
CREATE INDEX `content_jobs_claim_idx` ON `content_jobs` (`status`,`priority` DESC,`available_at`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `content_jobs_lease_idx` ON `content_jobs` (`status`,`lease_expires_at`);
--> statement-breakpoint
CREATE INDEX `content_jobs_workspace_revision_idx` ON `content_jobs` (`workspace_id`,`revision`,`status`);
--> statement-breakpoint
CREATE TABLE `content_job_dependencies` (
  `job_id` text NOT NULL,
  `dependency_key` text NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `content_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_job_dependencies_key_idx` ON `content_job_dependencies` (`job_id`,`dependency_key`);
--> statement-breakpoint
CREATE INDEX `content_job_dependencies_lookup_idx` ON `content_job_dependencies` (`dependency_key`,`job_id`);
--> statement-breakpoint
CREATE TABLE `content_revision_required_units` (
  `workspace_id` text NOT NULL,
  `revision` integer NOT NULL,
  `kind` text NOT NULL,
  `unit_key` text NOT NULL,
  `input_hash` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT `content_required_units_revision_check` CHECK(`revision` > 0),
  CONSTRAINT `content_required_units_kind_check` CHECK(`kind` in ('material_extract','material_analyze','roadmap_generate','lesson_generate','exercise_generate','plan_recalculate'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_required_units_key_idx` ON `content_revision_required_units` (`workspace_id`,`revision`,`kind`,`unit_key`);
--> statement-breakpoint
CREATE INDEX `content_required_units_revision_idx` ON `content_revision_required_units` (`workspace_id`,`revision`);
--> statement-breakpoint
INSERT INTO `workspace_content_revisions` (`workspace_id`,`revision`,`input_hash`,`state`,`created_at`,`updated_at`)
SELECT `id`,1,'legacy-unavailable','provisioning',`created_at`,`updated_at` FROM `workspaces`;

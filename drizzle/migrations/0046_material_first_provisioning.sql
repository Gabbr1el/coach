ALTER TABLE `workspace_learning_overrides` ADD `onboarding_analysis_revision` integer;
--> statement-breakpoint
ALTER TABLE `workspace_learning_overrides` ADD `onboarding_analysis_fingerprint` text;
--> statement-breakpoint
ALTER TABLE `workspace_content_revisions` ADD `legacy_state` text;
--> statement-breakpoint
ALTER TABLE `materials` ADD `extraction_fingerprint` text;
--> statement-breakpoint
ALTER TABLE `materials` ADD `analysis_fingerprint` text;
--> statement-breakpoint
UPDATE `workspace_content_revisions` SET `legacy_state`='legacy_accessible' WHERE `input_hash`='legacy-unavailable';
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_workspace_provisioning` (
  `workspace_id` text PRIMARY KEY NOT NULL,
  `status` text NOT NULL,
  `stage` text NOT NULL,
  `material_ids_json` text DEFAULT '[]' NOT NULL,
  `attempt_count` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL,
  `started_at` integer,
  `stage_updated_at` integer NOT NULL,
  `completed_at` integer,
  `retry_after` integer,
  `error_code` text,
  `error_message` text,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT `workspace_provisioning_status_check` CHECK(`status` in ('draft','queued','running','waiting_for_provider','failed_retryable','ready')),
  CONSTRAINT `workspace_provisioning_stage_check` CHECK(`stage` in ('workspace','materials','roadmap','lesson','exercises','plan','background','ready'))
);
--> statement-breakpoint
INSERT INTO `__new_workspace_provisioning` SELECT * FROM `workspace_provisioning`;
--> statement-breakpoint
DROP TABLE `workspace_provisioning`;
--> statement-breakpoint
ALTER TABLE `__new_workspace_provisioning` RENAME TO `workspace_provisioning`;
--> statement-breakpoint
CREATE INDEX `workspace_provisioning_resume_idx` ON `workspace_provisioning` (`status`,`retry_after`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;

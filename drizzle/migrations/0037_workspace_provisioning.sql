CREATE TABLE `workspace_learning_overrides` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`declared_level` text,
	`declared_knowledge_json` text DEFAULT '[]' NOT NULL,
	`declared_difficulties_json` text DEFAULT '[]' NOT NULL,
	`goals_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspace_learning_overrides_level_check" CHECK("declared_level" is null or "declared_level" in ('beginner','intermediate','advanced'))
);
--> statement-breakpoint
CREATE TABLE `workspace_provisioning` (
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
	CONSTRAINT "workspace_provisioning_status_check" CHECK("status" in ('draft','queued','running','waiting_for_provider','failed_retryable','ready')),
	CONSTRAINT "workspace_provisioning_stage_check" CHECK("stage" in ('workspace','materials','roadmap','lesson','ready'))
);
--> statement-breakpoint
CREATE INDEX `workspace_provisioning_resume_idx` ON `workspace_provisioning` (`status`,`retry_after`);

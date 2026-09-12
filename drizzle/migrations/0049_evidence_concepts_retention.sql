CREATE TABLE `concepts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`canonical_name` text NOT NULL,
	`domain` text NOT NULL,
	`parent_concept_id` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `concepts_workspace_domain_name_unique` ON `concepts` (`workspace_id`,`domain`,`canonical_name`);
--> statement-breakpoint
CREATE INDEX `concepts_parent_idx` ON `concepts` (`parent_concept_id`);
--> statement-breakpoint
CREATE TABLE `concept_aliases` (`id` text PRIMARY KEY NOT NULL,`concept_id` text NOT NULL,`alias` text NOT NULL,`normalized_alias` text NOT NULL,`provenance` text NOT NULL,`created_at` integer NOT NULL,FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE cascade);
--> statement-breakpoint
CREATE UNIQUE INDEX `concept_aliases_concept_normalized_unique` ON `concept_aliases` (`concept_id`,`normalized_alias`);
--> statement-breakpoint
CREATE TABLE `topic_concepts` (`id` text PRIMARY KEY NOT NULL,`workspace_id` text NOT NULL,`roadmap_id` text NOT NULL,`module_id` text NOT NULL,`topic_id` text NOT NULL,`concept_id` text,`provenance` text NOT NULL,`confidence` real NOT NULL,`mapping_status` text NOT NULL,`created_at` integer NOT NULL,`updated_at` integer NOT NULL,FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE set null,CONSTRAINT `topic_concepts_confidence_check` CHECK(`confidence` >= 0 and `confidence` <= 1),CONSTRAINT `topic_concepts_status_check` CHECK(`mapping_status` in ('mapped','unknown','rejected')));
--> statement-breakpoint
CREATE UNIQUE INDEX `topic_concepts_topic_concept_unique` ON `topic_concepts` (`workspace_id`,`topic_id`,`concept_id`);
--> statement-breakpoint
CREATE INDEX `topic_concepts_concept_idx` ON `topic_concepts` (`concept_id`);
--> statement-breakpoint
CREATE TABLE `assessment_intents` (`id` text PRIMARY KEY NOT NULL,`workspace_id` text NOT NULL,`concept_id` text NOT NULL,`kind` text NOT NULL,`objective` text NOT NULL,`created_at` integer NOT NULL,`updated_at` integer NOT NULL,FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE cascade);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_intents_identity_unique` ON `assessment_intents` (`workspace_id`,`concept_id`,`kind`,`objective`);
--> statement-breakpoint
CREATE TABLE `assessment_variants` (`id` text PRIMARY KEY NOT NULL,`workspace_id` text NOT NULL,`intent_id` text NOT NULL,`environment` text NOT NULL,`source_ref` text NOT NULL,`source_revision` text NOT NULL,`difficulty` text NOT NULL,`prerequisite_concept_ids_json` text DEFAULT '[]' NOT NULL,`public_metadata_json` text DEFAULT '{}' NOT NULL,`created_at` integer NOT NULL,`updated_at` integer NOT NULL,FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,FOREIGN KEY (`intent_id`) REFERENCES `assessment_intents`(`id`) ON UPDATE no action ON DELETE cascade,CONSTRAINT `assessment_variants_difficulty_check` CHECK(`difficulty` in ('introductory','standard','challenge')));
--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_variants_source_unique` ON `assessment_variants` (`workspace_id`,`intent_id`,`environment`,`source_ref`,`source_revision`);
--> statement-breakpoint
CREATE TABLE `learning_attempts` (`id` text PRIMARY KEY NOT NULL,`workspace_id` text NOT NULL,`concept_id` text,`assessment_intent_id` text,`assessment_variant_id` text,`environment` text NOT NULL,`source_ref` text NOT NULL,`source_revision` text NOT NULL,`first_seen_at` integer,`idempotency_key` text NOT NULL,`payload_hash` text NOT NULL,`outcome` text NOT NULL,`correct` integer,`independent` integer NOT NULL,`reasoning_quality` text NOT NULL,`occurred_at` integer NOT NULL,`created_at` integer NOT NULL,FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE set null,FOREIGN KEY (`assessment_intent_id`) REFERENCES `assessment_intents`(`id`) ON UPDATE no action ON DELETE set null,FOREIGN KEY (`assessment_variant_id`) REFERENCES `assessment_variants`(`id`) ON UPDATE no action ON DELETE set null,CONSTRAINT `learning_attempts_environment_check` CHECK(`environment` in ('checkpoint','exercise','study_interactive','practice','review')));
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_attempts_workspace_environment_key_unique` ON `learning_attempts` (`workspace_id`,`environment`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `learning_attempts_concept_time_idx` ON `learning_attempts` (`concept_id`,`occurred_at`,`id`);
--> statement-breakpoint
CREATE TABLE `learning_evidence` (`id` text PRIMARY KEY NOT NULL,`attempt_id` text NOT NULL,`concept_id` text,`type` text NOT NULL,`strength` text NOT NULL,`ordinal` integer NOT NULL,`metadata_json` text DEFAULT '{}' NOT NULL,`occurred_at` integer NOT NULL,`created_at` integer NOT NULL,FOREIGN KEY (`attempt_id`) REFERENCES `learning_attempts`(`id`) ON UPDATE no action ON DELETE cascade,FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE set null,CONSTRAINT `learning_evidence_strength_check` CHECK(`strength` in ('none','weak','moderate','strong')));
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_evidence_attempt_type_ordinal_unique` ON `learning_evidence` (`attempt_id`,`type`,`ordinal`);
--> statement-breakpoint
CREATE INDEX `learning_evidence_concept_time_idx` ON `learning_evidence` (`concept_id`,`occurred_at`,`id`);
--> statement-breakpoint
CREATE TABLE `concept_memories` (`workspace_id` text NOT NULL,`concept_id` text NOT NULL,`performance` text NOT NULL,`evidence_quantity` text NOT NULL,`independence` text NOT NULL,`diversity` text NOT NULL,`recency` text NOT NULL,`retention` text NOT NULL,`confidence` text NOT NULL,`successful_retrievals` integer DEFAULT 0 NOT NULL,`independent_successes` integer DEFAULT 0 NOT NULL,`error_count` integer DEFAULT 0 NOT NULL,`help_events` integer DEFAULT 0 NOT NULL,`environment_count` integer DEFAULT 0 NOT NULL,`interval_days` integer DEFAULT 1 NOT NULL,`last_evidence_at` integer,`next_review_at` integer,`updated_at` integer NOT NULL,FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE cascade);
--> statement-breakpoint
CREATE UNIQUE INDEX `concept_memories_workspace_concept_unique` ON `concept_memories` (`workspace_id`,`concept_id`);
--> statement-breakpoint
CREATE INDEX `concept_memories_next_review_idx` ON `concept_memories` (`workspace_id`,`next_review_at`);
--> statement-breakpoint
CREATE TABLE `exercise_help_events` (`request_id` text PRIMARY KEY NOT NULL,`workspace_id` text NOT NULL,`exercise_id` text NOT NULL,`type` text NOT NULL,`created_at` integer NOT NULL,FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade,CONSTRAINT `exercise_help_events_type_check` CHECK(`type` in ('hint_requested','coach_help_requested','worked_example_shown','solution_revealed')));
--> statement-breakpoint
CREATE INDEX `exercise_help_events_exercise_created_idx` ON `exercise_help_events` (`workspace_id`,`exercise_id`,`created_at`);
--> statement-breakpoint
INSERT INTO `topic_concepts` (`id`,`workspace_id`,`roadmap_id`,`module_id`,`topic_id`,`concept_id`,`provenance`,`confidence`,`mapping_status`,`created_at`,`updated_at`)
SELECT lower(hex(randomblob(16))), sp.workspace_id, sp.roadmap_id, sp.current_module_id, key, NULL, 'legacy_backfill', 0, 'unknown', sp.updated_at, sp.updated_at
FROM study_progress sp, json_each(sp.topic_statuses_json)
WHERE NOT EXISTS (SELECT 1 FROM topic_concepts tc WHERE tc.workspace_id=sp.workspace_id AND tc.topic_id=key);

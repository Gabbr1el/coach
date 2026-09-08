CREATE TABLE `academic_subject_contexts` (
	`subject` text PRIMARY KEY NOT NULL,
	`declared_level` text,
	`declared_knowledge_json` text DEFAULT '[]' NOT NULL,
	`declared_difficulties_json` text DEFAULT '[]' NOT NULL,
	`goals_json` text DEFAULT '[]' NOT NULL,
	`source_evidence_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "academic_subject_contexts_level_check" CHECK(`declared_level` IS NULL OR `declared_level` IN ('beginner','intermediate','advanced'))
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_planner_actions` (`id` text PRIMARY KEY NOT NULL, `origin_message_id` text NOT NULL, `label` text NOT NULL, `context_version` integer DEFAULT 0 NOT NULL, `idempotency_key` text NOT NULL, `type` text NOT NULL, `status` text DEFAULT 'proposed' NOT NULL, `payload_json` text NOT NULL, `result_json` text, `created_at` integer NOT NULL, `resolved_at` integer, CONSTRAINT "planner_actions_type_check" CHECK(`type` in ('workspace.prepare','workspace.create','deadline.create','routine.add')), CONSTRAINT "planner_actions_status_check" CHECK(`status` in ('proposed','applying','applied','rejected','obsolete')));
--> statement-breakpoint
INSERT INTO `__new_planner_actions` SELECT `id`,`origin_message_id`,`label`,`context_version`,`idempotency_key`,`type`,`status`,`payload_json`,`result_json`,`created_at`,`resolved_at` FROM `planner_actions`;
--> statement-breakpoint
UPDATE `__new_planner_actions` SET `status` = 'obsolete', `resolved_at` = `created_at` WHERE `type` = 'workspace.create' AND `status` IN ('proposed','applying');
--> statement-breakpoint
DROP TABLE `planner_actions`;
--> statement-breakpoint
ALTER TABLE `__new_planner_actions` RENAME TO `planner_actions`;
--> statement-breakpoint
CREATE UNIQUE INDEX `planner_actions_idempotency_idx` ON `planner_actions` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `planner_actions_status_created_idx` ON `planner_actions` (`status`,`created_at`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;

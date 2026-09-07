ALTER TABLE `planner_actions` ADD `origin_message_id` text NOT NULL DEFAULT 'legacy';
--> statement-breakpoint
ALTER TABLE `planner_actions` ADD `label` text NOT NULL DEFAULT 'Aplicar ação';
--> statement-breakpoint
ALTER TABLE `planner_actions` ADD `context_version` integer NOT NULL DEFAULT 0;

--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_planner_actions` (`id` text PRIMARY KEY NOT NULL, `origin_message_id` text NOT NULL, `label` text NOT NULL, `context_version` integer DEFAULT 0 NOT NULL, `idempotency_key` text NOT NULL, `type` text NOT NULL, `status` text DEFAULT 'proposed' NOT NULL, `payload_json` text NOT NULL, `result_json` text, `created_at` integer NOT NULL, `resolved_at` integer, CONSTRAINT "planner_actions_type_check" CHECK("type" in ('workspace.create','deadline.create','routine.add')), CONSTRAINT "planner_actions_status_check" CHECK("status" in ('proposed','applying','applied','rejected','obsolete')));
--> statement-breakpoint
INSERT INTO `__new_planner_actions` SELECT `id`,`origin_message_id`,`label`,`context_version`,`idempotency_key`,`type`,`status`,`payload_json`,`result_json`,`created_at`,`resolved_at` FROM `planner_actions`;
--> statement-breakpoint
DROP TABLE `planner_actions`;
--> statement-breakpoint
ALTER TABLE `__new_planner_actions` RENAME TO `planner_actions`;
--> statement-breakpoint
CREATE UNIQUE INDEX `planner_actions_idempotency_idx` ON `planner_actions` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `planner_actions_status_created_idx` ON `planner_actions` (`status`,`created_at`);
--> statement-breakpoint
CREATE TABLE `__new_study_deadlines` (`id` text PRIMARY KEY NOT NULL, `workspace_id` text NOT NULL, `title` text NOT NULL, `due_at` integer NOT NULL, `estimated_minutes` integer DEFAULT 120 NOT NULL, `mastery_percent` integer, `completed` integer DEFAULT false NOT NULL, `created_at` integer NOT NULL, FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade, CONSTRAINT "study_deadlines_mastery_check" CHECK("mastery_percent" is null or "mastery_percent" between 0 and 100), CONSTRAINT "study_deadlines_minutes_check" CHECK("estimated_minutes" between 1 and 100000));
--> statement-breakpoint
INSERT INTO `__new_study_deadlines` SELECT `id`,`workspace_id`,`title`,`due_at`,`estimated_minutes`,`mastery_percent`,`completed`,`created_at` FROM `study_deadlines`;
--> statement-breakpoint
DROP TABLE `study_deadlines`;
--> statement-breakpoint
ALTER TABLE `__new_study_deadlines` RENAME TO `study_deadlines`;
--> statement-breakpoint
CREATE INDEX `study_deadlines_due_idx` ON `study_deadlines` (`due_at`);

--> statement-breakpoint
PRAGMA foreign_keys=ON;

CREATE TABLE `academic_life_items` (
  `id` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `title` text NOT NULL,
  `details` text DEFAULT '' NOT NULL,
  `workspace_id` text,
  `starts_at` integer,
  `ends_at` integer,
  `expires_at` integer,
  `timezone` text NOT NULL,
  `weekday` integer,
  `minutes` integer,
  `share_with_ai` integer DEFAULT 1 NOT NULL,
  `provenance_source` text NOT NULL,
  `provenance_reference` text,
  `replaces_id` text,
  `replaced_by_id` text,
  `fingerprint` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `resolved_at` integer,
  `archived_at` integer,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
  CONSTRAINT `academic_life_kind_check` CHECK(`kind` in ('fact','event','commitment','availability')),
  CONSTRAINT `academic_life_status_check` CHECK(`status` in ('active','resolved','archived')),
  CONSTRAINT `academic_life_availability_check` CHECK((`kind` = 'availability' and `weekday` between 0 and 6 and `minutes` between 0 and 1440) or (`kind` <> 'availability' and `weekday` is null and `minutes` is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `academic_life_fingerprint_idx` ON `academic_life_items` (`fingerprint`);
--> statement-breakpoint
CREATE INDEX `academic_life_current_idx` ON `academic_life_items` (`status`,`expires_at`,`ends_at`);
--> statement-breakpoint
CREATE INDEX `academic_life_workspace_idx` ON `academic_life_items` (`workspace_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `academic_life_items` (`id`,`kind`,`status`,`title`,`details`,`workspace_id`,`starts_at`,`ends_at`,`expires_at`,`timezone`,`weekday`,`minutes`,`share_with_ai`,`provenance_source`,`provenance_reference`,`replaces_id`,`replaced_by_id`,`fingerprint`,`created_at`,`updated_at`,`resolved_at`,`archived_at`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), 'event', 'active', title, '', workspace_id, NULL, due_at, due_at, 'UTC', NULL, NULL, 1, 'legacy_migration', id, NULL, NULL, 'legacy-event:' || id, created_at, updated_at, NULL, NULL FROM academic_events;
--> statement-breakpoint
INSERT OR IGNORE INTO `academic_life_items` (`id`,`kind`,`status`,`title`,`details`,`workspace_id`,`starts_at`,`ends_at`,`expires_at`,`timezone`,`weekday`,`minutes`,`share_with_ai`,`provenance_source`,`provenance_reference`,`replaces_id`,`replaced_by_id`,`fingerprint`,`created_at`,`updated_at`,`resolved_at`,`archived_at`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), 'availability', 'active', 'Disponibilidade semanal', '', NULL, NULL, NULL, NULL, 'UTC', weekday, minutes, 1, 'legacy_migration', CAST(weekday AS text), NULL, NULL, 'legacy-availability:' || weekday, updated_at, updated_at, NULL, NULL FROM academic_availability;
--> statement-breakpoint
ALTER TABLE `planner_actions` RENAME TO `planner_actions_legacy`;
--> statement-breakpoint
CREATE TABLE `planner_actions` (`id` text PRIMARY KEY NOT NULL,`origin_message_id` text NOT NULL,`label` text NOT NULL,`context_version` integer DEFAULT 0 NOT NULL,`idempotency_key` text NOT NULL,`type` text NOT NULL,`status` text DEFAULT 'proposed' NOT NULL,`payload_json` text NOT NULL,`result_json` text,`created_at` integer NOT NULL,`resolved_at` integer,CONSTRAINT `planner_actions_type_check` CHECK(`type` in ('workspace.prepare','workspace.create','deadline.create','routine.add','academic-life.save','academic-life.transition')),CONSTRAINT `planner_actions_status_check` CHECK(`status` in ('proposed','applying','applied','rejected','obsolete')));
--> statement-breakpoint
INSERT INTO `planner_actions` SELECT * FROM `planner_actions_legacy`;
--> statement-breakpoint
DROP TABLE `planner_actions_legacy`;
--> statement-breakpoint
CREATE UNIQUE INDEX `planner_actions_idempotency_idx` ON `planner_actions` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `planner_actions_status_created_idx` ON `planner_actions` (`status`,`created_at`);

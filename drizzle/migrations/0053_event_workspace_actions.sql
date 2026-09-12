PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `planner_actions_next` (`id` text PRIMARY KEY NOT NULL,`origin_message_id` text NOT NULL,`label` text NOT NULL,`context_version` integer DEFAULT 0 NOT NULL,`idempotency_key` text NOT NULL,`type` text NOT NULL,`status` text DEFAULT 'proposed' NOT NULL,`payload_json` text NOT NULL,`result_json` text,`created_at` integer NOT NULL,`resolved_at` integer,CONSTRAINT `planner_actions_type_check` CHECK(`type` in ('workspace.prepare','workspace.create','deadline.create','routine.add','academic-life.save','academic-life.transition','plan.today-budget.set','plan.weekday-availability.set','plan.recalculate','plan.item-completion.set','academic.event.linkWorkspace','academic.event.unlinkWorkspace','academic.event.keepUnlinked')),CONSTRAINT `planner_actions_status_check` CHECK(`status` in ('proposed','applying','applied','rejected','obsolete')));--> statement-breakpoint
INSERT INTO `planner_actions_next` SELECT * FROM `planner_actions`;--> statement-breakpoint
DROP TABLE `planner_actions`;--> statement-breakpoint
ALTER TABLE `planner_actions_next` RENAME TO `planner_actions`;--> statement-breakpoint
CREATE UNIQUE INDEX `planner_actions_idempotency_idx` ON `planner_actions` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `planner_actions_status_created_idx` ON `planner_actions` (`status`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=ON;

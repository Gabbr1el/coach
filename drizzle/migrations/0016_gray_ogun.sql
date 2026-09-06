CREATE TABLE `planner_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`payload_json` text NOT NULL,
	`result_json` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	CONSTRAINT "planner_actions_type_check" CHECK("planner_actions"."type" in ('workspace.create','deadline.create','routine.add')),
	CONSTRAINT "planner_actions_status_check" CHECK("planner_actions"."status" in ('proposed','applied','rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `planner_actions_idempotency_idx` ON `planner_actions` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `planner_actions_status_created_idx` ON `planner_actions` (`status`,`created_at`);
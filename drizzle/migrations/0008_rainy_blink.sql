CREATE TABLE `learning_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`session_id` text NOT NULL,
	`type` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `study_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "learning_events_type_check" CHECK("learning_events"."type" in ('session_started','session_completed','window_blurred','window_focused','code_executed','execution_error','possible_learning_loop','plan_item_changed'))
);
--> statement-breakpoint
CREATE INDEX `learning_events_session_created_idx` ON `learning_events` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `learning_events_workspace_type_idx` ON `learning_events` (`workspace_id`,`type`,`created_at`);
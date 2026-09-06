ALTER TABLE `materials` ADD `status` text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE `materials` ADD `relevance` integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE `materials` ADD `source_url` text;--> statement-breakpoint
ALTER TABLE `materials` ADD `content_hash` text;--> statement-breakpoint
ALTER TABLE `materials` ADD `error_message` text;--> statement-breakpoint
CREATE INDEX `materials_workspace_status_idx` ON `materials` (`workspace_id`,`status`);
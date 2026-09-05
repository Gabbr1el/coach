CREATE TABLE `conversation_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`provider_id` text,
	`model_id` text,
	`created_at` integer NOT NULL,
	`sequence` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `conversation_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "conversation_messages_role_check" CHECK("conversation_messages"."role" in ('user', 'assistant', 'system'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_messages_thread_sequence_idx` ON `conversation_messages` (`thread_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `conversation_messages_thread_created_idx` ON `conversation_messages` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `conversation_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`workspace_id` text,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "conversation_threads_scope_check" CHECK("conversation_threads"."scope" in ('home', 'workspace')),
	CONSTRAINT "conversation_threads_scope_workspace_check" CHECK(("conversation_threads"."scope" = 'home' and "conversation_threads"."workspace_id" is null) or ("conversation_threads"."scope" = 'workspace' and "conversation_threads"."workspace_id" is not null))
);

CREATE TABLE `organizer_requests` (
	`request_id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`content` text NOT NULL,
	`user_message_id` text NOT NULL,
	`assistant_message_id` text NOT NULL,
	`result_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `conversation_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_message_id`) REFERENCES `conversation_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assistant_message_id`) REFERENCES `conversation_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizer_requests_user_message_idx` ON `organizer_requests` (`user_message_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizer_requests_assistant_message_idx` ON `organizer_requests` (`assistant_message_id`);

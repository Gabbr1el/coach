PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_provider_configurations` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`display_name` text NOT NULL,
	`label` text NOT NULL,
	`base_url` text,
	`model` text NOT NULL,
	`secret_reference` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "provider_configurations_provider_check" CHECK("__new_provider_configurations"."provider_id" in ('openai', 'openai-compatible')),
	CONSTRAINT "provider_configurations_secret_reference_check" CHECK(length(trim("__new_provider_configurations"."secret_reference")) > 0),
	CONSTRAINT "provider_configurations_label_check" CHECK(length(trim("__new_provider_configurations"."label")) between 1 and 60)
);
--> statement-breakpoint
INSERT INTO `__new_provider_configurations`("id", "provider_id", "display_name", "label", "base_url", "model", "secret_reference", "is_active", "created_at", "updated_at") SELECT "id", "provider_id", "display_name", "label", NULL, "model", "secret_reference", "is_active", "created_at", "updated_at" FROM `provider_configurations`;--> statement-breakpoint
DROP TABLE `provider_configurations`;--> statement-breakpoint
ALTER TABLE `__new_provider_configurations` RENAME TO `provider_configurations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `provider_configurations_single_active_idx` ON `provider_configurations` (`is_active`) WHERE "provider_configurations"."is_active" = 1;

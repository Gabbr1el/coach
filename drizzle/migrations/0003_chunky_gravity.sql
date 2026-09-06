PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_provider_configurations` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`display_name` text NOT NULL,
	`label` text NOT NULL,
	`model` text NOT NULL,
	`secret_reference` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "provider_configurations_provider_check" CHECK("__new_provider_configurations"."provider_id" in ('openai')),
	CONSTRAINT "provider_configurations_secret_reference_check" CHECK(length(trim("__new_provider_configurations"."secret_reference")) > 0),
	CONSTRAINT "provider_configurations_label_check" CHECK(length(trim("__new_provider_configurations"."label")) between 1 and 60)
);
--> statement-breakpoint
INSERT INTO `__new_provider_configurations`("id", "provider_id", "display_name", "label", "model", "secret_reference", "is_active", "created_at", "updated_at") SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-a' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))), "provider_id", "display_name", "display_name", "model", "secret_reference", "is_active", "created_at", "updated_at" FROM `provider_configurations`;--> statement-breakpoint
DROP TABLE `provider_configurations`;--> statement-breakpoint
ALTER TABLE `__new_provider_configurations` RENAME TO `provider_configurations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;

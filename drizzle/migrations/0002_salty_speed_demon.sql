CREATE TABLE `provider_configurations` (
	`provider_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`model` text NOT NULL,
	`secret_reference` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "provider_configurations_provider_check" CHECK("provider_configurations"."provider_id" in ('openai')),
	CONSTRAINT "provider_configurations_secret_reference_check" CHECK(length(trim("provider_configurations"."secret_reference")) > 0)
);

PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_provider_configurations` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`display_name` text NOT NULL,
	`label` text NOT NULL,
	`auth_kind` text DEFAULT 'api-key' NOT NULL,
	`identity_label` text,
	`base_url` text,
	`model` text NOT NULL,
	`reasoning_effort` text DEFAULT 'auto' NOT NULL,
	`secret_reference` text NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "provider_configurations_provider_check" CHECK("__new_provider_configurations"."provider_id" in (
        'openai',
        'gemini',
        'github-copilot',
        'anthropic',
        'omniroute',
        'openai-compatible',
        'ollama'
      )),
	CONSTRAINT "provider_configurations_auth_kind_check" CHECK("__new_provider_configurations"."auth_kind" in (
        'api-key',
        'oauth',
        'endpoint-token',
        'local'
      )),
	CONSTRAINT "provider_configurations_reasoning_effort_check" CHECK("__new_provider_configurations"."reasoning_effort" in (
        'auto',
        'low',
        'medium',
        'high'
      )),
	CONSTRAINT "provider_configurations_secret_reference_check" CHECK(length(trim("__new_provider_configurations"."secret_reference")) > 0),
	CONSTRAINT "provider_configurations_label_check" CHECK(length(trim("__new_provider_configurations"."label")) between 1 and 60),
	CONSTRAINT "provider_configurations_identity_label_check" CHECK("__new_provider_configurations"."identity_label" is null or length(trim("__new_provider_configurations"."identity_label")) between 1 and 120),
	CONSTRAINT "provider_configurations_base_url_check" CHECK(
        (
          "__new_provider_configurations"."provider_id" in ('openai', 'gemini', 'github-copilot', 'anthropic')
          and "__new_provider_configurations"."base_url" is null
        )
        or
        (
          "__new_provider_configurations"."provider_id" in ('openai-compatible', 'omniroute', 'ollama')
          and "__new_provider_configurations"."base_url" is not null
          and length(trim("__new_provider_configurations"."base_url")) > 0
        )
      ),
	CONSTRAINT "provider_configurations_active_enabled_check" CHECK("__new_provider_configurations"."is_active" = 0 or "__new_provider_configurations"."is_enabled" = 1)
);
--> statement-breakpoint
INSERT INTO `__new_provider_configurations`("id", "provider_id", "display_name", "label", "auth_kind", "identity_label", "base_url", "model", "reasoning_effort", "secret_reference", "is_enabled", "is_active", "created_at", "updated_at") SELECT "id", "provider_id", "display_name", "label", "auth_kind", "identity_label", "base_url", "model", "reasoning_effort", "secret_reference", "is_enabled", "is_active", "created_at", "updated_at" FROM `provider_configurations`;--> statement-breakpoint
DROP TABLE `provider_configurations`;--> statement-breakpoint
ALTER TABLE `__new_provider_configurations` RENAME TO `provider_configurations`;--> statement-breakpoint
CREATE UNIQUE INDEX `provider_configurations_single_active_idx` ON `provider_configurations` (`is_active`) WHERE "provider_configurations"."is_active" = 1;--> statement-breakpoint
PRAGMA foreign_keys=ON;

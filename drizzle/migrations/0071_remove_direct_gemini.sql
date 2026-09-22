PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TRIGGER IF EXISTS `provider_configurations_identity_key_insert_check`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `provider_configurations_identity_key_update_check`;--> statement-breakpoint
DROP INDEX IF EXISTS `provider_configurations_provider_identity_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `provider_configurations_single_active_idx`;--> statement-breakpoint
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
  `identity_key` text,
  CONSTRAINT `provider_configurations_provider_check` CHECK(`provider_id` in ('openai','github-copilot','anthropic','omniroute','openai-compatible','ollama')),
  CONSTRAINT `provider_configurations_auth_kind_check` CHECK(`auth_kind` in ('api-key','oauth','endpoint-token','local')),
  CONSTRAINT `provider_configurations_reasoning_effort_check` CHECK(`reasoning_effort` in ('auto','low','medium','high')),
  CONSTRAINT `provider_configurations_secret_reference_check` CHECK(length(trim(`secret_reference`)) > 0),
  CONSTRAINT `provider_configurations_label_check` CHECK(length(trim(`label`)) between 1 and 60),
  CONSTRAINT `provider_configurations_identity_label_check` CHECK(`identity_label` is null or length(trim(`identity_label`)) between 1 and 120),
  CONSTRAINT `provider_configurations_identity_key_check` CHECK(`identity_key` is null or length(trim(`identity_key`)) between 1 and 160),
  CONSTRAINT `provider_configurations_base_url_check` CHECK((`provider_id` in ('openai','github-copilot','anthropic') and `base_url` is null) or (`provider_id` in ('openai-compatible','omniroute','ollama') and `base_url` is not null and length(trim(`base_url`)) > 0)),
  CONSTRAINT `provider_configurations_active_enabled_check` CHECK(`is_active` = 0 or `is_enabled` = 1)
);--> statement-breakpoint
INSERT INTO `__new_provider_configurations` (`id`,`provider_id`,`display_name`,`label`,`auth_kind`,`identity_label`,`base_url`,`model`,`reasoning_effort`,`secret_reference`,`is_enabled`,`is_active`,`created_at`,`updated_at`,`identity_key`)
SELECT `id`,`provider_id`,`display_name`,`label`,`auth_kind`,`identity_label`,`base_url`,`model`,`reasoning_effort`,`secret_reference`,`is_enabled`,`is_active`,`created_at`,`updated_at`,`identity_key`
FROM `provider_configurations` WHERE `provider_id` <> 'gemini';--> statement-breakpoint
DROP TABLE `provider_configurations`;--> statement-breakpoint
ALTER TABLE `__new_provider_configurations` RENAME TO `provider_configurations`;--> statement-breakpoint
CREATE UNIQUE INDEX `provider_configurations_single_active_idx` ON `provider_configurations` (`is_active`) WHERE `is_active` = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `provider_configurations_provider_identity_idx` ON `provider_configurations` (`provider_id`,`identity_key`) WHERE `identity_key` is not null;--> statement-breakpoint
PRAGMA foreign_keys=ON;

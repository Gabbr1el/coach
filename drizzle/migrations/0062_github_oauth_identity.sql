ALTER TABLE `provider_configurations`
ADD `identity_key` text;--> statement-breakpoint

CREATE UNIQUE INDEX `provider_configurations_provider_identity_idx`
ON `provider_configurations` (`provider_id`, `identity_key`)
WHERE `identity_key` is not null;--> statement-breakpoint

CREATE TRIGGER `provider_configurations_identity_key_insert_check`
BEFORE INSERT ON `provider_configurations`
WHEN NEW.`identity_key` is not null
  AND length(trim(NEW.`identity_key`)) not between 1 and 160
BEGIN
  SELECT RAISE(ABORT, 'invalid provider identity key');
END;--> statement-breakpoint

CREATE TRIGGER `provider_configurations_identity_key_update_check`
BEFORE UPDATE OF `identity_key` ON `provider_configurations`
WHEN NEW.`identity_key` is not null
  AND length(trim(NEW.`identity_key`)) not between 1 and 160
BEGIN
  SELECT RAISE(ABORT, 'invalid provider identity key');
END;

CREATE TABLE `__new_workspaces` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `objective` text DEFAULT '' NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `last_opened_at` integer,
  `archived_at` integer,
  `completed_at` integer,
  `confirmed_at` integer,
  `equivalence_key` text DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
  `meaningful_distinction` text,
  `predecessor_id` text REFERENCES `workspaces`(`id`) ON DELETE SET NULL,
  CONSTRAINT "workspaces_name_length_check" CHECK(length(trim(`name`)) between 1 and 80),
  CONSTRAINT "workspaces_status_check" CHECK(`status` in ('active','completed','archived')),
  CONSTRAINT "workspaces_archive_consistency_check" CHECK((`status`='active' and `archived_at` is null and `completed_at` is null) or (`status`='completed' and `completed_at` is not null and `archived_at` is null) or (`status`='archived' and `archived_at` is not null))
);
--> statement-breakpoint
INSERT INTO `__new_workspaces` (`id`,`name`,`objective`,`status`,`created_at`,`updated_at`,`last_opened_at`,`archived_at`,`completed_at`,`confirmed_at`,`equivalence_key`,`meaningful_distinction`,`predecessor_id`)
SELECT `id`,`name`,`objective`,`status`,`created_at`,`updated_at`,`last_opened_at`,`archived_at`,NULL,
  NULL,
  lower(hex(randomblob(16))),NULL,NULL
FROM `workspaces`;
--> statement-breakpoint
DROP TABLE `workspaces`;
--> statement-breakpoint
ALTER TABLE `__new_workspaces` RENAME TO `workspaces`;
--> statement-breakpoint
WITH RECURSIVE normalized(`id`,`rest`,`value`) AS (
  SELECT `id`,
    lower(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(`name`,'Á','a'),'À','a'),'Â','a'),'Ã','a'),'Ä','a'),'á','a'),'à','a'),'â','a'),'ã','a'),'ä','a'),'É','e'),'Ê','e'),'é','e'),'ê','e'),'Í','i'),'í','i')),
    '' FROM `workspaces`
  UNION ALL
  SELECT `id`,substr(`rest`,2),`value` || CASE
    WHEN substr(`rest`,1,1) IN ('Ó','Ò','Ô','Õ','Ö','ó','ò','ô','õ','ö') THEN 'o'
    WHEN substr(`rest`,1,1) IN ('Ú','Ù','Û','Ü','ú','ù','û','ü') THEN 'u'
    WHEN substr(`rest`,1,1) IN ('Ç','ç') THEN 'c'
    WHEN substr(`rest`,1,1) BETWEEN 'a' AND 'z' OR substr(`rest`,1,1) BETWEEN '0' AND '9' OR substr(`rest`,1,1) IN ('+','#') THEN substr(`rest`,1,1)
    WHEN length(`value`)>0 AND substr(`value`,-1)<>' ' THEN ' ' ELSE '' END
  FROM normalized WHERE length(`rest`)>0
), keys AS (
  SELECT `id`,trim(`value`) AS `plain` FROM normalized WHERE `rest`=''
)
UPDATE `workspaces` SET `equivalence_key`=(SELECT CASE
  WHEN `plain` IN ('poo','programacao orientada a objetos','orientacao a objetos') THEN 'programacao-orientada-a-objetos'
  WHEN `plain` IN ('js','javascript','java script') THEN 'javascript'
  ELSE replace(`plain`,' ','-') END FROM keys WHERE keys.`id`=`workspaces`.`id`);
--> statement-breakpoint
DELETE FROM `weekly_plan_items` WHERE `status`<>'completed' AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id=`weekly_plan_items`.`workspace_id` AND w.status<>'active');
--> statement-breakpoint
DELETE FROM `study_plan_items` WHERE `status`<>'completed' AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id=`study_plan_items`.`workspace_id` AND w.status<>'active');
--> statement-breakpoint
CREATE INDEX `workspaces_status_updated_idx` ON `workspaces` (`status`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `workspaces_last_opened_idx` ON `workspaces` (`last_opened_at`);
--> statement-breakpoint
CREATE INDEX `workspaces_active_equivalence_idx` ON `workspaces` (`equivalence_key`) WHERE `status`='active' AND `confirmed_at` IS NOT NULL;

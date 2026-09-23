ALTER TABLE `ontology_classes` DROP FOREIGN KEY `ontology_classes_moduleId_ontology_modules_id_fk`;
--> statement-breakpoint
ALTER TABLE `ontology_properties` DROP FOREIGN KEY `ontology_properties_moduleId_ontology_modules_id_fk`;
--> statement-breakpoint
ALTER TABLE `ontology_versions` DROP FOREIGN KEY `ontology_versions_moduleId_ontology_modules_id_fk`;
--> statement-breakpoint
ALTER TABLE `ontology_classes` ADD CONSTRAINT `ontology_classes_moduleId_ontology_modules_id_fk` FOREIGN KEY (`moduleId`) REFERENCES `ontology_modules`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ontology_properties` ADD CONSTRAINT `ontology_properties_moduleId_ontology_modules_id_fk` FOREIGN KEY (`moduleId`) REFERENCES `ontology_modules`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ontology_versions` ADD CONSTRAINT `ontology_versions_moduleId_ontology_modules_id_fk` FOREIGN KEY (`moduleId`) REFERENCES `ontology_modules`(`id`) ON DELETE cascade ON UPDATE no action;
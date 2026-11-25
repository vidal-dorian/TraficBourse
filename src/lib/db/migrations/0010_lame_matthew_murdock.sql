CREATE TABLE `job_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`updated_count` integer NOT NULL,
	`failed` text NOT NULL
);

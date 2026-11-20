CREATE TABLE `briefs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`tldr` text NOT NULL,
	`mood` text NOT NULL,
	`raw_payload` text NOT NULL,
	`published_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `briefs_date_kind_unique` ON `briefs` (`date`,`kind`);--> statement-breakpoint
CREATE TABLE `news_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brief_id` integer NOT NULL,
	`rank` integer NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`why_it_matters` text NOT NULL,
	`impact` text NOT NULL,
	`category` text NOT NULL,
	`tickers` text NOT NULL,
	`source_name` text NOT NULL,
	`source_url` text NOT NULL,
	FOREIGN KEY (`brief_id`) REFERENCES `briefs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `news_items_brief_rank_unique` ON `news_items` (`brief_id`,`rank`);
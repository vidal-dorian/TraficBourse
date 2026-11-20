CREATE TABLE `mcp_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tool` text NOT NULL,
	`ok` integer NOT NULL,
	`error` text,
	`duration_ms` integer NOT NULL,
	`at` integer DEFAULT (unixepoch()) NOT NULL
);

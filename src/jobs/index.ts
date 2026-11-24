// Entrypoint of the `jobs` container (same image as `web`, see docker-compose.yml).
// Wires node-cron, the database and the Yahoo provider; the jobs themselves live in their own
// modules; schedules run in Europe/Paris (see schedule.ts). Still to come: missing-brief check, nightly backup (CLAUDE.md §2).
import { drizzle } from "drizzle-orm/better-sqlite3";
import cron from "node-cron";
import { openDatabase, resolveDatabasePath } from "../lib/db/client";
import * as schema from "../lib/db/schema";
import { createYahooProvider } from "../lib/market/yahoo";
import { runPricesJob } from "./prices";
import { startScheduler, TIMEZONE } from "./schedule";

const db = drizzle(openDatabase(resolveDatabasePath()), { schema });
const provider = createYahooProvider();

const tasks = startScheduler({ cron, runPrices: () => runPricesJob({ db, provider }) });

console.log(`jobs: scheduler started (timezone ${TIMEZONE})`);

function stop(signal: NodeJS.Signals): void {
  console.log(`jobs: ${signal} received, stopping the scheduler`);
  void Promise.all(tasks.map((task) => task.stop())).finally(() => process.exit(0));
}

process.once("SIGTERM", stop);
process.once("SIGINT", stop);

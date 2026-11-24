// Entrypoint of the `jobs` container (same image as `web`, see docker-compose.yml).
// Wires node-cron, the database and the Yahoo provider (and the Twelve Data fallback when its key is set); the jobs themselves live in their own
// modules; schedules run in Europe/Paris (see schedule.ts). Still to come: missing-brief check, nightly backup (CLAUDE.md §2).
import { drizzle } from "drizzle-orm/better-sqlite3";
import cron from "node-cron";
import { openDatabase, resolveDatabasePath } from "../lib/db/client";
import * as schema from "../lib/db/schema";
import { createTwelveDataProvider } from "../lib/market/twelvedata";
import { createYahooProvider } from "../lib/market/yahoo";
import { runPricesJob } from "./prices";
import { startScheduler, TIMEZONE } from "./schedule";

const db = drizzle(openDatabase(resolveDatabasePath()), { schema });
const provider = createYahooProvider();

// Twelve Data (free tier, 8 calls a minute) only serves the symbols Yahoo fails on.
const twelveDataKey = process.env.TWELVE_DATA_API_KEY?.trim();
const fallback = twelveDataKey ? createTwelveDataProvider({ apiKey: twelveDataKey }) : undefined;
if (!fallback) console.log("jobs: TWELVE_DATA_API_KEY not set, no fallback if Yahoo fails");

const tasks = startScheduler({ cron, runPrices: () => runPricesJob({ db, provider, fallback }) });

console.log(`jobs: scheduler started (timezone ${TIMEZONE})`);

function stop(signal: NodeJS.Signals): void {
  console.log(`jobs: ${signal} received, stopping the scheduler`);
  void Promise.all(tasks.map((task) => task.stop())).finally(() => process.exit(0));
}

process.once("SIGTERM", stop);
process.once("SIGINT", stop);

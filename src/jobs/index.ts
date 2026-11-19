// Entrypoint of the `jobs` container (same image as `web`, see docker-compose.yml).
// Phase 0: it only proves the scheduler runs. The real jobs (prices at 06:30, missing-brief
// check, nightly backup; CLAUDE.md §2) arrive in phase 2.
import cron from "node-cron";

/** Every schedule is read in Paris time, whatever the timezone of the container. */
const TIMEZONE = "Europe/Paris";

/** Hourly log line, so `docker compose logs jobs` shows the scheduler is alive. */
const heartbeat = cron.schedule("0 * * * *", () => console.log("jobs: heartbeat"), {
  name: "heartbeat",
  timezone: TIMEZONE,
});

console.log(`jobs: scheduler started (timezone ${TIMEZONE})`);

function stop(signal: NodeJS.Signals): void {
  console.log(`jobs: ${signal} received, stopping the scheduler`);
  void Promise.resolve(heartbeat.stop()).finally(() => process.exit(0));
}

process.once("SIGTERM", stop);
process.once("SIGINT", stop);

// Schedules of the `jobs` container. Kept apart from the entrypoint so it can be tested
// with a fake cron.

/** Every schedule is read in Paris time, whatever the timezone of the container. */
export const TIMEZONE = "Europe/Paris";

/** Prices job: every day at 06:30 (CLAUDE.md §2). */
export const PRICES_CRON = "30 6 * * *";

/** The part of node-cron the scheduler uses. */
export interface CronLike {
  schedule(
    expression: string,
    task: () => unknown,
    options: { name: string; timezone: string },
  ): { stop(): unknown };
}

export interface SchedulerOptions {
  cron: CronLike;
  runPrices: () => Promise<unknown>;
}

/** Registers the hourly heartbeat and the prices job; returns the tasks to stop on shutdown. */
export function startScheduler({ cron, runPrices }: SchedulerOptions): { stop(): unknown }[] {
  // Hourly log line, so `docker compose logs jobs` shows the scheduler is alive.
  const heartbeat = cron.schedule("0 * * * *", () => console.log("jobs: heartbeat"), {
    name: "heartbeat",
    timezone: TIMEZONE,
  });
  const prices = cron.schedule(
    PRICES_CRON,
    async () => {
      // A failed run must not crash the process: the next one is tomorrow.
      try {
        await runPrices();
      } catch (error) {
        console.error("jobs: prices run failed", error);
      }
    },
    { name: "prices", timezone: TIMEZONE },
  );
  return [heartbeat, prices];
}

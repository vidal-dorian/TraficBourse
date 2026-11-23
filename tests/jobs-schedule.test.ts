// US #18 — criterion 72: the prices job is scheduled at 06:30 Paris time.
import { describe, expect, it, vi } from "vitest";
import { PRICES_CRON, startScheduler, TIMEZONE } from "@/jobs/schedule";

describe("criterion 72 — the job runs at 06:30 Paris time", () => {
  it("given the scheduler, when it starts, then the prices job is registered at 30 6 * * * in Europe/Paris and its callback runs the prices job", async () => {
    expect(PRICES_CRON).toBe("30 6 * * *");
    expect(TIMEZONE).toBe("Europe/Paris");

    const registered: { expr: string; fn: () => unknown; opts: Record<string, unknown> }[] = [];
    const cron = {
      schedule: vi.fn((expr: string, fn: () => unknown, opts: Record<string, unknown>) => {
        registered.push({ expr, fn, opts });
        return { stop: vi.fn() };
      }),
    };
    const runPrices = vi.fn(async () => ({}));
    startScheduler({ cron: cron as never, runPrices });

    const prices = registered.find((r) => r.opts?.name === "prices");
    expect(prices).toBeDefined();
    expect(prices?.expr).toBe("30 6 * * *");
    expect(prices?.opts).toMatchObject({ timezone: "Europe/Paris", name: "prices" });
    await prices?.fn();
    expect(runPrices).toHaveBeenCalledTimes(1);
  });
});

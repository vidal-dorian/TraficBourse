// US #21 — the pure geometry of the tile curves.
import { describe, expect, it } from "vitest";
import { curvePoints } from "../src/lib/render/market-tiles";

const ys = (points: string) => points.split(" ").map((p) => Number(p.split(",")[1]));

describe("curvePoints", () => {
  it("given a rise, when scaled, then y decreases and stays inside the 1 px padding", () => {
    const [a, b, c] = ys(curvePoints([{ date: "d1", close: 1 }, { date: "d2", close: 2 }, { date: "d3", close: 3 }]));
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(c).toBe(1);
    expect(a).toBe(31);
  });

  it("given a flat series, when scaled, then every point sits in the middle", () => {
    expect(ys(curvePoints([{ date: "d1", close: 5 }, { date: "d2", close: 5 }]))).toEqual([16, 16]);
  });
});

"use client";

// The curves of a news item's chart (US #22), drawn with TradingView Lightweight Charts. The data
// comes from the server as props (closes of `prices_daily`): nothing is fetched here. The library
// is loaded in the effect, so the server render only outputs the empty container.
import { useEffect, useRef } from "react";
import type { ChartSeries } from "@/lib/market/chart";

/** One neutral, distinct colour per curve (a chart shows at most 3 instruments). */
const LINE_COLORS = ["#1d4ed8", "#b45309", "#047857"];

const HEIGHT = 224;

export function PriceChart({ series }: { series: ChartSeries[] }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let disposed = false;
    let remove: (() => void) | undefined;

    void import("lightweight-charts").then(({ createChart, LineSeries }) => {
      if (disposed) return;
      // `autoSize` follows the width of the container, so the chart fits a phone screen.
      const chart = createChart(element, {
        autoSize: true,
        height: HEIGHT,
        layout: { attributionLogo: true, fontFamily: "inherit" },
        localization: { locale: "fr-FR" },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false },
      });
      series.forEach((entry, index) => {
        const line = chart.addSeries(LineSeries, { color: LINE_COLORS[index % LINE_COLORS.length], lineWidth: 2 });
        line.setData(entry.points.map((point) => ({ time: point.date, value: point.value })));
      });
      chart.timeScale().fitContent();
      remove = () => chart.remove();
    });

    return () => {
      disposed = true;
      remove?.();
    };
  }, [series]);

  return <div ref={container} className="mt-2 w-full" style={{ height: HEIGHT }} aria-hidden="true" />;
}

"use client";

import { useEffect, useRef } from "react";

export interface PnLPoint {
  time: number; // unix timestamp (seconds)
  value: number; // balance USDT
}

interface Props {
  data: PnLPoint[];
  height?: number;
  lineColor?: string;
  areaTop?: string;
  areaBottom?: string;
}

export default function PnLChart({
  data,
  height = 260,
  lineColor = "#0AFFE0",
  areaTop = "rgba(10,255,224,0.18)",
  areaBottom = "rgba(10,255,224,0.01)",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    let chart: any;
    let series: any;

    async function init() {
      const { createChart, ColorType } = await import("lightweight-charts");

      const container = containerRef.current!;
      container.innerHTML = "";

      chart = createChart(container, {
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "#666",
          fontFamily: "JetBrains Mono",
          fontSize: 11,
        },
        grid: {
          vertLines: { color: "rgba(42,42,62,0.4)" },
          horzLines: { color: "rgba(42,42,62,0.4)" },
        },
        crosshair: {
          mode: 1,
          vertLine: { color: "rgba(10,255,224,0.4)", labelBackgroundColor: "#0AFFE0" },
          horzLine: { color: "rgba(10,255,224,0.4)", labelBackgroundColor: "#0AFFE0" },
        },
        rightPriceScale: {
          borderColor: "rgba(42,42,62,0.6)",
          textColor: "#666",
        },
        timeScale: {
          borderColor: "rgba(42,42,62,0.6)",
          timeVisible: true,
          secondsVisible: false,
        },
        width: container.clientWidth,
        height,
      });

      series = chart.addAreaSeries({
        lineColor,
        topColor: areaTop,
        bottomColor: areaBottom,
        lineWidth: 2,
        priceFormat: { type: "price", precision: 2, minMove: 0.01 },
      });

      series.setData(data.map((d) => ({ time: d.time, value: d.value })));
      chart.timeScale().fitContent();

      chartRef.current = chart;

      // Resize observer
      const ro = new ResizeObserver(() => {
        if (chart && container) {
          chart.applyOptions({ width: container.clientWidth });
        }
      });
      ro.observe(container);
      return () => ro.disconnect();
    }

    init();

    return () => {
      if (chartRef.current) {
        try { chartRef.current.remove(); } catch { }
        chartRef.current = null;
      }
    };
  }, [data, height]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-xl bg-bg-panel/40" style={{ height }}>
        <p className="text-sm text-text-muted">Нет данных для построения графика</p>
      </div>
    );
  }

  return <div ref={containerRef} className="w-full" style={{ height }} />;
}

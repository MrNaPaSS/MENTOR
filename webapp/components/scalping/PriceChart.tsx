"use client";

// График свечей рядом со стаканом.
//
// Свечи берутся у того же источника, что и книга заявок. Это не мелочь: если
// график тянуть из другого места, трейдер увидит на нём одну цену, а в стакане
// другую, и доверия к разделу не будет.
//
// Плита из стакана отмечена на графике горизонтальной линией — видно, подходила
// ли цена к этому уровню раньше и как от него отбивалась.

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type UTCTimestamp,
} from "lightweight-charts";
import { API_URL } from "@/lib/api";
import type { Wall } from "@/lib/scalping";

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

// Свеча закрывается раз в минуту, но текущая меняется постоянно. Пять секунд —
// компромисс: график живой, а лимит запросов биржи не расходуется впустую.
const REFRESH_MS = 5000;

export default function PriceChart({
  symbol,
  wall,
}: {
  symbol: string;
  wall: Wall | null;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineRef = useRef<IPriceLine | null>(null);

  // Создаём график один раз: пересоздание на каждой смене монеты дало бы
  // мигание и потерю масштаба, который трейдер выставил руками.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const chart = createChart(box, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#7A8290",
        fontFamily: "var(--font-mono), monospace",
      },
      grid: {
        vertLines: { color: "rgba(43,49,57,0.4)" },
        horzLines: { color: "rgba(43,49,57,0.4)" },
      },
      rightPriceScale: {
        borderColor: "#2B3139",
        // По умолчанию сверху и снизу остаётся по 20% пустоты, и свечи
        // занимают половину окна. Скальперу нужен размах цены, а не поля.
        scaleMargins: { top: 0.06, bottom: 0.06 },
      },
      timeScale: { borderColor: "#2B3139", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      autoSize: true,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#0ECB81",
      downColor: "#F6465D",
      borderVisible: false,
      wickUpColor: "#0ECB81",
      wickDownColor: "#F6465D",
    });

    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      lineRef.current = null;
    };
  }, []);

  // Свечи: первая загрузка при смене монеты и периодическое обновление.
  useEffect(() => {
    let cancelled = false;

    async function load(fit: boolean) {
      try {
        const res = await fetch(
          `${API_URL}/api/scalping/klines/${symbol}?interval=1m&limit=240`,
        );
        if (!res.ok) return;
        const body: { candles: Candle[] } = await res.json();
        if (cancelled || !seriesRef.current) return;
        seriesRef.current.setData(
          body.candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })),
        );
        if (fit) chartRef.current?.timeScale().fitContent();
      } catch {
        // Сеть моргнула — следующая попытка через REFRESH_MS.
      }
    }

    load(true);
    const timer = setInterval(() => load(false), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [symbol]);

  // Линия плиты. Пересоздаём только когда уровень изменился: дёргать её на
  // каждом кадре стакана незачем, она бы моргала.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (lineRef.current) {
      series.removePriceLine(lineRef.current);
      lineRef.current = null;
    }
    if (!wall) return;
    lineRef.current = series.createPriceLine({
      price: wall.price,
      color: "#F0B90B",
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: "плита",
    });
  }, [wall?.price, wall?.side]);

  return <div ref={boxRef} className="h-full w-full" />;
}

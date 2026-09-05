"use client";

// График свечей рядом со стаканом.
//
// Свечи берутся у того же источника, что и книга заявок. Это не мелочь: если
// график тянуть из другого места, трейдер увидит на нём одну цену, а в стакане
// другую, и доверия к разделу не будет.
//
// Индикаторы считаются на клиенте по тем же свечам — отдельных запросов ради
// средней линии не делаем.

import { useEffect, useMemo, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { API_URL } from "@/lib/api";
import type { Wall } from "@/lib/scalping";

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Indicators = {
  volume: boolean;
  ema: boolean;
  vwap: boolean;
};

// Периоды скользящих средних. Девять и двадцать один — стандартная пара для
// внутридневной торговли: быстрая показывает импульс, медленная — направление.
const EMA_FAST = 9;
const EMA_SLOW = 21;

// Текущая свеча меняется постоянно, закрытые — нет. Пять секунд держат график
// живым, не расходуя лимит запросов биржи впустую.
const REFRESH_MS = 5000;

function ema(candles: Candle[], period: number) {
  if (candles.length < period) return [];
  const k = 2 / (period + 1);
  const out: { time: UTCTimestamp; value: number }[] = [];
  let prev = candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period;
  out.push({ time: candles[period - 1].time as UTCTimestamp, value: prev });
  for (let i = period; i < candles.length; i++) {
    prev = candles[i].close * k + prev * (1 - k);
    out.push({ time: candles[i].time as UTCTimestamp, value: prev });
  }
  return out;
}

/** VWAP от начала загруженного окна: средняя цена, взвешенная объёмом. */
function vwap(candles: Candle[]) {
  let pv = 0;
  let vol = 0;
  return candles.map((c) => {
    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * c.volume;
    vol += c.volume;
    return {
      time: c.time as UTCTimestamp,
      value: vol > 0 ? pv / vol : c.close,
    };
  });
}

export default function PriceChart({
  symbol,
  interval,
  wall,
  indicators,
}: {
  symbol: string;
  interval: string;
  wall: Wall | null;
  indicators: Indicators;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const emaFastRef = useRef<ISeriesApi<"Line"> | null>(null);
  const emaSlowRef = useRef<ISeriesApi<"Line"> | null>(null);
  const vwapRef = useRef<ISeriesApi<"Line"> | null>(null);
  const lineRef = useRef<IPriceLine | null>(null);
  const dataRef = useRef<Candle[]>([]);

  const cfg = useMemo(() => indicators, [indicators.volume, indicators.ema, indicators.vwap]);

  // График создаётся один раз. Пересоздание на каждой смене монеты давало бы
  // мигание и сбрасывало масштаб, который трейдер выставил руками.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const chart = createChart(box, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#7A8290",
        fontFamily: "var(--font-mono), monospace",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(43,49,57,0.35)" },
        horzLines: { color: "rgba(43,49,57,0.35)" },
      },
      rightPriceScale: {
        borderColor: "#2B3139",
        // По умолчанию сверху и снизу остаётся по 20% пустоты, и свечи
        // занимают половину окна. Скальперу нужен размах цены, а не поля.
        scaleMargins: { top: 0.06, bottom: 0.22 },
      },
      timeScale: { borderColor: "#2B3139", timeVisible: true, secondsVisible: false },
      crosshair: {
        mode: 0,
        vertLine: { color: "#0AFFE0", width: 1, style: 3, labelBackgroundColor: "#0AFFE0" },
        horzLine: { color: "#0AFFE0", width: 1, style: 3, labelBackgroundColor: "#0AFFE0" },
      },
      autoSize: true,
    });

    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: "#0ECB81",
      downColor: "#F6465D",
      borderVisible: false,
      wickUpColor: "#0ECB81",
      wickDownColor: "#F6465D",
    });

    // Объём живёт на своей шкале в нижней пятой части окна, иначе он
    // раздавил бы цену.
    volumeRef.current = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    emaFastRef.current = chart.addSeries(LineSeries, {
      color: "#0AFFE0",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    emaSlowRef.current = chart.addSeries(LineSeries, {
      color: "#F0B90B",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    vwapRef.current = chart.addSeries(LineSeries, {
      color: "#B7BDC6",
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      emaFastRef.current = null;
      emaSlowRef.current = null;
      vwapRef.current = null;
      lineRef.current = null;
    };
  }, []);

  // Свечи: первая загрузка при смене монеты или таймфрейма, дальше обновление.
  useEffect(() => {
    let cancelled = false;

    function draw(candles: Candle[]) {
      dataRef.current = candles;
      candleRef.current?.setData(
        candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })),
      );
      volumeRef.current?.setData(
        candles.map((c) => ({
          time: c.time as UTCTimestamp,
          value: c.volume,
          color: c.close >= c.open ? "rgba(14,203,129,0.4)" : "rgba(246,70,93,0.4)",
        })),
      );
      emaFastRef.current?.setData(ema(candles, EMA_FAST));
      emaSlowRef.current?.setData(ema(candles, EMA_SLOW));
      vwapRef.current?.setData(vwap(candles));
    }

    async function load(fit: boolean) {
      try {
        const res = await fetch(
          `${API_URL}/api/scalping/klines/${symbol}?interval=${interval}&limit=400`,
        );
        if (!res.ok) return;
        const body: { candles: Candle[] } = await res.json();
        if (cancelled || !candleRef.current) return;
        draw(body.candles);
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
  }, [symbol, interval]);

  // Видимость индикаторов — отдельно от данных: переключение не должно
  // дёргать загрузку и сбрасывать масштаб.
  useEffect(() => {
    volumeRef.current?.applyOptions({ visible: cfg.volume });
    emaFastRef.current?.applyOptions({ visible: cfg.ema });
    emaSlowRef.current?.applyOptions({ visible: cfg.ema });
    vwapRef.current?.applyOptions({ visible: cfg.vwap });
  }, [cfg]);

  // Линия плиты из стакана: видно, подходила ли цена к этому уровню раньше.
  // Пересоздаём только при смене уровня — иначе моргала бы на каждом кадре.
  useEffect(() => {
    const series = candleRef.current;
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

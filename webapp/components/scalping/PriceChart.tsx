"use client";

// График свечей рядом со стаканом.
//
// Свечи берутся у того же источника, что и книга заявок. Это не мелочь: если
// график тянуть из другого места, трейдер увидит на нём одну цену, а в стакане
// другую, и доверия к разделу не будет.
//
// Структура и средние считаются на клиенте по тем же свечам — отдельных
// запросов ради средней линии не делаем. Полки приходят из стакана: это
// единственное на графике, что берётся не из истории цены, а из живой книги.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { API_URL } from "@/lib/api";
import { computeSmc, type SmcResult } from "@/lib/indicator/smc";
import { ema } from "@/lib/indicator/ta";
import type { Candle } from "@/lib/indicator/types";
import { buildShapes } from "@/lib/indicator/shapes";
import {
  EMPTY_SHAPES,
  ShapesPrimitive,
  type Shapes,
} from "./primitives/ShapesPrimitive";
import { money, price as fmtPrice, type Wall } from "@/lib/scalping";

// Цвета покупок и продаж из палитры проекта.
const BUY = "#0ECB81";
const SELL = "#F6465D";

// Периоды скользящих средних индикатора.
const EMA_FAST = 8;
const EMA_SLOW = 21;
const EMA_TREND = 50;

export type { Candle };

export type Indicators = {
  volume: boolean;
  /** Скользящие средние индикатора: 8, 21 и трендовая 50. */
  ema: boolean;
  /** Полки ликвидности: цены, где в стакане стоит от двух миллионов. */
  shelves: boolean;
  /** Структура рынка: BOS и CHoCH, подписи свингов. */
  structure: boolean;
  /** Ордер-блоки: три внутренних и два свинговых. */
  blocks: boolean;
  /** Разрывы справедливой цены и равные экстремумы. */
  gaps: boolean;
  /** Максимумы и минимумы прошлого дня, недели и месяца. */
  levels: boolean;
  /** Зоны премии, равновесия и скидки. */
  zones: boolean;
};

/** Периоды старших уровней: код интервала биржи и подпись на графике. */
const MTF_PERIODS: { interval: string; high: string; low: string; color: string }[] = [
  { interval: "1d", high: "PDH", low: "PDL", color: "#2157F3" },
  { interval: "1w", high: "PWH", low: "PWL", color: "#2157F3" },
  { interval: "1M", high: "PMH", low: "PML", color: "#2157F3" },
];

// Текущая свеча меняется постоянно, закрытые — нет. Пять секунд держат график
// живым, не расходуя лимит запросов биржи впустую.
const REFRESH_MS = 5000;

// Сколько свечей показываем сразу. Четыреста грузим ради индикаторов и
// прокрутки назад, но в окне они превращаются в щётку — видно должно быть
// столько, сколько трейдер реально читает.
const VISIBLE_BARS = 150;

/** Ряд для графика: бары, где значение ещё не определено, пропускаем. */
function toLine(candles: Candle[], values: number[]) {
  const out: { time: UTCTimestamp; value: number }[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (Number.isFinite(values[i])) {
      out.push({ time: candles[i].time as UTCTimestamp, value: values[i] });
    }
  }
  return out;
}

export default function PriceChart({
  symbol,
  interval,
  wall,
  shelves,
  indicators,
}: {
  symbol: string;
  interval: string;
  wall: Wall | null;
  shelves: Wall[];
  indicators: Indicators;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const emaFastRef = useRef<ISeriesApi<"Line"> | null>(null);
  const emaSlowRef = useRef<ISeriesApi<"Line"> | null>(null);
  const emaTrendRef = useRef<ISeriesApi<"Line"> | null>(null);
  const shapesRef = useRef<ShapesPrimitive | null>(null);
  const shapeDataRef = useRef<Shapes>(EMPTY_SHAPES);
  // Результат структурного движка держим отдельно: переключатели меняют набор
  // фигур, и пересчитывать структуру ради этого незачем.
  const smcRef = useRef<SmcResult | null>(null);
  const lastTimeRef = useRef(0);
  // Читаем настройки из ref: загрузка данных не должна зависеть от
  // переключателей, иначе включение индикатора перезапрашивало бы свечи.
  const indicatorsRef = useRef(indicators);
  indicatorsRef.current = indicators;
  const lineRef = useRef<IPriceLine | null>(null);
  const mtfLinesRef = useRef<IPriceLine[]>([]);
  const shelfShapesRef = useRef<ShapesPrimitive | null>(null);
  const dataRef = useRef<Candle[]>([]);

  // Загруженные уровни старших периодов. Нужны не только для линий: на минутном
  // графике сто пятьдесят баров укладываются в двести долларов, а вчерашние
  // максимум и минимум разнесены на три тысячи — линия оказывается далеко за
  // краем окна, и нажатие кнопки выглядит как «ничего не произошло». Поэтому
  // уровни ещё и выписываются строкой с расстоянием до цены.
  const [levels, setLevels] = useState<{ title: string; price: number }[]>([]);

  // Полки перерисовываем только когда меняется сам набор цен. Стакан обновляется
  // восемь раз в секунду, и пересоздание линий на каждом кадре давало бы моргание.
  const shelfKey = shelves
    .map((s) => `${s.price}`)
    .sort()
    .join("|");

  const cfg = useMemo(
    () => indicators,
    [
      indicators.volume,
      indicators.ema,
      indicators.structure,
      indicators.blocks,
      indicators.gaps,
      indicators.levels,
      indicators.zones,
      indicators.shelves,
    ],
  );

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
    // Трендовая: по ней индикатор фильтрует направление сигнала.
    emaTrendRef.current = chart.addSeries(LineSeries, {
      color: "#7A8290",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    // Структура, ордер-блоки и разрывы: всё, что рисуется поверх свечей
    // произвольными фигурами.
    shapesRef.current = new ShapesPrimitive();
    candleRef.current.attachPrimitive(shapesRef.current);

    // Полки живут отдельным примитивом: они приходят из стакана и меняются
    // своим темпом, а структура — из свечей и своим. Общий набор фигур
    // пересобирался бы восемь раз в секунду ради нескольких линий.
    shelfShapesRef.current = new ShapesPrimitive("top");
    candleRef.current.attachPrimitive(shelfShapesRef.current);

    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      emaFastRef.current = null;
      emaSlowRef.current = null;
      emaTrendRef.current = null;
      shapesRef.current = null;
      lineRef.current = null;
      mtfLinesRef.current = [];
      shelfShapesRef.current = null;
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

      // Средние считаются по тем же свечам, что и всё остальное.
      const close = candles.map((c) => c.close);

      emaFastRef.current?.setData(toLine(candles, ema(close, EMA_FAST)));
      emaSlowRef.current?.setData(toLine(candles, ema(close, EMA_SLOW)));
      emaTrendRef.current?.setData(toLine(candles, ema(close, EMA_TREND)));



      // Структурная часть считается по тем же свечам одним проходом.
      const smc = computeSmc(candles);
      const cfgNow = indicatorsRef.current;
      shapeDataRef.current = buildShapes(smc, candles[candles.length - 1]?.time ?? 0, {
        structure: cfgNow.structure,
        orderBlocks: cfgNow.blocks,
        fvg: cfgNow.gaps,
        equal: cfgNow.gaps,
        zones: cfgNow.zones,
      });
      shapesRef.current?.setShapes(shapeDataRef.current);
      smcRef.current = smc;
      lastTimeRef.current = candles[candles.length - 1]?.time ?? 0;


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
        if (fit) reframe(body.candles.length);
      } catch {
        // Сеть моргнула — следующая попытка через REFRESH_MS.
      }
    }

    /** Навести график на свежие свечи новой монеты.
     *
     * Одной подгонки шкалы времени мало: ценовая шкала запоминает диапазон
     * прошлого инструмента, и после переключения график висел где-то за краем
     * окна — цену приходилось искать руками. Поэтому включаем автомасштаб
     * заново и показываем последние свечи, а не все четыреста: на всём окне
     * они сжимаются в неразличимую щётку.
     */
    function reframe(total: number) {
      const chart = chartRef.current;
      if (!chart) return;
      chart.priceScale("right").applyOptions({ autoScale: true });
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, total - VISIBLE_BARS),
        to: total + 2,
      });
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
    emaTrendRef.current?.applyOptions({ visible: cfg.ema });

    // Фигуры пересобираем из уже посчитанной структуры: переключатель меняет
    // только набор видимого, считать заново незачем.
    if (smcRef.current) {
      shapeDataRef.current = buildShapes(smcRef.current, lastTimeRef.current, {
        structure: cfg.structure,
        orderBlocks: cfg.blocks,
        fvg: cfg.gaps,
        equal: cfg.gaps,
        zones: cfg.zones,
      });
      shapesRef.current?.setShapes(shapeDataRef.current);
    }
  }, [cfg]);

  // Уровни прошлого дня, недели и месяца. Грузятся отдельно от свечей графика:
  // это другие интервалы, и меняются они раз в сутки, а не каждые пять секунд.
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;

    let cancelled = false;
    for (const l of mtfLinesRef.current) series.removePriceLine(l);
    mtfLinesRef.current = [];
    setLevels([]);
    if (!cfg.levels) return;

    async function load() {
      const collected: { title: string; price: number }[] = [];

      for (const period of MTF_PERIODS) {
        try {
          const res = await fetch(
            `${API_URL}/api/scalping/klines/${symbol}?interval=${period.interval}&limit=3`,
          );
          if (!res.ok) continue;
          const body: { candles: Candle[] } = await res.json();
          // Берём предпоследнюю свечу: последняя — текущий незакрытый период,
          // а уровень интересен именно завершённый.
          const previous = body.candles.at(-2);
          if (cancelled || !previous || !candleRef.current) continue;

          for (const [price, title] of [
            [previous.high, period.high],
            [previous.low, period.low],
          ] as const) {
            collected.push({ title, price });
            mtfLinesRef.current.push(
              candleRef.current.createPriceLine({
                price,
                color: period.color,
                lineWidth: 1,
                lineStyle: 2,
                axisLabelVisible: true,
                title,
              }),
            );
          }
        } catch {
          // Уровень не загрузился — график от этого не ломается.
        }
      }

      if (!cancelled) setLevels(collected);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [symbol, cfg.levels]);

  // Полки ликвидности: цены, где в стакане стоит от двух миллионов. Это то,
  // чего нет ни в одном индикаторе — уровни берутся из живой книги заявок, а не
  // из истории цены. Видно, куда цена идёт и где её встретят.
  //
  // Рисуем своим примитивом, а не ценовой линией: у линии подпись выводится
  // только плашкой на оси, и десяток полок превращал шкалу в стену бейджей.
  useEffect(() => {
    const candles = dataRef.current;
    if (!shelfShapesRef.current || candles.length === 0) return;

    if (!cfg.shelves) {
      shelfShapesRef.current.setShapes(EMPTY_SHAPES);
      return;
    }

    const from = candles[0].time as UTCTimestamp;
    const to = candles[candles.length - 1].time as UTCTimestamp;
    shelfShapesRef.current.setShapes({
      boxes: [],
      points: [],
      segments: shelves.map((shelf) => ({
        fromTime: from,
        toTime: to,
        price: shelf.price,
        color: shelf.side === "bid" ? BUY : SELL,
        dashed: true,
        label: money(shelf.notional),
        labelAt: "end" as const,
      })),
    });
  }, [shelfKey, cfg.shelves, lastTimeRef.current]);

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

  return (
    <div className="relative h-full w-full">
      <div ref={boxRef} className="h-full w-full" />
      {cfg.levels && levels.length > 0 && (
        <LevelsStrip levels={levels} price={dataRef.current.at(-1)?.close ?? 0} />
      )}
    </div>
  );
}

/**
 * Уровни старших периодов строкой, с расстоянием до текущей цены.
 *
 * Ближние — первыми: на скальпе важно, что рядом, а не что было в прошлом
 * месяце. Строка нужна потому, что сама линия почти всегда за краем окна.
 */
function LevelsStrip({
  levels,
  price,
}: {
  levels: { title: string; price: number }[];
  price: number;
}) {
  if (price <= 0) return null;
  const sorted = [...levels]
    .map((l) => ({ ...l, distance: ((l.price - price) / price) * 100 }))
    .sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance))
    .slice(0, 4);

  return (
    <div className="pointer-events-none absolute left-2 top-1 flex gap-3 font-mono text-[10px] tabular-nums text-text-muted">
      {sorted.map((l) => (
        <span key={l.title}>
          {l.title}{" "}
          <span className="text-text-secondary">{fmtPrice(l.price)}</span>{" "}
          <span className={l.distance >= 0 ? "text-success" : "text-danger"}>
            {l.distance >= 0 ? "+" : ""}
            {l.distance.toFixed(1)}%
          </span>
        </span>
      ))}
    </div>
  );
}

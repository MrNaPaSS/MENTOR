"use client";

// График свечей рядом со стаканом.
//
// Свечи берутся у того же источника, что и книга заявок. Это не мелочь: если
// график тянуть из другого места, трейдер увидит на нём одну цену, а в стакане
// другую, и доверия к разделу не будет.
//
// Индикаторы считаются на клиенте по тем же свечам — отдельных запросов ради
// средней линии не делаем.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
  type WhitespaceData,
} from "lightweight-charts";
import { API_URL } from "@/lib/api";
import { computeVision, DEFAULTS, type VisionSignal } from "@/lib/indicator/nmnhVision";
import { computeSmc, type SmcResult } from "@/lib/indicator/smc";
import { buildShapes } from "@/lib/indicator/shapes";
import { BandPrimitive, type BandPoint } from "./primitives/BandPrimitive";
import {
  EMPTY_SHAPES,
  ShapesPrimitive,
  type Shapes,
} from "./primitives/ShapesPrimitive";
import { money, price as fmtPrice, type Wall } from "@/lib/scalping";

// Цвета берём из палитры проекта, а не из настроек Tiger: у нас тёмная тема,
// и чистый зелёный с красным на ней выжигают глаз.
const CE_LONG = "#0ECB81";
const CE_SHORT = "#F6465D";

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
  /** Скользящие средние индикатора: 8, 21 и трендовая 50. */
  ema: boolean;
  /** Полки ликвидности: цены, где в стакане стоит от двух миллионов. */
  shelves: boolean;
  /** NMNH VISION: трейлинг Chandelier Exit, метки BY↑/SL↓ и панель BM Score. */
  vision: boolean;
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

/**
 * Линия трейлинг-стопа рисуется только на своей стороне.
 *
 * В оригинале это `plot.style_linebr` — линия рвётся там, где значения нет.
 * Просто пропустить бары нельзя: библиотека соединяет соседние точки, и
 * неактивный стоп протягивался через весь экран диагональю. Поэтому на
 * «чужих» барах отдаём пустую точку — только время, без значения.
 */
function toStopLine(
  candles: Candle[],
  values: number[],
  direction: number[],
  side: 1 | -1,
): (LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>)[] {
  return candles.map((c, i) => {
    const time = c.time as UTCTimestamp;
    return direction[i] === side && Number.isFinite(values[i])
      ? { time, value: values[i] }
      : { time };
  });
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
  const longStopRef = useRef<ISeriesApi<"Line"> | null>(null);
  const shortStopRef = useRef<ISeriesApi<"Line"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const markerDataRef = useRef<SeriesMarker<Time>[]>([]);
  const bandRef = useRef<BandPrimitive | null>(null);
  const bandDataRef = useRef<BandPoint[]>([]);
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
  const shelfLinesRef = useRef<IPriceLine[]>([]);
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
      indicators.vision,
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
    // Трейлинг-стоп Chandelier Exit. Толщина 2 — как в настройках заказчика.
    longStopRef.current = chart.addSeries(LineSeries, {
      color: CE_LONG,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    shortStopRef.current = chart.addSeries(LineSeries, {
      color: CE_SHORT,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    // Метки разворота BY↑ и SL↓ ставятся на свечи, а не на уровни стопа:
    // так видно, на каком баре сигнал возник.
    markersRef.current = createSeriesMarkers(candleRef.current, []);

    // Заливка коридора между средней ценой бара и стопом — без неё стоп
    // читается как ещё одна средняя, а не как граница движения.
    bandRef.current = new BandPrimitive();
    candleRef.current.attachPrimitive(bandRef.current);

    // Структура, ордер-блоки и разрывы: всё, что рисуется поверх свечей
    // произвольными фигурами.
    shapesRef.current = new ShapesPrimitive();
    candleRef.current.attachPrimitive(shapesRef.current);

    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      emaFastRef.current = null;
      emaSlowRef.current = null;
      emaTrendRef.current = null;
      longStopRef.current = null;
      shortStopRef.current = null;
      markersRef.current = null;
      bandRef.current = null;
      shapesRef.current = null;
      lineRef.current = null;
      mtfLinesRef.current = [];
      shelfLinesRef.current = [];
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

      // Весь индикатор считается за один проход по тем же свечам, что и стакан.
      const vision = computeVision(candles);

      emaFastRef.current?.setData(toLine(candles, vision.emaFast));
      emaSlowRef.current?.setData(toLine(candles, vision.emaSlow));
      emaTrendRef.current?.setData(toLine(candles, vision.emaTrend));

      longStopRef.current?.setData(
        toStopLine(candles, vision.longStop, vision.direction, 1),
      );
      shortStopRef.current?.setData(
        toStopLine(candles, vision.shortStop, vision.direction, -1),
      );

      // Полоса строится от средней цены бара до активного стопа — как fill()
      // между ohlc4 и линией стопа в оригинале.
      bandDataRef.current = candles.flatMap((c, i) => {
        const up = vision.direction[i] === 1;
        const stop = up ? vision.longStop[i] : vision.shortStop[i];
        if (!Number.isFinite(stop)) return [];
        const mid = (c.open + c.high + c.low + c.close) / 4;
        return [
          {
            time: c.time as UTCTimestamp,
            upper: Math.max(mid, stop),
            lower: Math.min(mid, stop),
            up,
          },
        ];
      });
      bandRef.current?.setPoints(indicatorsRef.current.vision ? bandDataRef.current : []);

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

      markerDataRef.current = vision.signals.map((s) => ({
        time: s.time as UTCTimestamp,
        position: s.side === "buy" ? ("belowBar" as const) : ("aboveBar" as const),
        color: s.side === "buy" ? CE_LONG : CE_SHORT,
        shape: s.side === "buy" ? ("arrowUp" as const) : ("arrowDown" as const),
        text: s.side === "buy" ? "BY↑" : "SL↓",
      }));
      markersRef.current?.setMarkers(indicatorsRef.current.vision ? markerDataRef.current : []);

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
    longStopRef.current?.applyOptions({ visible: cfg.vision });
    shortStopRef.current?.applyOptions({ visible: cfg.vision });
    // У плагина меток и у заливки нет флага видимости — прячем, подставляя
    // пустой набор.
    markersRef.current?.setMarkers(cfg.vision ? markerDataRef.current : []);
    bandRef.current?.setPoints(cfg.vision ? bandDataRef.current : []);

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

  // Полки ликвидности: цены, где в стакане стоит от двух миллионов. Это то, чего нет
  // ни в одном индикаторе — уровни берутся из живой книги заявок, а не из
  // истории цены. Видно, куда цена идёт и где её встретят.
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;

    for (const l of shelfLinesRef.current) series.removePriceLine(l);
    shelfLinesRef.current = [];
    if (!cfg.shelves) return;

    shelfLinesRef.current = shelves.map((shelf) =>
      series.createPriceLine({
        price: shelf.price,
        color: shelf.side === "bid" ? CE_LONG : CE_SHORT,
        lineWidth: 1,
        lineStyle: 1,
        // Плашку с ценой на ось не вешаем: каждая полка добавляла бы к шкале
        // вторую метку, и ценовая ось превращалась в сплошную стену бейджей.
        // Положение линии цену и так показывает, а размер виден на ней самой.
        axisLabelVisible: false,
        title: money(shelf.notional),
      }),
    );
  }, [shelfKey, cfg.shelves]);

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

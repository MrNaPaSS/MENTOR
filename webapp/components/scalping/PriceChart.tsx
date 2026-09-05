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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { atr, ema } from "@/lib/indicator/ta";
import type { Candle } from "@/lib/indicator/types";
import { buildShapes, type ChartTheme } from "@/lib/indicator/shapes";
import {
  EMPTY_SHAPES,
  ShapesPrimitive,
  type Shapes,
} from "./primitives/ShapesPrimitive";
import { money, price as fmtPrice, type Wall } from "@/lib/scalping";
import type { TradePlan } from "@/lib/trade/plan";

// Две темы графика.
//
// Тёмная — биржевая: зелёные и красные свечи на тёмном фоне. Светлая собрана по
// оформлению самого индикатора: белый фон без сетки, свечи чёрно-белые с чёрной
// обводкой (рост — пустая, падение — залитая), структура чёрным пунктиром.
// Зелёный с красным на ней остаются только там, где цвет несёт смысл, — на
// линиях полок покупателя и продавца.
const THEMES: Record<
  ChartTheme,
  {
    background: string;
    text: string;
    grid: string;
    border: string;
    up: string;
    down: string;
    upBorder: string;
    downBorder: string;
    upWick: string;
    downWick: string;
    candleBorders: boolean;
    upVolume: string;
    downVolume: string;
    bidLine: string;
    askLine: string;
    emaFast: string;
    emaSlow: string;
    emaTrend: string;
    crosshair: string;
    /** Уровни прошлого дня, недели и месяца. */
    mtf: string;
  }
> = {
  dark: {
    background: "transparent",
    text: "#7A8290",
    grid: "rgba(43,49,57,0.35)",
    border: "#2B3139",
    up: "#0ECB81",
    down: "#F6465D",
    upBorder: "#0ECB81",
    downBorder: "#F6465D",
    upWick: "#0ECB81",
    downWick: "#F6465D",
    candleBorders: false,
    upVolume: "rgba(14,203,129,0.4)",
    downVolume: "rgba(246,70,93,0.4)",
    bidLine: "#0ECB81",
    askLine: "#F6465D",
    emaFast: "#0AFFE0",
    emaSlow: "#F0B90B",
    emaTrend: "#7A8290",
    crosshair: "#0AFFE0",
    mtf: "#2157F3",
  },
  light: {
    background: "#FFFFFF",
    text: "#333333",
    // Сетка бледная: на белом она нужна для отсчёта, но спорить с чёрным
    // пунктиром структуры не должна.
    grid: "rgba(0,0,0,0.06)",
    border: "#B0B0B0",
    up: "#FFFFFF",
    down: "#000000",
    upBorder: "#000000",
    downBorder: "#000000",
    upWick: "#000000",
    downWick: "#000000",
    candleBorders: true,
    // Объём серый: чёрно-белым свечам цветные столбики не пара.
    upVolume: "rgba(120,123,134,0.28)",
    downVolume: "rgba(0,0,0,0.35)",
    // Зелёное и красное индикатора: GREEN = #00A86B, RED = #FF1A2E.
    bidLine: "#00A86B",
    askLine: "#FF1A2E",
    emaFast: "#26A69A",
    emaSlow: "#FFA726",
    emaTrend: "#9E9E9E",
    // Уровни старших периодов в оригинале чёрным пунктиром, не синим.
    crosshair: "#555555",
    mtf: "#333333",
  },
};

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
const MTF_PERIODS: { interval: string; high: string; low: string }[] = [
  { interval: "1d", high: "PDH", low: "PDL" },
  { interval: "1w", high: "PWH", low: "PWL" },
  { interval: "1M", high: "PMH", low: "PML" },
];

// Текущая свеча меняется постоянно, закрытые — нет. Пять секунд держат график
// живым, не расходуя лимит запросов биржи впустую.
const REFRESH_MS = 5000;

// Сколько свечей показываем сразу. Четыреста грузим ради индикаторов и
// прокрутки назад, но в окне они превращаются в щётку — видно должно быть
// столько, сколько трейдер реально читает.
const VISIBLE_BARS = 150;

// Насколько близко к линии полки должен попасть курсор, чтобы нажатие
// засчиталось. Линия толщиной в пиксель, попасть в неё мышью невозможно.
const SHELF_HIT_PX = 8;

// На сколько баров назад тянутся боксы сделки. Сделка ещё не открыта, точки
// входа во времени у неё нет — бокс просто должен быть виден.
const TRADE_BOX_BARS = 60;

/** ATR последних баров: по нему предлагается стоп. */
function currentAtr(candles: Candle[]): number {
  if (candles.length < 15) return 0;
  const series = atr(
    candles.map((c) => c.high),
    candles.map((c) => c.low),
    candles.map((c) => c.close),
    14,
  );
  const last = series[series.length - 1];
  return Number.isFinite(last) ? last : 0;
}

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
  theme,
  trade,
  onShelfClick,
}: {
  symbol: string;
  interval: string;
  wall: Wall | null;
  shelves: Wall[];
  indicators: Indicators;
  theme: ChartTheme;
  /** Разметка сделки: вход, стоп и цели. Считается снаружи. */
  trade: TradePlan | null;
  /**
   * Нажатие по линии полки. Вторым аргументом идёт ATR текущего таймфрейма:
   * по нему предлагается стоп, а волатильность известна только здесь — свечи
   * загружает график.
   */
  onShelfClick?: (shelf: Wall, atr: number) => void;
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
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const lineRef = useRef<IPriceLine | null>(null);
  const mtfLinesRef = useRef<IPriceLine[]>([]);
  const shelfLinesRef = useRef<IPriceLine[]>([]);
  const tradeLinesRef = useRef<IPriceLine[]>([]);
  const tradeShapesRef = useRef<Shapes | null>(null);
  const dataRef = useRef<Candle[]>([]);
  // Нажатие по полке ищет ближайшую линию к точке клика, а слушатель графика
  // ставится один раз — значит и полки, и обработчик читаются из ref.
  const shelvesRef = useRef<Wall[]>(shelves);
  shelvesRef.current = shelves;
  const shelfClickRef = useRef(onShelfClick);
  shelfClickRef.current = onShelfClick;

  /**
   * Отдать примитиву фигуры индикатора вместе с разметкой сделки.
   *
   * Примитив один на все фигуры, а источников два, и живут они порознь:
   * структура пересчитывается при новых свечах, разметка — при вводе в окне
   * сделки. Поэтому наборы хранятся отдельно и склеиваются здесь.
   */
  const pushShapes = useCallback(() => {
    const base = shapeDataRef.current;
    const extra = tradeShapesRef.current;
    shapesRef.current?.setShapes(
      extra
        ? {
            boxes: [...base.boxes, ...extra.boxes],
            segments: [...base.segments, ...extra.segments],
            points: [...base.points, ...extra.points],
          }
        : base,
    );
  }, []);

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
      upColor: THEMES[theme].up,
      downColor: THEMES[theme].down,
      borderVisible: THEMES[theme].candleBorders,
      borderUpColor: THEMES[theme].upBorder,
      borderDownColor: THEMES[theme].downBorder,
      wickUpColor: THEMES[theme].upWick,
      wickDownColor: THEMES[theme].downWick,
      // Линия текущей цены цветом текста темы: на светлой она чёрная, иначе
      // белая свеча роста рисовала бы белую линию на белом фоне.
      priceLineColor: THEMES[theme].text,
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

    // Нажатие по полке: библиотека не знает о ценовых линиях в момент клика,
    // поэтому ищем ближайшую сами — по расстоянию в пикселях, а не в цене. На
    // минутном графике цена шага и цена в двадцати пикселях различаются на
    // порядки в зависимости от монеты, и порог в деньгах работать не может.
    chart.subscribeClick((param) => {
      const handler = shelfClickRef.current;
      const series = candleRef.current;
      if (!handler || !series || !param.point) return;

      let nearest: Wall | null = null;
      let best = SHELF_HIT_PX;
      for (const shelf of shelvesRef.current) {
        const y = series.priceToCoordinate(shelf.price);
        if (y === null) continue;
        const distance = Math.abs(y - param.point.y);
        if (distance < best) {
          best = distance;
          nearest = shelf;
        }
      }
      if (nearest) handler(nearest, currentAtr(dataRef.current));
    });

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
      tradeLinesRef.current = [];
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
          color:
            c.close >= c.open
              ? THEMES[themeRef.current].upVolume
              : THEMES[themeRef.current].downVolume,
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
      shapeDataRef.current = buildShapes(
        smc,
        candles[candles.length - 1]?.time ?? 0,
        {
          structure: cfgNow.structure,
          orderBlocks: cfgNow.blocks,
          fvg: cfgNow.gaps,
          equal: cfgNow.gaps,
          zones: cfgNow.zones,
        },
        themeRef.current,
      );
      pushShapes();
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
      shapeDataRef.current = buildShapes(
        smcRef.current,
        lastTimeRef.current,
        {
          structure: cfg.structure,
          orderBlocks: cfg.blocks,
          fvg: cfg.gaps,
          equal: cfg.gaps,
          zones: cfg.zones,
        },
        themeRef.current,
      );
      pushShapes();
    }
  }, [cfg]);

  // Смена темы: перекрашиваем график на месте. Пересоздавать его нельзя —
  // потеряется масштаб и положение, которые трейдер выставил руками.
  useEffect(() => {
    const chart = chartRef.current;
    const palette = THEMES[theme];
    if (!chart) return;

    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: palette.background },
        textColor: palette.text,
      },
      grid: {
        vertLines: { color: palette.grid },
        horzLines: { color: palette.grid },
      },
      rightPriceScale: { borderColor: palette.border },
      timeScale: { borderColor: palette.border },
      crosshair: {
        vertLine: { color: palette.crosshair, labelBackgroundColor: palette.crosshair },
        horzLine: { color: palette.crosshair, labelBackgroundColor: palette.crosshair },
      },
    });

    candleRef.current?.applyOptions({
      upColor: palette.up,
      downColor: palette.down,
      borderVisible: palette.candleBorders,
      borderUpColor: palette.upBorder,
      borderDownColor: palette.downBorder,
      wickUpColor: palette.upWick,
      wickDownColor: palette.downWick,
      priceLineColor: palette.text,
    });
    emaFastRef.current?.applyOptions({ color: palette.emaFast });
    emaSlowRef.current?.applyOptions({ color: palette.emaSlow });
    emaTrendRef.current?.applyOptions({ color: palette.emaTrend });

    // Объём красится по каждой свече, поэтому его набор пересобираем.
    const candles = dataRef.current;
    if (candles.length > 0) {
      volumeRef.current?.setData(
        candles.map((c) => ({
          time: c.time as UTCTimestamp,
          value: c.volume,
          color: c.close >= c.open ? palette.upVolume : palette.downVolume,
        })),
      );
    }

    // Фигуры индикатора тоже зависят от темы: на белом светло-серые подписи
    // и прозрачные заливки исчезают.
    if (smcRef.current) {
      shapeDataRef.current = buildShapes(
        smcRef.current,
        lastTimeRef.current,
        {
          structure: cfg.structure,
          orderBlocks: cfg.blocks,
          fvg: cfg.gaps,
          equal: cfg.gaps,
          zones: cfg.zones,
        },
        theme,
      );
      pushShapes();
    }
  }, [theme, cfg]);

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
                color: THEMES[themeRef.current].mtf,
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
  // Сумма выводится плашкой на ценовой шкале: это единственное место, где
  // подпись ценовой линии вообще показывается, и читается она там лучше всего —
  // рядом с ценой уровня, а не поверх свечей.
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;

    for (const l of shelfLinesRef.current) series.removePriceLine(l);
    shelfLinesRef.current = [];
    if (!cfg.shelves) return;

    shelfLinesRef.current = shelves.map((shelf) =>
      series.createPriceLine({
        price: shelf.price,
        color: shelf.side === "bid" ? THEMES[theme].bidLine : THEMES[theme].askLine,
        lineWidth: 1,
        lineStyle: 1,
        axisLabelVisible: true,
        title: money(shelf.notional),
      }),
    );
  }, [shelfKey, cfg.shelves, theme]);

  // Разметка сделки: вход, стоп и цели линиями, риск и потенциал — боксами.
  //
  // Линии дают точные цены на шкале, боксы — соотношение: видно с одного
  // взгляда, во сколько раз зелёная область выше красной. Ради этого разметка
  // и рисуется, цифры уже есть в окне расчёта.
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;

    for (const l of tradeLinesRef.current) series.removePriceLine(l);
    tradeLinesRef.current = [];
    tradeShapesRef.current = null;

    if (!trade) {
      pushShapes();
      return;
    }

    const palette = THEMES[themeRef.current];
    const line = (price: number, color: string, title: string, style: 0 | 2) =>
      series.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title });

    tradeLinesRef.current.push(line(trade.entry, palette.text, "вход", 0));
    tradeLinesRef.current.push(line(trade.stop, palette.askLine, "стоп", 2));
    trade.targets.forEach((target, i) => {
      tradeLinesRef.current.push(line(target.price, palette.bidLine, `тейк ${i + 1}`, 2));
    });

    // Боксы тянутся от края видимого окна до последнего бара: сделка ещё не
    // открыта, точки входа во времени у неё нет, а к правому краю подходит цена.
    const candles = dataRef.current;
    const last = candles.at(-1);
    if (last) {
      const from = candles[Math.max(0, candles.length - TRADE_BOX_BARS)];
      const top = trade.targets.at(-1)?.price ?? trade.entry;
      tradeShapesRef.current = {
        boxes: [
          {
            fromTime: from.time as UTCTimestamp,
            toTime: last.time as UTCTimestamp,
            top: Math.max(trade.entry, trade.stop),
            bottom: Math.min(trade.entry, trade.stop),
            fill: "rgba(246,70,93,0.16)",
            border: "rgba(246,70,93,0.45)",
          },
          {
            fromTime: from.time as UTCTimestamp,
            toTime: last.time as UTCTimestamp,
            top: Math.max(trade.entry, top),
            bottom: Math.min(trade.entry, top),
            fill: "rgba(14,203,129,0.13)",
            border: "rgba(14,203,129,0.45)",
          },
        ],
        segments: [],
        points: [],
      };
    }

    pushShapes();
  }, [trade, pushShapes]);

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

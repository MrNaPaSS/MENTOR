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

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell } from "lucide-react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { API_URL } from "@/lib/api";
import { computeSmc, type SmcResult } from "@/lib/indicator/smc";
import { computeChandelier, type ChandelierResult } from "@/lib/indicator/chandelier";
import { atr, ema } from "@/lib/indicator/ta";
import type { Candle } from "@/lib/indicator/types";
import { buildShapes, type ChartTheme } from "@/lib/indicator/shapes";
import {
  EMPTY_SHAPES,
  ShapesPrimitive,
  type Shapes,
} from "./primitives/ShapesPrimitive";
import { VolumeCandlesPrimitive } from "./primitives/VolumeCandlesPrimitive";
import { money, price as fmtPrice, priceFormat, type Wall } from "@/lib/scalping";
import { loadCalendar, loadTrades, type JournalTrade } from "@/lib/journal";
import {
  floatingAt,
  pendingTargets,
  pnlAt,
  type ActiveTrade,
} from "@/lib/trade/position";

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
    /** Отметки трейдера на ценах — тот же жёлтый, что у плиты в стакане. */
    gold: string;
    /** Боксы риска и потенциала у разметки сделки. */
    riskBox: string;
    riskBorder: string;
    /** Тот же бокс, когда риска уже нет: стоп переехал в безубыток. */
    spentBox: string;
    spentBorder: string;
    rewardBox: string;
    rewardBorder: string;
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
    gold: "#F0B90B",
    riskBox: "rgba(246,70,93,0.16)",
    riskBorder: "rgba(246,70,93,0.45)",
    spentBox: "rgba(122,130,144,0.10)",
    spentBorder: "rgba(122,130,144,0.35)",
    rewardBox: "rgba(14,203,129,0.13)",
    rewardBorder: "rgba(14,203,129,0.45)",
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
    gold: "#A97400",
    // На белом красное и зелёное спорят с чёрно-белыми свечами: риск серым,
    // потенциал сиреневым — так эти области размечены в самом терминале.
    riskBox: "rgba(120,123,134,0.22)",
    riskBorder: "rgba(120,123,134,0.45)",
    spentBox: "rgba(120,123,134,0.08)",
    spentBorder: "rgba(120,123,134,0.28)",
    rewardBox: "rgba(149,117,205,0.16)",
    rewardBorder: "rgba(149,117,205,0.45)",
  },
};

// Периоды скользящих средних индикатора.
const EMA_FAST = 8;
const EMA_SLOW = 21;
const EMA_TREND = 50;

export type { Candle };

export type Indicators = {
  volume: boolean;
  /**
   * Объёмные свечи: толщина тела по объёму.
   *
   * Обычный график равняет все свечи, и рывок на пустом рынке выглядит так
   * же, как движение, в которое влили миллионы. Здесь это видно сразу.
   */
  heavy: boolean;
  /** Скользящие средние индикатора: 8, 21 и трендовая 50. */
  ema: boolean;
  /** Полки ликвидности: цены, где в стакане стоит от двух миллионов. */
  shelves: boolean;
  /** Лента трейлинг-уровня: динамическая поддержка и сопротивление. */
  trend: boolean;
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

// Пустых баров справа от последней свечи. Разметка сделки — это будущее:
// вход, стоп и цели ещё не случились, и рисовать их поверх прошлых свечей
// значит показывать то, чего там не было.
const RIGHT_BARS = 14;

/** Секунды в интервале графика: нужны таймеру закрытия свечи. */
const INTERVAL_SECONDS: Record<string, number> = {
  "1m": 60,
  "3m": 180,
  "5m": 300,
  "10m": 600,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};

/**
 * Сколько осталось до закрытия текущей свечи.
 *
 * Интервалы биржи выровнены по началу эпохи, поэтому остаток считается
 * остатком от деления — без запроса времени сервера.
 */
function untilClose(interval: string, now = Date.now()): string {
  const step = INTERVAL_SECONDS[interval];
  if (!step) return "";
  const left = step - (Math.floor(now / 1000) % step);
  const hours = Math.floor(left / 3600);
  const minutes = Math.floor((left % 3600) / 60);
  const seconds = left % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Ближайший бар к моменту сделки.
 *
 * Метку можно ставить только на существующий бар: на минутном графике сделка
 * закрылась в 12:03:47, а бар есть только на 12:03. За краем загруженной
 * истории метки нет вовсе — сделка была раньше, чем начинается график.
 */
function snapToBar(
  candles: Candle[],
  at: string | number | null,
  /**
   * Что делать со временем левее загруженной истории.
   *
   * Сделка живёт часами, а на графике четыреста баров: на минутке это семь
   * часов, на пятисекундках — полчаса. Вернувшись к терминалу через час,
   * трейдер видел бокс, уехавший к правому краю: бар входа не находился, и
   * привязка падала на последнюю свечу. Прижимаем к первому бару — сделка
   * началась раньше окна, но начало у неё слева, а не справа.
   */
  clampToStart = false,
): number | null {
  if (at === null || at === undefined || candles.length === 0) return null;
  const ms = typeof at === "number" ? at : new Date(at).getTime();
  const seconds = Math.floor(ms / 1000);
  if (!Number.isFinite(seconds)) return null;
  if (seconds < candles[0].time) return clampToStart ? candles[0].time : null;

  let low = 0;
  let high = candles.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (candles[mid].time <= seconds) low = mid;
    else high = mid - 1;
  }
  return candles[low].time;
}

/**
 * Бокс сделки: область убытка и область прибыли справа от последней свечи.
 *
 * Отдельной функцией, потому что нужен в двух местах: при изменении самой
 * сделки и при каждой загрузке свечей. Открыть сделку можно раньше, чем
 * приедут бары — тогда строить не от чего, и бокс должен появиться сам, как
 * только график наполнится, а не ждать следующего движения цены.
 */
function tradeBoxes(
  trade: ActiveTrade | null,
  palette: (typeof THEMES)[ChartTheme],
  candles: Candle[],
): Shapes | null {
  const last = candles.at(-1);
  if (!trade || trade.status === "closed" || !last) return null;

  // Левый край бокса стоит там, где сделка появилась, и больше не двигается:
  // это точка отсчёта, от неё видно, сколько времени сделка уже идёт. Правый
  // край едет вместе с графиком и заходит в пустое поле справа.
  const step = candles.length > 1 ? candles[1].time - candles[0].time : 60;
  const anchor = snapToBar(candles, trade.openedAt ?? trade.createdAt ?? null, true) ?? last.time;
  const width = Math.round((last.time - anchor) / Math.max(1, step)) + RIGHT_BARS;
  const span = { kind: "bars" as const, bars: Math.max(RIGHT_BARS, width) };

  const far = pendingTargets(trade).at(-1);

  // Бокс риска остаётся и после переноса стопа в безубыток: он показывает, чем
  // сделка рисковала. Живого риска в нём уже нет, поэтому рисуется бледнее —
  // иначе картинка врёт, будто убыток всё ещё возможен.
  // Риск снят не по флагу, а по факту: стоп должен стоять за ценой входа.
  // Флаг говорил «безубыток» и тогда, когда стоп на бирже не сдвинулся, - и
  // метка BE оказывалась на исходном стопе, то есть на цене убытка.
  const safe = riskFree(trade);
  const risk = safe ? trade.initialStop : trade.stop;
  const boxes: Shapes["boxes"] = [
    {
      fromTime: anchor as UTCTimestamp,
      toTime: span,
      top: Math.max(trade.entry, risk),
      bottom: Math.min(trade.entry, risk),
      fill: safe ? palette.spentBox : palette.riskBox,
      border: safe ? palette.spentBorder : palette.riskBorder,
      // Без надписи: бледная заливка и метка BE у края и так говорят, что
      // риска в этом боксе больше нет, а слова поверх свечей мешают читать
      // цену - ради неё график и открыт.
      labelColor: palette.text,
    },
  ];
  // Безубыток подписан у правого края бокса, на той цене, где стоп стоит на
  // самом деле. Ярлык на линии входа врал бы дважды: и местом, и ценой —
  // биржа считает безубыток с комиссией, это заметно выше входа.
  const segments: Shapes["segments"] = safe
    ? [
        {
          fromTime: anchor as UTCTimestamp,
          toTime: span,
          price: trade.stop,
          color: palette.mtf,
          dashed: true,
          label: "BE",
          labelAt: "end",
        },
      ]
    : [];

  if (far !== undefined) {
    boxes.push({
      fromTime: anchor as UTCTimestamp,
      toTime: span,
      top: Math.max(trade.entry, far),
      bottom: Math.min(trade.entry, far),
      fill: palette.rewardBox,
      border: palette.rewardBorder,
    });
  }
  return { bands: [], boxes, segments, points: [] };
}

/**
 * Боксы перечисленных сделок — одним набором фигур.
 *
 * Что рисовать, решает вызывающий: у идущей сделки бокс есть всегда, у
 * ждущей — только пока трейдер смотрит на её ярлык или держит открытым окно
 * расчёта. Риска и потенциала у ненабранной позиции ещё нет, и постоянные
 * боксы спорили бы с разметкой той сделки, которая действительно идёт.
 */
function tradeShapes(
  items: (ActiveTrade | null | undefined)[],
  palette: (typeof THEMES)[ChartTheme],
  candles: Candle[],
): Shapes | null {
  const parts: Shapes[] = [];
  for (const trade of items) {
    if (!trade || trade.status === "closed") continue;
    const shapes = tradeBoxes(trade, palette, candles);
    if (shapes) parts.push(shapes);
  }
  if (parts.length === 0) return null;
  return {
    bands: parts.flatMap((p) => p.bands),
    boxes: parts.flatMap((p) => p.boxes),
    segments: parts.flatMap((p) => p.segments),
    points: parts.flatMap((p) => p.points),
  };
}

/**
 * Снят ли риск: стоп стоит по ту сторону цены входа.
 *
 * Именно это значит «безубыток» для трейдера, и проверяется это числами, а не
 * состоянием сделки: пока стоп на бирже не переехал, риск на месте, чего бы
 * ни думал терминал.
 */
function riskFree(trade: ActiveTrade): boolean {
  return trade.side === "long" ? trade.stop >= trade.entry : trade.stop <= trade.entry;
}

/**
 * Снимок графика со всеми слоями.
 *
 * Библиотека умеет отдавать свой холст сама, но рисует в нём только то, что
 * знает: наши примитивы - свечи по объёму, боксы сделок, ленты индикатора -
 * живут отдельными холстами поверх, и снимок выходил пустым белым листом.
 * Поэтому собираем всё, что реально видно: холсты складываются в порядке
 * наложения, как их рисует браузер.
 */
function snapshot(chart: IChartApi, box: HTMLDivElement): HTMLCanvasElement | null {
  const layers = Array.from(box.querySelectorAll("canvas")).filter(
    (canvas) => canvas.width > 0 && canvas.height > 0,
  );
  if (layers.length === 0) return chart.takeScreenshot?.() ?? null;

  // Каждый слой стоит на своём месте: холст свечей, холст ценовой шкалы и
  // холст шкалы времени - разные элементы. Сложить их в одну точку значит
  // получить кашу, поэтому берём положение каждого относительно контейнера.
  const frame = box.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;

  const out = document.createElement("canvas");
  out.width = Math.round(frame.width * ratio);
  out.height = Math.round(frame.height * ratio);

  const ctx = out.getContext("2d");
  if (!ctx) return chart.takeScreenshot?.() ?? null;

  for (const layer of layers) {
    const at = layer.getBoundingClientRect();
    try {
      ctx.drawImage(
        layer,
        Math.round((at.left - frame.left) * ratio),
        Math.round((at.top - frame.top) * ratio),
        Math.round(at.width * ratio),
        Math.round(at.height * ratio),
      );
    } catch {
      // Холст, который браузер не даёт прочитать, пропускаем: лучше снимок
      // без одного слоя, чем ошибка вместо картинки.
    }
  }
  return out;
}

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

function PriceChart({
  symbol,
  interval,
  wall,
  shelves,
  indicators,
  theme,
  trades,
  preview,
  livePrice,
  liveCandle,
  onCloseTrade,
  showJournal,
  journalKey,
  ghost,
  hoverLevel,
  shot,
  tick,
  alerts,
  onRemoveAlert,
  onShelfClick,
}: {
  symbol: string;
  interval: string;
  wall: Wall | null;
  shelves: Wall[];
  indicators: Indicators;
  theme: ChartTheme;
  /**
   * Идущие сделки: вход, стоп и цели. Жизненный цикл считается снаружи.
   *
   * Их может быть несколько сразу, в том числе в разные стороны: открыть
   * встречную позицию, не закрыв текущую, — обычное дело, и стирать за это
   * разметку идущей сделки терминал не вправе.
   */
  trades: ActiveTrade[];
  /**
   * Расчёт из открытого окна: показывается целиком, пока трейдер смотрит.
   *
   * Отдельно от идущих сделок, потому что живёт по другим правилам — исчезает
   * с закрытием окна и в журнал не попадает.
   */
  preview?: ActiveTrade | null;
  /** Последняя цена рынка: по ней считается плавающий результат. */
  livePrice: number;
  /**
   * Текущая свеча из ленты сделок, восемь раз в секунду.
   *
   * История приходит по REST раз в пять секунд, и без этого текущая свеча
   * отставала от биржи ровно на это время — на скальпе это вечность.
   */
  liveCandle: Candle | null;
  /** Закрыть сделку по нажатию на ярлык её позиции. */
  onCloseTrade?: (trade: ActiveTrade) => void;
  /** Показывать отработанные сетапы из журнала прямо на графике. */
  showJournal?: boolean;
  /** Растёт после каждой записи в журнал — повод перечитать метки. */
  journalKey?: number;
  /** Сделка из журнала под курсором: показываем, как она шла. */
  ghost?: JournalTrade | null;
  /**
   * Уровень из стакана под курсором: цена и деньги, стоящие на ней.
   *
   * Плита в стакане и уровень на графике — одно и то же место. Пока линии
   * нет, трейдер переводит цену глазами из колонки в шкалу и теряет то
   * самое мгновение, ради которого стакан и открыт.
   */
  hoverLevel?: { price: number; label: string; side: "bid" | "ask" } | null;
  /**
   * Шаг цены инструмента.
   *
   * Без него библиотека рисует шкалу с точностью до цента, и на дешёвых
   * монетах она оказывается пустой: весь видимый диапазон меньше шага, все
   * подписи одинаковы, а одинаковые она не показывает.
   */
  tick?: number;
  /**
   * Сюда график кладёт способ снять свой холст.
   *
   * Снимок делает библиотека - у неё и холст, и все слои. Кнопка живёт в
   * шапке рядом с темой, поэтому наружу отдаётся не картинка, а способ её
   * получить в нужный момент.
   */
  shot?: React.MutableRefObject<(() => HTMLCanvasElement | null) | null>;
  /** Отметки на ценах: терминал скажет, когда их пересекут. */
  alerts?: { id: string; price: number }[];
  /** Снять отметку по крестику у её будильника. */
  onRemoveAlert?: (id: string) => void;
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
  const heavyRef = useRef<VolumeCandlesPrimitive | null>(null);
  const shapeDataRef = useRef<Shapes>(EMPTY_SHAPES);
  // Результат структурного движка держим отдельно: переключатели меняют набор
  // фигур, и пересчитывать структуру ради этого незачем.
  const smcRef = useRef<SmcResult | null>(null);
  const ceRef = useRef<ChandelierResult | null>(null);
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
  const ghostShapesRef = useRef<Shapes | null>(null);
  const hoverLineRef = useRef<IPriceLine | null>(null);
  const alertLinesRef = useRef<IPriceLine[]>([]);
  // Ключом по значениям: массив приходит новый на каждом кадре стакана.
  const alertKey = (alerts ?? []).map((a) => `${a.id}:${a.price}`).join(",");
  // Будильники у цены: по ярлыку на отметку, как у ждущей заявки.
  const alertLabelsRef = useRef(new Map<string, HTMLDivElement | null>());
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const dataRef = useRef<Candle[]>([]);
  // Нажатие по полке ищет ближайшую линию к точке клика, а слушатель графика
  // ставится один раз — значит и полки, и обработчик читаются из ref.
  const shelvesRef = useRef<Wall[]>(shelves);
  shelvesRef.current = shelves;
  const wallRef = useRef<Wall | null>(wall);
  wallRef.current = wall;
  const shelfClickRef = useRef(onShelfClick);
  shelfClickRef.current = onShelfClick;

  /**
   * Отдать примитиву фигуры индикатора вместе с разметкой сделки.
   *
   * Примитив один на все фигуры, а источников два, и живут они порознь:
   * структура пересчитывается при новых свечах, разметка — при вводе в окне
   * сделки. Поэтому наборы хранятся отдельно и склеиваются здесь.
   */
  /**
   * Перерисовать свечи в нужном виде.
   *
   * В объёмном режиме встроенная серия становится прозрачной, а свечи рисует
   * примитив. Серию не прячем: на ней держатся автомасштаб, перекрестие и
   * подпись последней цены - без неё пришлось бы всё это подменять.
   */
  const paintCandles = useCallback(() => {
    const series = candleRef.current;
    const heavy = heavyRef.current;
    if (!series || !heavy) return;

    const palette = THEMES[themeRef.current];
    if (!indicatorsRef.current.heavy) {
      heavy.clear();
      series.applyOptions({
        upColor: palette.up,
        downColor: palette.down,
        borderVisible: palette.candleBorders,
        borderUpColor: palette.upBorder,
        borderDownColor: palette.downBorder,
        wickUpColor: palette.upWick,
        wickDownColor: palette.downWick,
      });
      return;
    }

    series.applyOptions({
      upColor: "transparent",
      downColor: "transparent",
      borderVisible: false,
      borderUpColor: "transparent",
      borderDownColor: "transparent",
      wickUpColor: "transparent",
      wickDownColor: "transparent",
    });
    heavy.setData(dataRef.current, {
      up: palette.up,
      down: palette.down,
      upWick: palette.upWick,
      downWick: palette.downWick,
      // Обводка там, где она есть у обычных свечей темы: на светлой свеча
      // роста белая, и без неё на белом листе её не видно вовсе.
      upBorder: palette.candleBorders ? palette.upBorder : undefined,
      downBorder: palette.candleBorders ? palette.downBorder : undefined,
    });
  }, []);

  const pushShapes = useCallback(() => {
    const parts = [shapeDataRef.current, tradeShapesRef.current, ghostShapesRef.current];
    const alive = parts.filter((p): p is Shapes => Boolean(p));
    shapesRef.current?.setShapes(
      alive.length === 1
        ? alive[0]
        : {
            bands: alive.flatMap((p) => p.bands),
            boxes: alive.flatMap((p) => p.boxes),
            segments: alive.flatMap((p) => p.segments),
            points: alive.flatMap((p) => p.points),
          },
    );
  }, []);

  // Загруженные уровни старших периодов. Нужны не только для линий: на минутном
  // графике сто пятьдесят баров укладываются в двести долларов, а вчерашние
  // максимум и минимум разнесены на три тысячи — линия оказывается далеко за
  // краем окна, и нажатие кнопки выглядит как «ничего не произошло». Поэтому
  // уровни ещё и выписываются строкой с расстоянием до цены.
  const [levels, setLevels] = useState<{ title: string; price: number }[]>([]);

  // Ярлык позиции и таймер свечи — это HTML поверх канвы, и им нужны пиксели.
  // Координата цены меняется и без новых данных: от прокрутки и масштаба, — а
  // о них библиотека не сообщает, поэтому опрашиваем по таймеру.
  // Плашка позиции и таймер свечи стоят на своих ценах и обязаны держаться
  // на них при любом движении графика. Поэтому их положение пишется прямо в
  // узел на каждом кадре: состояние React перерисовывается позже отрисовки
  // холста, и плашка отставала бы от линии на всё время перетаскивания.
  // Ярлыки позиций: по одному на сделку, поэтому не ref, а карта по её id.
  const labelsRef = useRef(new Map<string, HTMLDivElement | null>());
  const clockRef = useRef<HTMLDivElement>(null);
  // Результат за сегодня по журналу. null — журнал недоступен: ученик не вошёл
  // в кабинет, и показывать ему чужой ноль незачем.
  const [todayPnl, setTodayPnl] = useState<number | null>(null);
  // Почему на графике нет свежих свечей. Пусто — всё в порядке.
  const [dataError, setDataError] = useState<string | null>(null);
  // До какого момента не спрашивать свечи: биржа назвала срок сама.
  const retryAfter = useRef(0);
  const livePriceRef = useRef(livePrice);
  livePriceRef.current = livePrice;
  // Сделка нужна и при загрузке свечей: бокс строится от последнего бара, а на
  // момент открытия сделки баров может ещё не быть.
  const tradeRef = useRef(trades);
  tradeRef.current = trades;
  // Через ref: сам объект приходит из страницы и меняться не должен, а вот
  // пересоздавать из-за него график незачем.
  const shotRef = useRef(shot);
  shotRef.current = shot;
  const previewRef = useRef(preview);
  previewRef.current = preview;
  // Ярлык ждущей сделки под курсором: показываем, что её ждёт, — бокс и цели.
  const [peeked, setPeeked] = useState<string | null>(null);
  const peekedRef = useRef<string | null>(null);
  peekedRef.current = peeked;

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
      indicators.trend,
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
      timeScale: {
        borderColor: "#2B3139",
        timeVisible: true,
        secondsVisible: false,
        // Пустое место справа: там рисуется бокс сделки и туда идёт цена.
        rightOffset: RIGHT_BARS,
      },
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
    heavyRef.current = new VolumeCandlesPrimitive();
    candleRef.current.attachPrimitive(heavyRef.current);

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
      // Плита - такой же уровень, как полка: по ней тоже считают сделку.
      // Раньше нажатие по ней не давало ничего, и приходилось искать ту же
      // цену в стакане.
      const levels = wallRef.current
        ? [wallRef.current, ...shelvesRef.current]
        : shelvesRef.current;
      for (const shelf of levels) {
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
    if (shotRef.current) {
      // Сначала пробуем собрать слои сами - в них наши примитивы. Если
      // собрать нечего, берём холст библиотеки: он хотя бы со свечами.
      shotRef.current.current = () => snapshot(chart, box) ?? chart.takeScreenshot();
    }
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      emaFastRef.current = null;
      emaSlowRef.current = null;
      emaTrendRef.current = null;
      shapesRef.current = null;
      heavyRef.current = null;
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
      // Трейлинг-уровень: та самая лента, по которой видно смещение и о
      // которую цена отбивается. В скрипте это стоп Chandelier Exit.
      ceRef.current = computeChandelier(candles);
      const cfgNow = indicatorsRef.current;
      shapeDataRef.current = buildShapes(
        smc,
        candles[candles.length - 1]?.time ?? 0,
        {
          trend: cfgNow.trend,
          structure: cfgNow.structure,
          orderBlocks: cfgNow.blocks,
          fvg: cfgNow.gaps,
          equal: cfgNow.gaps,
          zones: cfgNow.zones,
        },
        themeRef.current,
        ceRef.current,
      );
      paintCandles();
      // Бокс сделки пересобираем здесь же: он привязан к последнему бару, а
      // бары только что приехали.
      tradeShapesRef.current = tradeShapes(
        [
          ...tradeRef.current.filter(
            (t) => t.status === "open" || t.id === peekedRef.current,
          ),
          previewRef.current,
        ],
        THEMES[themeRef.current],
        candles,
      );
      pushShapes();
      smcRef.current = smc;
      lastTimeRef.current = candles[candles.length - 1]?.time ?? 0;


    }

    async function load(fit: boolean) {
      // Биржа сказала, когда вернётся, — до этого срока не спрашиваем. Долбить
      // сервер раз в пять секунд ради того же отказа незачем.
      if (Date.now() < retryAfter.current) return;
      try {
        const res = await fetch(
          `${API_URL}/api/scalping/klines/${symbol}?interval=${interval}&limit=400`,
        );
        if (!res.ok) {
          // Причину называем словами. Пустой график молча — это то же самое,
          // что показать неверные данные: трейдер не знает, чему верить.
          const detail = await res.json().catch(() => null);
          const text = String(detail?.detail || `Свечи недоступны (${res.status})`);
          const seconds = Number(text.match(/через\s+(\d+)\s*с/)?.[1] ?? 0);
          if (seconds > 0) retryAfter.current = Date.now() + seconds * 1000;
          if (!cancelled) setDataError(text);
          return;
        }
        const body: { candles: Candle[] } = await res.json();
        if (cancelled || !candleRef.current) return;
        retryAfter.current = 0;
        setDataError(null);
        draw(body.candles);
        if (fit) reframe(body.candles.length);
      } catch {
        if (!cancelled) setDataError("Нет связи с сервером");
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
          trend: cfg.trend,
          structure: cfg.structure,
          orderBlocks: cfg.blocks,
          fvg: cfg.gaps,
          equal: cfg.gaps,
          zones: cfg.zones,
        },
        themeRef.current,
        ceRef.current,
      );
      pushShapes();
    }
  }, [cfg]);

  // Вид свечей переключается отдельным эффектом: пересборка фигур индикатора
  // идёт по четырёмстам свечам, и ждать её ради смены вида нечестно - нажатие
  // должно отзываться в тот же кадр.
  useEffect(() => {
    paintCandles();
  }, [cfg.heavy, theme, paintCandles]);

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

    candleRef.current?.applyOptions({ priceLineColor: palette.text });
    // Цвета самих свечей зависят ещё и от режима: в объёмном серия прозрачна.
    paintCandles();
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
          trend: cfg.trend,
          structure: cfg.structure,
          orderBlocks: cfg.blocks,
          fvg: cfg.gaps,
          equal: cfg.gaps,
          zones: cfg.zones,
        },
        theme,
        ceRef.current,
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
  }, [symbol, cfg.levels, theme]);

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

    // Полку на цене плиты не рисуем: это один и тот же уровень, и две линии
    // с двумя подписями на нём спорят друг с другом, а не дополняют.
    const shown = wall
      ? shelves.filter((shelf) => Math.abs(shelf.price - wall.price) > (tick || 0) / 2)
      : shelves;

    shelfLinesRef.current = shown.map((shelf) =>
      series.createPriceLine({
        price: shelf.price,
        color: shelf.side === "bid" ? THEMES[theme].bidLine : THEMES[theme].askLine,
        lineWidth: 1,
        lineStyle: 1,
        axisLabelVisible: true,
        title: money(shelf.notional),
      }),
    );
  }, [shelfKey, cfg.shelves, theme, wall?.price, tick]);

  // Разметка сделки: вход, стоп и цели линиями, риск и потенциал — боксами.
  //
  // Линии дают точные цены на шкале, боксы — соотношение: видно с одного
  // взгляда, во сколько раз область прибыли выше области убытка. Взятые цели с
  // графика убираются: они уже отработали, и держать их значит показывать
  // сделке цель, которой у неё больше нет.
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;

    for (const l of tradeLinesRef.current) series.removePriceLine(l);
    tradeLinesRef.current = [];
    tradeShapesRef.current = null;

    const palette = THEMES[themeRef.current];
    const line = (price: number, color: string, title: string, style: 0 | 2) =>
      series.createPriceLine({
        price,
        color,
        lineWidth: 1,
        lineStyle: style,
        axisLabelVisible: true,
        title,
      });

    for (const trade of [...trades, ...(preview ? [preview] : [])]) {
      if (trade.status === "closed") continue;

      // Сделка ждёт свою лимитку — на графике от неё только сама лимитка.
      // Бокс и цели появляются, когда цена дошла до уровня и позиция набрана:
      // до этого момента ни риска, ни потенциала ещё нет, а нарисованные они
      // спорят с разметкой той сделки, которая действительно идёт. Расчёт из
      // открытого окна — исключение: его показывают именно целиком.
      if (trade.status === "planned" && trade !== preview && trade.id !== peeked) {
        tradeLinesRef.current.push(
          line(trade.entry, palette.mtf, `лимит ${trade.side === "long" ? "↑" : "↓"}`, 2),
        );
        continue;
      }

      // Вход и стоп — разные цены даже в безубытке: биржа считает его с учётом
      // комиссии и реального исполнения, и это на десятки пунктов от входа.
      // Подпись «б/у» должна стоять там, где стоп стоит на самом деле.
      tradeLinesRef.current.push(line(trade.entry, palette.text, "вход", 0));
      tradeLinesRef.current.push(
        riskFree(trade)
          ? line(trade.stop, palette.mtf, "", 2)   // подпись BE стоит у бокса
          : line(trade.stop, palette.askLine, "стоп", 2),
      );
      pendingTargets(trade).forEach((price, i) => {
        tradeLinesRef.current.push(
          line(price, palette.bidLine, `тейк ${trade.takesHit + i + 1}`, 2),
        );
      });

    }

    tradeShapesRef.current = tradeShapes(
      [...trades.filter((t) => t.status === "open" || t.id === peeked), preview],
      palette,
      dataRef.current,
    );
    pushShapes();
  }, [trades, preview, peeked, theme, pushShapes]);

  // Вертикальное перетаскивание прямо по свечам.
  //
  // Пока ценовая шкала на автомасштабе, библиотека держит цену сама и тянуть
  // график вверх-вниз мышью не даёт: нужно сначала потянуть саму шкалу справа,
  // и только после этого работает. Трейдер об этом знать не обязан. Замечаем
  // вертикальное движение с зажатой кнопкой по холсту и снимаем автомасштаб
  // сами — дальше библиотека тянет как обычно.
  //
  // Порог в шесть пикселей: горизонтальная прокрутка истории почти всегда
  // немного гуляет по вертикали, и снимать из-за этого автомасштаб нельзя.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    let startY: number | null = null;

    function onDown(event: PointerEvent) {
      if (event.button !== 0) return;
      startY = event.clientY;
    }

    function onMove(event: PointerEvent) {
      if (startY === null || event.buttons === 0) return;
      if (Math.abs(event.clientY - startY) < 6) return;
      startY = null;
      chartRef.current?.priceScale("right").applyOptions({ autoScale: false });
    }

    function onUp() {
      startY = null;
    }

    // Двойное нажатие возвращает автомасштаб. У ценовой шкалы такой жест есть
    // и у самой библиотеки, но идти за ним к правому краю - лишний шаг: цену
    // упустили здесь, вернуть её должно быть можно здесь же.
    function onDouble() {
      chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
    }

    box.addEventListener("pointerdown", onDown);
    box.addEventListener("pointermove", onMove);
    box.addEventListener("pointerup", onUp);
    box.addEventListener("pointerleave", onUp);
    box.addEventListener("dblclick", onDouble);
    return () => {
      box.removeEventListener("pointerdown", onDown);
      box.removeEventListener("pointermove", onMove);
      box.removeEventListener("pointerup", onUp);
      box.removeEventListener("pointerleave", onUp);
      box.removeEventListener("dblclick", onDouble);
    };
  }, []);

  // Положение наложений — покадрово, вместе с самим графиком.
  //
  // Раз в четверть секунды было мало: при перетаскивании и масштабировании
  // холст перерисовывается каждый кадр, и плашка позиции плыла относительно
  // своей линии. Кадр стоит одного вычисления координаты и записи стиля —
  // дешевле, чем перерисовка React, которой здесь больше нет вовсе.
  useEffect(() => {
    let frame = 0;
    let shownClock = "";

    function place(node: HTMLDivElement | null, y: number | null, offset: number) {
      if (!node) return;
      if (y === null) {
        node.style.visibility = "hidden";
        return;
      }
      node.style.visibility = "visible";
      node.style.transform = `translateY(${y + offset}px)`;
    }

    function draw() {
      frame = requestAnimationFrame(draw);
      const series = candleRef.current;
      if (!series) return;

      for (const active of tradeRef.current) {
        place(
          labelsRef.current.get(active.id) ?? null,
          active.status !== "closed" ? series.priceToCoordinate(active.entry) : null,
          -12,
        );
      }

      for (const alert of alertsRef.current ?? []) {
        place(
          alertLabelsRef.current.get(alert.id) ?? null,
          series.priceToCoordinate(alert.price),
          -10,
        );
      }

      const price =
        livePriceRef.current > 0 ? livePriceRef.current : dataRef.current.at(-1)?.close ?? 0;
      place(clockRef.current, price > 0 ? series.priceToCoordinate(price) : null, 10);

      // Текст таймера меняется раз в секунду — пишем его только при смене.
      const next = untilClose(interval);
      if (next !== shownClock && clockRef.current) {
        shownClock = next;
        clockRef.current.textContent = next;
      }
    }

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [interval]);

  // Живая свеча: дорисовываем последний бар по ленте сделок.
  //
  // Библиотека умеет обновлять последний бар одним вызовом, без пересборки
  // ряда. Свечу с чужим временем игнорируем: она из другого таймфрейма,
  // приехала между переключениями, и подставлять её в ряд нельзя.
  useEffect(() => {
    const series = candleRef.current;
    if (!series || !liveCandle) return;
    const bars = dataRef.current;
    const last = bars.at(-1);
    if (!last) return;
    if (liveCandle.time < last.time) return;

    series.update({ ...liveCandle, time: liveCandle.time as UTCTimestamp });
    if (cfg.volume) {
      volumeRef.current?.update({
        time: liveCandle.time as UTCTimestamp,
        value: liveCandle.volume,
        color:
          liveCandle.close >= liveCandle.open
            ? THEMES[themeRef.current].upVolume
            : THEMES[themeRef.current].downVolume,
      });
    }

    // Держим ряд в согласии с экраном: индикаторы считаются по нему, и без
    // этого они отставали бы от нарисованной свечи.
    if (liveCandle.time === last.time) bars[bars.length - 1] = liveCandle;
    else bars.push(liveCandle);

    // Объёмная свеча толстеет прямо на глазах: объём в ней растёт с каждой
    // сделкой, и рисовать её прежней шириной значит отставать от рынка.
    if (cfg.heavy) paintCandles();
  }, [liveCandle, cfg.volume, cfg.heavy, paintCandles]);

  // Точность ценовой шкалы - по шагу инструмента, а не по умолчанию в цент.
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;
    const last = dataRef.current.at(-1)?.close ?? livePrice;
    series.applyOptions({ priceFormat: { type: "price", ...priceFormat(tick ?? 0, last) } });
  }, [tick, symbol, livePrice]);

  // Отметки на ценах — пунктиром через график.
  //
  // Отметка не уровень рынка, а напоминание трейдера, поэтому цвет у неё свой
  // и подпись говорит, что это его метка, а не что-то из стакана.
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;

    for (const l of alertLinesRef.current) series.removePriceLine(l);
    alertLinesRef.current = (alerts ?? []).map((alert) =>
      series.createPriceLine({
        price: alert.price,
        color: THEMES[theme].gold,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "",
      }),
    );
  }, [alertKey, theme]);

  // Уровень из стакана под курсором — линией через весь график.
  //
  // Живёт ровно пока курсор на строке: это подсказка, а не разметка, и
  // оставаться на графике после того, как трейдер увёл мышь, она не должна.
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;

    if (hoverLineRef.current) {
      series.removePriceLine(hoverLineRef.current);
      hoverLineRef.current = null;
    }
    if (!hoverLevel || !(hoverLevel.price > 0)) return;

    hoverLineRef.current = series.createPriceLine({
      price: hoverLevel.price,
      color:
        hoverLevel.side === "bid"
          ? THEMES[themeRef.current].bidLine
          : THEMES[themeRef.current].askLine,
      lineWidth: 2,
      lineStyle: 0,
      axisLabelVisible: true,
      title: hoverLevel.label,
    });
  }, [hoverLevel, theme]);

  // Сделка из журнала под курсором: как она шла и чем кончилась.
  //
  // Рисуется на своём отрезке времени — от входа до выхода, — а не в будущем:
  // это уже история, и накрывать ею текущую цену нечестно. Цели показаны все,
  // включая невзятые: замысел важен не меньше итога.
  useEffect(() => {
    if (!ghost) {
      ghostShapesRef.current = null;
      pushShapes();
      return;
    }

    const candles = dataRef.current;
    const from = snapToBar(candles, ghost.opened_at ?? ghost.closed_at, true);
    const to = snapToBar(candles, ghost.closed_at);
    if (from === null || to === null) {
      // Сделка старше загруженной истории — рисовать не на чем.
      ghostShapesRef.current = null;
      pushShapes();
      return;
    }

    const palette = THEMES[themeRef.current];
    const span = { fromTime: from as UTCTimestamp, toTime: (to === from ? to + 1 : to) as UTCTimestamp };

    // Дальняя граница прибыли: последняя цель, а если целей не записано —
    // цена выхода. Она есть у любой сделки и это настоящее число, а не
    // достроенное: сделки, закрытые до появления целей в журнале, рисовались
    // одним серым боксом стопа.
    const far = ghost.targets.at(-1) ?? ghost.exit_price ?? undefined;

    ghostShapesRef.current = {
      bands: [],
      boxes: [
        {
          ...span,
          top: Math.max(ghost.entry, ghost.stop),
          bottom: Math.min(ghost.entry, ghost.stop),
          fill: palette.riskBox,
          border: palette.riskBorder,
        },
        ...(far !== undefined
          ? [
              {
                ...span,
                top: Math.max(ghost.entry, far),
                bottom: Math.min(ghost.entry, far),
                fill: palette.rewardBox,
                border: palette.rewardBorder,
                label: `${ghost.pnl >= 0 ? "+" : "-"}${Math.abs(ghost.pnl).toFixed(2)}`,
                labelColor: palette.text,
              },
            ]
          : []),
      ],
      segments: [
        {
          ...span,
          price: ghost.entry,
          color: palette.text,
          dashed: false,
          label: "вход",
        },
        ...ghost.targets.map((price, i) => ({
          ...span,
          price,
          color: palette.bidLine,
          dashed: i >= ghost.takes_hit,     // невзятая цель - пунктиром
          label: `тейк ${i + 1}`,
        })),
        {
          ...span,
          price: ghost.stop,
          color: palette.askLine,
          dashed: true,
          label: "стоп",
        },
        // Цена выхода: чем сделка кончилась на самом деле.
        ...(ghost.exit_price
          ? [
              {
                ...span,
                price: ghost.exit_price,
                color: ghost.pnl >= 0 ? palette.bidLine : palette.askLine,
                dashed: false,
                label: "выход",
              },
            ]
          : []),
      ],
      points: [],
    };
    pushShapes();
  }, [ghost, theme, pushShapes]);

  // Отработанные сетапы из журнала прямо на графике.
  //
  // Смотреть статистику списком и смотреть её на графике — разные вещи: в
  // списке видно, сколько сделка принесла, а на графике — почему. Метки идут
  // парами: вход и выход, с результатом у выхода.
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;
    if (!markersRef.current) markersRef.current = createSeriesMarkers(series, []);
    const markers = markersRef.current;

    if (!showJournal) {
      markers.setMarkers([]);
      return;
    }

    let cancelled = false;
    loadTrades(90, symbol)
      .then((body) => {
        if (cancelled || !body) return;
        const candles = dataRef.current;
        if (candles.length === 0) return;

        const marks: SeriesMarker<Time>[] = [];
        for (const t of body.trades) {
          const opened = snapToBar(candles, t.opened_at);
          const closed = snapToBar(candles, t.closed_at);
          const win = t.pnl >= 0;
          if (opened !== null) {
            marks.push({
              time: opened as UTCTimestamp,
              position: t.side === "long" ? "belowBar" : "aboveBar",
              shape: t.side === "long" ? "arrowUp" : "arrowDown",
              color: THEMES[themeRef.current].mtf,
              text: t.side === "long" ? "вход ↑" : "вход ↓",
            });
          }
          if (closed !== null) {
            marks.push({
              time: closed as UTCTimestamp,
              position: t.side === "long" ? "aboveBar" : "belowBar",
              shape: "circle",
              color: win ? THEMES[themeRef.current].bidLine : THEMES[themeRef.current].askLine,
              text: `${win ? "+" : "-"}${Math.abs(t.pnl).toFixed(2)}`,
            });
          }
        }
        // Библиотека требует метки по возрастанию времени.
        marks.sort((a, b) => Number(a.time) - Number(b.time));
        markers.setMarkers(marks);
      })
      .catch(() => {
        // Журнал недоступен — график от этого не страдает.
      });

    return () => {
      cancelled = true;
    };
  }, [showJournal, journalKey, symbol, interval]);

  // Итог дня из журнала. Перечитываем после каждой записанной сделки: цифра в
  // углу должна отвечать на «сколько я сегодня», а не «сколько было на входе».
  useEffect(() => {
    let cancelled = false;
    const now = new Date();
    loadCalendar(now.getUTCFullYear(), now.getUTCMonth() + 1)
      .then((body) => {
        if (cancelled || !body) return;
        const today = now.toISOString().slice(0, 10);
        setTodayPnl(body.days.find((d) => d.date === today)?.pnl ?? 0);
      })
      .catch(() => {
        // Журнал недоступен — угол просто останется пустым.
      });
    return () => {
      cancelled = true;
    };
  }, [journalKey]);

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

      {/* Ярлык позиции у линии входа: состояние, объём и результат в деньгах.
          По ярлыку на сделку - их может идти несколько сразу, и общий на всех
          сказал бы неправду о каждой. Пока цена не дошла до уровня, там слово
          «ждём»: это тоже ответ, и он честнее пустого места. */}
      {trades
        .filter((t) => t.status !== "closed")
        .map((t) => {
          // Главная цифра — по открытой позиции: ровно её показывает биржа, и с
          // ней трейдер сверяется глазами. Забранное по целям стоит рядом
          // отдельно: смешать их значит показать 219 там, где на счёт пришло 148.
          // Число биржи, когда оно есть: она считает от реальной средней и
          // своей цены маркировки, и спорить с ней своей арифметикой значит
          // показывать трейдеру не тот результат, что у него на счёте.
          const floating = t.unrealized ?? floatingAt(t, livePrice);
          const taken = t.realized;
          const total = pnlAt(t, livePrice);
          return (
            <div
              key={t.id}
              ref={(node) => {
                labelsRef.current.set(t.id, node);
              }}
              // Наведение на «ждём вход» показывает, что именно ждёт трейдер:
              // бокс риска, цели и стоп. Постоянно они не рисуются — позиции
              // ещё нет, — но посмотреть на них он вправе в любую секунду.
              onMouseEnter={t.status === "planned" ? () => setPeeked(t.id) : undefined}
              onMouseLeave={t.status === "planned" ? () => setPeeked(null) : undefined}
              // Справа, но с отступом от ценовой шкалы: плашка стоит на конце
              // своей линии, а не в начале графика, где под ней чужие свечи, и
              // при этом не наезжает на плашки цен. Вертикаль задаётся покадрово.
              className="pointer-events-auto absolute right-28 top-0 z-10 flex items-center gap-2 rounded border px-2 py-1 font-mono text-[11px] tabular-nums shadow"
              style={{
                visibility: "hidden",
                borderColor: "var(--pane-border)",
                background: "var(--pane-bg)",
                color: "var(--pane-text)",
              }}
            >
              <span
                className={t.side === "long" ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"}
              >
                {t.side === "long" ? "LONG" : "SHORT"}
              </span>
              {t.status === "planned" ? (
                <span
                  className="cursor-help text-[var(--pane-muted)]"
                  title="Наведите - покажем бокс, стоп и цели этой заявки"
                >
                  ждём вход
                </span>
              ) : (
                <span
                  className={floating >= 0 ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"}
                  title={
                    taken !== 0
                      ? `По открытой позиции, как на бирже. Забрано по целям ${
                          taken >= 0 ? "+" : "-"
                        }${Math.abs(taken).toFixed(2)}, всего по сделке ${
                          total >= 0 ? "+" : "-"
                        }${Math.abs(total).toFixed(2)}`
                      : "По открытой позиции - как на бирже"
                  }
                >
                  {floating >= 0 ? "+" : "-"}
                  {Math.abs(floating).toFixed(2)} USD
                </span>
              )}
              <button
                onClick={() => onCloseTrade?.(t)}
                title="Закрыть сделку"
                className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
              >
                ✕
              </button>
            </div>
          );
        })}

      {/* Будильник у цены отметки: маленький ярлык с крестиком — снять её
          можно там же, где она стоит, как и ждущую заявку. Вертикаль
          задаётся покадрово, вместе с самим графиком. */}
      {(alerts ?? []).map((alert) => (
        <div
          key={alert.id}
          ref={(node) => {
            alertLabelsRef.current.set(alert.id, node);
          }}
          className="pointer-events-auto absolute right-28 top-0 z-10 flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[10px] tabular-nums shadow"
          style={{
            visibility: "hidden",
            borderColor: THEMES[theme].gold,
            background: "var(--pane-bg)",
            color: THEMES[theme].gold,
          }}
        >
          <Bell className="h-3 w-3" />
          <button
            onClick={() => onRemoveAlert?.(alert.id)}
            title="Убрать уведомление"
            className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
          >
            ✕
          </button>
        </div>
      ))}

      {/* Данных нет — говорим, почему, и не рисуем ничего вместо них.
          Устаревшая свеча в скальпинге хуже пустого экрана: по ней принимают
          решение, считая её текущей. */}
      {dataError && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
          <p className="rounded-md border border-[var(--pane-border)] bg-[var(--pane-bg)] px-4 py-2 text-center text-[12px] text-[var(--pane-down)] shadow">
            {dataError}
          </p>
        </div>
      )}

      {/* Итог дня: одна цифра в углу. Всё остальное — в журнале. */}
      {todayPnl !== null && (
        <div className="pointer-events-none absolute right-24 top-1 z-10 font-mono text-[11px] tabular-nums">
          <span className="text-[var(--pane-muted)]">PnL сегодня </span>
          <span className={todayPnl >= 0 ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"}>
            {todayPnl >= 0 ? "+" : "-"}
            {Math.abs(todayPnl).toFixed(2)} $
          </span>
        </div>
      )}

      {/* Время до закрытия свечи — под ценой, у самой шкалы. Скальперу важно,
          сколько осталось: свеча закрывается, и уровень подтверждается или нет. */}
      <div
        ref={clockRef}
        className="pointer-events-none absolute right-1 top-0 z-10 rounded px-1 py-px font-mono text-[10px] tabular-nums"
        style={{
          visibility: "hidden",
          background: "var(--pane-deep)",
          color: "var(--pane-text-2)",
        }}
      />
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
    <div className="pointer-events-none absolute left-2 top-1 z-10 flex gap-3 font-mono text-[10px] tabular-nums text-[var(--pane-muted)]">
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

// Страница перерисовывается на каждом кадре стакана — восемь раз в секунду.
// График к этому равнодушен только если его собственный рендер не запускается
// впустую: сам холст живёт своей жизнью, а JSX вокруг него пересобирать незачем.
export default memo(PriceChart);

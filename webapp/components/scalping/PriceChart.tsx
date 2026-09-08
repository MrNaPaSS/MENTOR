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

import { useT } from "@/lib/i18n";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, X } from "lucide-react";
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
  type ITimeScaleApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { API_URL } from "@/lib/api";
import { computeSmc, type SmcResult } from "@/lib/indicator/smc";
import { readout, tenth, type ScoreReadout } from "@/lib/indicator/score";

// Свёрнута ли панель показаний. Ключ свой, отдельно от рабочего места: там
// живёт раскладка кабинета, а это переключатель внутри самого графика.
const SCORE_KEY = "nmnh.chart.score.wide";

// Насколько трейдер увёл разбор свечи от неё самой.
const FOOT_SHIFT_KEY = "nmnh.chart.foot.shift";

function readShift(): { dx: number; dy: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(FOOT_SHIFT_KEY) || "null") as unknown;
    const spot = raw as { dx?: unknown; dy?: unknown } | null;
    // Нечисло из хранилища увело бы картинку с экрана насовсем.
    if (!spot || typeof spot.dx !== "number" || typeof spot.dy !== "number") {
      return { dx: 0, dy: 0 };
    }
    if (!Number.isFinite(spot.dx) || !Number.isFinite(spot.dy)) return { dx: 0, dy: 0 };
    return { dx: spot.dx, dy: spot.dy };
  } catch {
    // В приватном окне обращение к хранилищу бросает исключение.
    return { dx: 0, dy: 0 };
  }
}

function keepShift(shift: { dx: number; dy: number }): void {
  try {
    localStorage.setItem(FOOT_SHIFT_KEY, JSON.stringify(shift));
  } catch {
    // Не запомнилось - сдвиг всё равно держится до конца сессии.
  }
}

function readScoreWide(): boolean {
  try {
    // Умолчание - развёрнута: подписи нужны тому, кто видит панель впервые.
    return localStorage.getItem(SCORE_KEY) !== "0";
  } catch {
    // В приватном окне обращение к хранилищу бросает исключение.
    return true;
  }
}

function keepScoreWide(wide: boolean): boolean {
  try {
    localStorage.setItem(SCORE_KEY, wide ? "1" : "0");
  } catch {
    // Не запомнилось - переключатель всё равно сработает на эту сессию.
  }
  return wide;
}
import { computeChandelier, type ChandelierResult } from "@/lib/indicator/chandelier";
import { atr, ema } from "@/lib/indicator/ta";
import type { Candle } from "@/lib/indicator/types";
import { buildShapes, type ChartLook } from "@/lib/indicator/shapes";
import {
  presetSkin,
  rgba,
  type ChartPaletteName,
  type ChartPaper,
} from "@/lib/indicator/presets";
import {
  EMPTY_SHAPES,
  ShapesPrimitive,
  type Shapes,
} from "./primitives/ShapesPrimitive";
import { VolumeCandlesPrimitive } from "./primitives/VolumeCandlesPrimitive";
import {
  FOOTPRINT_PRICE,
  FOOTPRINT_WIDTH,
  FootprintPrimitive,
  type FootprintSkin,
} from "./primitives/FootprintPrimitive";
import { parseFootprint, type FootprintData } from "@/lib/indicator/footprint";
import { money, price as fmtPrice, priceFormat, type Wall } from "@/lib/scalping";
import { snapshot, type ShotResult } from "@/lib/shotFrame";
import DragLevels, { type DragLevel } from "./DragLevels";
import OrderChipView, { type OrderChip } from "./OrderChip";
import { loadTrades, type JournalTrade } from "@/lib/journal";
import {
  floatingAt,
  pendingTargets,
  pnlAt,
  riskEdge,
  type ActiveTrade,
} from "@/lib/trade/position";

// Лист графика и палитра свечей.
//
// Тёмный лист — биржевой: зелёные и красные свечи на тёмном фоне. Светлый собран по
// оформлению самого индикатора: белый фон без сетки, свечи чёрно-белые с чёрной
// обводкой (рост — пустая, падение — залитая), структура чёрным пунктиром.
// Зелёный с красным на нём остаются только там, где цвет несёт смысл, — на
// линиях полок покупателя и продавца.
//
// Палитра меняет свечи, лист — бумагу под ними. Настройки независимы: любой из
// пяти пресетов включается на обоих листах, и фон, сетку с рамкой пресет не
// трогает — они приходят от листа.

type ChartPalette = {
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
};

const BASE: Record<"dark" | "light", ChartPalette> = {
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

/**
 * Полная палитра графика: лист плюс выбранные свечи.
 *
 * Своё у пресета только то, что человек видит как цвет графика: свечи, средние,
 * крестовина, линии полок, объёмы и боксы сделки. Фон, сетка, рамка и серый бокс
 * израсходованного риска приходят от листа — они про панель, а не про палитру.
 *
 * Обводка включена у всех пяти: она задана в каждом пресете отдельным цветом, а
 * у Megatron ещё и одна несёт направление — тела там одинаковые.
 */
function chartPalette(paper: ChartPaper, choice: ChartPaletteName): ChartPalette {
  const base = BASE[paper];
  if (choice === "default") return base;

  const skin = presetSkin(choice, paper);
  // На белом листе прозрачные заливки слабее видно: там плотнее.
  const dense = paper === "light";
  return {
    ...base,
    text: skin.ink,
    up: skin.up,
    down: skin.down,
    upBorder: skin.upBorder,
    downBorder: skin.downBorder,
    upWick: skin.upWick,
    downWick: skin.downWick,
    candleBorders: true,
    upVolume: rgba(skin.bull, dense ? 0.42 : 0.36),
    downVolume: rgba(skin.bear, dense ? 0.42 : 0.36),
    bidLine: skin.bull,
    askLine: skin.bear,
    emaFast: skin.emaFast,
    emaSlow: skin.emaSlow,
    emaTrend: skin.emaTrend,
    crosshair: skin.crosshair,
    mtf: skin.mtf,
    gold: skin.gold,
    riskBox: rgba(skin.bear, dense ? 0.18 : 0.16),
    riskBorder: rgba(skin.bear, dense ? 0.5 : 0.45),
    rewardBox: rgba(skin.bull, dense ? 0.18 : 0.14),
    rewardBorder: rgba(skin.bull, dense ? 0.5 : 0.45),
  };
}

// Периоды скользящих средних индикатора.
const EMA_FAST = 8;
const EMA_SLOW = 21;
const EMA_TREND = 50;

export type { Candle };

/**
 * Свеча по времени бара.
 *
 * Картинка объёма рисует настоящую свечу - ту же, что стоит на графике, - а не
 * собранную из строк профиля. Профиль знает только цены сделок, и открытие с
 * закрытием по нему не восстановить: свеча вышла бы без тела.
 */
function barAt(bars: Candle[], time: number | undefined): Candle | null {
  if (time === undefined) return null;
  return bars.find((bar) => bar.time === time) ?? null;
}

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
  /** Зоны премии, равновесия и скидки. */
  zones: boolean;
};

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

/**
 * Таймфреймы, у которых свеча раскрывается объёмом.
 *
 * Крупнее часа профиль не строим: за сутки сделок миллионы, и выкачивать их
 * ради картинки нечестно по отношению к лимиту биржи. Набор обязан совпадать
 * с тем, что принимает эндпоинт, — иначе нажатие давало бы отказ вместо свечи.
 */
const FOOTPRINT_INTERVALS = new Set(["1m", "3m", "5m", "10m", "15m", "30m", "1h"]);

/** Как часто перезапрашивать профиль текущей свечи. */
const FOOTPRINT_REFRESH_MS = 3000;

/** Насколько вертикально можно промахнуться мимо свечи, точки экрана. */
const FOOTPRINT_HIT_PX = 6;

/** Высота меню плюсика: три пункта. По ней решаем, куда его раскрывать. */
const PLUS_MENU_H = 96;

/**
 * Сколько пустых баров дорисовываем за ленту, пока не приехала история.
 *
 * Два часа минуток. Больше - значит ряд отстал не на пропуск сделок, а на
 * сбой связи, и выдумывать за биржу плоскую историю нечестно.
 */
const FILL_BARS = 120;

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
  palette: ChartPalette,
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

  // Бокс показывает, чем сделка рискует: от входа до дальнего края риска.
  //
  // Край не съёживается вслед за подтянутым стопом - иначе с графика пропадает
  // то, на что трейдер шёл, когда входил, - но расширяется вслед за отодвинутым:
  // стоп дальше задуманного это не память о риске, а новый риск. Правило целиком
  // живёт в riskEdge().
  //
  // Риск снят не по флагу, а по факту: стоп должен стоять за ценой входа. Флаг
  // говорил «безубыток» и тогда, когда стоп на бирже не сдвинулся, - и метка BE
  // оказывалась на исходном стопе, то есть на цене убытка.
  const safe = riskFree(trade);
  const risk = riskEdge(trade);
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
  // Линию текущего стопа внутри бокса не рисуем: она уже есть - ценовая
  // линия сделки, со своей подписью на шкале. Вторая такая же на той же цене
  // читается как две разные.
  const segments: Shapes["segments"] = [];

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
  palette: ChartPalette,
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
 * Подпись деления на шкале времени - в часах трейдера.
 *
 * Библиотека отдаёт время бара в UTC и подписывает его же. Здесь оно
 * переводится в местное: день - датой, всё, что мельче, - часами и минутами.
 */
function localTick(time: number | string, kind: number): string {
  const at = new Date(Number(time) * 1000);
  if (Number.isNaN(at.getTime())) return String(time);
  // Метки крупнее дня библиотека нумерует нулём и единицей: год и месяц.
  if (kind <= 1) return at.toLocaleDateString("ru-RU", { month: "short", year: "2-digit" });
  if (kind === 2) return at.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
  return at.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

/** Время под перекрестьем - тоже местное, с датой. */
function localStamp(time: number | string): string {
  const at = new Date(Number(time) * 1000);
  if (Number.isNaN(at.getTime())) return String(time);
  return at.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Свеча под курсором — или ничего, если нажали мимо.
 *
 * Ближайшая по горизонтали, и только если попали в её размах по цене. Одной
 * горизонтали мало: у свечи есть ещё и верх с низом, а нажатие по пустому
 * месту над ней - это расчёт сделки от той цены, и отбирать его нельзя.
 */
function barUnder(
  scale: ITimeScaleApi<Time>,
  series: ISeriesApi<"Candlestick">,
  point: { x: number; y: number },
  candles: Candle[],
): Candle | null {
  const spacing = scale.options().barSpacing;
  let bar: Candle | null = null;
  let best = Math.max(3, spacing * 0.6);
  for (const candle of candles) {
    const x = scale.timeToCoordinate(candle.time as UTCTimestamp);
    if (x === null) continue;
    const dx = Math.abs(x - point.x);
    if (dx <= best) {
      best = dx;
      bar = candle;
    }
  }
  if (!bar) return null;

  // Допуск считаем в пикселях и переводим в цену: на монетах с разным шагом
  // порог в деньгах отличался бы на порядки.
  const at = series.coordinateToPrice(point.y);
  const edge = series.coordinateToPrice(point.y + FOOTPRINT_HIT_PX);
  if (at === null) return null;
  const slack = edge === null ? 0 : Math.abs(at - edge);
  return at >= bar.low - slack && at <= bar.high + slack ? bar : null;
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
  paper,
  preset,
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
  dragLevels,
  orderChip,
  onEmptyClick,
  onAddAlert,
  onAddOrder,
  onAxisHeight,
}: {
  symbol: string;
  interval: string;
  wall: Wall | null;
  shelves: Wall[];
  indicators: Indicators;
  paper: ChartPaper;
  preset: ChartPaletteName;
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
  shot?: React.MutableRefObject<(() => ShotResult | null) | null>;
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
  /**
   * Уровни, которые трейдер тянет мышью: вход ручной лимитки, её стоп и цель,
   * а у идущей сделки - защита на бирже.
   *
   * Собираются снаружи: график знает геометрию, но не знает ни о заявках, ни о
   * деньгах, и знать не должен.
   */
  dragLevels?: DragLevel[];
  /**
   * Чип ждущей лимитки на её линии: сторона, объём и кнопки SL, TP, снять.
   *
   * Отдельно от уровней: у него своё место - линия входа - и свои действия, а
   * не одна цена, которую тянут.
   */
  orderChip?: OrderChip | null;
  /**
   * Нажатие по пустому месту графика - с ценой этого места.
   *
   * Отсюда начинается ручная лимитка. Полка перехватывает нажатие первой:
   * рядом с уровнем трейдер целился в уровень, а не в пустоту.
   */
  onEmptyClick?: (price: number, atr: number) => void;
  /** Поставить отметку на текущей цене - из плюсика у неё же. */
  onAddAlert?: (price: number) => void;
  /**
   * Начать лимитку от текущей цены. Вторым числом - ATR для подсказки стопа,
   * третьим - сторона: её трейдер называет сам, а не выводит из цены.
   */
  onAddOrder?: (price: number, atr: number, side: "long" | "short") => void;
  /** Открыть журнал. Итог дня в углу - вопрос, а ответ на него в журнале. */
  /**
   * Высота шкалы времени в точках.
   *
   * Наружу её сообщает график, потому что считает её библиотека - от шрифта, -
   * и заранее не знает никто. По ней стакан равняет свой низ: две панели рядом
   * обязаны кончаться на одной линии.
   */
  onAxisHeight?: (px: number) => void;
}) {
  const t = useT();
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
  // Показания индикатора в углу графика: балл и объём на последней свече.
  // Ref рядом с состоянием - по нему сравниваются числа без перерисовки.
  const scoreRef = useRef<ScoreReadout | null>(null);
  const [score, setScore] = useState<ScoreReadout | null>(null);
  // Панель развёрнута или свёрнута в одну строку. Держим здесь, а не в
  // рабочем месте: это про сам график, а не про раскладку кабинета, и тянуть
  // ради переключателя ещё одно поле через всю страницу незачем.
  const [wideScore, setScoreWide] = useState(readScoreWide);
  const ceRef = useRef<ChandelierResult | null>(null);
  const lastTimeRef = useRef(0);
  // Последняя сообщённая высота шкалы времени: сообщаем только смену, иначе
  // покадровый цикл дёргал бы состояние страницы шестьдесят раз в секунду.
  const axisRef = useRef(0);
  const onAxisHeightRef = useRef(onAxisHeight);
  onAxisHeightRef.current = onAxisHeight;
  // Читаем настройки из ref: загрузка данных не должна зависеть от
  // переключателей, иначе включение индикатора перезапрашивало бы свечи.
  const indicatorsRef = useRef(indicators);
  indicatorsRef.current = indicators;
  // Готовая палитра: лист и выбор свечей сходятся здесь один раз. Через useMemo,
  // потому что по ней сравниваются зависимости эффектов перекраски.
  const skin = useMemo(() => chartPalette(paper, preset), [paper, preset]);
  const skinRef = useRef(skin);
  skinRef.current = skin;
  // Фигурам структуры нужен не готовый цвет, а сам выбор: лист красит подписи,
  // палитра — разрывы.
  const lookRef = useRef<ChartLook>({ paper, palette: preset });
  lookRef.current = { paper, palette: preset };
  const lineRef = useRef<IPriceLine | null>(null);
  const shelfLinesRef = useRef<IPriceLine[]>([]);
  const tradeLinesRef = useRef(new Map<string, IPriceLine>());
  const tradeShapesRef = useRef<Shapes | null>(null);
  const ghostShapesRef = useRef<Shapes | null>(null);
  /** Ценовые линии сделки из журнала: живут, пока она выбрана. */
  const ghostLinesRef = useRef<Map<string, IPriceLine>>(new Map());
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
  const emptyClickRef = useRef(onEmptyClick);
  emptyClickRef.current = onEmptyClick;
  const alertAddRef = useRef(onAddAlert);
  alertAddRef.current = onAddAlert;
  const orderAddRef = useRef(onAddOrder);
  orderAddRef.current = onAddOrder;

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

    const paint = skinRef.current;
    if (!indicatorsRef.current.heavy) {
      heavy.clear();
      series.applyOptions({
        upColor: paint.up,
        downColor: paint.down,
        borderVisible: paint.candleBorders,
        borderUpColor: paint.upBorder,
        borderDownColor: paint.downBorder,
        wickUpColor: paint.upWick,
        wickDownColor: paint.downWick,
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
      up: paint.up,
      down: paint.down,
      upWick: paint.upWick,
      downWick: paint.downWick,
      // Обводка там, где она есть у обычных свечей темы: на светлой свеча
      // роста белая, и без неё на белом листе её не видно вовсе.
      upBorder: paint.candleBorders ? paint.upBorder : undefined,
      downBorder: paint.candleBorders ? paint.downBorder : undefined,
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
  // Плюсик у текущей цены: отсюда ставят отметку и заводят лимитку. Стоит на
  // самой цене и едет вместе с ней, поэтому положение задаётся покадрово.
  const plusRef = useRef<HTMLDivElement>(null);
  const [plusMenu, setPlusMenu] = useState(false);
  // Куда раскрывать меню плюсика. У нижнего края графика вниз некуда: холст
  // теперь обрезает всё, что за него вылезает, и меню осталось бы наполовину
  // за краем. Считаем один раз на открытии - положение кнопки к этому моменту
  // уже известно, а следить за ним покадрово ради трёх пунктов незачем.
  const [plusUp, setPlusUp] = useState(false);
  // Пока курсор на плюсике или открыто его меню, кнопка стоит на месте.
  // Цена меняется восемь раз в секунду, и кнопка, едущая вместе с ней, уходит
  // из-под курсора ровно в тот момент, когда по ней целятся.
  const plusHeldRef = useRef(false);
  // Почему на графике нет свежих свечей. Пусто — всё в порядке.
  const [dataError, setDataError] = useState<string | null>(null);
  // Раскрытая свеча. Раскрыта всегда одна: две колонки на минутном графике
  // перекрыли бы половину окна, а сравнивают их всё равно по одной — смотрят,
  // где объём встал плитой, а где размазался.
  //
  // Раскрывается она двумя разными жестами, и путать их нельзя. Нажатие по
  // текущей цене открывает панель на живой свече, и дальше она идёт за
  // рынком сама: закрылась минута — панель показывает следующую, не спрашивая.
  // Нажатие по любой свече в истории закрепляет именно её: разбор прошлого
  // ходить за временем не должен.
  const [followBar, setFollowBar] = useState(false);
  const [pickedBar, setPickedBar] = useState<number | null>(null);
  // Начало идущей свечи, секунды. Тикает само: живая панель обязана перейти на
  // новую свечу ровно тогда, когда её открыла биржа, а не когда трейдер
  // случайно шевельнул график.
  const [liveBar, setLiveBar] = useState<number | null>(null);
  const openBar = pickedBar ?? (followBar ? liveBar : null);
  const openBarRef = useRef<number | null>(null);
  openBarRef.current = openBar;
  const followRef = useRef(false);
  followRef.current = followBar;
  const [foot, setFoot] = useState<FootprintData | null>(null);
  const footRef = useRef<FootprintData | null>(null);
  footRef.current = foot;
  // Подпись над лестницей: время свечи, итоги и ступени укрупнения.
  // Положение задаётся покадрово - она стоит на свече, а свеча едет.
  const footBarRef = useRef<HTMLDivElement>(null);
  const footPrimRef = useRef<FootprintPrimitive | null>(null);
  // Цвета для холста: переменных оформления он не понимает, ему нужны
  // значения, и снимать их можно только с живого узла страницы.
  const footSkinRef = useRef<FootprintSkin | null>(null);
  // Обработчик нажатия ставится один раз на всю жизнь графика, а таймфрейм
  // трейдер переключает — значит читаем его из ref, а не из замыкания.
  const intervalRef = useRef(interval);
  intervalRef.current = interval;
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
  // Разметка ждущей заявки - бокс, стоп и цели - показывается двумя способами.
  //
  // Наведение на её ярлык - предпросмотр: подержал курсор, посмотрел, что
  // именно ждёт трейдер, увёл - разметка ушла. Нажатие закрепляет её насовсем:
  // дальше уровни правят руками, а держать для этого курсор на месте нельзя.
  //
  // Наведение живёт только на ярлыке - видимой плашке, к которой ведут курсор
  // намеренно. На самих линиях его нет: полоски захвата невидимы и тянутся во
  // всю ширину, курсор задевал их по пути к ценовой шкале, и поверх идущей
  // сделки сами собой вспыхивали чужие стопы с целями.
  const [pinned, setPinned] = useState<string | null>(null);
  const [peeked, setPeeked] = useState<string | null>(null);
  const shown = pinned ?? peeked;
  const shownRef = useRef<string | null>(null);
  shownRef.current = shown;

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
        // Ниже трёх точек на свечу библиотека перестаёт рисовать обводку, и
        // на светлой теме растущая свеча - белое тело в чёрной рамке -
        // пропадает с белого поля вовсе. Дальше просто не даём отдалять: видеть
        // кашу из свечей всё равно незачем.
        minBarSpacing: 3,
        // Время на шкале - местное, часов трейдера.
        //
        // Библиотека по умолчанию подписывает деления в UTC, и на графике
        // стояло время, которого нет ни на одних часах в комнате: сверять
        // свечу с новостью или с записью в журнале приходилось в уме.
        tickMarkFormatter: localTick,
      },
      localization: {
        locale: "ru-RU",
        // Та же местная зона в подписи перекрестья: шкала и перекрестье,
        // расходящиеся на три часа, - это хуже, чем UTC в обоих.
        timeFormatter: localStamp,
      },
      crosshair: {
        mode: 0,
        vertLine: { color: "#0AFFE0", width: 1, style: 3, labelBackgroundColor: "#0AFFE0" },
        horzLine: { color: "#0AFFE0", width: 1, style: 3, labelBackgroundColor: "#0AFFE0" },
      },
      autoSize: true,
    });

    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: skin.up,
      downColor: skin.down,
      borderVisible: skin.candleBorders,
      borderUpColor: skin.upBorder,
      borderDownColor: skin.downBorder,
      wickUpColor: skin.upWick,
      wickDownColor: skin.downWick,
      // Линия текущей цены цветом текста темы: на светлой она чёрная, иначе
      // белая свеча роста рисовала бы белую линию на белом фоне.
      priceLineColor: skin.text,
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
    // Объём внутри свечи: лестница цифр на самой свече, по ценовой шкале.
    footPrimRef.current = new FootprintPrimitive();
    candleRef.current.attachPrimitive(footPrimRef.current);
    // Нажатие по полке: библиотека не знает о ценовых линиях в момент клика,
    // поэтому ищем ближайшую сами — по расстоянию в пикселях, а не в цене. На
    // минутном графике цена шага и цена в двадцати пикселях различаются на
    // порядки в зависимости от монеты, и порог в деньгах работать не может.
    chart.subscribeClick((param) => {
      const handler = shelfClickRef.current;
      const series = candleRef.current;
      if (!series || !param.point) return;

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
      const atr = currentAtr(dataRef.current);
      if (nearest) {
        handler?.(nearest, atr);
        return;
      }

      const scale = chart.timeScale();
      // Нажатие по текущей цене раскрывает идущую свечу. Это главный жест
      // режима: цена стоит у правого края, панель встаёт рядом с ней — рука
      // тянется туда же, куда и взгляд.
      const live = dataRef.current.at(-1);
      if (live && FOOTPRINT_INTERVALS.has(intervalRef.current)) {
        const liveX = scale.timeToCoordinate(live.time as UTCTimestamp);
        const liveY = series.priceToCoordinate(live.close);
        if (
          liveX !== null &&
          liveY !== null &&
          param.point.x > liveX &&
          Math.abs(liveY - param.point.y) <= FOOTPRINT_HIT_PX
        ) {
          // Живая панель, а не снимок этой минуты: трейдер, нажавший по цене,
          // просит показать, что происходит сейчас, - и через минуту тоже.
          setPickedBar(null);
          setFollowBar((now) => !now);
          return;
        }
      }

      // Нажатие по самой свече раскрывает её: карточка объёма встаёт в углу
      // графика. Проверяем и по горизонтали, и по вертикали: клик по пустому месту над свечой - это расчёт сделки от той
      // цены, и отбирать его у трейдера нельзя.
      const bar = barUnder(scale, series, param.point, dataRef.current);
      if (bar && FOOTPRINT_INTERVALS.has(intervalRef.current)) {
        setPickedBar((now) => (now === bar.time ? null : bar.time));
        return;
      }

      // Мимо полок - значит по пустому месту. Закреплённая разметка заявки
      // снимается: трейдер посмотрел, поправил и отпустил её взглядом.
      setPinned(null);
      const price = series.coordinateToPrice(param.point.y);
      if (price !== null && price > 0) emptyClickRef.current?.(price, atr);
    });

    chartRef.current = chart;
    if (shotRef.current) {
      // Снимок различает лишь цвет листа: пресеты живут на тёмном.
      shotRef.current.current = () =>
        snapshot(chart, box, lookRef.current.paper);
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
      footPrimRef.current = null;
      lineRef.current = null;
      tradeLinesRef.current = new Map();
      // Линии сделки из журнала живут на том же ряду: с его уходом ссылки на
      // них становятся чужими, и снимать их с нового ряда нельзя.
      ghostLinesRef.current = new Map();
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
              ? skinRef.current.upVolume
              : skinRef.current.downVolume,
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
        lookRef.current,
        ceRef.current,
      );
      paintCandles();
      // Бокс сделки пересобираем здесь же: он привязан к последнему бару, а
      // бары только что приехали.
      tradeShapesRef.current = tradeShapes(
        [
          ...tradeRef.current.filter(
            (t) => t.status === "open" || t.id === shownRef.current,
          ),
          previewRef.current,
        ],
        skinRef.current,
        candles,
      );
      pushShapes();
      smcRef.current = smc;
      // Показания панели в углу. Ставим их в состояние только когда числа
      // изменились: свечи приезжают постоянно, а балл держится минутами, и
      // перерисовывать из-за него всю разметку вокруг холста незачем.
      const now = readout(candles);
      const was = scoreRef.current;
      if (
        was === null ||
        was.long !== now.long ||
        was.short !== now.short ||
        tenth(was.vo) !== tenth(now.vo) ||
        tenth(was.voSma) !== tenth(now.voSma)
      ) {
        scoreRef.current = now;
        setScore(now);
      }
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
          const text = String(detail?.detail || t.terminal.chart.candlesUnavailable(res.status));
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
        if (!cancelled) setDataError(t.terminal.chart.noServer);
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
        lookRef.current,
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
  }, [cfg.heavy, skin, paintCandles]);

  // Смена темы: перекрашиваем график на месте. Пересоздавать его нельзя —
  // потеряется масштаб и положение, которые трейдер выставил руками.
  useEffect(() => {
    const chart = chartRef.current;
    const palette = skin;
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
        { paper, palette: preset },
        ceRef.current,
      );
      pushShapes();
    }
  }, [paper, preset, cfg]);

  // Уровни прошлого дня, недели и месяца. Грузятся отдельно от свечей графика:
  // это другие интервалы, и меняются они раз в сутки, а не каждые пять секунд.
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
    const drawn = wall
      ? shelves.filter((shelf) => Math.abs(shelf.price - wall.price) > (tick || 0) / 2)
      : shelves;

    shelfLinesRef.current = drawn.map((shelf) =>
      series.createPriceLine({
        price: shelf.price,
        color: shelf.side === "bid" ? skin.bidLine : skin.askLine,
        lineWidth: 1,
        lineStyle: 1,
        axisLabelVisible: true,
        title: money(shelf.notional),
      }),
    );
  }, [shelfKey, cfg.shelves, skin, wall?.price, tick]);

  // Разметка сделки: вход, стоп и цели линиями, риск и потенциал — боксами.
  //
  // Линии дают точные цены на шкале, боксы — соотношение: видно с одного
  // взгляда, во сколько раз область прибыли выше области убытка. Взятые цели с
  // графика убираются: они уже отработали, и держать их значит показывать
  // сделке цель, которой у неё больше нет.
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;

    tradeShapesRef.current = null;
    const palette = skinRef.current;

    // Линии не пересоздаём, а переставляем.
    //
    // Перетаскивание уровня меняет цену на каждом кадре. Снимать и заводить
    // заново вход, стоп и три цели по десять раз в секунду - это моргание и
    // заметное отставание разметки от курсора: бокс догонял стоп рывками уже
    // после того, как его отпустили. Живущая линия умеет менять цену сама.
    const kept = new Map<string, IPriceLine>();
    const line = (
      key: string,
      price: number,
      color: string,
      title: string,
      style: 0 | 2,
    ) => {
      const options = {
        price,
        color,
        lineWidth: 1 as const,
        lineStyle: style,
        axisLabelVisible: true,
        title,
      };
      const alive = tradeLinesRef.current.get(key);
      if (alive) {
        alive.applyOptions(options);
        kept.set(key, alive);
        return;
      }
      kept.set(key, series.createPriceLine(options));
    };

    for (const trade of [...trades, ...(preview ? [preview] : [])]) {
      if (trade.status === "closed") continue;

      // Сделка ждёт свою лимитку — на графике от неё только сама лимитка.
      // Бокс и цели появляются, когда цена дошла до уровня и позиция набрана:
      // до этого момента ни риска, ни потенциала ещё нет, а нарисованные они
      // спорят с разметкой той сделки, которая действительно идёт. Расчёт из
      // открытого окна — исключение: его показывают именно целиком.
      if (trade.status === "planned" && trade !== preview && trade.id !== shown) {
        // Без подписи на линии: рядом с ней на той же цене стоит плашка
        // «ждём вход» с крестиком, и подпись наезжала на него - снять заявку
        // становилось нечем. Сторону и цену плашка называет сама.
        line(`${trade.id}:limit`, trade.entry, palette.mtf, "", 2);
        continue;
      }

      // Вход и стоп — разные цены даже в безубытке: биржа считает его с учётом
      // комиссии и реального исполнения, и это на десятки пунктов от входа.
      // Подпись «б/у» должна стоять там, где стоп стоит на самом деле.
      line(`${trade.id}:entry`, trade.entry, palette.text, t.terminal.levels.entry, 0);
      // Стоп за ценой входа - это уже не стоп, а безубыток, и на шкале он так
      // и подписан: трейдер читает подпись, а не сравнивает цены глазами.
      if (riskFree(trade)) line(`${trade.id}:stop`, trade.stop, palette.mtf, t.terminal.levels.breakEven, 2);
      else line(`${trade.id}:stop`, trade.stop, palette.askLine, t.terminal.levels.stop, 2);

      pendingTargets(trade).forEach((price, i) => {
        line(
          `${trade.id}:take${i}`,
          price,
          palette.bidLine,
          t.terminal.levels.take(trade.takesHit + i + 1),
          2,
        );
      });
    }

    // Линии сделок, которых больше нет на графике, снимаем.
    for (const [key, alive] of tradeLinesRef.current) {
      if (!kept.has(key)) series.removePriceLine(alive);
    }
    tradeLinesRef.current = kept;

    tradeShapesRef.current = tradeShapes(
      [...trades.filter((t) => t.status === "open" || t.id === shown), preview],
      palette,
      dataRef.current,
    );
    pushShapes();
  }, [trades, preview, shown, skin, pushShapes]);

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
      // Цена вне видимой части шкалы - плашке места нет.
      //
      // Координату график считает и для цены за краем экрана: она просто
      // уезжает за высоту холста. Плашки при этом продолжали ехать за ней и
      // вылезали поверх журнала - таймер свечи и плюсик висели над чужой
      // панелью, будто принадлежат ей.
      const height = boxRef.current?.clientHeight ?? 0;
      const at = y === null ? null : y + offset;
      if (at === null || (height > 0 && (at < 0 || at > height))) {
        node.style.visibility = "hidden";
        return;
      }
      node.style.visibility = "visible";
      node.style.transform = `translateY(${at}px)`;
    }

    function draw() {
      frame = requestAnimationFrame(draw);
      const series = candleRef.current;
      if (!series) return;

      // Высота шкалы времени - наружу. По ней стакан равняет свой низ: обе
      // панели обязаны кончаться на одной линии, а высоту шкалы библиотека
      // считает сама, от шрифта, и заранее её не знает никто.
      const axis = chartRef.current?.timeScale().height() ?? 0;
      if (axis > 0 && axis !== axisRef.current) {
        axisRef.current = axis;
        onAxisHeightRef.current?.(axis);
      }

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

      // Подпись над картинкой объёма. Место считает сам примитив: он же
      // решает, справа от свечи ей встать или слева, и повторять эту
      // арифметику здесь значило бы разойтись с ней на первом же краю холста.
      const label = footBarRef.current;
      if (label) {
        const spot = footPrimRef.current?.box ?? null;
        if (!spot) {
          label.style.visibility = "hidden";
        } else {
          label.style.visibility = "visible";
          label.style.transform = `translate(${spot.x}px, ${Math.max(0, spot.y - label.offsetHeight)}px)`;
        }
      }

      const price =
        livePriceRef.current > 0 ? livePriceRef.current : dataRef.current.at(-1)?.close ?? 0;
      const atPrice = price > 0 ? series.priceToCoordinate(price) : null;
      place(clockRef.current, atPrice, 10);
      if (!plusHeldRef.current) place(plusRef.current, atPrice, -10);

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

  useEffect(() => {
    if (pinned && !trades.some((t) => t.id === pinned && t.status === "planned")) {
      setPinned(null);
    }
  }, [trades, pinned]);

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

    // Шаг сетки таймфрейма. По нему и отличаем свою свечу от чужой.
    const step = INTERVAL_SECONDS[interval] ?? 0;
    // Свеча чужого таймфрейма приезжает между переключениями: подписка на
    // ленту меняет интервал не в тот же миг, что график. Её время не ложится
    // на сетку - и в ряду появлялся лишний бар, сдвинутый относительно
    // остальных. Проверяем сеткой, а не обещанием: пятиминутка кратна минуте,
    // и одним «больше последнего» её не отличить.
    if (step > 0 && liveCandle.time % step !== 0) return;

    // Свеча с ленты знает только то, что пришло с момента подписки. На минуте
    // это почти вся свеча, а на пяти и десяти минутах - её хвост: открытие,
    // максимум и минимум остались в прошлом, до подписки. Класть такую поверх
    // настоящей значит стереть свечу до огрызка - именно это и выглядело как
    // «текущая свеча не рисуется».
    //
    // Поэтому не заменяем, а дополняем: у своей свечи берём открытие и
    // крайние точки, у ленты - цену закрытия и то, что она видела нового.
    const same = liveCandle.time === last.time;
    const merged = same
      ? {
          time: last.time,
          open: last.open,
          high: Math.max(last.high, liveCandle.high),
          low: Math.min(last.low, liveCandle.low),
          close: liveCandle.close,
          volume: Math.max(last.volume, liveCandle.volume),
        }
      : liveCandle;

    /** Нарисовать бар и оставить его в ряду. */
    const put = (bar: Candle, append: boolean) => {
      series.update({ ...bar, time: bar.time as UTCTimestamp });
      if (cfg.volume) {
        volumeRef.current?.update({
          time: bar.time as UTCTimestamp,
          value: bar.volume,
          color:
            bar.close >= bar.open
              ? skinRef.current.upVolume
              : skinRef.current.downVolume,
        });
      }
      // Держим ряд в согласии с экраном: индикаторы считаются по нему, и без
      // этого они отставали бы от нарисованной свечи.
      if (append) bars.push(bar);
      else bars[bars.length - 1] = bar;
    };

    if (!same && step > 0) {
      // Минуты без единой сделки. Лента о них молчать вправе - сделок не
      // было, - а ряд из-за этого получал дыру: за баром 12:03 сразу шёл
      // 12:07, и график врал о том, сколько времени заняло движение. Биржа
      // такие минуты отдаёт плоскими свечами по последней цене; до её ответа
      // дорисовываем их сами, ровно так же.
      const missing = Math.round((liveCandle.time - last.time) / step) - 1;
      // Отстал слишком сильно - это не пропуск, а мёртвый ряд: ждём историю
      // с биржи, а не выдумываем два часа плоских свечей.
      if (missing > FILL_BARS) return;
      for (let i = 1; i <= missing; i++) {
        put(
          {
            time: last.time + step * i,
            open: last.close,
            high: last.close,
            low: last.close,
            close: last.close,
            volume: 0,
          },
          true,
        );
      }
    }

    put(merged, !same);

    // Объёмная свеча толстеет прямо на глазах: объём в ней растёт с каждой
    // сделкой, и рисовать её прежней шириной значит отставать от рынка.
    if (cfg.heavy) paintCandles();
  }, [liveCandle, interval, cfg.volume, cfg.heavy, paintCandles]);

  // Профиль раскрытой свечи.
  //
  // Текущая свеча живёт: сделки в неё приходят каждую секунду, и профиль
  // перезапрашивается, пока она не закроется. Закрытая приезжает один раз —
  // меняться ей уже нечем, и сервер отдаёт её из кэша.
  useEffect(() => {
    if (openBar === null) {
      setFoot(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const seconds = INTERVAL_SECONDS[interval] ?? 60;

    async function load() {
      try {
        const res = await fetch(
          `${API_URL}/api/scalping/footprint/${symbol}?interval=${interval}&time=${openBar}`,
        );
        if (!res.ok) {
          // Причину называем словами: пустая колонка молча - это то же самое,
          // что показать неверный объём.
          const detail = await res.json().catch(() => null);
          if (!cancelled) {
            setDataError(
              String(detail?.detail || t.terminal.chart.footprintUnavailable(res.status)),
            );
          }
          return;
        }
        const body = await res.json();
        if (cancelled) return;
        setDataError(null);
        setFoot(parseFootprint(body));
      } catch {
        if (!cancelled) setDataError(t.terminal.chart.noServer);
      }
    }

    void load();
    timer = setInterval(() => {
      void load();
      // Свеча закрылась - следующий запрос уже ничего не изменит. Один после
      // закрытия всё же делаем: последние сделки минуты приходят в неё же.
      if (timer && Date.now() / 1000 > openBar + seconds + 2) {
        clearInterval(timer);
        timer = null;
      }
    }, FOOTPRINT_REFRESH_MS);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [openBar, symbol, interval, t]);

  // Начало идущей свечи. Считаем по часам, а не по последнему бару графика:
  // свечи приезжают раз в пять секунд, и панель на живой свече отставала бы от
  // рынка на эти пять секунд ровно в тот момент, когда открывается новая.
  //
  // Секундный шаг здесь не расточительство: это одно деление в минуту, а
  // граница свечи - единственное, что панель обязана поймать вовремя.
  useEffect(() => {
    // Пока трейдер разбирает свечу из истории, часы не тикают: панель всё
    // равно показывает не их, а перерисовка раз в секунду ради невидимого
    // числа - это работа впустую.
    if (!followBar || pickedBar !== null) {
      setLiveBar(null);
      return;
    }
    const seconds = INTERVAL_SECONDS[interval] ?? 60;
    const put = () => {
      const now = Math.floor(Date.now() / 1000);
      setLiveBar(now - (now % seconds));
    };
    put();
    const timer = setInterval(put, 1000);
    return () => clearInterval(timer);
  }, [followBar, pickedBar, interval]);

  // Смена монеты или таймфрейма отпускает закреплённую свечу: её время на новом
  // ряду означает другую свечу, а на другой монете - вообще ничего. Живую
  // панель это не трогает: «покажи, что сейчас» на новой монете значит то же
  // самое, и закрывать её ради смены инструмента незачем.
  useEffect(() => {
    setPickedBar(null);
  }, [symbol, interval]);

  // Escape - тот же выход, что и нажатие по колонке. Раскрытая свеча закрывает
  // соседей, и руке проще нажать клавишу, чем целиться в неё же мышью.
  useEffect(() => {
    if (openBar === null) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setPickedBar(null);
      setFollowBar(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openBar]);

  // Масштаб строк читаем один раз при первой отрисовке: хранилище - вещь
  // браузера, а страница собирается и на сервере, где его нет.
  useEffect(() => {
    footPrimRef.current?.setShift(readShift());
  }, []);

  // Цвета лестницы снимаем с живого узла страницы.
  //
  // Холст не понимает переменных оформления - ему нужны значения, а значения
  // эти меняются вместе с листом графика и с темой кабинета. Снимаем их на
  // смене листа, а не на каждом кадре: computed style стоит перерасчёта
  // раскладки, и делать его шестьдесят раз в секунду ради семи цветов нельзя.
  useEffect(() => {
    const node = boxRef.current;
    if (!node) return;
    const read = getComputedStyle(node);
    const pick = (name: string, fallback: string) =>
      read.getPropertyValue(name).trim() || fallback;
    footSkinRef.current = {
      bg: pick("--pane-bg", "#181a20"),
      border: pick("--pane-border", "#2b3139"),
      text: pick("--pane-text", "#eaecef"),
      muted: pick("--pane-muted", "#7a8290"),
      // Объём красится цветом выбранных свечей, а не всегда зелёно-красным:
      // на белом листе свечи чёрно-белые, и зелёный столбик рядом с ними -
      // фигура из другого графика.
      up: skinRef.current.up,
      down: skinRef.current.down,
      // Светлые чернила для тёмной ячейки. Берём фон тёмного листа, а не
      // белый: чистый белый на цветной подложке слепит.
      bright: "#f5f7fa",
      gold: pick("--pane-gold", "#f0b90b"),
      accent: pick("--pane-accent", "#0affe0"),
      // Свеча разбора - той же палитрой, что свечи графика: на белом листе они
      // чёрно-белые, и зелёно-красная свеча поверх них читалась бы чужой
      // фигурой. Обводка тела берётся от неё же - на белом листе тело роста
      // пустое, и без обводки его просто нет.
      bodyUp: skinRef.current.upBorder || skinRef.current.up,
      bodyDown: skinRef.current.downBorder || skinRef.current.down,
      washUp: skinRef.current.up,
      washDown: skinRef.current.down,
      wickUp: skinRef.current.upWick,
      wickDown: skinRef.current.downWick,
    };
    footPrimRef.current?.setData(
      footRef.current,
      barAt(dataRef.current, footRef.current?.time),
      footSkinRef.current,
    );
  }, [paper, preset]);

  // Данные лестницы - в примитив. Он рисует их сам на каждом кадре графика,
  // React в этом больше не участвует: два десятка строк с цифрами, едущих
  // вместе с холстом, перерисовкой компонента не вытянуть.
  useEffect(() => {
    const skin = footSkinRef.current;
    if (skin) {
      footPrimRef.current?.setData(foot, barAt(dataRef.current, foot?.time), skin);
    }
    // Свежая свеча - в зависимостях: тело и фитили на картинке двигаются с
    // каждой сделкой, а профиль перезапрашивается раз в три секунды. Без этого
    // свеча на разборе отставала бы от той, что стоит на графике.
  }, [foot, liveCandle]);

  // Перенос разбора свечи за её тело.
  //
  // Ручка - само тело: за него картинку и хватают, как хватают любую вещь на
  // экране за её середину. Ловим нажатие на перехвате и глушим его: ниже по
  // дереву лежит холст библиотеки, и без этого график поехал бы вместе с
  // картинкой.
  //
  // Сдвиг откладывается от места самой свечи, а не задаётся в точках холста:
  // картинка обязана остаться при своей свече, когда график прокрутят.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const hit = (event: PointerEvent) => {
      const body = footPrimRef.current?.body;
      if (!body) return false;
      const rect = box.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      return (
        x >= body.x && x <= body.x + body.width && y >= body.y && y <= body.y + body.height
      );
    };

    function onDown(event: PointerEvent) {
      if (event.button !== 0 || !hit(event)) return;
      event.preventDefault();
      event.stopPropagation();

      const from = footPrimRef.current?.shift ?? { dx: 0, dy: 0 };
      const startX = event.clientX;
      const startY = event.clientY;
      let last = from;

      const move = (moved: PointerEvent) => {
        last = { dx: from.dx + (moved.clientX - startX), dy: from.dy + (moved.clientY - startY) };
        footPrimRef.current?.setShift(last);
      };
      const drop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", drop);
        keepShift(last);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", drop);
    }

    // Курсор-ладонь над телом: иначе о том, что картинку можно увести, узнают
    // только случайно.
    function onHover(event: PointerEvent) {
      if (event.buttons !== 0) return;
      box!.style.cursor = hit(event) ? "grab" : "";
    }

    box.addEventListener("pointerdown", onDown, true);
    box.addEventListener("pointermove", onHover);
    return () => {
      box.removeEventListener("pointerdown", onDown, true);
      box.removeEventListener("pointermove", onHover);
      box.style.cursor = "";
    };
  }, []);

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
        color: skin.gold,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "",
      }),
    );
  }, [alertKey, skin]);

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
          ? skinRef.current.bidLine
          : skinRef.current.askLine,
      lineWidth: 2,
      lineStyle: 0,
      axisLabelVisible: true,
      title: hoverLevel.label,
    });
  }, [hoverLevel, skin]);

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

    const palette = skinRef.current;
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
        },
        ...ghost.targets.map((price, i) => ({
          ...span,
          price,
          color: palette.bidLine,
          dashed: i >= ghost.takes_hit,     // невзятая цель - пунктиром
        })),
        {
          ...span,
          price: ghost.stop,
          color: palette.askLine,
          dashed: true,
        },
        // Цена выхода: чем сделка кончилась на самом деле.
        ...(ghost.exit_price
          ? [
              {
                ...span,
                price: ghost.exit_price,
                color: ghost.pnl >= 0 ? palette.bidLine : palette.askLine,
                dashed: false,
              },
            ]
          : []),
      ],
      points: [],
    };
    pushShapes();
  }, [ghost, skin, pushShapes]);

  // Уровни сделки из журнала - у ценовой шкалы, как у живой сделки.
  //
  // Раньше «вход», «стоп» и «тейк 1..3» были надписями поверх бокса: чтобы
  // прочитать цену уровня, приходилось вести взгляд от подписи к шкале и
  // обратно. У идущей сделки это давно сделано иначе - линия во всю ширину и
  // ярлык с ценой справа, - и разбирать закрытую сделку глаз должен так же,
  // не переучиваясь.
  //
  // Линии переставляем, а не пересоздаём: смена сделки в журнале иначе давала
  // бы моргание.
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;
    const palette = skinRef.current;

    const kept = new Map<string, IPriceLine>();
    const put = (key: string, price: number, color: string, title: string, dashed: boolean) => {
      if (!(price > 0)) return;
      const options = {
        price,
        color,
        lineWidth: 1 as const,
        lineStyle: (dashed ? 2 : 0) as 0 | 2,
        axisLabelVisible: true,
        title,
      };
      const alive = ghostLinesRef.current.get(key);
      if (alive) {
        alive.applyOptions(options);
        kept.set(key, alive);
        return;
      }
      kept.set(key, series.createPriceLine(options));
    };

    if (ghost) {
      put("entry", ghost.entry, palette.text, t.terminal.levels.entry, false);
      put("stop", ghost.stop, palette.askLine, t.terminal.levels.stop, true);
      ghost.targets.forEach((price, i) => {
        // Невзятая цель пунктиром - тем же различием, что и у идущей сделки.
        put(`take${i}`, price, palette.bidLine, t.terminal.levels.take(i + 1), i >= ghost.takes_hit);
      });
      if (ghost.exit_price) {
        put(
          "exit",
          ghost.exit_price,
          ghost.pnl >= 0 ? palette.bidLine : palette.askLine,
          t.terminal.levels.exit,
          false,
        );
      }
    }

    for (const [key, line] of ghostLinesRef.current) {
      if (!kept.has(key)) series.removePriceLine(line);
    }
    ghostLinesRef.current = kept;
  }, [ghost, skin]);

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
        for (const row of body.trades) {
          const opened = snapToBar(candles, row.opened_at);
          const closed = snapToBar(candles, row.closed_at);
          const win = row.pnl >= 0;
          if (opened !== null) {
            marks.push({
              time: opened as UTCTimestamp,
              position: row.side === "long" ? "belowBar" : "aboveBar",
              shape: row.side === "long" ? "arrowUp" : "arrowDown",
              color: skinRef.current.mtf,
              text: row.side === "long" ? t.terminal.levels.entryUp : t.terminal.levels.entryDown,
            });
          }
          if (closed !== null) {
            marks.push({
              time: closed as UTCTimestamp,
              position: row.side === "long" ? "aboveBar" : "belowBar",
              shape: "circle",
              color: win ? skinRef.current.bidLine : skinRef.current.askLine,
              text: `${win ? "+" : "-"}${Math.abs(row.pnl).toFixed(2)}`,
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
      title: t.terminal.levels.wall,
    });
  }, [wall?.price, wall?.side]);

  // Полоски захвата у ждущей заявки: пока её не закрепили - только на лимитке.
  //
  // Стоп и цели у неё на графике не нарисованы, а полоски под них заводились
  // всё равно - невидимые, во всю ширину и светящиеся под курсором. Курсор шёл
  // через график, задевал их, и по экрану ползли цветные полосы там, где линий
  // нет; нажатие на такую полосу закрепляло чужую разметку с боксами. Взять
  // уровень, которого не видишь, всё равно нельзя - значит и полоски под ним
  // не нужно.
  const waiting = useMemo(
    () => new Set(trades.filter((t) => t.status === "planned").map((t) => t.id)),
    [trades],
  );
  const pinnable = useMemo(
    () =>
      (dragLevels ?? []).flatMap((level) => {
        if (!level.trade || !waiting.has(level.trade)) return [level];
        if (level.trade === pinned) return [level];
        if (level.kind !== "entry") return [];
        // Нажатие по лимитке закрепляет разметку заявки: дальше уровни видны и
        // их правят руками.
        return [
          {
            ...level,
            onClick: () =>
              setPinned((now) => (now === level.trade ? null : level.trade ?? null)),
          },
        ];
      }),
    [dragLevels, waiting, pinned],
  );

  // Меню плюсика закрывается нажатием мимо: открытое окно, которое нельзя
  // закрыть тем же движением, каким открыл, - ловушка.
  useEffect(() => {
    if (!plusMenu) return;
    function away(event: MouseEvent) {
      if (plusRef.current?.contains(event.target as Node)) return;
      setPlusMenu(false);
      plusHeldRef.current = false;
    }
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [plusMenu]);

  const priceToY = useCallback(
    (value: number) => candleRef.current?.priceToCoordinate(value) ?? null,
    [],
  );
  const yToPrice = useCallback(
    (y: number) => candleRef.current?.coordinateToPrice(y) ?? null,
    [],
  );

  return (
    // overflow-hidden - страховка на всё, что ездит за ценой. Плашки, чипы и
    // уровни держатся на translateY, и любая координата за краем холста
    // выносила их поверх соседних панелей. Само по себе это уже не случается
    // (см. place()), но чужая панель - слишком заметная плата за недосмотр в
    // одном из полудюжины мест, которые сюда что-то кладут.
    <div className="relative h-full w-full overflow-hidden">
      <div ref={boxRef} className="h-full w-full" />

      {/* Уровни под мышью: вход ручной лимитки, стоп и цель. Цену и координату
          знает ценовой ряд - он же их и пересчитывает. */}
      {dragLevels && dragLevels.length > 0 && (
        <DragLevels
          levels={pinnable}
          toY={priceToY}
          toPrice={yToPrice}
          format={(value) => fmtPrice(value, tick ?? 0)}
        />
      )}

      {orderChip && <OrderChipView chip={orderChip} toY={priceToY} toPrice={yToPrice} />}
      {/* Ярлык позиции у линии входа: состояние, объём и результат в деньгах.
          По ярлыку на сделку - их может идти несколько сразу, и общий на всех
          сказал бы неправду о каждой. Пока цена не дошла до уровня, там слово
          «ждём»: это тоже ответ, и он честнее пустого места. */}
      {trades
        .filter((t) => t.status !== "closed")
        .map((row) => {
          // Главная цифра — по открытой позиции: ровно её показывает биржа, и с
          // ней трейдер сверяется глазами. Забранное по целям стоит рядом
          // отдельно: смешать их значит показать 219 там, где на счёт пришло 148.
          // Число биржи, когда оно есть: она считает от реальной средней и
          // своей цены маркировки, и спорить с ней своей арифметикой значит
          // показывать трейдеру не тот результат, что у него на счёте.
          const floating = row.unrealized ?? floatingAt(row, livePrice);
          const taken = row.realized;
          const total = pnlAt(row, livePrice);
          return (
            <div
              key={row.id}
              ref={(node) => {
                labelsRef.current.set(row.id, node);
              }}
              // «Ждём вход» показывает, что именно ждёт трейдер: бокс риска,
              // цели и стоп. Постоянно они не рисуются - позиции ещё нет.
              // Наведение показывает их на посмотреть, нажатие закрепляет.
              onMouseEnter={row.status === "planned" ? () => setPeeked(row.id) : undefined}
              onMouseLeave={row.status === "planned" ? () => setPeeked(null) : undefined}
              onClick={
                row.status === "planned"
                  ? () => setPinned((now) => (now === row.id ? null : row.id))
                  : undefined
              }
              // Справа, но с отступом от ценовой шкалы: плашка стоит на конце
              // своей линии, а не в начале графика, где под ней чужие свечи, и
              // при этом не наезжает на плашки цен. Вертикаль задаётся покадрово.
              className={`pointer-events-auto absolute right-28 top-0 z-10 flex items-center gap-2 rounded border px-2 py-1 font-mono text-[11px] tabular-nums shadow${
                // Курсор-палец у ждущей заявки: иначе о том, что плашка
                // нажимается и закрепляет разметку, узнают только случайно.
                row.status === "planned" ? " cursor-pointer" : ""
              }`}
              style={{
                visibility: "hidden",
                borderColor:
                  pinned === row.id
                    ? "var(--pane-accent)"
                    : peeked === row.id
                      ? "var(--pane-accent-soft)"
                      : "var(--pane-border)",
                background: "var(--pane-bg)",
                color: "var(--pane-text)",
              }}
            >
              <span
                className={row.side === "long" ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"}
              >
                {row.side === "long" ? "LONG" : "SHORT"}
              </span>
              {row.status === "planned" ? (
                <span
                  className="cursor-pointer text-[var(--pane-muted)]"
                  title={
                    pinned === row.id
                      ? t.terminal.chart.unpinHint
                      : t.terminal.chart.pinHint
                  }
                >
                  {pinned === row.id ? t.terminal.chart.pinned : t.terminal.chart.waitingEntry}
                </span>
              ) : (
                <span
                  className={floating >= 0 ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"}
                  title={
                    taken !== 0
                      ? t.terminal.chart.pnlWithTaken(
              `${taken >= 0 ? "+" : "-"}${Math.abs(taken).toFixed(2)}`,
              `${total >= 0 ? "+" : "-"}${Math.abs(total).toFixed(2)}`
            )
                      : t.terminal.chart.pnlOpenOnly
                  }
                >
                  {floating >= 0 ? "+" : "-"}
                  {Math.abs(floating).toFixed(2)} USD
                </span>
              )}
              <button
                onClick={() => onCloseTrade?.(row)}
                title={t.terminal.chart.closeTrade}
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
            borderColor: skin.gold,
            background: "var(--pane-bg)",
            color: skin.gold,
          }}
        >
          <Bell className="h-3 w-3" />
          <button
            onClick={() => onRemoveAlert?.(alert.id)}
            title={t.terminal.chart.removeAlert}
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

      {/* Плюсик у текущей цены: два действия, которые нужны прямо на ней -
          отметить уровень или встать в него лимиткой. Раньше для этого надо
          было знать, что нажатие по графику что-то делает. */}
      <div
        ref={plusRef}
        className="absolute right-16 top-0 z-30"
        style={{ visibility: "hidden" }}
        onPointerEnter={() => {
          plusHeldRef.current = true;
        }}
        onPointerLeave={() => {
          plusHeldRef.current = plusMenu;
        }}
      >
        <button
          onClick={() => {
            setPlusMenu((v) => {
              // Меню закрыли - кнопка снова едет за ценой.
              plusHeldRef.current = !v;
              if (!v) {
                const at = plusRef.current?.getBoundingClientRect();
                const box = boxRef.current?.getBoundingClientRect();
                setPlusUp(Boolean(at && box && at.bottom + PLUS_MENU_H > box.bottom));
              }
              return !v;
            });
          }}
          // Подсказка только пока меню закрыто: открытое она перекрывает
          // собой, и пункт «открыть лонг» просто не виден.
          title={plusMenu ? undefined : t.terminal.chart.plusTitle}
          className="pointer-events-auto flex h-5 w-5 items-center justify-center rounded-full border text-[13px] leading-none shadow transition-colors duration-150 ease-out"
          style={{
            borderColor: "var(--pane-border)",
            background: "var(--pane-bg)",
            color: "var(--pane-text-2)",
          }}
        >
          +
        </button>
        {plusMenu && (
          <div
            className={`pointer-events-auto absolute right-6 w-44 overflow-hidden rounded-lg border shadow-xl ${
              plusUp ? "bottom-0" : "top-0"
            }`}
            style={{ borderColor: "var(--pane-border)", background: "var(--pane-bg)" }}
          >
            {(
              [
                // Цвета берём у интерфейса, а не у свечей: цвет роста в палитре -
                // это тело свечи, и на белом листе оно белое. Пункт «открыть лонг»
                // оказывался белым по белому и не читался вовсе.
                ["alert", t.terminal.chart.plusAlert, "var(--pane-text-2)"],
                ["long", t.terminal.chart.plusLong, "var(--pane-up)"],
                ["short", t.terminal.chart.plusShort, "var(--pane-down)"],
              ] as const
            ).map(([action, label, color]) => (
              <button
                key={action}
                onClick={() => {
                  setPlusMenu(false);
                  plusHeldRef.current = false;
                  const at =
                    livePriceRef.current > 0
                      ? livePriceRef.current
                      : dataRef.current.at(-1)?.close ?? 0;
                  if (!(at > 0)) return;
                  if (action === "alert") alertAddRef.current?.(at);
                  else orderAddRef.current?.(at, currentAtr(dataRef.current), action);
                }}
                className="block w-full px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-[var(--pane-hover)]"
                style={{ color }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Подпись над лестницей объёма.
          
          Сама лестница живёт на холсте, вместе со свечами: она про цену, и
          место ей на ценовой шкале. А вот итоги свечи и ступени укрупнения -
          это уже не рынок, а управление, и рисовать их на холсте значит
          лишить трейдера возможности по ним нажать.
          
          Стоит подпись над верхней строкой лестницы и едет вместе с ней:
          положение задаётся покадрово, как у плашек позиций. */}
      {foot && (
        <div
          ref={footBarRef}
          className="pointer-events-auto absolute left-0 top-0 z-20 flex items-center gap-2 rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums"
          style={{
            visibility: "hidden",
            // Ширина - ровно по картинке: слова обязаны встать над своими
            // колонками, а не рядом друг с другом.
            width: FOOTPRINT_WIDTH,
            background: "var(--pane-bg)",
            color: "var(--pane-text-2)",
          }}
        >
          {/* Слово стоит над своей колонкой: шорт над колонкой продаж, лонг
              над колонкой покупок. Подпись сбоку заставляла бы каждый раз
              вспоминать, какая сторона где, - а сторону надо знать раньше,
              чем прочитаешь цифру.

              Между ними пропуск в ширину колонки цены: там из картинки
              выходит верхний фитиль, и слово на нём читалось бы поверх свечи. */}
          <span className="flex-1 text-right" style={{ color: "var(--pane-down)" }}>
            {t.terminal.chart.footShort} {foot.partial ? "≈" : ""}
            {money(foot.sell)}
          </span>
          <span
            className="shrink-0"
            style={{ width: FOOTPRINT_PRICE }}
            // «≈» у обеих сторон, когда свеча разобрана не целиком: цифры
            // всё равно меньше настоящих, и выдавать их за полные нельзя.
            title={foot.partial ? t.terminal.chart.footPartial : undefined}
          />
          <span className="flex-1 text-left" style={{ color: "var(--pane-up)" }}>
            {t.terminal.chart.footLong} {foot.partial ? "≈" : ""}
            {money(foot.buy)}
          </span>

          <button
            onClick={() => {
              setPickedBar(null);
              setFollowBar(false);
            }}
            title={t.terminal.chart.footClose}
            className="shrink-0 transition-opacity duration-150 ease-out hover:opacity-70"
            style={{ color: "var(--pane-muted)" }}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Показания индикатора - в правом нижнем углу, как в оригинале на
          TradingView. Именно там их ищет взгляд человека, пришедшего оттуда, и
          именно там они не спорят с ценой: верх графика занят ею.

          Отступы не на глаз: справа за краем полотна идёт шкала цены, снизу -
          шкала времени. Панель, положенная в самый угол, накрывала последние
          цифры цены - ровно те, ради которых на график и смотрят. Правый край
          подведён к самой черте шкалы: пустая полоса между ними тянула панель
          в середину графика, где ей не место. */}
      {score && (
        <button
          onClick={() => setScoreWide(keepScoreWide(!wideScore))}
          title={wideScore ? t.terminal.chart.scoreHide : t.terminal.chart.scoreShow}
          className="pointer-events-auto absolute bottom-8 right-[60px] z-10 overflow-hidden rounded border text-left font-mono text-[10px] tabular-nums shadow transition-opacity duration-150 ease-out hover:opacity-80"
          style={{ borderColor: "var(--pane-border)", background: "var(--pane-deep)" }}
        >
          {wideScore ? (
            <>
              <div className="flex">
                <span
                  className="px-1.5 py-0.5"
                  style={{ background: "var(--pane-bg)", color: "var(--pane-muted)" }}
                >
                  BM Score
                </span>
                <span className="px-1.5 py-0.5" style={{ color: "var(--pane-text)" }}>
                  <span style={{ color: "var(--pane-up)" }}>L:{score.long}</span>
                  {"  "}
                  <span style={{ color: "var(--pane-down)" }}>S:{score.short}</span>
                </span>
              </div>
              <div className="flex" style={{ borderTop: "1px solid var(--pane-border)" }}>
                <span
                  className="px-1.5 py-0.5"
                  style={{ background: "var(--pane-bg)", color: "var(--pane-muted)" }}
                >
                  VO / SMA
                </span>
                <span className="px-1.5 py-0.5" style={{ color: "var(--pane-text-2)" }}>
                  {tenth(score.vo)} / {tenth(score.voSma)}
                </span>
              </div>
            </>
          ) : (
            /* Свёрнутый вид: те же числа без подписей. Подписи нужны один раз -
               чтобы понять, что это; дальше они занимают угол графика впустую. */
            <span className="flex items-center gap-1 px-1.5 py-0.5">
              <span style={{ color: "var(--pane-up)" }}>{score.long}</span>
              <span style={{ color: "var(--pane-muted)" }}>/</span>
              <span style={{ color: "var(--pane-down)" }}>{score.short}</span>
              <span style={{ color: "var(--pane-muted)" }}>·</span>
              <span style={{ color: "var(--pane-text-2)" }}>{tenth(score.vo)}</span>
            </span>
          )}
        </button>
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
// Страница перерисовывается на каждом кадре стакана — восемь раз в секунду.
// График к этому равнодушен только если его собственный рендер не запускается
// впустую: сам холст живёт своей жизнью, а JSX вокруг него пересобирать незачем.
export default memo(PriceChart);

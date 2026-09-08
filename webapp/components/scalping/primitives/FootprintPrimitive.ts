// Раскрытая свеча: её объём разложен по ценам прямо на графике.
//
// Нажатие по свече раскрывает её: на месте одной палочки встаёт колонка строк —
// сколько денег прошло на каждой цене, слева продажи, справа покупки. Порядок
// тот же, что в стакане рядом: продажи слева, покупки справа, старшая цена
// сверху. Одно и то же движение глаз читает и книгу заявок, и уже прошедший
// объём.
//
// Рисуем сами, а не средствами библиотеки: ей на графике доступны линии и
// маркеры, а здесь нужна таблица, встающая ровно на ценовую сетку и знающая
// текущий масштаб. Сама свеча тоже перерисовывается здесь — тонкой чертой
// поверх строк: под таблицей её тело было бы не видно, а без него непонятно,
// какую свечу раскрыли.

import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";
import type { Candle } from "@/lib/indicator/types";
import {
  foldRows,
  markRows,
  pickStep,
  type FootprintData,
  type FootprintRow,
} from "@/lib/indicator/footprint";
import { money } from "@/lib/scalping";

/** Минимальная высота строки: меньше в неё не влезает число. */
const MIN_ROW_PX = 12;

/**
 * Ширина колонки чисел и зазор от оси свечи до края числа.
 *
 * Наружу отдаётся половина ширины панели: по ней график понимает, попало ли
 * нажатие в раскрытую свечу.
 */
const COL_W = 54;
const GAP = 5;

export const FOOTPRINT_HALF_W = COL_W;

/** Размер шрифта строк, точки экрана. */
const FONT_PX = 10;

/** Отступ шапки над верхней строкой. */
const HEAD_GAP = 6;

export type FootprintPalette = {
  /** Фон панели: под ним свечи соседей должны угадываться, но не мешать. */
  panel: string;
  border: string;
  /** Цвет пустой строки: объёма на этой цене не было. */
  muted: string;
  up: string;
  down: string;
  /** Полосы объёма за числами. */
  barBuy: string;
  barSell: string;
  /** Самая наторгованная цена свечи. */
  poc: string;
  /** Крупная сделка — тот же жёлтый, что у плиты в стакане. */
  gold: string;
  /** Тело и фитиль раскрытой свечи поверх строк. */
  candleUp: string;
  candleDown: string;
};

/** Раскрытая свеча в координатах экрана. */
type ReadyCandle = {
  open: number;
  close: number;
  high: number;
  low: number;
  rising: boolean;
};

type ReadyRow = {
  row: FootprintRow;
  top: number;
  bottom: number;
  center: number;
};

type Ready = {
  x: number;
  left: number;
  right: number;
  rows: ReadyRow[];
  peakSide: number;
  head: string;
  headY: number;
  headDelta: number;
  candle: ReadyCandle | null;
} | null;

class FootprintRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly ready: Ready,
    private readonly palette: FootprintPalette,
  ) {}

  draw(target: {
    useBitmapCoordinateSpace: (
      callback: (scope: {
        context: CanvasRenderingContext2D;
        horizontalPixelRatio: number;
        verticalPixelRatio: number;
      }) => void,
    ) => void;
  }) {
    const ready = this.ready;
    if (!ready || ready.rows.length === 0) return;

    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio: hx, verticalPixelRatio: vy }) => {
      const palette = this.palette;
      const line = Math.max(1, Math.round(hx));
      const x = Math.round(ready.x * hx);
      const left = Math.round(ready.left * hx);
      const right = Math.round(ready.right * hx);
      const top = Math.round(ready.rows[0].top * vy);
      const bottom = Math.round(ready.rows[ready.rows.length - 1].bottom * vy);

      // Подложка. Без неё строки читались бы поверх соседних свечей, и цифры
      // мешались бы с фитилями.
      context.fillStyle = palette.panel;
      context.fillRect(left, top, right - left, bottom - top);
      context.strokeStyle = palette.border;
      context.lineWidth = line;
      context.strokeRect(left + 0.5 * line, top + 0.5 * line, right - left - line, bottom - top - line);

      context.font = `${Math.round(FONT_PX * vy)}px ui-monospace, monospace`;
      context.textBaseline = "middle";

      // Половина панели в точках холста: полосы объёма растут от оси свечи к
      // краям, и длиннее половины быть не могут.
      const half = COL_W * hx;
      for (const { row, top: rowTop, bottom: rowBottom, center } of ready.rows) {
        const y1 = Math.round(rowTop * vy);
        const y2 = Math.round(rowBottom * vy);
        const y = center * vy;

        if (row.poc) {
          // Цена, на которой свеча простояла дольше всего: к ней она и
          // возвращается, и по ней ставят стоп.
          context.fillStyle = palette.poc;
          context.fillRect(left, y1, right - left, Math.max(1, y2 - y1));
        }

        // Полосы за числами: по ним видно перевес, не читая цифр.
        if (ready.peakSide > 0) {
          const sellW = Math.round((row.sell / ready.peakSide) * half);
          const buyW = Math.round((row.buy / ready.peakSide) * half);
          const h = Math.max(1, y2 - y1 - Math.round(vy));
          if (sellW > 0) {
            context.fillStyle = palette.barSell;
            context.fillRect(x - sellW, y1, sellW, h);
          }
          if (buyW > 0) {
            context.fillStyle = palette.barBuy;
            context.fillRect(x, y1, buyW, h);
          }
        }

        // Числа. Ноль не печатаем: пустая строка читается быстрее, чем строка
        // нулей, а профиль как раз про то, где объём есть.
        context.textAlign = "right";
        context.fillStyle = row.sell > 0 ? palette.down : palette.muted;
        if (row.sell > 0) context.fillText(money(row.sell), x - GAP * hx, y);
        context.textAlign = "left";
        context.fillStyle = row.buy > 0 ? palette.up : palette.muted;
        if (row.buy > 0) context.fillText(money(row.buy), x + GAP * hx, y);

        if (row.whale) {
          // Крупная сделка обводится, как плита в стакане: тем же жёлтым и
          // такой же рамкой — это одно и то же событие, только уже прошедшее.
          context.strokeStyle = palette.gold;
          context.lineWidth = line;
          context.strokeRect(left + line, y1 + 0.5 * line, right - left - 2 * line, Math.max(1, y2 - y1) - line);
        }

        if (row.imbalance !== 0) {
          // Перевес агрессии по диагонали: метка у края со стороны того, кто
          // передавил.
          const width = Math.max(2, Math.round(2 * hx));
          context.fillStyle = row.imbalance > 0 ? palette.up : palette.down;
          const edge = row.imbalance > 0 ? right - width : left;
          context.fillRect(edge, y1, width, Math.max(1, y2 - y1));
        }
      }

      // Сама свеча поверх строк: тонкой чертой по оси колонки. Без неё
      // непонятно, какую свечу раскрыли и куда она сходила.
      if (ready.candle) {
        const body = ready.candle.rising ? palette.candleUp : palette.candleDown;
        context.strokeStyle = body;
        context.lineWidth = line;
        context.beginPath();
        context.moveTo(x + 0.5 * line, Math.round(ready.candle.high * vy));
        context.lineTo(x + 0.5 * line, Math.round(ready.candle.low * vy));
        context.stroke();

        const bodyTop = Math.round(Math.min(ready.candle.open, ready.candle.close) * vy);
        const bodyBottom = Math.round(Math.max(ready.candle.open, ready.candle.close) * vy);
        const width = Math.max(line, Math.round(3 * hx));
        context.fillStyle = body;
        context.fillRect(x - width / 2, bodyTop, width, Math.max(line, bodyBottom - bodyTop));
      }

      // Шапка: оборот свечи и её дельта. Итоги считает сервер по всем сделкам,
      // а не по видимым строкам, — укрупнение на них не влияет.
      context.textAlign = "center";
      context.fillStyle = ready.headDelta >= 0 ? palette.up : palette.down;
      context.fillText(ready.head, x, ready.headY * vy);
      context.textAlign = "left";
      context.textBaseline = "alphabetic";
    });
  }
}

class FootprintPaneView implements IPrimitivePaneView {
  private ready: Ready = null;

  constructor(private readonly source: FootprintPrimitive) {}

  update() {
    const chart = this.source.chart;
    const series = this.source.series;
    const data = this.source.data;
    if (!chart || !series || !data || data.levels.length === 0) {
      this.ready = null;
      return;
    }

    const scale = chart.timeScale();
    const x = scale.timeToCoordinate(data.time as Time);
    if (x === null) {
      // Свечу увели за край экрана прокруткой — рисовать нечего.
      this.ready = null;
      return;
    }

    // Цена на точку экрана: по ней решаем, насколько крупными должны быть
    // строки. Меряем по самой колонке, а не по всему окну: у графика бывает
    // логарифмическая шкала, и цена точки на разной высоте разная.
    const anchor = data.levels[Math.floor(data.levels.length / 2)].price;
    const probe = data.tick * 20;
    const yA = series.priceToCoordinate(anchor);
    const yB = series.priceToCoordinate(anchor + probe);
    if (yA === null || yB === null || yA === yB) {
      this.ready = null;
      return;
    }
    const pricePerPixel = probe / Math.abs(yA - yB);

    const step = pickStep(data.tick, pricePerPixel, MIN_ROW_PX);
    const rows = markRows(foldRows(data.levels, step));
    if (rows.length === 0) {
      this.ready = null;
      return;
    }

    const ready: ReadyRow[] = [];
    for (const row of rows) {
      const top = series.priceToCoordinate(row.price + step);
      const bottom = series.priceToCoordinate(row.price);
      if (top === null || bottom === null) continue;
      ready.push({ row, top, bottom, center: (top + bottom) / 2 });
    }
    if (ready.length === 0) {
      this.ready = null;
      return;
    }

    const peakSide = rows.reduce((acc, row) => Math.max(acc, row.buy, row.sell), 0);
    const delta = data.buy - data.sell;
    const total = data.buy + data.sell;
    // «≈» вместо «Σ», когда свеча разобрана не целиком: цифра рядом всё равно
    // меньше настоящей, и выдавать её за полную нельзя.
    const sign = delta >= 0 ? "+" : "−";
    const head = `${data.partial ? "≈" : "Σ"}${money(total)}  Δ${sign}${money(Math.abs(delta))}`;

    const candleData = this.source.candle;
    let candle: ReadyCandle | null = null;
    if (candleData) {
      const open = series.priceToCoordinate(candleData.open);
      const close = series.priceToCoordinate(candleData.close);
      const high = series.priceToCoordinate(candleData.high);
      const low = series.priceToCoordinate(candleData.low);
      if (open !== null && close !== null && high !== null && low !== null) {
        candle = { open, close, high, low, rising: candleData.close >= candleData.open };
      }
    }

    this.ready = {
      x,
      left: x - COL_W,
      right: x + COL_W,
      rows: ready,
      peakSide,
      head,
      headY: ready[0].top - HEAD_GAP,
      headDelta: delta,
      candle,
    };
  }

  renderer() {
    return new FootprintRenderer(this.ready, this.source.palette);
  }

  /** Поверх всего: раскрытая свеча — это то, на что трейдер сейчас смотрит. */
  zOrder() {
    return "top" as const;
  }
}

const DEFAULT_PALETTE: FootprintPalette = {
  panel: "rgba(11,14,18,0.86)",
  border: "rgba(122,130,144,0.35)",
  muted: "rgba(122,130,144,0.4)",
  up: "#0ECB81",
  down: "#F6465D",
  barBuy: "rgba(14,203,129,0.16)",
  barSell: "rgba(246,70,93,0.16)",
  poc: "rgba(240,185,11,0.12)",
  gold: "#F0B90B",
  candleUp: "#0ECB81",
  candleDown: "#F6465D",
};

export class FootprintPrimitive implements ISeriesPrimitive<Time> {
  data: FootprintData | null = null;
  candle: Candle | null = null;
  palette: FootprintPalette = DEFAULT_PALETTE;
  chart: IChartApi | null = null;
  series: ISeriesApi<SeriesType> | null = null;

  private readonly view = new FootprintPaneView(this);
  private requestUpdate?: () => void;

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    this.chart = null;
    this.series = null;
    this.requestUpdate = undefined;
  }

  setData(data: FootprintData | null, candle: Candle | null, palette: FootprintPalette) {
    this.data = data;
    this.candle = candle;
    this.palette = palette;
    this.requestUpdate?.();
  }

  clear() {
    this.data = null;
    this.candle = null;
    this.requestUpdate?.();
  }

  updateAllViews() {
    this.view.update();
  }

  paneViews() {
    return [this.view];
  }
}

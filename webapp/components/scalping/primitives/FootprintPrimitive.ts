// Кластерная свеча: объём выбранной свечи, разложенный по ценам.
//
// Стоит она не на месте свечи, а справа от графика — в пустом поле впереди
// последней свечи. Раньше колонка вставала прямо на палочку и закрывала собой
// соседей: чтобы посмотреть, из чего собрана минута, приходилось терять из
// виду то, что было до неё. Теперь график остаётся целым, а свеча раскрывается
// рядом — так же, как стакан стоит сбоку, а не поверх цены.
//
// Строки встают на ту же ценовую сетку, что и график: строка панели и уровень
// на графике находятся на одной высоте, и до цены из панели можно дотянуться
// взглядом по горизонтали. Порядок сторон тот же, что в стакане: продажи
// слева, покупки справа, старшая цена сверху.
//
// Рисуем сами, а не средствами библиотеки: ей доступны линии и маркеры, а
// здесь нужна таблица, знающая текущий масштаб цены. Тело свечи повторяется
// внутри панели тонкой чертой по её оси — иначе непонятно, где внутри размаха
// свеча открылась и где стоит сейчас.

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
  panelLeft,
  pickStep,
  type FootprintData,
  type FootprintRow,
} from "@/lib/indicator/footprint";
import { money } from "@/lib/scalping";

/** Минимальная высота строки: меньше в неё не влезает число. */
const MIN_ROW_PX = 13;

/** Ширина одной колонки чисел: продажи слева от оси, покупки справа. */
const COL_W = 52;

/** Полная ширина панели. */
export const FOOTPRINT_W = COL_W * 2;

/** Зазор от числа до оси панели: в этом коридоре стоит тело свечи. */
const GAP = 6;

/** Отступ панели от ценовой шкалы. */
const PAD = 8;

/**
 * Шапка: две строки итогов свечи.
 *
 * Сверху стороны порознь — сколько продали и сколько купили: это два разных
 * лагеря, и складывать их в одно число значит терять главное. Ниже их итог:
 * перевес и весь оборот свечи.
 */
const HEAD_LINE = 14;
const HEAD_H = HEAD_LINE * 2;

/** Размер шрифта, точки экрана. */
const FONT_PX = 10;

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
  /** Тело и фитиль раскрытой свечи внутри панели. */
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
  /** Ось панели: от неё расходятся колонки. */
  x: number;
  left: number;
  right: number;
  /** Верх панели вместе с шапкой — по нему же считается попадание мышью. */
  top: number;
  bottom: number;
  rows: ReadyRow[];
  peakSide: number;
  /** Итоги свечи: стороны порознь сверху, перевес и оборот под ними. */
  sellText: string;
  buyText: string;
  deltaText: string;
  totalText: string;
  buyersWin: boolean;
  candle: ReadyCandle | null;
  /** Где на графике стоит раскрытая свеча. Уехала под панель — ничего. */
  markerX: number | null;
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
      const top = Math.round(ready.top * vy);
      const rowsTop = Math.round(ready.rows[0].top * vy);
      const bottom = Math.round(ready.bottom * vy);

      // Черта от свечи к панели: панель стоит в стороне, и без неё непонятно,
      // какую именно свечу разобрали. Пунктиром — это подсказка, а не данные.
      if (ready.markerX !== null) {
        const mx = Math.round(ready.markerX * hx) + 0.5 * line;
        context.save();
        context.strokeStyle = palette.border;
        context.lineWidth = line;
        context.setLineDash([3 * hx, 3 * hx]);
        context.beginPath();
        context.moveTo(mx, top);
        context.lineTo(mx, bottom);
        context.moveTo(mx, rowsTop);
        context.lineTo(left, rowsTop);
        context.stroke();
        context.restore();
      }

      // Подложка. Панель стоит в пустом поле, но при сильном отдалении свечи
      // подходят к ней вплотную: без глухого фона цифры смешались бы с ними.
      context.fillStyle = palette.panel;
      context.fillRect(left, top, right - left, bottom - top);
      context.strokeStyle = palette.border;
      context.lineWidth = line;
      context.strokeRect(left + 0.5 * line, top + 0.5 * line, right - left - line, bottom - top - line);

      context.font = `${Math.round(FONT_PX * vy)}px ui-monospace, monospace`;
      context.textBaseline = "middle";

      // Шапка. Верхняя строка - стороны порознь: слева продали, справа купили,
      // в том же порядке, что и колонки под ней. Нижняя - их итог: перевес и
      // весь оборот свечи. Итоги считает сервер по всем сделкам, а не по
      // видимым строкам, — укрупнение на них не влияет.
      const lineA = (ready.top + HEAD_LINE / 2) * vy;
      const lineB = (ready.top + HEAD_LINE * 1.5) * vy;
      const inner = GAP * hx;
      context.textAlign = "left";
      context.fillStyle = palette.down;
      context.fillText(ready.sellText, left + inner, lineA);
      context.textAlign = "right";
      context.fillStyle = palette.up;
      context.fillText(ready.buyText, right - inner, lineA);
      context.textAlign = "left";
      context.fillStyle = ready.buyersWin ? palette.up : palette.down;
      context.fillText(ready.deltaText, left + inner, lineB);
      context.textAlign = "right";
      context.fillStyle = palette.muted;
      context.fillText(ready.totalText, right - inner, lineB);
      context.beginPath();
      context.strokeStyle = palette.border;
      context.lineWidth = line;
      context.moveTo(left, rowsTop - 0.5 * line);
      context.lineTo(right, rowsTop - 0.5 * line);
      context.stroke();

      // Длина полосы: от оси до края колонки, за вычетом рамки.
      const span = (COL_W - 2) * hx;
      for (const { row, top: rowTop, bottom: rowBottom, center } of ready.rows) {
        const y1 = Math.round(rowTop * vy);
        const y2 = Math.round(rowBottom * vy);
        const y = center * vy;

        if (row.poc) {
          // Цена, на которой свеча простояла дольше всего: к ней она и
          // возвращается, и по ней ставят стоп.
          context.fillStyle = palette.poc;
          context.fillRect(left + line, y1, right - left - 2 * line, Math.max(1, y2 - y1));
        }

        // Полосы за числами: по ним видно перевес, не читая цифр.
        if (ready.peakSide > 0) {
          const sellW = Math.round((row.sell / ready.peakSide) * span);
          const buyW = Math.round((row.buy / ready.peakSide) * span);
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
        if (row.sell > 0) {
          context.textAlign = "right";
          context.fillStyle = palette.down;
          context.fillText(money(row.sell), x - GAP * hx, y);
        }
        if (row.buy > 0) {
          context.textAlign = "left";
          context.fillStyle = palette.up;
          context.fillText(money(row.buy), x + GAP * hx, y);
        }

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
          const edge = row.imbalance > 0 ? right - line - width : left + line;
          context.fillRect(edge, y1, width, Math.max(1, y2 - y1));
        }
      }

      // Сама свеча — тонкой чертой по оси панели, в коридоре между колонками.
      // Без неё панель была бы просто столбиком чисел: тело показывает, где
      // внутри размаха свеча открылась и где стоит сейчас.
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
        const width = Math.max(line, Math.round((GAP - 2) * hx));
        context.fillStyle = body;
        context.fillRect(x - width / 2, bodyTop, width, Math.max(line, bodyBottom - bodyTop));
      }

      context.textAlign = "left";
      context.textBaseline = "alphabetic";
    });
  }
}

class FootprintPaneView implements IPrimitivePaneView {
  private ready: Ready = null;

  constructor(private readonly source: FootprintPrimitive) {}

  /** Панель на экране — по ней график считает попадание мышью. */
  box() {
    const ready = this.ready;
    if (!ready) return null;
    return { left: ready.left, right: ready.right, top: ready.top, bottom: ready.bottom };
  }

  update() {
    const chart = this.source.chart;
    const series = this.source.series;
    const data = this.source.data;
    if (!chart || !series || !data || data.levels.length === 0) {
      this.ready = null;
      return;
    }

    const scale = chart.timeScale();
    const width = scale.width();
    if (!(width > 0)) {
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

    // Панель прижата к ценовой шкале и стоит впереди последней свечи. Место
    // под неё есть почти всегда: справа график держит пустое поле в полтора
    // десятка свечей — то самое, в которое уходит цена.
    const lastX = this.source.lastTime === null
      ? null
      : scale.timeToCoordinate(this.source.lastTime as Time);
    const left = panelLeft(width, FOOTPRINT_W, PAD, lastX, scale.options().barSpacing);

    const peakSide = rows.reduce((acc, row) => Math.max(acc, row.buy, row.sell), 0);
    const delta = data.buy - data.sell;
    const total = data.buy + data.sell;
    // «≈» вместо «Σ», когда свеча разобрана не целиком: цифра рядом всё равно
    // меньше настоящей, и выдавать её за полную нельзя.
    const sign = delta >= 0 ? "+" : "−";

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

    const markerX = scale.timeToCoordinate(data.time as Time);

    this.ready = {
      x: left + COL_W,
      left,
      right: left + FOOTPRINT_W,
      top: ready[0].top - HEAD_H,
      bottom: ready[ready.length - 1].bottom,
      rows: ready,
      peakSide,
      sellText: money(data.sell),
      buyText: money(data.buy),
      deltaText: `Δ${sign}${money(Math.abs(delta))}`,
      totalText: `${data.partial ? "≈" : "Σ"}${money(total)}`,
      buyersWin: delta >= 0,
      candle,
      // Черту к свече ведём, только если панель её не накрыла: под панелью
      // рисовать пунктир незачем.
      markerX: markerX !== null && markerX < left ? markerX : null,
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
  /** Время последней свечи ряда: от неё считается пустое поле справа. */
  lastTime: number | null = null;
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

  setData(
    data: FootprintData | null,
    candle: Candle | null,
    lastTime: number | null,
    palette: FootprintPalette,
  ) {
    this.data = data;
    this.candle = candle;
    this.lastTime = lastTime;
    this.palette = palette;
    this.requestUpdate?.();
  }

  clear() {
    this.data = null;
    this.candle = null;
    this.requestUpdate?.();
  }

  /** Попало ли нажатие в панель. Нажатие внутри неё сворачивает её обратно. */
  hit(x: number, y: number): boolean {
    const box = this.view.box();
    if (!box) return false;
    return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  }

  updateAllViews() {
    this.view.update();
  }

  paneViews() {
    return [this.view];
  }
}

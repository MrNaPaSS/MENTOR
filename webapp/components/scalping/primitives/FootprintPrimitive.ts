// Объём внутри свечи, нарисованный на самой свече.
//
// Панелью в углу это читалось как таблица: цифры есть, а к какой цене они
// относятся - надо вспоминать. Здесь строки стоят на ценовой шкале графика:
// строка объёма и есть та цена, на которой он прошёл, и уровень из соседней
// свечи виден без единого движения глаз.
//
// Рисует холст, а не вёрстка. Строк два десятка, каждая с двумя числами и
// подложкой, и всё это обязано ехать вместе с графиком на каждом кадре: React
// на таком перерисовывается заметно, а холст - нет. Заодно лестница живёт в
// том же слое, что свечи, и не спорит с ними за место.
//
// Укрупнение строк считается от масштаба графика: трейдер крутит колесо, и
// строки собираются в более крупный шаг сами. Рукой его можно загрубить ещё -
// множителем `grow`: на минутке биткойна триста шагов биржи, и даже на полном
// экране читать их все незачем.

import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
  UTCTimestamp,
} from "lightweight-charts";

import {
  buildRows,
  pickStep,
  type FootprintData,
  type FootprintRow,
} from "@/lib/indicator/footprint";
import { withValueArea, type ValueArea } from "@/lib/indicator/valueArea";
import { money, price as fmtPrice } from "@/lib/scalping";

/** Цвета панели: холст не понимает переменных оформления, ему нужны значения. */
export type FootprintSkin = {
  bg: string;
  border: string;
  text: string;
  muted: string;
  up: string;
  down: string;
  gold: string;
  accent: string;
};

/**
 * Ширины колонок в точках экрана.
 *
 * Цена шире сторон: у монет с мелким шагом в ней восемь знаков, и обрезанная
 * цена - это не цена. Метка справа - под три буквы VAH.
 */
const PAD = 5;
const COL_PRICE = 52;
const COL_SIDE = 44;
const COL_PROFILE = 26;
const COL_TAG = 20;
const WIDTH = PAD * 2 + COL_PRICE + COL_SIDE * 2 + COL_PROFILE + COL_TAG;

/**
 * Минимальная высота строки, точки.
 *
 * Строка - это строка текста: тоньше двенадцати точек цифры в ней сливаются в
 * серую полосу. По этому числу и решается, во сколько биржевых шагов собрать
 * строку на текущем масштабе.
 */
const MIN_ROW = 13;

/** Насколько густа подложка самой крупной ячейки свечи. */
const HEAT_MAX = 0.55;
const HEAT_MIN = 0.08;

type ReadyRow = {
  top: number;
  height: number;
  price: string;
  sell: string;
  buy: string;
  sellHeat: number;
  buyHeat: number;
  sellBold: boolean;
  buyBold: boolean;
  share: number;
  poc: boolean;
  value: boolean;
  whale: boolean;
  tag: string;
};

type Ready = {
  x: number;
  rows: ReadyRow[];
  /** Цены границ области стоимости на экране: линии уходят от панели вправо. */
  marks: { y: number; color: string; dashed: boolean }[];
  right: number;
} | null;

class FootprintRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly ready: Ready,
    private readonly skin: FootprintSkin,
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

    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hx, verticalPixelRatio: vy }) => {
      const skin = this.skin;
      const line = Math.max(1, Math.round(hx));
      const x = Math.round(ready.x * hx);
      const width = Math.round(WIDTH * hx);
      const top = Math.round(ready.rows[0].top * vy);
      const last = ready.rows[ready.rows.length - 1];
      const bottom = Math.round((last.top + last.height) * vy);

      // Линии области стоимости уходят вправо от панели через весь холст:
      // цену, на которой рынок стоял, ищут глазами не в свече, а там, куда он
      // пришёл потом.
      for (const mark of ready.marks) {
        ctx.strokeStyle = mark.color;
        ctx.lineWidth = line;
        ctx.setLineDash(mark.dashed ? [3 * hx, 3 * hx] : []);
        ctx.beginPath();
        const y = Math.round(mark.y * vy) + 0.5;
        ctx.moveTo(x + width, y);
        ctx.lineTo(ready.right * hx, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Подложка: свечи под лестницей должны просвечивать, но не мешать
      // читать. Прозрачнее - и цифры ложатся на фитили, плотнее - и панель
      // становится тем же окном, только приклеенным к свече.
      ctx.globalAlpha = 0.93;
      ctx.fillStyle = skin.bg;
      ctx.fillRect(x, top, width, bottom - top);
      ctx.globalAlpha = 1;

      const font = (size: number, bold = false) =>
        `${bold ? "700 " : ""}${Math.round(size * vy)}px ui-monospace, monospace`;
      const sellX = x + Math.round((PAD + COL_PRICE) * hx);
      const buyX = sellX + Math.round(COL_SIDE * hx);
      const profX = buyX + Math.round(COL_SIDE * hx);
      const tagX = profX + Math.round(COL_PROFILE * hx);

      ctx.textBaseline = "middle";

      for (const row of ready.rows) {
        const y = Math.round(row.top * vy);
        const h = Math.max(line, Math.round(row.height * vy));
        const middle = y + h / 2;

        // Тепловые ячейки сторон. Густота - это и есть ответ на «сколько»:
        // цифру читают, когда уже увидели, где густо.
        if (row.sellHeat > 0) {
          ctx.globalAlpha = row.sellHeat;
          ctx.fillStyle = skin.down;
          ctx.fillRect(sellX, y, Math.round(COL_SIDE * hx), h);
        }
        if (row.buyHeat > 0) {
          ctx.globalAlpha = row.buyHeat;
          ctx.fillStyle = skin.up;
          ctx.fillRect(buyX, y, Math.round(COL_SIDE * hx), h);
        }
        ctx.globalAlpha = 1;

        // Профиль строки: её оборот целиком. Внутри области стоимости цветом,
        // снаружи серым - видно, где рынок стоял, а где пробежал на пустоте.
        const bar = Math.max(line, Math.round(row.share * (COL_PROFILE - 4) * hx));
        ctx.fillStyle = row.poc ? skin.gold : row.value ? skin.accent : skin.border;
        ctx.fillRect(profX, y + h / 2 - line, bar, Math.max(line, 2 * line));

        ctx.textAlign = "right";
        ctx.font = font(10);
        // Крупная сделка - тем же жёлтым, что плита в стакане: это одно и то
        // же событие, только уже прошедшее.
        ctx.fillStyle = row.whale ? skin.gold : skin.muted;
        ctx.fillText(row.price, x + Math.round((PAD + COL_PRICE - 4) * hx), middle);

        // Чернила у чисел общие: сторону называет подложка, а красное на
        // красном читается хуже, чем то же число обычным цветом панели.
        ctx.fillStyle = skin.text;
        ctx.font = font(10, row.sellBold);
        ctx.fillText(row.sell, sellX + Math.round((COL_SIDE - 4) * hx), middle);
        ctx.font = font(10, row.buyBold);
        ctx.fillText(row.buy, buyX + Math.round((COL_SIDE - 4) * hx), middle);

        if (row.tag) {
          ctx.textAlign = "left";
          ctx.font = font(8);
          ctx.fillStyle = row.poc ? skin.gold : skin.muted;
          ctx.fillText(row.tag, tagX, middle);
        }

        // Самая наторгованная цена - рамкой, а не заливкой: залитая строка
        // перекрашивает под собой обе ячейки, и то, чем эта цена стала
        // главной, на ней уже не разглядеть.
        if (row.poc) {
          ctx.strokeStyle = skin.gold;
          ctx.lineWidth = line;
          ctx.strokeRect(x + 0.5 * line, y + 0.5 * line, width - line, h - line);
        }
      }

      ctx.textAlign = "left";
      ctx.strokeStyle = skin.border;
      ctx.lineWidth = line;
      ctx.strokeRect(x + 0.5 * line, top + 0.5 * line, width - line, bottom - top - line);
    });
  }
}

class FootprintPaneView implements IPrimitivePaneView {
  private ready: Ready = null;

  constructor(private readonly source: FootprintPrimitive) {}

  update() {
    this.ready = null;
    const chart = this.source.chart;
    const series = this.source.series;
    const data = this.source.data;
    if (!chart || !series || !data || data.levels.length === 0) return;

    const scale = chart.timeScale();
    const x = scale.timeToCoordinate(data.time as UTCTimestamp);
    if (x === null) return;

    // Цена одной точки экрана. Спрашиваем у самого ряда: масштаб он держит
    // сам, и считать его по видимому диапазону значило бы разойтись с ним
    // ровно на автоподгонке.
    const near = series.coordinateToPrice(100);
    const far = series.coordinateToPrice(200);
    if (near === null || far === null) return;
    const perPixel = Math.abs(Number(near) - Number(far)) / 100;
    if (!(perPixel > 0)) return;

    const minRow = MIN_ROW * Math.max(1, this.source.grow);
    const step = pickStep(data.tick, perPixel, minRow);
    const marked = buildRows(data, perPixel, minRow);
    if (marked.length === 0 || !(step > 0)) return;

    const { rows, area } = withValueArea(marked);
    const peak = rows.reduce((acc, row) => Math.max(acc, row.buy, row.sell), 0);
    const peakTotal = rows.reduce((acc, row) => Math.max(acc, row.total), 0);

    const height = chart.paneSize().height;
    const ready: ReadyRow[] = [];
    for (const row of rows) {
      const bottom = series.priceToCoordinate(row.price);
      const top = series.priceToCoordinate(row.price + step);
      if (bottom === null || top === null) continue;
      // Строка целиком за краем холста - её не рисуем: она всё равно не видна,
      // а холст на неё тратится.
      if (bottom < 0 || top > height) continue;
      ready.push({
        top,
        height: bottom - top,
        price: fmtPrice(row.price, data.tick),
        sell: row.sell > 0 ? money(row.sell) : "·",
        buy: row.buy > 0 ? money(row.buy) : "·",
        sellHeat: heat(row.sell, peak),
        buyHeat: heat(row.buy, peak),
        sellBold: row.imbalance < 0,
        buyBold: row.imbalance > 0,
        share: peakTotal > 0 ? row.total / peakTotal : 0,
        poc: row.poc,
        value: row.value,
        whale: row.whale,
        tag: row.edge ? TAG[row.edge] : "",
      });
    }
    if (ready.length === 0) return;

    this.ready = {
      x,
      rows: ready,
      marks: marks(series, area, this.source.skin),
      right: scale.width(),
    };
  }

  renderer() {
    return new FootprintRenderer(this.ready, this.source.skin);
  }

  /** Поверх свечей: лестница - это то, из чего свеча собрана. */
  zOrder() {
    return "top" as const;
  }
}

const TAG = { vah: "VAH", poc: "POC", val: "VAL" } as const;

/**
 * Густота подложки.
 *
 * Корнем от доли, а не долей: на свече, где одна плита вдесятеро больше
 * соседей, доля кладёт все остальные строки в один бледный тон, и лестница
 * перестаёт быть лестницей. Нижний край не нулевой - строка, где прошла хоть
 * одна сделка, обязана отличаться от пустой.
 */
function heat(value: number, peak: number): number {
  if (!(peak > 0) || !(value > 0)) return 0;
  return HEAT_MIN + HEAT_MAX * Math.sqrt(value / peak);
}

/** Линии границ области стоимости. POC сплошной, края - пунктиром. */
function marks(
  series: ISeriesApi<SeriesType>,
  area: ValueArea | null,
  skin: FootprintSkin,
): { y: number; color: string; dashed: boolean }[] {
  if (!area) return [];
  const out: { y: number; color: string; dashed: boolean }[] = [];
  const put = (price: number, color: string, dashed: boolean) => {
    const y = series.priceToCoordinate(price);
    if (y !== null) out.push({ y, color, dashed });
  };
  put(area.vah, skin.accent, true);
  put(area.val, skin.accent, true);
  put(area.poc, skin.gold, false);
  return out;
}

export class FootprintPrimitive implements ISeriesPrimitive<Time> {
  data: FootprintData | null = null;
  grow = 1;
  skin: FootprintSkin = {
    bg: "#181a20",
    border: "#2b3139",
    text: "#eaecef",
    muted: "#7a8290",
    up: "#0ecb81",
    down: "#f6465d",
    gold: "#f0b90b",
    accent: "#0affe0",
  };
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

  setData(data: FootprintData | null, grow: number, skin: FootprintSkin) {
    this.data = data;
    this.grow = grow;
    this.skin = skin;
    this.requestUpdate?.();
  }

  clear() {
    this.data = null;
    this.requestUpdate?.();
  }

  updateAllViews() {
    this.view.update();
  }

  paneViews() {
    return [this.view];
  }
}

/** Ширина лестницы в точках: по ней страница считает, куда встанет подпись. */
export const FOOTPRINT_WIDTH = WIDTH;

/** Не используется примитивом, но нужен странице для той же арифметики строк. */
export type { FootprintRow };

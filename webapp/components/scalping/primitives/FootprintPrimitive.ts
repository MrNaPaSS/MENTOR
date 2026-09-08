// Свеча, разобранная на след покупателя и след продавца.
//
// Свеча говорит, куда цена сходила, и молчит о том, чем ход подкреплён. Здесь
// она нарисована крупно и неподвижно - своей меркой, а не меркой графика, - и
// от неё в обе стороны расходятся следы: влево, красным, продали; вправо,
// зелёным, купили. Длина следа - деньги на этой цене, густота - его же доля.
// Свеча с одной плитой у низа и свеча, набранная ровным потоком, различаются с
// одного взгляда, не читая ни одной цифры.
//
// Неподвижная мерка - главное здесь. Строки, привязанные к ценовой шкале,
// тончают вместе с масштабом и на обычном зуме превращаются в серую щётку;
// картинка же свечи обязана читаться всегда одинаково. Поэтому высота строки
// задана в точках, а цены раскладываются внутри картинки сами.
//
// Рисует холст, а не вёрстка: два десятка строк со следами и цифрами едут
// вместе с графиком на каждом кадре, и React на таком перерисовывается
// заметно.

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
  foldRows,
  markRows,
  stepForRows,
  type FootprintData,
} from "@/lib/indicator/footprint";
import { withValueArea } from "@/lib/indicator/valueArea";
import { money, price as fmtPrice } from "@/lib/scalping";
import type { Candle } from "@/lib/indicator/types";

/** Цвета картинки: холст не понимает переменных оформления, ему нужны значения. */
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

/** Ширина следа в каждую сторону, точки. */
const SIDE = 104;
/** Ширина тела свечи. Уже - и она перестаёт быть свечой, шире - лезет в следы. */
const CANDLE = 18;
/** Колонка цены справа от следов. У монет с мелким шагом в цене восемь знаков. */
const PRICE = 52;
const GAP = 6;
const PAD = 6;
const WIDTH = PAD * 2 + SIDE * 2 + CANDLE + GAP + PRICE;

/** Высота строки в точках. Ниже одиннадцати цифры в ней сливаются. */
const ROW = 14;
const ROW_MIN = 11;

/**
 * Сколько строк показывает картинка на обычной крупности.
 *
 * Свеча на триста биржевых шагов в столбик не влезает ни на каком экране, а
 * прокручиваемая лента цифр перестаёт быть картинкой свечи. Ступени крупности
 * делят это число: вдвое грубее - вдвое меньше строк, зато каждая весомее.
 */
const ROWS = 28;

/** Насколько густ самый длинный след. Короткие остаются заметно бледнее. */
const HEAT_MIN = 0.3;
const HEAT_MAX = 0.6;

type ReadyRow = {
  top: number;
  height: number;
  price: string;
  sell: string;
  buy: string;
  sellLen: number;
  buyLen: number;
  sellHeat: number;
  buyHeat: number;
  sellBold: boolean;
  buyBold: boolean;
  poc: boolean;
  value: boolean;
  whale: boolean;
  tag: string;
};

type ReadyCandle = {
  wickTop: number;
  wickBottom: number;
  bodyTop: number;
  bodyBottom: number;
  rising: boolean;
};

type Ready = {
  x: number;
  y: number;
  height: number;
  rows: ReadyRow[];
  candle: ReadyCandle | null;
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
      const y = Math.round(ready.y * vy);
      const width = Math.round(WIDTH * hx);
      const height = Math.round(ready.height * vy);

      // Ось свечи: от неё расходятся оба следа, и она же середина тела.
      const axis = x + Math.round((PAD + SIDE + CANDLE / 2) * hx);
      const bodyLeft = x + Math.round((PAD + SIDE) * hx);
      const bodyRight = bodyLeft + Math.round(CANDLE * hx);
      const priceLeft = bodyRight + Math.round((SIDE + GAP) * hx);

      // Подложка: свечи графика под картинкой должны просвечивать, но не
      // мешать читать. Прозрачнее - и цифры ложатся на чужие фитили, плотнее -
      // и картинка становится тем же окном, только приклеенным к свече.
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = skin.bg;
      ctx.fillRect(x, y, width, height);
      ctx.globalAlpha = 1;

      const font = (size: number, bold = false) =>
        `${bold ? "700 " : ""}${Math.round(size * vy)}px ui-monospace, monospace`;
      ctx.textBaseline = "middle";

      for (const row of ready.rows) {
        const top = Math.round(row.top * vy);
        const h = Math.max(line, Math.round(row.height * vy));
        // Полторы точки зазора между строками: сплошная заливка от края до
        // края превращает два десятка следов в один цветной прямоугольник.
        const barTop = top + Math.round(1 * vy);
        const barH = Math.max(line, h - Math.round(2 * vy));
        const middle = top + h / 2;

        if (row.sellLen > 0) {
          ctx.globalAlpha = row.sellHeat;
          ctx.fillStyle = skin.down;
          const len = Math.max(line, Math.round(row.sellLen * hx));
          ctx.fillRect(bodyLeft - len, barTop, len, barH);
        }
        if (row.buyLen > 0) {
          ctx.globalAlpha = row.buyHeat;
          ctx.fillStyle = skin.up;
          ctx.fillRect(bodyRight, barTop, Math.max(line, Math.round(row.buyLen * hx)), barH);
        }
        ctx.globalAlpha = 1;

        // Цифры у самой свечи, лицом наружу: след растёт от неё, и число
        // стоит в его начале - там, где оно есть у каждой строки, даже самой
        // короткой.
        ctx.fillStyle = skin.text;
        ctx.textAlign = "right";
        ctx.font = font(10, row.sellBold);
        ctx.fillText(row.sell, bodyLeft - Math.round(3 * hx), middle);
        ctx.textAlign = "left";
        ctx.font = font(10, row.buyBold);
        ctx.fillText(row.buy, bodyRight + Math.round(3 * hx), middle);

        // Цена справа. Крупная сделка - тем же жёлтым, что плита в стакане:
        // это одно и то же событие, только уже прошедшее.
        ctx.textAlign = "right";
        ctx.font = font(10);
        ctx.fillStyle = row.whale ? skin.gold : skin.muted;
        ctx.fillText(row.price, priceLeft + Math.round((PRICE - 2) * hx), middle);

        if (row.tag) {
          ctx.textAlign = "left";
          ctx.font = font(8);
          ctx.fillStyle = row.poc ? skin.gold : skin.accent;
          ctx.fillText(row.tag, priceLeft - Math.round(1 * hx), middle);
        }

        // Граница области стоимости - чертой во всю картинку: по ней видно,
        // где рынок согласился торговать, а где пробежал на пустоте.
        if (row.tag && !row.poc) {
          ctx.strokeStyle = skin.accent;
          ctx.lineWidth = line;
          ctx.setLineDash([3 * hx, 3 * hx]);
          ctx.beginPath();
          const edge = Math.round(top) + 0.5;
          ctx.moveTo(x, edge);
          ctx.lineTo(x + width, edge);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Самая наторгованная цена - рамкой, а не заливкой: залитая строка
        // перекрашивает под собой оба следа, и то, чем эта цена стала
        // главной, на ней уже не разглядеть.
        if (row.poc) {
          ctx.strokeStyle = skin.gold;
          ctx.lineWidth = line;
          ctx.strokeRect(x + 0.5 * line, top + 0.5 * line, width - line, h - line);
        }
      }

      // Свеча поверх следов: она здесь предмет разговора, а следы - объяснение.
      const candle = ready.candle;
      if (candle) {
        const color = candle.rising ? skin.up : skin.down;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = line;
        ctx.beginPath();
        ctx.moveTo(axis, Math.round(candle.wickTop * vy));
        ctx.lineTo(axis, Math.round(candle.wickBottom * vy));
        ctx.stroke();

        const bodyTop = Math.round(candle.bodyTop * vy);
        const bodyH = Math.max(line, Math.round((candle.bodyBottom - candle.bodyTop) * vy));
        ctx.fillRect(bodyLeft, bodyTop, bodyRight - bodyLeft, bodyH);
      }

      ctx.textAlign = "left";
      ctx.strokeStyle = skin.border;
      ctx.lineWidth = line;
      ctx.strokeRect(x + 0.5 * line, y + 0.5 * line, width - line, height - line);
    });
  }
}

const TAG = { vah: "VAH", poc: "", val: "VAL" } as const;

class FootprintPaneView implements IPrimitivePaneView {
  private ready: Ready = null;

  constructor(private readonly source: FootprintPrimitive) {}

  update() {
    this.ready = null;
    this.source.box = null;

    const chart = this.source.chart;
    const series = this.source.series;
    const data = this.source.data;
    if (!chart || !series || !data || data.levels.length === 0) return;

    const prices = data.levels.map((level) => level.price);
    const lowest = Math.min(...prices);
    const span = Math.max(...prices) - lowest;
    // Крупность: ступень делит число строк, а не шаг цены. Так на любой монете
    // «вдвое грубее» означает одно и то же - вдвое меньше строк.
    const budget = Math.max(4, Math.round(ROWS / Math.max(1, this.source.grow)));
    const step = stepForRows(data.tick, span, budget);
    if (!(step > 0)) return;

    const { rows } = withValueArea(markRows(foldRows(data.levels, step)));
    if (rows.length === 0) return;

    const pane = chart.paneSize();
    // Строка ужимается, только если картинка не влезает в холст целиком:
    // обрезанная снизу свеча врёт о том, где она кончилась.
    const room = Math.max(1, pane.height - 24);
    const rowHeight = Math.max(ROW_MIN, Math.min(ROW, room / rows.length));
    const height = rowHeight * rows.length;

    const peakSide = rows.reduce((acc, row) => Math.max(acc, row.buy, row.sell), 0);
    // Границы картинки по цене: верх верхней строки и низ нижней. По ним же
    // раскладывается свеча, иначе её тело разойдётся со следами.
    const top = rows[0].price + step;
    const bottom = rows[rows.length - 1].price;
    const perPixel = top > bottom ? height / (top - bottom) : 0;

    const ready: ReadyRow[] = rows.map((row, i) => ({
      top: i * rowHeight,
      height: rowHeight,
      price: fmtPrice(row.price, data.tick),
      sell: row.sell > 0 ? money(row.sell) : "·",
      buy: row.buy > 0 ? money(row.buy) : "·",
      sellLen: length(row.sell, peakSide),
      buyLen: length(row.buy, peakSide),
      sellHeat: heat(row.sell, peakSide),
      buyHeat: heat(row.buy, peakSide),
      sellBold: row.imbalance < 0,
      buyBold: row.imbalance > 0,
      poc: row.poc,
      value: row.value,
      whale: row.whale,
      tag: row.edge ? TAG[row.edge] : "",
    }));

    const candle = this.source.candle;
    const at = (price: number) => (top - price) * perPixel;
    const shape: ReadyCandle | null =
      candle && perPixel > 0
        ? {
            wickTop: at(candle.high),
            wickBottom: at(candle.low),
            bodyTop: at(Math.max(candle.open, candle.close)),
            bodyBottom: at(Math.min(candle.open, candle.close)),
            rising: candle.close >= candle.open,
          }
        : null;

    // Где встанет картинка. Справа от своей свечи, если справа есть место:
    // слева от неё история цены, ради которой на график и смотрят. Не влезла -
    // уходит влево, и в любом случае целиком остаётся на холсте.
    const scale = chart.timeScale();
    const anchor = scale.timeToCoordinate(data.time as UTCTimestamp);
    if (anchor === null) return;
    const spacing = scale.options().barSpacing;
    let x = anchor + spacing;
    if (x + WIDTH > pane.width - 4) x = anchor - spacing - WIDTH;
    x = Math.max(4, Math.min(x, pane.width - WIDTH - 4));

    const middle = series.priceToCoordinate((top + bottom) / 2);
    const y = Math.max(
      4,
      Math.min((middle ?? pane.height / 2) - height / 2, pane.height - height - 4),
    );

    this.ready = {
      x,
      y,
      height,
      rows: ready.map((row) => ({ ...row, top: row.top + y })),
      candle: shape ? shift(shape, y) : null,
    };
    this.source.box = { x, y, width: WIDTH, height };
  }

  renderer() {
    return new FootprintRenderer(this.ready, this.source.skin);
  }

  /** Поверх свечей: картинка - это разбор одной из них, а не фон под ними. */
  zOrder() {
    return "top" as const;
  }
}

function shift(shape: ReadyCandle, by: number): ReadyCandle {
  return {
    wickTop: shape.wickTop + by,
    wickBottom: shape.wickBottom + by,
    bodyTop: shape.bodyTop + by,
    bodyBottom: shape.bodyBottom + by,
    rising: shape.rising,
  };
}

/**
 * Длина следа.
 *
 * Корнем от доли, а не долей: на свече, где одна плита вдесятеро больше
 * соседей, доля оставляет от всех остальных следов по два пикселя, и картинка
 * превращается в одну полосу посреди пустоты.
 */
function length(value: number, peak: number): number {
  if (!(peak > 0) || !(value > 0)) return 0;
  return SIDE * Math.sqrt(value / peak);
}

/** Густота следа. Короткий обязан быть и бледнее: иначе длину не видно вовсе. */
function heat(value: number, peak: number): number {
  if (!(peak > 0) || !(value > 0)) return 0;
  return HEAT_MIN + HEAT_MAX * Math.sqrt(value / peak);
}

export class FootprintPrimitive implements ISeriesPrimitive<Time> {
  data: FootprintData | null = null;
  candle: Candle | null = null;
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
  /** Место картинки на холсте: по нему страница ставит подпись над ней. */
  box: { x: number; y: number; width: number; height: number } | null = null;
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

  setData(data: FootprintData | null, candle: Candle | null, grow: number, skin: FootprintSkin) {
    this.data = data;
    this.candle = candle;
    this.grow = grow;
    this.skin = skin;
    this.requestUpdate?.();
  }

  clear() {
    this.data = null;
    this.candle = null;
    this.box = null;
    this.requestUpdate?.();
  }

  updateAllViews() {
    this.view.update();
  }

  paneViews() {
    return [this.view];
  }
}

/** Ширина картинки в точках: по ней страница равняет подпись над ней. */
export const FOOTPRINT_WIDTH = WIDTH;

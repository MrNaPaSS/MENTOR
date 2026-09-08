// Свеча, разобранная на след покупателя и след продавца.
//
// Свеча говорит, куда цена сходила, и молчит о том, чем ход подкреплён. Здесь
// она нарисована крупно и неподвижно - своей меркой, а не меркой графика.
// Посередине идут цены, по обе стороны от них - деньги: слева красным продали,
// справа зелёным купили. Ячейка у цены есть всегда, а за её край уходит след,
// длина которого и есть объём. Свеча с одной плитой у низа и свеча, набранная
// ровным потоком, различаются с одного взгляда, не читая ни одной цифры.
//
// Тело свечи - рамка вокруг лестницы: от цены открытия до цены закрытия.
// Фитили торчат из неё вверх и вниз, к максимуму и минимуму. Так это и есть
// свеча, а не таблица рядом со свечой: видно, какая часть хода пришлась на
// тело, а какую цена только пощупала и вернулась.
//
// Растёт картинка сама. Только что открытая свеча стоит на одной цене - у неё
// одна строка; за минуту их набирается десяток, за час - сотня, и они
// собираются в более крупный шаг, чтобы остаться читаемыми. Ничего для этого
// делать не надо: строки - это цены, на которых прошли сделки.
//
// Неподвижная мерка здесь главное. Строки, привязанные к ценовой шкале,
// тончают вместе с масштабом и на обычном зуме превращаются в серую щётку;
// картинка же обязана читаться всегда одинаково. Поэтому высота строки задана
// в точках, а цены раскладываются внутри картинки сами.
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
import {
  cellHeat,
  rowBudget,
  rowHeight,
  traceTail,
} from "@/lib/indicator/footprintLayout";
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

/** Колонка цены. Посередине: цена - это то, к чему относятся оба числа рядом. */
const PRICE = 54;
/** Колонка числа по каждую сторону от цены. */
const NUM = 44;
/** Ядро - то, что обводит тело свечи: цена и оба числа. */
const CORE = PRICE + NUM * 2;
/** Насколько далеко за ядро уходит самый длинный след. */
const SIDE = 84;
const PAD = 6;
const WIDTH = PAD * 2 + SIDE * 2 + CORE;

/** Место под фитиль и подпись края там, где свеча выходит за лестницу. */
const TAIL = 16;

type ReadyRow = {
  top: number;
  height: number;
  price: string;
  sell: string;
  buy: string;
  /** Насколько след вылезает за ядро, точки. */
  sellTail: number;
  buyTail: number;
  sellHeat: number;
  buyHeat: number;
  sellBold: boolean;
  buyBold: boolean;
  poc: boolean;
  whale: boolean;
  /** Граница области стоимости: подпись и черта у верхнего или нижнего края. */
  edge: "vah" | "val" | null;
};

type ReadyCandle = {
  wickTop: number;
  wickBottom: number;
  bodyTop: number;
  bodyBottom: number;
  rising: boolean;
  high: string;
  low: string;
};

type Ready = {
  x: number;
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
      const width = Math.round(WIDTH * hx);

      const coreLeft = x + Math.round((PAD + SIDE) * hx);
      const priceLeft = coreLeft + Math.round(NUM * hx);
      const priceRight = priceLeft + Math.round(PRICE * hx);
      const coreRight = priceRight + Math.round(NUM * hx);
      // Ось свечи - середина колонки цены: фитиль обязан выходить из неё же,
      // иначе тело и фитиль читаются как две разные фигуры.
      const axis = Math.round((priceLeft + priceRight) / 2);

      // Подложки нет намеренно: картинка лежит прямо на графике, и сетка со
      // свечами просвечивает сквозь неё. Прямоугольник цвета панели превращал
      // разбор свечи в то же окно, только приклеенное к ней.
      const font = (size: number, bold = false) =>
        `${bold ? "700 " : ""}${Math.round(size * vy)}px ui-monospace, monospace`;
      ctx.textBaseline = "middle";

      /** Число с каймой цвета панели: на голом графике иначе не прочесть. */
      const ink = (text: string, atX: number, atY: number) => {
        ctx.strokeStyle = skin.bg;
        ctx.lineWidth = Math.max(line, Math.round(2.5 * hx));
        ctx.lineJoin = "round";
        ctx.strokeText(text, atX, atY);
        ctx.fillText(text, atX, atY);
      };

      for (const row of ready.rows) {
        const top = Math.round(row.top * vy);
        const h = Math.max(line, Math.round(row.height * vy));
        // Точка зазора между строками: сплошная заливка от края до края
        // превращает два десятка ячеек в один цветной прямоугольник.
        const cellTop = top + Math.round(1 * vy);
        const cellH = Math.max(line, h - Math.round(2 * vy));
        const middle = top + h / 2;

        // Ячейка у цены есть всегда - на ней стоит число; за край ядра уходит
        // след, и вот он уже про деньги. Одним прямоугольником: стык двух
        // заливок с одинаковой прозрачностью виден полосой.
        if (row.sellHeat > 0) {
          ctx.globalAlpha = row.sellHeat;
          ctx.fillStyle = skin.down;
          const tail = Math.round(row.sellTail * hx);
          ctx.fillRect(coreLeft - tail, cellTop, priceLeft - coreLeft + tail, cellH);
        }
        if (row.buyHeat > 0) {
          ctx.globalAlpha = row.buyHeat;
          ctx.fillStyle = skin.up;
          const tail = Math.round(row.buyTail * hx);
          ctx.fillRect(priceRight, cellTop, coreRight - priceRight + tail, cellH);
        }
        ctx.globalAlpha = 1;

        ctx.fillStyle = skin.text;
        ctx.textAlign = "right";
        ctx.font = font(10, row.sellBold);
        ink(row.sell, priceLeft - Math.round(4 * hx), middle);
        ctx.textAlign = "left";
        ctx.font = font(10, row.buyBold);
        ink(row.buy, priceRight + Math.round(4 * hx), middle);

        // Цена посередине. Крупная сделка - тем же жёлтым, что плита в
        // стакане: это одно и то же событие, только уже прошедшее.
        ctx.textAlign = "center";
        ctx.font = font(10);
        ctx.fillStyle = row.whale ? skin.gold : skin.muted;
        ink(row.price, axis, middle);

        // Граница области стоимости - чертой во всю ширину: по ней видно, где
        // рынок согласился торговать, а где пробежал на пустоте. Верхняя идёт
        // по верху своей строки, нижняя по низу: это края, а не сами строки.
        if (row.edge) {
          const edge = (row.edge === "vah" ? top : top + h) + 0.5 * line;
          ctx.strokeStyle = skin.accent;
          ctx.lineWidth = line;
          ctx.setLineDash([3 * hx, 3 * hx]);
          ctx.beginPath();
          ctx.moveTo(x, edge);
          ctx.lineTo(x + width, edge);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = skin.accent;
          ctx.font = font(8);
          ctx.textAlign = "right";
          ctx.textBaseline = row.edge === "vah" ? "bottom" : "top";
          ink(row.edge === "vah" ? "VAH" : "VAL", x + width - Math.round(2 * hx), edge);
          ctx.textBaseline = "middle";
        }

        // Самая наторгованная цена - рамкой вокруг ядра, а не заливкой:
        // залитая строка перекрашивает под собой оба следа, и то, чем эта цена
        // стала главной, на ней уже не разглядеть.
        if (row.poc) {
          ctx.strokeStyle = skin.gold;
          ctx.lineWidth = line;
          ctx.strokeRect(coreLeft + 0.5 * line, top + 0.5 * line, coreRight - coreLeft - line, h - line);
        }
      }

      // Свеча поверх следов: она здесь предмет разговора, а следы - объяснение.
      //
      // Тело - рамкой вокруг ядра: залитое, оно закрыло бы собой всю лестницу,
      // ради которой картинку и открыли. Фитили рисуются только там, где они
      // торчат из тела, - внутри него фитиля не бывает.
      const candle = ready.candle;
      if (candle) {
        const color = candle.rising ? skin.up : skin.down;
        const bodyTop = Math.round(candle.bodyTop * vy);
        const bodyBottom = Math.round(candle.bodyBottom * vy);
        const wickTop = Math.round(candle.wickTop * vy);
        const wickBottom = Math.round(candle.wickBottom * vy);

        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(line, Math.round(1.5 * hx));
        if (wickTop < bodyTop) {
          ctx.beginPath();
          ctx.moveTo(axis + 0.5 * line, wickTop);
          ctx.lineTo(axis + 0.5 * line, bodyTop);
          ctx.stroke();
        }
        if (wickBottom > bodyBottom) {
          ctx.beginPath();
          ctx.moveTo(axis + 0.5 * line, bodyBottom);
          ctx.lineTo(axis + 0.5 * line, wickBottom);
          ctx.stroke();
        }

        ctx.strokeRect(
          coreLeft + 0.5 * line,
          bodyTop + 0.5 * line,
          coreRight - coreLeft - line,
          Math.max(line, bodyBottom - bodyTop) - line,
        );

        // Края хода подписаны: максимум над верхним фитилём, минимум под
        // нижним. Без них картинка молчит о том, докуда цена дотянулась.
        ctx.fillStyle = skin.muted;
        ctx.font = font(9);
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ink(candle.high, axis, wickTop - Math.round(3 * vy));
        ctx.textBaseline = "top";
        ink(candle.low, axis, wickBottom + Math.round(3 * vy));
        ctx.textBaseline = "middle";
      }

      ctx.textAlign = "left";
    });
  }
}

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
    const span = Math.max(...prices) - Math.min(...prices);
    // Крупность: ступень делит число строк, а не шаг цены. Так на любой монете
    // «вдвое грубее» означает одно и то же - вдвое меньше строк.
    const budget = rowBudget(this.source.grow);
    const step = stepForRows(data.tick, span, budget);
    if (!(step > 0)) return;

    const { rows } = withValueArea(markRows(foldRows(data.levels, step)));
    if (rows.length === 0) return;

    const pane = chart.paneSize();
    // Строка ужимается, только если картинка не влезает в холст целиком:
    // обрезанная снизу свеча врёт о том, где она кончилась.
    const room = Math.max(1, pane.height - TAIL * 2 - 8);
    const tall = rowHeight(rows.length, room);
    const height = tall * rows.length;

    const peak = rows.reduce((acc, row) => Math.max(acc, row.buy, row.sell), 0);
    // Границы картинки по цене: верх верхней строки и низ нижней. По ним же
    // раскладывается свеча, иначе её тело разойдётся со строками.
    const top = rows[0].price + step;
    const bottom = rows[rows.length - 1].price;
    const perPixel = top > bottom ? height / (top - bottom) : 0;

    const laid: ReadyRow[] = rows.map((row, i) => ({
      top: i * tall,
      height: tall,
      price: fmtPrice(row.price, data.tick),
      sell: row.sell > 0 ? money(row.sell) : "·",
      buy: row.buy > 0 ? money(row.buy) : "·",
      sellTail: traceTail(row.sell, peak, SIDE),
      buyTail: traceTail(row.buy, peak, SIDE),
      sellHeat: cellHeat(row.sell, peak),
      buyHeat: cellHeat(row.buy, peak),
      sellBold: row.imbalance < 0,
      buyBold: row.imbalance > 0,
      poc: row.poc,
      whale: row.whale,
      edge: row.edge === "vah" || row.edge === "val" ? row.edge : null,
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
            high: fmtPrice(candle.high, data.tick),
            low: fmtPrice(candle.low, data.tick),
          }
        : null;

    // Свеча выходит за лестницу настолько, насколько её край не совпал с краем
    // строки. Место под этот вылет и под подписи краёв держим всегда: иначе
    // картинка у верха холста обрезается ровно по максимуму хода.
    const over = Math.max(TAIL, shape ? TAIL - Math.min(0, shape.wickTop) : TAIL);
    const under = Math.max(
      TAIL,
      shape ? TAIL + Math.max(0, shape.wickBottom - height) : TAIL,
    );

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

    // По вертикали - вокруг середины своей свечи: разбор обязан стоять там же,
    // где цена, о которой он рассказывает.
    const middle = series.priceToCoordinate((top + bottom) / 2);
    const y = Math.max(
      over,
      Math.min((middle ?? pane.height / 2) - height / 2, pane.height - height - under),
    );

    this.ready = {
      x,
      rows: laid.map((row) => ({ ...row, top: row.top + y })),
      candle: shape ? shift(shape, y) : null,
    };
    this.source.box = { x, y: y - over, width: WIDTH, height: height + over + under };
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
    ...shape,
    wickTop: shape.wickTop + by,
    wickBottom: shape.wickBottom + by,
    bodyTop: shape.bodyTop + by,
    bodyBottom: shape.bodyBottom + by,
  };
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

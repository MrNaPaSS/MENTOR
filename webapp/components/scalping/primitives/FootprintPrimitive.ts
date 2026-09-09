// Свеча, разобранная на след покупателя и след продавца.
//
// Свеча говорит, куда цена сходила, и молчит о том, чем ход подкреплён. Здесь
// она нарисована крупно - своей меркой, а не меркой графика, - и висит на
// цене: строка, на которой рынок стоит сейчас, держится ровно на той высоте,
// где эта цена проходит по шкале, и едет вместе с ней.
// Посередине идут цены, по обе стороны от них - деньги: слева красным продали,
// справа зелёным купили. Ячейка у цены есть всегда, а за её край уходит след,
// длина которого и есть объём. Свеча с одной плитой у низа и свеча, набранная
// ровным потоком, различаются с одного взгляда, не читая ни одной цифры.
//
// Разметки свечи здесь нет намеренно: ни рамки тела, ни фитилей, ни подписей
// краёв. Всё это картинка и так рассказывает строками - где прошли деньги,
// там свеча и стояла, - а рамка поверх них только спорила с цифрами внутри
// себя. От свечи осталась одна помеченная цена: та строка, на которой рынок
// стоит сейчас. Это единственный вопрос, которого у строк нет, и отвечает на
// него не отдельная фигура, а сама цена в своей колонке - залитая плашкой
// цвета свечи. Рамка на лестнице одна, золотая, и она про другое: где свеча
// простояла дольше всего.
//
// Растёт картинка сама. Только что открытая свеча стоит на одной цене - у неё
// одна строка; за минуту их набирается десяток, за час - сотня. Строк ровно
// столько, сколько цен свеча набрала: лестница прибавляет их сверху и снизу по
// мере хода. Шаг укрупняется, только когда лестница перестаёт помещаться в
// холст, - и тогда сотня строк собирается в то, что читается.
//
// Неподвижная мерка здесь главное - но мерка, а не место. Строки, привязанные
// высотой к ценовой шкале, тончают вместе с масштабом и на обычном зуме
// превращаются в серую щётку; картинка же обязана читаться всегда одинаково.
// Поэтому высота строки задана в точках, а к шкале привязана одна точка -
// текущая цена, за которую лестница и держится.
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
  HEAT_FLOOR,
  HEAT_TOP,
  ROW,
  ROWS_MIN,
  cellHeat,
  rowHeight,
  traceTail,
} from "@/lib/indicator/footprintLayout";
import { fadeLimit, light, readableInk, toRgb } from "@/lib/indicator/ink";
import { money, price as fmtPrice } from "@/lib/scalping";
import type { Candle } from "@/lib/indicator/types";

/** Цвета картинки: холст не понимает переменных оформления, ему нужны значения. */
export type FootprintSkin = {
  bg: string;
  border: string;
  text: string;
  muted: string;
  /** Цвет объёма: тот же, что у выбранных свечей, а не всегда зелёно-красный. */
  up: string;
  down: string;
  /** Светлые чернила - для тёмной ячейки. Тёмные берутся из `text`. */
  bright: string;
  gold: string;
  accent: string;
  /**
   * Точка текущей цены - цветом свечей графика.
   *
   * Не зелёная с красной: на белом листе свечи чёрно-белые, и цветная точка
   * поверх них читалась бы чужой фигурой. Следы покупателя и продавца при этом
   * остаются цветными везде - там цвет несёт смысл, а не оформление.
   */
  dotUp: string;
  dotDown: string;
};

/** Колонка цены. Посередине: цена - это то, к чему относятся оба числа рядом. */
const PRICE = 46;
/** Колонка числа по каждую сторону от цены. */
const NUM = 38;
/** Ядро - то, что обводит тело свечи: цена и оба числа. */
const CORE = PRICE + NUM * 2;
/** Насколько далеко за ядро уходит самый длинный след. */
const SIDE = 62;
const PAD = 4;
const WIDTH = PAD * 2 + SIDE * 2 + CORE;

/** Место под фитиль и подпись края там, где свеча выходит за лестницу. */
const TAIL = 14;

/** Насколько контур следа гуще своей заливки. */
const EDGE = 0.3;

/**
 * Какую долю холста занимает лестница в полный рост.
 *
 * Остальное - её ход. Лестница держится за текущую цену, и подниматься с ней
 * она может ровно на столько, сколько между её краем и краем поля: занявшая
 * весь холст упирается в оба края сразу и стоит колом.
 */
const RIDE = 0.5;

type ReadyRow = {
  top: number;
  height: number;
  /** Цена строки числом - по ней график рисует уровень под курсором. */
  value: number;
  total: number;
  price: string;
  sell: string;
  buy: string;
  /** Насколько след вылезает за ядро, точки. */
  sellTail: number;
  buyTail: number;
  sellHeat: number;
  buyHeat: number;
  sellInk: string;
  buyInk: string;
  sellBold: boolean;
  buyBold: boolean;
  poc: boolean;
  whale: boolean;
  /** Граница области стоимости: подпись и черта у верхнего или нижнего края. */
  edge: "vah" | "val" | null;
};

type ReadyCandle = {
  /** Строка, на которой цена стоит сейчас: её цену и метим плашкой. */
  top: number;
  height: number;
  rising: boolean;
  /** Чернила по плашке: цвет свечей бывает и светлым, и почти чёрным. */
  ink: string;
};

type Ready = {
  x: number;
  rows: ReadyRow[];
  candle: ReadyCandle | null;
  /** Цена строки под курсором. null - курсор не на картинке. */
  hover: number | null;
} | null;

/** Прямоугольник в точках экрана: место картинки и место её тела. */
export type FootprintBox = { x: number; y: number; width: number; height: number };

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

      // Плашка текущей цены - под строками, а не поверх них.
      //
      // Раньше здесь стояла рамка, и на самой наторгованной цене их сходилось
      // сразу две: золотая вокруг ядра и эта внутри неё. Две вложенные рамки
      // читаются как одна фигура неясного смысла, а вопросы у них разные -
      // «здесь свеча стояла дольше всего» и «здесь рынок сейчас». Поэтому
      // рамка осталась одна, золотая, а текущая цена стала залитой плашкой:
      // спорить им больше нечем.
      const candle = ready.candle;
      if (candle) {
        const top = Math.round(candle.top * vy);
        const h = Math.max(line, Math.round(candle.height * vy));
        ctx.fillStyle = candle.rising ? skin.dotUp : skin.dotDown;
        ctx.fillRect(
          priceLeft,
          top + Math.round(1 * vy),
          priceRight - priceLeft,
          Math.max(line, h - Math.round(2 * vy)),
        );
      }

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
        //
        // По краю - контур своим же цветом в полную силу. Заливка задана
        // густотой, и на бледных строках её край размывается в бумагу: две
        // соседние полосы отличаются на пиксель длины, а на глаз выходят
        // одинаковыми. Контур возвращает след к тому, чем он и является, -
        // к полосе известной длины, которую можно сравнить с соседней.
        const trace = (fill: string, from: number, to: number, heat: number) => {
          ctx.globalAlpha = heat;
          ctx.fillStyle = fill;
          ctx.fillRect(from, cellTop, to - from, cellH);
          ctx.globalAlpha = Math.min(1, heat + EDGE);
          ctx.strokeStyle = fill;
          ctx.lineWidth = line;
          ctx.strokeRect(from + 0.5 * line, cellTop + 0.5 * line, to - from - line, cellH - line);
          ctx.globalAlpha = 1;
        };

        if (row.sellHeat > 0) {
          trace(skin.down, coreLeft - Math.round(row.sellTail * hx), priceLeft, row.sellHeat);
        }
        if (row.buyHeat > 0) {
          trace(skin.up, priceRight, coreRight + Math.round(row.buyTail * hx), row.buyHeat);
        }

        ctx.textAlign = "right";
        ctx.fillStyle = row.sellInk;
        ctx.font = font(9, row.sellBold);
        ink(row.sell, priceLeft - Math.round(3 * hx), middle);
        ctx.textAlign = "left";
        ctx.fillStyle = row.buyInk;
        ctx.font = font(9, row.buyBold);
        ink(row.buy, priceRight + Math.round(3 * hx), middle);

        // Цена посередине. Крупная сделка - тем же жёлтым, что плита в
        // стакане: это одно и то же событие, только уже прошедшее. На плашке
        // текущей цены - её чернилами и без каймы: кайма цвета панели обвела
        // бы цифру белым кольцом посреди залитой плашки.
        ctx.textAlign = "center";
        ctx.font = font(9);
        if (candle && row.top === candle.top) {
          ctx.fillStyle = candle.ink;
          ctx.fillText(row.price, axis, middle);
        } else {
          ctx.fillStyle = row.whale ? skin.gold : skin.muted;
          ink(row.price, axis, middle);
        }

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
          ctx.font = font(7);
          ctx.textAlign = "right";
          ctx.textBaseline = row.edge === "vah" ? "bottom" : "top";
          ink(row.edge === "vah" ? "VAH" : "VAL", x + width - Math.round(2 * hx), edge);
          ctx.textBaseline = "middle";
        }

        // Строка под курсором: тонкая черта во всю ширину. Уровень этой цены
        // в тот же момент проводится через весь график, и подсветка говорит,
        // какая именно строка его дала.
        if (ready.hover !== null && row.value === ready.hover) {
          ctx.strokeStyle = skin.accent;
          ctx.lineWidth = line;
          ctx.strokeRect(x + 0.5 * line, top + 0.5 * line, width - line, h - line);
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

      ctx.textAlign = "left";
    });
  }
}

class FootprintPaneView implements IPrimitivePaneView {
  private ready: Ready = null;

  /** Готовая раскладка кадра: по ней страница ищет строку под курсором. */
  get shot(): Ready {
    return this.ready;
  }

  constructor(private readonly source: FootprintPrimitive) {}

  update() {
    this.ready = null;
    this.source.box = null;

    const chart = this.source.chart;
    const series = this.source.series;
    const data = this.source.data;
    if (!chart || !series || !data || data.levels.length === 0) return;

    const chartPane = chart.paneSize();
    // Строк ровно столько, сколько набрала свеча. Это и есть рост картинки:
    // только что открытая стоит на одной цене - у неё одна строка, за минуту
    // их набирается десяток. Укрупняем шаг, лишь когда лестница перестаёт
    // помещаться в отведённое ей место: ужимать строки нельзя - там цифры, а
    // обрезать снизу значит соврать о том, где свеча кончилась.
    //
    // Место это - половина холста, а не весь холст. Лестница висит на цене, и
    // ехать за ней она может ровно настолько, насколько сама короче поля:
    // разросшаяся во всю высоту упиралась в оба края разом и застывала на
    // месте - цена улетала, а картинка оставалась стоять, где стояла.
    const room = Math.max(1, chartPane.height - TAIL * 2 - 8);
    const fits = Math.max(ROWS_MIN, Math.floor((room * RIDE) / ROW));

    const prices = data.levels.map((level) => level.price);
    const span = Math.max(...prices) - Math.min(...prices);
    const step = stepForRows(data.tick, span, fits);
    if (!(step > 0)) return;

    const { rows } = withValueArea(markRows(foldRows(data.levels, step)));
    if (rows.length === 0) return;

    const skin = this.source.skin;

    const pane = chartPane;
    const tall = rowHeight(rows.length, room * RIDE);
    const height = tall * rows.length;

    const peak = rows.reduce((acc, row) => Math.max(acc, row.buy, row.sell), 0);

    // Цифры одного цвета на всю картинку, а густота каждой стороны своя: у
    // палитр разная светлота, и то, что на зелёном ещё читается, на белом
    // вельвете уже нет.
    const letters = inkOn(skin);
    const sellCap = heatCap(skin, skin.down);
    const buyCap = heatCap(skin, skin.up);

    const laid: ReadyRow[] = rows.map((row, i) => ({
      top: i * tall,
      height: tall,
      value: row.price,
      total: row.total,
      price: fmtPrice(row.price, data.tick),
      sell: row.sell > 0 ? money(row.sell) : "·",
      buy: row.buy > 0 ? money(row.buy) : "·",
      sellTail: traceTail(row.sell, peak, SIDE),
      buyTail: traceTail(row.buy, peak, SIDE),
      sellHeat: cellHeat(row.sell, peak, sellCap),
      buyHeat: cellHeat(row.buy, peak, buyCap),
      // Пустая строка пишется приглушённым: там не сумма, а точка.
      sellInk: row.sell > 0 ? letters : skin.muted,
      buyInk: row.buy > 0 ? letters : skin.muted,
      sellBold: row.imbalance < 0,
      buyBold: row.imbalance > 0,
      poc: row.poc,
      whale: row.whale,
      edge: row.edge === "vah" || row.edge === "val" ? row.edge : null,
    }));

    // Строка, на которой цена стоит сейчас. Ищем ту, в чью корзину она попала;
    // не попала ни в одну - берём ближайшую: последняя сделка бывает на пол-
    // шага выше верхней строки, и остаться совсем без обводки хуже, чем
    // обвести соседку.
    const candle = this.source.candle;
    let shape: ReadyCandle | null = null;
    let best = -1;
    if (candle) {
      let gap = Infinity;
      best = 0;
      rows.forEach((row, i) => {
        const away =
          candle.close >= row.price && candle.close < row.price + step
            ? 0
            : Math.min(
                Math.abs(candle.close - row.price),
                Math.abs(candle.close - (row.price + step)),
              );
        if (away < gap) {
          gap = away;
          best = i;
        }
      });
      const rising = candle.close >= candle.open;
      shape = {
        top: laid[best].top,
        height: laid[best].height,
        rising,
        // Плашка залита в полную силу, значит и чернила считаем по ней самой:
        // цвет свечей бывает и почти белым, и почти чёрным.
        ink: readableInk(
          rising ? skin.dotUp : skin.dotDown,
          skin.bg,
          1,
          INK_DARK,
          skin.bright,
        ),
      };
    }

    // Поле сверху и снизу: сверху под подпись, снизу чтобы нижняя строка не
    // упиралась в шкалу времени.
    const over = TAIL;
    const under = TAIL;

    // Где встанет картинка. Справа от своей свечи, если справа есть место:
    // слева от неё история цены, ради которой на график и смотрят. Не влезла -
    // уходит влево, и в любом случае целиком остаётся на холсте.
    const scale = chart.timeScale();
    const anchor = scale.timeToCoordinate(data.time as UTCTimestamp);
    if (anchor === null) return;
    const spacing = scale.options().barSpacing;
    let x = anchor + spacing;
    if (x + WIDTH > pane.width - 4) x = anchor - spacing - WIDTH;
    // Сдвиг рукой поверх этого выбора: трейдер потянул картинку за тело свечи,
    // и держать её на месте после этого - значит отменить его решение. Своей
    // свечи она при этом не теряет: сдвиг откладывается от её же места.
    x = Math.max(4, Math.min(x + this.source.shift.dx, pane.width - WIDTH - 4));

    // По вертикали лестница встаёт на цену один раз - и дальше стоит.
    //
    // Раньше она висела на текущей цене и ехала за ней на каждом кадре. Замысел
    // был в связи с рынком, а вышло мельтешение: цена на скальпе ходит восемь
    // раз в секунду, и картинка вместе с ней дёргалась вверх-вниз всё время,
    // пока в неё смотрят. Читать дрожащий столбец цифр нельзя.
    //
    // Поэтому запоминаем одну пару - цену и высоту, на которой она была в
    // момент открытия, - и держим лестницу на ней. Дальше высота считается от
    // этой цены, а не от шкалы: цена гуляет - картинка стоит; свеча набрала
    // новые цены - строки прибавляются сверху и снизу, а прежние остаются
    // ровно там, где были. Связь с рынком при этом никуда не делась: строка,
    // на которой рынок стоит сейчас, помечена плашкой цвета свечи, и видно её
    // внутри картинки.
    const pin = this.source.pin ?? this.source.pinTo(candle, series);
    let hang: number | null = null;
    if (pin) {
      // Строка, в чью корзину попала закреплённая цена. Не попала ни в одну -
      // держимся за край: после укрупнения шага корзины другие, и цена может
      // оказаться за краем лестницы.
      let at = rows.findIndex(
        (row) => pin.price >= row.price && pin.price < row.price + step,
      );
      if (at < 0) at = pin.price > rows[0].price ? 0 : rows.length - 1;
      // Внутри своей строки цена стоит на своём месте, а не в середине: иначе
      // лестница прыгала бы на целую строку каждый раз, когда цена
      // переступает границу корзины.
      const part = Math.min(1, Math.max(0, (pin.price - rows[at].price) / step));
      hang = pin.y - (laid[at].top + laid[at].height * (1 - part));
    }

    // Зацепиться не за что - свеча из истории уехала со шкалы, цены под рукой
    // нет: встаём серединой на середину профиля. Это по-прежнему то место, о
    // котором картинка рассказывает.
    const middle = series.priceToCoordinate(
      (rows[0].price + step + rows[rows.length - 1].price) / 2,
    );
    const y = Math.max(
      over,
      Math.min(
        (hang ?? (middle ?? pane.height / 2) - height / 2) + this.source.shift.dy,
        pane.height - height - under,
      ),
    );

    this.ready = {
      x,
      hover: this.source.hover,
      rows: laid.map((row) => ({ ...row, top: row.top + y })),
      candle: shape ? { ...shape, top: shape.top + y } : null,
    };
    this.source.box = { x, y: y - over, width: WIDTH, height: height + over + under };
    // Ручка переноса - колонка цены: это ось картинки, единственная её полоса
    // без цифр по краям, и попасть в неё мышью можно не целясь. Отдаём её
    // странице в тех же точках экрана, в которых она ловит мышь.
    this.source.body = {
      x: x + PAD + SIDE + NUM,
      y,
      width: PRICE,
      height,
    };
  }

  renderer() {
    return new FootprintRenderer(this.ready, this.source.skin);
  }

  /** Поверх свечей: картинка - это разбор одной из них, а не фон под ними. */
  zOrder() {
    return "top" as const;
  }
}

/**
 * Тёмные чернила для светлой подложки.
 *
 * Своим цветом, а не текстом панели: на тёмной панели её текст сам светлый, и
 * тёмным он быть не может по определению.
 */
const INK_DARK = "#0b0e11";

/** Каким контрастом цифра считается читаемой. Ниже четырёх она спорит с ячейкой. */
const INK_RATIO = 4;

/**
 * Цвет цифр в ячейках - один на всю картинку, от листа панели.
 *
 * Не по каждой ячейке отдельно. Выбор под каждую честен по контрасту, но
 * читается как поломка: в одном столбце половина сумм белая, половина чёрная,
 * и правила в этом не видно - густота считается от объёма самой строки. Ровно
 * это и было на тёмном листе во всех палитрах.
 */
function inkOn(skin: FootprintSkin): string {
  const back = toRgb(skin.bg);
  return back && light(back) > 0.5 ? INK_DARK : skin.bright;
}

/**
 * До какой густоты можно красить сторону, чтобы цифры на ней остались видны.
 *
 * Подстраивается заливка, а не цвет цифр: заливка - оформление, цифра - смысл,
 * и уступать должна первая. Длину следа это не трогает - объём по-прежнему
 * виден целиком.
 */
function heatCap(skin: FootprintSkin, fill: string): number {
  return fadeLimit(fill, skin.bg, inkOn(skin), INK_RATIO, HEAT_TOP, HEAT_FLOOR);
}

export class FootprintPrimitive implements ISeriesPrimitive<Time> {
  data: FootprintData | null = null;
  candle: Candle | null = null;
  skin: FootprintSkin = {
    bg: "#181a20",
    border: "#2b3139",
    text: "#eaecef",
    muted: "#7a8290",
    up: "#0ecb81",
    down: "#f6465d",
    bright: "#ffffff",
    gold: "#f0b90b",
    accent: "#0affe0",
    dotUp: "#0ecb81",
    dotDown: "#f6465d",
  };
  /** Место картинки на холсте: по нему страница ставит подпись над ней. */
  box: FootprintBox | null = null;
  /** Место тела свечи: за него картинку переносят рукой. */
  body: FootprintBox | null = null;
  /** Насколько картинку увели от её свечи. */
  shift: { dx: number; dy: number } = { dx: 0, dy: 0 };
  /**
   * За какую цену и на какой высоте закреплена лестница.
   *
   * Ставится один раз - когда картинку открыли, - и живёт до её закрытия. Это
   * и есть неподвижность: высота считается от запомненной цены, а не от того,
   * где эта цена проходит по шкале сейчас. Иначе картинка ехала бы за рынком
   * восемь раз в секунду.
   */
  pin: { price: number; y: number } | null = null;
  /** Монета и таймфрейм закреплённой цены: на чужих она ничего не значит. */
  private pinKey = "";
  /** Цена строки под курсором. Живёт отдельно от данных: это про мышь. */
  hover: number | null = null;
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

  setData(data: FootprintData | null, candle: Candle | null, skin: FootprintSkin) {
    // Сменилась монета или таймфрейм - прежняя привязка недействительна: цена
    // с другого инструмента на этой шкале не значит ничего.
    //
    // Пустые данные привязку не трогают. Профиль на мгновение пропадает и на
    // границе минуты, и между запросами; считать это закрытием значит
    // закреплять картинку заново на новой цене - то есть возвращать прыжок,
    // только раз в минуту. Закрытие приходит отдельно, через clear().
    const key = data ? `${data.symbol}:${data.interval}` : this.pinKey;
    if (key !== this.pinKey) {
      this.pinKey = key;
      this.pin = null;
    }
    this.data = data;
    this.candle = candle;
    this.skin = skin;
    this.requestUpdate?.();
  }

  /**
   * Закрепить лестницу на нынешней цене. Возвращает привязку или пусто.
   *
   * Пусто - цены под рукой нет: свеча ещё не приехала или уехала со шкалы.
   * Тогда картинка встаёт серединой профиля посреди холста, как и раньше, а
   * закрепится на следующем кадре, когда цену станет видно.
   */
  pinTo(
    candle: Candle | null,
    series: ISeriesApi<SeriesType>,
  ): { price: number; y: number } | null {
    if (!candle) return null;
    const y = series.priceToCoordinate(candle.close);
    if (y === null) return null;
    this.pin = { price: candle.close, y };
    return this.pin;
  }

  clear() {
    this.data = null;
    this.candle = null;
    this.box = null;
    this.body = null;
    this.pin = null;
    this.pinKey = "";
    this.requestUpdate?.();
  }

  /** Увести картинку от свечи. Сдвиг живёт отдельно от данных: он про руку. */
  setShift(shift: { dx: number; dy: number }) {
    this.shift = shift;
    this.requestUpdate?.();
  }

  /** Подсветить строку под курсором. */
  setHover(price: number | null) {
    if (this.hover === price) return;
    this.hover = price;
    this.requestUpdate?.();
  }

  /**
   * Строка под точкой экрана.
   *
   * Ищем по готовой раскладке, а не пересчитываем цены: раскладку примитив уже
   * посчитал на этом кадре, и второй счёт разошёлся бы с нарисованным на
   * границе строки - ровно там, где курсор чаще всего и стоит.
   */
  at(pointX: number, pointY: number): { price: number; total: number } | null {
    const ready = this.view.shot;
    if (!ready) return null;
    if (pointX < ready.x || pointX > ready.x + WIDTH) return null;
    const row = ready.rows.find(
      (one) => pointY >= one.top && pointY < one.top + one.height,
    );
    return row ? { price: row.value, total: row.total } : null;
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

/** Ширина колонки цены: подпись оставляет над ней пропуск - там фитиль. */
export const FOOTPRINT_PRICE = PRICE;

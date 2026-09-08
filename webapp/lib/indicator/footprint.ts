// Профиль объёма внутри свечи: из чего она собрана.
//
// Свеча говорит, куда цена сходила, и молчит о том, чем ход подкреплён. Одна и
// та же зелёная минута бывает набрана ровным потоком по всей длине тела, а
// бывает одной плитой у самого низа, после которой цену вынесли вверх на
// пустоте. Различает их только профиль: сколько денег прошло на каждой цене и
// в какую сторону били.
//
// Сервер отдаёт строки на шаге биржи. Сколько их поместится на экран, знает
// только график: на минутке биткойна шагов три сотни, а строка — это строка
// текста, ей нужно около дюжины точек по высоте. Поэтому укрупнение считается
// здесь, на каждом кадре, от текущего масштаба.
//
// Правила разметки — POC, киты, имбаланс — тоже здесь, отдельно от рисования:
// это единственная часть режима, где можно ошибиться незаметно, и она
// проверяется тестами.

/** Одна цена внутри свечи: сколько на ней купили и продали, в деньгах. */
export type FootprintLevel = {
  price: number;
  buy: number;
  sell: number;
};

/** Ответ сервера: строки на шаге биржи и итоги свечи. */
export type FootprintData = {
  symbol: string;
  interval: string;
  /** Начало свечи, секунды. */
  time: number;
  seconds: number;
  /** Шаг цены, на котором отданы строки. */
  tick: number;
  buy: number;
  sell: number;
  /**
   * Свеча разобрана не целиком: сделок оказалось больше, чем сервер согласился
   * выкачать. Показать половину объёма молча хуже, чем сказать, что он неполон.
   */
  partial: boolean;
  /** Откуда взято: своя лента (`tape`) или запрос на биржу (`exchange`). */
  source: string;
  levels: FootprintLevel[];
};

/** Строка профиля на экране — после укрупнения и разметки. */
export type FootprintRow = {
  price: number;
  buy: number;
  sell: number;
  total: number;
  delta: number;
  /** Самая наторгованная цена свечи: вокруг неё она и стоит. */
  poc: boolean;
  /** Крупная сделка: заметно больше и соседей, и своей доли в свече. */
  whale: boolean;
  /** Перевес агрессии по диагонали: +1 покупатели, −1 продавцы. */
  imbalance: 0 | 1 | -1;
};

/**
 * Во сколько раз строка должна перерасти обычную, чтобы считаться китом.
 *
 * Оба условия обязательны. Одной кратности медиане мало: на тихой свече в
 * пять раз больше медианы бывает половина строк, и жёлтым заливается вся
 * свеча. Одной доли тоже мало: на свече из трёх строк каждая занимает треть,
 * и китом становится любая.
 */
const WHALE_TIMES = 3;
const WHALE_SHARE = 0.08;

/**
 * Перевес одной стороны над встречной по диагонали.
 *
 * Диагональ, а не та же цена: покупатель берёт по цене продавца, и сравнивать
 * его надо с продавцом строкой ниже — тем, кто стоял там же, где он бил.
 * Втрое — общепринятый порог имбаланса в кластерных терминалах.
 */
const IMBALANCE_TIMES = 3;

/** Мелочь имбалансом не считаем: на копеечных строках втрое бывает всегда. */
const IMBALANCE_SHARE = 0.02;

/** Разобрать ответ сервера. Строки приходят тройками — так же, как кластеры. */
export function parseFootprint(body: {
  symbol: string;
  interval: string;
  time: number;
  seconds: number;
  tick: number;
  buy: number;
  sell: number;
  partial?: boolean;
  source?: string;
  levels: [number, number, number][];
}): FootprintData {
  return {
    symbol: body.symbol,
    interval: body.interval,
    time: body.time,
    seconds: body.seconds,
    tick: body.tick,
    buy: body.buy,
    sell: body.sell,
    partial: Boolean(body.partial),
    source: body.source ?? "",
    levels: (body.levels ?? []).map(([price, buy, sell]) => ({ price, buy, sell })),
  };
}

/**
 * Номер корзины, в которую попадает цена.
 *
 * Деление дробных чисел точным не бывает: 129.9 / 0.3 даёт 432.9999999, и
 * цена, стоящая ровно на границе, уезжает строкой ниже. Округление до
 * шестого знака ставит её на место. Правило то же, что на сервере, — иначе
 * строки разъезжались бы при смене источника.
 */
function bucket(price: number, step: number): number {
  return Math.floor(Number((price / step).toFixed(6)));
}

/**
 * Шаг строк для текущего масштаба графика.
 *
 * Целым числом биржевых шагов: половина шага ценой не бывает, и строки на
 * дробном укрупнении встали бы между реальными ценами.
 */
export function pickStep(tick: number, pricePerPixel: number, minRowPx: number): number {
  if (!(tick > 0)) return 0;
  const needed = Math.max(0, pricePerPixel) * minRowPx;
  // Отношение округляем: 0.6 / 0.1 в двоичной арифметике даёт 6.000000000000001,
  // и потолок отдал бы семь шагов вместо шести — строки прыгали бы в высоте на
  // ровном месте.
  const factor = Math.max(1, Math.ceil(Number((needed / tick).toFixed(6))));
  return Number((tick * factor).toPrecision(12));
}

/**
 * Схлопнуть строки под выбранный шаг.
 *
 * Вниз, а не к ближайшей: корзины обязаны быть непрерывными, иначе соседние
 * строки перекрываются и один и тот же объём виден дважды.
 */
export function foldRows(levels: FootprintLevel[], step: number): FootprintRow[] {
  if (!(step > 0) || levels.length === 0) return [];

  const merged = new Map<number, { buy: number; sell: number }>();
  for (const level of levels) {
    const index = bucket(level.price, step);
    const cell = merged.get(index);
    if (cell) {
      merged.set(index, { buy: cell.buy + level.buy, sell: cell.sell + level.sell });
    } else {
      merged.set(index, { buy: level.buy, sell: level.sell });
    }
  }

  return [...merged.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([index, cell]) => ({
      price: index * step,
      buy: cell.buy,
      sell: cell.sell,
      total: cell.buy + cell.sell,
      delta: cell.buy - cell.sell,
      poc: false,
      whale: false,
      imbalance: 0 as const,
    }));
}

/** Медиана ненулевых строк: по ней видно, какая строка на этой свече обычная. */
function median(values: number[]): number {
  const alive = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (alive.length === 0) return 0;
  const middle = alive.length >> 1;
  return alive.length % 2 === 1 ? alive[middle] : (alive[middle - 1] + alive[middle]) / 2;
}

/**
 * Разметить строки: где стояла свеча, где били крупно и где перевес.
 *
 * Возвращается новый массив — исходные строки не трогаем: их пересчитывает
 * каждый кадр, и правка на месте означала бы, что метки копятся.
 */
export function markRows(rows: FootprintRow[]): FootprintRow[] {
  if (rows.length === 0) return rows;

  const sum = rows.reduce((acc, row) => acc + row.total, 0);
  const middle = median(rows.map((row) => row.total));
  const peak = Math.max(...rows.map((row) => row.total));

  return rows.map((row, i) => {
    // Строки идут сверху вниз: ниже по цене — следующая, выше — предыдущая.
    const below = rows[i + 1];
    const above = rows[i - 1];

    let imbalance: 0 | 1 | -1 = 0;
    const buyers = row.buy >= IMBALANCE_TIMES * (below?.sell ?? 0) && row.buy >= IMBALANCE_SHARE * sum;
    const sellers =
      row.sell >= IMBALANCE_TIMES * (above?.buy ?? 0) && row.sell >= IMBALANCE_SHARE * sum;
    if (buyers && !sellers) imbalance = 1;
    else if (sellers && !buyers) imbalance = -1;
    // Обе стороны разом — это не перевес, а просто крупная строка: с обеих
    // сторон от неё пусто. Такую отмечает кит, а не имбаланс.

    return {
      ...row,
      poc: row.total > 0 && row.total === peak,
      whale: row.total >= WHALE_TIMES * middle && row.total >= WHALE_SHARE * sum,
      imbalance,
    };
  });
}

/**
 * Левый край кластерной панели.
 *
 * Панель стоит впереди последней свечи — в пустом поле, которое график держит
 * справа. Так свеча раскрывается рядом с рынком, а не поверх него: соседние
 * свечи остаются видны, и профиль читается вместе с ними.
 *
 * За ценовую шкалу панель не выходит: при сильном отдалении пустое поле сжато
 * до десятка точек, и панель, поставленная сразу за свечой, оказалась бы за
 * краем окна. В этом случае она упирается в шкалу и накрывает последние свечи —
 * закрыть их собой лучше, чем уехать с экрана целиком.
 */
export function panelLeft(
  width: number,
  panel: number,
  pad: number,
  lastX: number | null,
  spacing: number,
): number {
  const edge = width - pad - panel;
  if (lastX === null) return Math.max(pad, edge);
  // Полшага сетки от последней свечи: вплотную к её фитилю панель читалась бы
  // как её продолжение.
  const ahead = lastX + Math.max(4, spacing * 0.75);
  return Math.max(pad, Math.min(ahead, edge));
}

/**
 * Строки профиля для текущего масштаба — то, что рисует примитив.
 *
 * Шаг считается от масштаба, а не хранится: трейдер крутит колесо, и строки
 * обязаны укрупняться вместе с ним, а не превращаться в кашу.
 */
export function buildRows(
  data: FootprintData | null,
  pricePerPixel: number,
  minRowPx: number,
): FootprintRow[] {
  if (!data || data.levels.length === 0) return [];
  const step = pickStep(data.tick, pricePerPixel, minRowPx);
  if (!(step > 0)) return [];
  return markRows(foldRows(data.levels, step));
}

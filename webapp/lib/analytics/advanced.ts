// Расширенная аналитика: то, что считают по журналу сделок.
//
// Всё считается здесь, а не в разметке: это арифметика про деньги, её надо
// проверять тестами, а не глазами на живом счёте. Сервер отдаёт сами сделки
// (`/api/journal/trades`), остальное - производные от них.
//
// Главная величина раздела - R, риск одной сделки. Он считается по замыслу
// трейдера: расстояние от входа до стопа, умноженное на объём. Деньги без
// него сравнивать нельзя: плюс сто долларов на риске в двадцать и на риске в
// двести - это разные сделки, и вторая опаснее, даже когда итог тот же.

import type { JournalTrade } from "@/lib/journal";

/** Итоги периода: то, что стоит в плитках наверху раздела. */
export interface Totals {
  trades: number;
  wins: number;
  losses: number;
  /** В ноль: ни плюс, ни минус - в винрейт такие не идут. */
  flat: number;
  /** Доля побед среди сделок с результатом, 0..1. */
  winRate: number;
  /** Сумма плюсов и сумма минусов (по модулю). */
  gross: number;
  drawn: number;
  net: number;
  fees: number;
  /** Плюсы, делённые на минусы. Null - минусов не было, делить не на что. */
  profitFactor: number | null;
  avgWin: number;
  avgLoss: number;
  /** Сколько в среднем приносит одна сделка. */
  expectancy: number;
  best: number;
  worst: number;
  /** Оборот обеих ног: по нему считается комиссия. */
  volume: number;
  /** Средний R по сделкам, у которых был стоп. Null - таких нет. */
  avgR: number | null;
  /** Просадка от пика капитала: в деньгах и в долях пика. */
  drawdown: number;
  drawdownPct: number;
  /** Среднее время в сделке, минуты. Null - время открытия неизвестно. */
  holdMinutes: number | null;
}

export interface EquityPoint {
  /** Время закрытия, миллисекунды. */
  at: number;
  /** Накопленный итог после этой сделки. */
  value: number;
  pnl: number;
  symbol: string;
  side: JournalTrade["side"];
}

export interface Bucket {
  key: string;
  trades: number;
  pnl: number;
  wins: number;
}

const MINUTE = 60_000;

function time(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Риск сделки в деньгах: расстояние до стопа на объём.
 *
 * Ноль означает, что риска в замысле не было (стоп на цене входа или его нет
 * вовсе) - такую сделку в R-статистику не берём: делить на ноль нечем.
 */
export function risk(trade: JournalTrade): number {
  const distance = Math.abs(trade.entry - trade.stop);
  const value = distance * trade.qty;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Результат сделки в риске. Null - риск неизвестен. */
export function rMultiple(trade: JournalTrade): number | null {
  const base = risk(trade);
  return base > 0 ? trade.pnl / base : null;
}

/** Оборот сделки: вход и выход вместе - с него берут комиссию. */
export function turnover(trade: JournalTrade): number {
  const exit = trade.exit_price ?? trade.entry;
  return (trade.entry + exit) * trade.qty;
}

/** Сделки по возрастанию времени закрытия: кривая строится во времени. */
export function inOrder(trades: readonly JournalTrade[]): JournalTrade[] {
  return [...trades].sort((a, b) => (time(a.closed_at) ?? 0) - (time(b.closed_at) ?? 0));
}

/** Накопленный итог после каждой сделки. */
export function equityCurve(trades: readonly JournalTrade[]): EquityPoint[] {
  let running = 0;
  return inOrder(trades).map((trade) => {
    running += trade.pnl;
    return {
      at: time(trade.closed_at) ?? 0,
      value: running,
      pnl: trade.pnl,
      symbol: trade.symbol,
      side: trade.side,
    };
  });
}

/**
 * Просадка: сколько капитал терял от своего пика.
 *
 * Доля считается от пика, а не от итога: просадка в сто долларов после тысячи
 * заработанных и после ста - это разные вещи. Пик ниже нуля доли не даёт:
 * делить на отрицательное значение бессмысленно.
 */
export function drawdown(points: readonly EquityPoint[]): { value: number; pct: number } {
  let peak = 0;
  let worst = 0;
  let worstPct = 0;
  for (const point of points) {
    if (point.value > peak) peak = point.value;
    const fall = peak - point.value;
    if (fall > worst) {
      worst = fall;
      worstPct = peak > 0 ? fall / peak : 0;
    }
  }
  return { value: worst, pct: worstPct };
}

/** Серии подряд: длина и сколько денег принесла. */
export interface Streak {
  length: number;
  pnl: number;
}

/**
 * Серии подряд: лучшая победная, худшая убыточная и та, что идёт сейчас.
 *
 * Вместе с длиной считаем и деньги серии: шесть побед подряд на четыре тысячи
 * и шесть побед на сорок долларов - это разные истории, а по одной длине они
 * неразличимы.
 */
export function streaks(trades: readonly JournalTrade[]): {
  bestWins: number;
  worstLosses: number;
  current: number;
  best: Streak;
  worst: Streak;
  /** Та, что идёт сейчас: длина со знаком, деньги как есть. */
  now: Streak;
} {
  let best: Streak = { length: 0, pnl: 0 };
  let worst: Streak = { length: 0, pnl: 0 };
  let run: Streak = { length: 0, pnl: 0 };

  for (const trade of inOrder(trades)) {
    if (trade.pnl > 0) {
      run = run.length > 0 ? { length: run.length + 1, pnl: run.pnl + trade.pnl } : { length: 1, pnl: trade.pnl };
    } else if (trade.pnl < 0) {
      run = run.length < 0 ? { length: run.length - 1, pnl: run.pnl + trade.pnl } : { length: -1, pnl: trade.pnl };
    } else {
      // Сделка в ноль серию не продолжает и не рвёт: считать её победой или
      // поражением нельзя, а обрывать ею серию - значит наказывать за выход
      // в безубыток.
      continue;
    }
    if (run.length > best.length) best = run;
    if (run.length < worst.length) worst = run;
  }

  return {
    bestWins: best.length,
    worstLosses: Math.abs(worst.length),
    current: run.length,
    best,
    worst: { length: Math.abs(worst.length), pnl: worst.pnl },
    now: run,
  };
}

function group(
  trades: readonly JournalTrade[],
  key: (trade: JournalTrade) => string | null,
): Bucket[] {
  const out = new Map<string, Bucket>();
  for (const trade of trades) {
    const name = key(trade);
    if (name === null) continue;
    const bucket = out.get(name) ?? { key: name, trades: 0, pnl: 0, wins: 0 };
    out.set(name, {
      key: name,
      trades: bucket.trades + 1,
      pnl: bucket.pnl + trade.pnl,
      wins: bucket.wins + (trade.pnl > 0 ? 1 : 0),
    });
  }
  return [...out.values()];
}

/** По монетам, от лучшей к худшей по итогу. */
export function bySymbol(trades: readonly JournalTrade[]): Bucket[] {
  return group(trades, (trade) => trade.symbol).sort((a, b) => b.pnl - a.pnl);
}

/** По стороне: лонг и шорт. */
export function bySide(trades: readonly JournalTrade[]): Bucket[] {
  return group(trades, (trade) => trade.side);
}

/** По тому, чем кончилась сделка: стоп, цель, руками. */
export function byOutcome(trades: readonly JournalTrade[]): Bucket[] {
  return group(trades, (trade) => trade.outcome);
}

/** По дням недели: 0 - понедельник. Пустые дни в списке тоже есть. */
export function byWeekday(trades: readonly JournalTrade[]): Bucket[] {
  const base: Bucket[] = Array.from({ length: 7 }, (_, i) => ({
    key: String(i),
    trades: 0,
    pnl: 0,
    wins: 0,
  }));
  for (const trade of trades) {
    const ms = time(trade.closed_at);
    if (ms === null) continue;
    // В JS неделя начинается с воскресенья, у нас - с понедельника.
    const index = (new Date(ms).getDay() + 6) % 7;
    const day = base[index];
    base[index] = {
      key: day.key,
      trades: day.trades + 1,
      pnl: day.pnl + trade.pnl,
      wins: day.wins + (trade.pnl > 0 ? 1 : 0),
    };
  }
  return base;
}

/** По часам входа: когда торгуется лучше. Все 24 часа, включая пустые. */
export function byHour(trades: readonly JournalTrade[]): Bucket[] {
  const base: Bucket[] = Array.from({ length: 24 }, (_, i) => ({
    key: String(i),
    trades: 0,
    pnl: 0,
    wins: 0,
  }));
  for (const trade of trades) {
    const ms = time(trade.opened_at) ?? time(trade.closed_at);
    if (ms === null) continue;
    const index = new Date(ms).getHours();
    const hour = base[index];
    base[index] = {
      key: hour.key,
      trades: hour.trades + 1,
      pnl: hour.pnl + trade.pnl,
      wins: hour.wins + (trade.pnl > 0 ? 1 : 0),
    };
  }
  return base;
}

/** Границы корзин R: от «хуже минус двух» до «лучше трёх». */
export const R_BUCKETS: { key: string; from: number; to: number }[] = [
  { key: "<-2R", from: -Infinity, to: -2 },
  { key: "-2R..-1R", from: -2, to: -1 },
  { key: "-1R..0", from: -1, to: 0 },
  { key: "0..1R", from: 0, to: 1 },
  { key: "1R..2R", from: 1, to: 2 },
  { key: "2R..3R", from: 2, to: 3 },
  { key: ">3R", from: 3, to: Infinity },
];

/** Сколько сделок в каждой корзине R и с каким итогом. */
export function rDistribution(trades: readonly JournalTrade[]): Bucket[] {
  const out: Bucket[] = R_BUCKETS.map((bucket) => ({
    key: bucket.key,
    trades: 0,
    pnl: 0,
    wins: 0,
  }));
  for (const trade of trades) {
    const r = rMultiple(trade);
    if (r === null) continue;
    const index = R_BUCKETS.findIndex((bucket) => r > bucket.from && r <= bucket.to);
    if (index < 0) continue;
    const bucket = out[index];
    out[index] = {
      key: bucket.key,
      trades: bucket.trades + 1,
      pnl: bucket.pnl + trade.pnl,
      wins: bucket.wins + (trade.pnl > 0 ? 1 : 0),
    };
  }
  return out;
}

/** Всё вместе: числа для плиток раздела. */
export function summarize(trades: readonly JournalTrade[]): Totals {
  const wins = trades.filter((trade) => trade.pnl > 0);
  const losses = trades.filter((trade) => trade.pnl < 0);
  const flat = trades.length - wins.length - losses.length;

  const gross = wins.reduce((sum, trade) => sum + trade.pnl, 0);
  const drawn = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0));
  const net = trades.reduce((sum, trade) => sum + trade.pnl, 0);
  const decided = wins.length + losses.length;

  const rs = trades.map(rMultiple).filter((r): r is number => r !== null);
  const held = trades
    .map((trade) => {
      const from = time(trade.opened_at);
      const to = time(trade.closed_at);
      return from !== null && to !== null && to >= from ? (to - from) / MINUTE : null;
    })
    .filter((minutes): minutes is number => minutes !== null);

  const fall = drawdown(equityCurve(trades));

  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    flat,
    winRate: decided > 0 ? wins.length / decided : 0,
    gross,
    drawn,
    net,
    fees: trades.reduce((sum, trade) => sum + (trade.fee || 0), 0),
    profitFactor: drawn > 0 ? gross / drawn : null,
    avgWin: wins.length > 0 ? gross / wins.length : 0,
    avgLoss: losses.length > 0 ? drawn / losses.length : 0,
    expectancy: trades.length > 0 ? net / trades.length : 0,
    best: trades.reduce((max, trade) => Math.max(max, trade.pnl), 0),
    worst: trades.reduce((min, trade) => Math.min(min, trade.pnl), 0),
    volume: trades.reduce((sum, trade) => sum + turnover(trade), 0),
    avgR: rs.length > 0 ? rs.reduce((sum, r) => sum + r, 0) / rs.length : null,
    drawdown: fall.value,
    drawdownPct: fall.pct,
    holdMinutes: held.length > 0 ? held.reduce((sum, m) => sum + m, 0) / held.length : null,
  };
}

/** Разрез: строка таблицы со всем, что о группе сделок стоит знать. */
export interface Row {
  key: string;
  trades: number;
  wins: number;
  pnl: number;
  fees: number;
  /** Лучшая и худшая сделка группы. */
  best: number;
  worst: number;
  /** Средний R по тем, у кого был стоп. Null - таких нет. */
  avgR: number | null;
  /** Среднее время в сделке, минуты. Null - время открытия неизвестно. */
  holdMinutes: number | null;
}

/**
 * Разрез по любому признаку: монета, сторона, сессия, день, час, исход.
 *
 * Отдельно от `group`: тому хватает трёх чисел на подпись под столбиком, а
 * таблице нужны крайние сделки, средний R и время удержания. Считать их
 * вторым проходом по каждой группе значило бы пробежать журнал шесть раз
 * вместо одного.
 */
export function breakdown(
  trades: readonly JournalTrade[],
  key: (trade: JournalTrade) => string | null,
): Row[] {
  const out = new Map<string, { row: Row; rs: number[]; held: number[] }>();

  for (const trade of trades) {
    const name = key(trade);
    if (name === null) continue;
    const found = out.get(name) ?? {
      row: {
        key: name,
        trades: 0,
        wins: 0,
        pnl: 0,
        fees: 0,
        best: 0,
        worst: 0,
        avgR: null,
        holdMinutes: null,
      },
      rs: [],
      held: [],
    };

    const r = rMultiple(trade);
    if (r !== null) found.rs.push(r);

    const from = time(trade.opened_at);
    const to = time(trade.closed_at);
    if (from !== null && to !== null && to >= from) found.held.push((to - from) / MINUTE);

    found.row = {
      ...found.row,
      trades: found.row.trades + 1,
      wins: found.row.wins + (trade.pnl > 0 ? 1 : 0),
      pnl: found.row.pnl + trade.pnl,
      fees: found.row.fees + (trade.fee || 0),
      best: Math.max(found.row.best, trade.pnl),
      worst: Math.min(found.row.worst, trade.pnl),
    };
    out.set(name, found);
  }

  return [...out.values()].map(({ row, rs, held }) => ({
    ...row,
    avgR: rs.length > 0 ? rs.reduce((sum, r) => sum + r, 0) / rs.length : null,
    holdMinutes: held.length > 0 ? held.reduce((sum, m) => sum + m, 0) / held.length : null,
  }));
}

/**
 * Торговые сессии по часу входа.
 *
 * Границы местные, а не биржевые: журнал показывают тому, кто торговал, и
 * «утро» для него - это утро на его часах. Рынок круглосуточный, и точные
 * часы открытия площадок тут ничего не решают.
 */
export const SESSIONS: { key: string; from: number; to: number }[] = [
  { key: "asia", from: 0, to: 8 },
  { key: "europe", from: 8, to: 14 },
  { key: "usa", from: 14, to: 21 },
  { key: "night", from: 21, to: 24 },
];

/** В какую сессию попал вход. */
export function sessionOf(trade: JournalTrade): string | null {
  const ms = time(trade.opened_at) ?? time(trade.closed_at);
  if (ms === null) return null;
  const hour = new Date(ms).getHours();
  return SESSIONS.find((one) => hour >= one.from && hour < one.to)?.key ?? null;
}

/**
 * Ровный темп: та же прибыль, но по чуть-чуть каждую сделку.
 *
 * Нужна как линия сравнения под кривой капитала. Своего смысла у неё нет -
 * она показывает ровно одно: шёл счёт ступенями или рос равномерно. Кривая,
 * которая держится выше ровной линии, а потом падает под неё, говорит о
 * серии, вытянувшей период, - и это видно только рядом с прямой.
 */
export function evenPace(points: readonly EquityPoint[]): number[] {
  if (points.length === 0) return [];
  const last = points[points.length - 1].value;
  const step = last / points.length;
  return points.map((_, i) => step * (i + 1));
}

/** Изменение к прошлому периоду: в долях. Null - сравнивать не с чем. */
export function change(now: number, before: number): number | null {
  if (!Number.isFinite(now) || !Number.isFinite(before)) return null;
  if (before === 0) return null;
  return (now - before) / Math.abs(before);
}

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

/** Серии подряд: лучшая победная, худшая убыточная и та, что идёт сейчас. */
export function streaks(trades: readonly JournalTrade[]): {
  bestWins: number;
  worstLosses: number;
  current: number;
} {
  let bestWins = 0;
  let worstLosses = 0;
  let current = 0;
  for (const trade of inOrder(trades)) {
    if (trade.pnl > 0) current = current > 0 ? current + 1 : 1;
    else if (trade.pnl < 0) current = current < 0 ? current - 1 : -1;
    else continue;
    bestWins = Math.max(bestWins, current);
    worstLosses = Math.min(worstLosses, current);
  }
  return { bestWins, worstLosses: Math.abs(worstLosses), current };
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

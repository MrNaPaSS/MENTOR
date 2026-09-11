// Статистика журнала для отчёта: всё, что рисуется диаграммами.
//
// Отдельно от вёрстки отчёта: числа проверяются тестами, а вёрстка - глазами.
// Если в отчёте окажется неверная просадка, искать её надо здесь, а не среди
// SVG-разметки.

import type { JournalTrade } from "./journal";

export type EquityPoint = { at: string; value: number };
export type DayResult = { day: string; pnl: number; count: number };
export type SymbolResult = { symbol: string; pnl: number; count: number; wins: number };
export type SideResult = { count: number; pnl: number; wins: number };

export type JournalStats = {
  count: number;
  wins: number;
  losses: number;
  /** Итог около нуля: не победа и не поражение, в винрейт не входит. */
  flat: number;
  /** Доля прибыльных среди сделок с результатом, в процентах. */
  winRate: number;
  pnl: number;
  fees: number;
  /** Сумма прибыльных и сумма убыточных (по модулю). */
  grossProfit: number;
  grossLoss: number;
  /** Сколько заработано на каждый потерянный доллар. null - убытков не было. */
  profitFactor: number | null;
  avgWin: number;
  avgLoss: number;
  best: number;
  worst: number;
  /** Самая глубокая просадка кривой капитала от её пика, в деньгах. */
  maxDrawdown: number;
  /** Оборот: вход и выход каждой сделки. */
  volume: number;
  longestWinStreak: number;
  longestLossStreak: number;
  from: string | null;
  to: string | null;
  equity: EquityPoint[];
  days: DayResult[];
  symbols: SymbolResult[];
  outcomes: { take: number; stop: number; manual: number };
  long: SideResult;
  short: SideResult;
  /** Итог по часу закрытия, 0-23 по местному времени. */
  hours: number[];
};

/** Результат меньше цента - это ноль: комиссия и округление, а не исход. */
const FLAT = 0.005;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function localDay(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function journalStats(input: readonly JournalTrade[]): JournalStats {
  // По времени закрытия, от старых к новым: кривая капитала и серии идут так.
  const trades = [...input].sort(
    (a, b) => new Date(a.closed_at).getTime() - new Date(b.closed_at).getTime(),
  );

  const winsList = trades.filter((t) => t.pnl > FLAT);
  const lossList = trades.filter((t) => t.pnl < -FLAT);
  const grossProfit = winsList.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(lossList.reduce((s, t) => s + t.pnl, 0));
  const pnl = trades.reduce((s, t) => s + t.pnl, 0);

  // Кривая капитала и просадка от пика.
  const equity: EquityPoint[] = [];
  let running = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const t of trades) {
    running += t.pnl;
    peak = Math.max(peak, running);
    maxDrawdown = Math.max(maxDrawdown, peak - running);
    equity.push({ at: t.closed_at, value: round(running) });
  }

  // Серии подряд.
  let winRun = 0;
  let lossRun = 0;
  let longestWinStreak = 0;
  let longestLossStreak = 0;
  for (const t of trades) {
    if (t.pnl > FLAT) {
      winRun += 1;
      lossRun = 0;
    } else if (t.pnl < -FLAT) {
      lossRun += 1;
      winRun = 0;
    }
    longestWinStreak = Math.max(longestWinStreak, winRun);
    longestLossStreak = Math.max(longestLossStreak, lossRun);
  }

  const dayMap = new Map<string, DayResult>();
  const symbolMap = new Map<string, SymbolResult>();
  const hours = Array.from({ length: 24 }, () => 0);
  const side = (): SideResult => ({ count: 0, pnl: 0, wins: 0 });
  const long = side();
  const short = side();
  const outcomes = { take: 0, stop: 0, manual: 0 };
  let volume = 0;
  let fees = 0;

  for (const t of trades) {
    const day = localDay(t.closed_at);
    const d = dayMap.get(day) ?? { day, pnl: 0, count: 0 };
    dayMap.set(day, { day, pnl: d.pnl + t.pnl, count: d.count + 1 });

    const s = symbolMap.get(t.symbol) ?? { symbol: t.symbol, pnl: 0, count: 0, wins: 0 };
    symbolMap.set(t.symbol, {
      symbol: t.symbol,
      pnl: s.pnl + t.pnl,
      count: s.count + 1,
      wins: s.wins + (t.pnl > FLAT ? 1 : 0),
    });

    hours[new Date(t.closed_at).getHours()] += t.pnl;
    const bucket = t.side === "long" ? long : short;
    bucket.count += 1;
    bucket.pnl += t.pnl;
    bucket.wins += t.pnl > FLAT ? 1 : 0;
    if (t.outcome in outcomes) outcomes[t.outcome] += 1;
    volume += (t.entry + (t.exit_price ?? t.entry)) * t.qty;
    fees += t.fee || 0;
  }

  const decided = winsList.length + lossList.length;
  return {
    count: trades.length,
    wins: winsList.length,
    losses: lossList.length,
    flat: trades.length - decided,
    winRate: decided ? round((winsList.length / decided) * 100) : 0,
    pnl: round(pnl),
    fees: round(fees),
    grossProfit: round(grossProfit),
    grossLoss: round(grossLoss),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : null,
    avgWin: winsList.length ? round(grossProfit / winsList.length) : 0,
    avgLoss: lossList.length ? round(-grossLoss / lossList.length) : 0,
    best: round(Math.max(0, ...trades.map((t) => t.pnl))),
    worst: round(Math.min(0, ...trades.map((t) => t.pnl))),
    maxDrawdown: round(maxDrawdown),
    volume: round(volume),
    longestWinStreak,
    longestLossStreak,
    from: trades[0]?.closed_at ?? null,
    to: trades.at(-1)?.closed_at ?? null,
    equity,
    days: [...dayMap.values()].map((d) => ({ ...d, pnl: round(d.pnl) })),
    symbols: [...symbolMap.values()]
      .map((s) => ({ ...s, pnl: round(s.pnl) }))
      .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)),
    outcomes,
    long: { ...long, pnl: round(long.pnl) },
    short: { ...short, pnl: round(short.pnl) },
    hours: hours.map(round),
  };
}

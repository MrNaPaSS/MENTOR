// Расширенная аналитика: арифметика по журналу сделок.
//
// Здесь проверяется то, по чему трейдер судит о своей торговле: риск сделки,
// результат в риске, просадка от пика и профит-фактор. Ошибка в любой из этих
// величин не выглядит ошибкой - она выглядит как чужая статистика.

import { describe, expect, it } from "vitest";

import {
  byHour,
  byOutcome,
  bySide,
  bySymbol,
  byWeekday,
  drawdown,
  equityCurve,
  inOrder,
  rDistribution,
  rMultiple,
  risk,
  streaks,
  summarize,
  turnover,
} from "@/lib/analytics/advanced";
import type { JournalTrade } from "@/lib/journal";

let counter = 0;

function trade(over: Partial<JournalTrade> = {}): JournalTrade {
  counter += 1;
  return {
    id: counter,
    client_id: `c${counter}`,
    symbol: "BTCUSDT",
    side: "long",
    entry: 100,
    stop: 90,
    exit_price: 110,
    qty: 1,
    margin: 10,
    leverage: 10,
    takes_hit: 1,
    fee: 0.5,
    targets: [110],
    outcome: "take",
    pnl: 10,
    opened_at: "2026-09-01T10:00:00Z",
    closed_at: "2026-09-01T10:30:00Z",
    note: "",
    ...over,
  };
}

// ── риск и результат в риске ─────────────────────────────────────────────────

describe("риск сделки", () => {
  it("это расстояние до стопа на объём", () => {
    expect(risk(trade({ entry: 100, stop: 90, qty: 2 }))).toBe(20);
    // Шорт: стоп выше входа, риск тот же по величине.
    expect(risk(trade({ side: "short", entry: 100, stop: 110, qty: 2 }))).toBe(20);
  });

  it("стоп на цене входа - риска нет, и в статистику такая сделка не идёт", () => {
    const flat = trade({ entry: 100, stop: 100 });
    expect(risk(flat)).toBe(0);
    expect(rMultiple(flat)).toBeNull();
  });

  it("результат делится на риск", () => {
    expect(rMultiple(trade({ entry: 100, stop: 90, qty: 1, pnl: 30 }))).toBe(3);
    expect(rMultiple(trade({ entry: 100, stop: 90, qty: 1, pnl: -10 }))).toBe(-1);
  });
});

describe("оборот", () => {
  it("считает обе ноги: с них берут комиссию", () => {
    expect(turnover(trade({ entry: 100, exit_price: 120, qty: 2 }))).toBe(440);
  });

  it("сделка без цены выхода считается по входу, а не роняет расчёт", () => {
    expect(turnover(trade({ entry: 100, exit_price: null, qty: 1 }))).toBe(200);
  });
});

// ── кривая капитала ──────────────────────────────────────────────────────────

describe("кривая капитала", () => {
  const trades = [
    trade({ pnl: 10, closed_at: "2026-09-02T10:00:00Z" }),
    trade({ pnl: -4, closed_at: "2026-09-01T10:00:00Z" }),
    trade({ pnl: 6, closed_at: "2026-09-03T10:00:00Z" }),
  ];

  it("идёт по времени закрытия, а не по порядку в списке", () => {
    expect(inOrder(trades).map((t) => t.pnl)).toEqual([-4, 10, 6]);
  });

  it("копит итог", () => {
    expect(equityCurve(trades).map((p) => p.value)).toEqual([-4, 6, 12]);
  });
});

describe("просадка", () => {
  it("считается от пика, а не от итога", () => {
    const points = equityCurve([
      trade({ pnl: 100, closed_at: "2026-09-01T10:00:00Z" }),
      trade({ pnl: -40, closed_at: "2026-09-02T10:00:00Z" }),
      trade({ pnl: 10, closed_at: "2026-09-03T10:00:00Z" }),
    ]);
    const fall = drawdown(points);
    expect(fall.value).toBe(40);
    expect(fall.pct).toBeCloseTo(0.4, 9);
  });

  it("счёт всё время в минусе - доли нет, делить не на что", () => {
    const points = equityCurve([
      trade({ pnl: -10, closed_at: "2026-09-01T10:00:00Z" }),
      trade({ pnl: -5, closed_at: "2026-09-02T10:00:00Z" }),
    ]);
    const fall = drawdown(points);
    expect(fall.value).toBe(15);
    expect(fall.pct).toBe(0);
  });
});

describe("серии", () => {
  it("считает лучшую, худшую и текущую", () => {
    const trades = [
      trade({ pnl: 5, closed_at: "2026-09-01T10:00:00Z" }),
      trade({ pnl: 5, closed_at: "2026-09-02T10:00:00Z" }),
      trade({ pnl: 5, closed_at: "2026-09-03T10:00:00Z" }),
      trade({ pnl: -5, closed_at: "2026-09-04T10:00:00Z" }),
      trade({ pnl: -5, closed_at: "2026-09-05T10:00:00Z" }),
    ];
    expect(streaks(trades)).toEqual({ bestWins: 3, worstLosses: 2, current: -2 });
  });

  it("ноль серию не обрывает и не продолжает", () => {
    const trades = [
      trade({ pnl: 5, closed_at: "2026-09-01T10:00:00Z" }),
      trade({ pnl: 0, closed_at: "2026-09-02T10:00:00Z" }),
      trade({ pnl: 5, closed_at: "2026-09-03T10:00:00Z" }),
    ];
    expect(streaks(trades).bestWins).toBe(2);
  });
});

// ── разрезы ──────────────────────────────────────────────────────────────────

describe("разрезы", () => {
  const trades = [
    trade({ symbol: "BTCUSDT", side: "long", outcome: "take", pnl: 30 }),
    trade({ symbol: "ETHUSDT", side: "short", outcome: "stop", pnl: -10 }),
    trade({ symbol: "ETHUSDT", side: "short", outcome: "manual", pnl: 4 }),
  ];

  it("по монетам - от лучшей к худшей", () => {
    const rows = bySymbol(trades);
    expect(rows.map((r) => r.key)).toEqual(["BTCUSDT", "ETHUSDT"]);
    expect(rows[1]).toMatchObject({ trades: 2, pnl: -6, wins: 1 });
  });

  it("по стороне и по исходу", () => {
    expect(bySide(trades).find((r) => r.key === "short")).toMatchObject({ trades: 2, pnl: -6 });
    expect(byOutcome(trades).map((r) => r.key).sort()).toEqual(["manual", "stop", "take"]);
  });

  it("неделя начинается с понедельника", () => {
    // 7 сентября 2026 - понедельник.
    const week = byWeekday([trade({ pnl: 3, closed_at: "2026-09-07T12:00:00Z" })]);
    expect(week).toHaveLength(7);
    expect(week[0].trades).toBe(1);
    expect(week[6].trades).toBe(0);
  });

  it("часы считаются по входу и покрывают сутки целиком", () => {
    const hours = byHour([trade({ opened_at: "2026-09-01T08:00:00Z", pnl: 2 })]);
    expect(hours).toHaveLength(24);
    expect(hours.reduce((sum, h) => sum + h.trades, 0)).toBe(1);
  });
});

describe("распределение по риску", () => {
  it("раскладывает сделки по корзинам R", () => {
    const rows = rDistribution([
      trade({ entry: 100, stop: 90, qty: 1, pnl: -25 }), // -2.5R
      trade({ entry: 100, stop: 90, qty: 1, pnl: -10 }), // -1R
      trade({ entry: 100, stop: 90, qty: 1, pnl: 15 }), // +1.5R
      trade({ entry: 100, stop: 90, qty: 1, pnl: 40 }), // +4R
    ]);
    const count = Object.fromEntries(rows.map((r) => [r.key, r.trades]));
    expect(count["<-2R"]).toBe(1);
    expect(count["-2R..-1R"]).toBe(1);
    expect(count["1R..2R"]).toBe(1);
    expect(count[">3R"]).toBe(1);
  });

  it("сделки без стопа в распределение не попадают", () => {
    const rows = rDistribution([trade({ entry: 100, stop: 100, pnl: 10 })]);
    expect(rows.reduce((sum, r) => sum + r.trades, 0)).toBe(0);
  });
});

// ── итоги ────────────────────────────────────────────────────────────────────

describe("итоги периода", () => {
  const trades = [
    trade({ pnl: 30, fee: 1, closed_at: "2026-09-01T10:00:00Z" }),
    trade({ pnl: -10, fee: 1, closed_at: "2026-09-02T10:00:00Z" }),
    trade({ pnl: 0, fee: 1, closed_at: "2026-09-03T10:00:00Z" }),
  ];

  it("винрейт считается без сделок в ноль", () => {
    const totals = summarize(trades);
    expect(totals.trades).toBe(3);
    expect(totals.flat).toBe(1);
    expect(totals.winRate).toBeCloseTo(0.5, 9);
  });

  it("профит-фактор и средние", () => {
    const totals = summarize(trades);
    expect(totals.profitFactor).toBeCloseTo(3, 9);
    expect(totals.avgWin).toBe(30);
    expect(totals.avgLoss).toBe(10);
    expect(totals.expectancy).toBeCloseTo(20 / 3, 9);
    expect(totals.net).toBe(20);
    expect(totals.fees).toBe(3);
  });

  it("без убытков профит-фактор не выдумывается", () => {
    expect(summarize([trade({ pnl: 5 })]).profitFactor).toBeNull();
  });

  it("среднее время в сделке - по тем, у кого известно открытие", () => {
    const totals = summarize([
      trade({ opened_at: "2026-09-01T10:00:00Z", closed_at: "2026-09-01T10:30:00Z" }),
      trade({ opened_at: null, closed_at: "2026-09-01T12:00:00Z" }),
    ]);
    expect(totals.holdMinutes).toBe(30);
  });

  it("пустой журнал не роняет расчёт", () => {
    const totals = summarize([]);
    expect(totals.trades).toBe(0);
    expect(totals.winRate).toBe(0);
    expect(totals.avgR).toBeNull();
    expect(totals.drawdown).toBe(0);
  });
});

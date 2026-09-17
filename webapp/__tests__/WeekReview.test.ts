/**
 * Разбор недели: сессии, нарушения и поведение после убытка.
 *
 * Проверяется, что сводка собирается из фактов журнала и собственных отметок
 * трейдера, а не из догадок: неотмеченная сделка не даёт нарушений, а «после
 * убытка» считается по времени входа, а не по настроению.
 */

import { describe, it, expect } from "vitest";

import { weekReview, REVENGE_MINUTES } from "@/lib/weekReview";
import type { JournalRow } from "@/components/scalping/JournalTable";

function trade(over: Partial<JournalRow> = {}): JournalRow {
  return {
    id: 1,
    client_id: "a",
    symbol: "BTCUSDT",
    side: "long",
    entry: 100,
    stop: 90,
    exit_price: 110,
    qty: 1,
    margin: 100,
    leverage: 10,
    takes_hit: 1,
    fee: 0.1,
    targets: [110],
    outcome: "take",
    pnl: 10,
    opened_at: "2026-09-15T10:00:00Z",
    closed_at: "2026-09-15T11:00:00Z",
    note: "",
    ...over,
  } as JournalRow;
}

const WEEK = "2026-W38";

describe("разбор недели", () => {
  it("находит лучшую и худшую позицию", () => {
    const review = weekReview(
      [
        trade({ client_id: "a", symbol: "ETHUSDT", pnl: 40 }),
        trade({ client_id: "b", pnl: -25 }),
        trade({ client_id: "c", pnl: 5 }),
      ],
      WEEK,
    );
    expect(review.best?.symbol).toBe("ETHUSDT");
    expect(review.worst?.pnl).toBe(-25);
  });

  it("считает нарушения по отметкам и ставит частые выше", () => {
    const review = weekReview(
      [
        trade({ client_id: "a", plan_ok: false, mistakes: ["late", "risk"] }),
        trade({ client_id: "b", plan_ok: false, mistakes: ["late"] }),
        // Без отметок: своих кодов не добавляет.
        trade({ client_id: "c" }),
      ],
      WEEK,
    );
    expect(review.mistakes[0]).toEqual({ code: "late", count: 2 });
    expect(review.mistakes[1]).toEqual({ code: "risk", count: 1 });
  });

  it("раскладывает сделки по сессиям входа", () => {
    const review = weekReview(
      [
        // 03:00 UTC - Азия, 14:00 UTC - Нью-Йорк.
        trade({
          client_id: "a",
          opened_at: "2026-09-15T03:00:00Z",
          closed_at: "2026-09-15T04:00:00Z",
          pnl: 12,
        }),
        trade({
          client_id: "b",
          opened_at: "2026-09-15T14:00:00Z",
          closed_at: "2026-09-15T15:00:00Z",
          pnl: -8,
        }),
        trade({
          client_id: "c",
          opened_at: "2026-09-16T14:30:00Z",
          closed_at: "2026-09-16T15:00:00Z",
          pnl: -2,
        }),
      ],
      WEEK,
    );
    const ny = review.sessions.find((one) => one.name === "newYork");
    expect(ny?.trades).toBe(2);
    expect(ny?.pnl).toBeCloseTo(-10, 6);
    expect(review.sessions.find((one) => one.name === "asia")?.wins).toBe(1);
  });

  it("видит входы сразу после убытка и не считает остальные", () => {
    const review = weekReview(
      [
        trade({
          client_id: "loss",
          opened_at: "2026-09-15T09:00:00Z",
          closed_at: "2026-09-15T10:00:00Z",
          pnl: -30,
        }),
        // Через пять минут после убытка: отыгрыш.
        trade({
          client_id: "back",
          opened_at: "2026-09-15T10:05:00Z",
          closed_at: "2026-09-15T10:30:00Z",
          pnl: -12,
        }),
        // Через два часа: обычный вход.
        trade({
          client_id: "calm",
          opened_at: "2026-09-15T12:00:00Z",
          closed_at: "2026-09-15T12:30:00Z",
          pnl: 20,
        }),
      ],
      WEEK,
    );
    expect(review.revenge.trades).toBe(1);
    expect(review.revenge.pnl).toBeCloseTo(-12, 6);
    expect(review.revenge.minutes).toBe(REVENGE_MINUTES);
  });

  it("на пустой неделе ничего не выдумывает", () => {
    const review = weekReview([], WEEK);
    expect(review.best).toBeNull();
    expect(review.worst).toBeNull();
    expect(review.sessions).toEqual([]);
    expect(review.revenge.trades).toBe(0);
  });
});

// Какая биржа показывается и как выглядит клетка одной биржи.
//
// Журнал, расширенная аналитика и календарь показывают один счёт за раз: суммы
// двух бирж в одной строке отчёта не сходятся ни с одним из них. Здесь
// проверяется, что экран выбирает биржу предсказуемо и что клетка дня в
// разрезе не приписывает себе чужие сделки.

import { describe, expect, it } from "vitest";

import { chooseVenue, freshChoice, venueLabel } from "@/lib/venuePick";
import { dayOfVenue, monthTradesOf } from "@/lib/venueDay";
import type { CalendarDay } from "@/lib/api";

describe("выбор биржи", () => {
  it("не фильтрует, когда биржа одна", () => {
    expect(chooseVenue(["weex"], null, "weex")).toBe("");
    expect(chooseVenue([], null, "weex")).toBe("");
  });

  it("открывается на той, куда уходят новые сделки", () => {
    expect(chooseVenue(["weex", "okx"], null, "okx")).toBe("okx");
  });

  it("помнит выбор ученика и не спорит с ним", () => {
    expect(chooseVenue(["weex", "okx"], "weex", "okx")).toBe("weex");
  });

  it("уступает активной, когда выбранной биржи в списке нет", () => {
    // Счёт отключили или за период по нему нет сделок: пустой экран с
    // выбранной вручную биржей выглядит поломкой, а не фильтром.
    expect(chooseVenue(["weex", "okx"], "bybit", "okx")).toBe("okx");
  });

  it("берёт первую, когда активной тоже нет", () => {
    // Первая в списке - та, где сделок больше: так его собирает сервер.
    expect(chooseVenue(["okx", "weex"], null, "")).toBe("okx");
  });

  it("подписывает сделки без биржи отдельно", () => {
    expect(venueLabel("okx", "без биржи")).toBe("OKX");
    expect(venueLabel("none", "без биржи")).toBe("без биржи");
  });
});

function day(over: Partial<CalendarDay> = {}): CalendarDay {
  return {
    date: "2026-09-12",
    signals: 0,
    balance: null,
    pnl_pct: 30,
    journal_pnl: 30,
    journal_trades: 3,
    journal_volume: 1000,
    trade_volume: 5000,
    journal_by_exchange: [
      { exchange: "weex", pnl: 50, pnl_pct: 50, volume: 800, trades: 2 },
      { exchange: "okx", pnl: -20, pnl_pct: -20, volume: 200, trades: 1 },
    ],
    ...over,
  };
}

describe("клетка дня в разрезе биржи", () => {
  it("берёт числа своей биржи, а не общие", () => {
    const okx = dayOfVenue(day(), "okx");
    expect(okx.journal_pnl).toBe(-20);
    expect(okx.pnl_pct).toBe(-20);
    expect(okx.journal_trades).toBe(1);
  });

  it("день без сделок этой биржи честно пустой", () => {
    const bybit = dayOfVenue(day(), "bybit");
    expect(bybit.journal_pnl).toBe(0);
    expect(bybit.pnl_pct).toBe(0);
    expect(bybit.journal_trades).toBe(0);
  });

  it("не переносит оборот с биржи: он приходит на весь счёт сразу", () => {
    expect(dayOfVenue(day(), "weex").trade_volume).toBe(0);
    expect(dayOfVenue(day(), "weex").journal_volume).toBe(800);
  });

  it("оставляет исходную клетку нетронутой", () => {
    const source = day();
    dayOfVenue(source, "okx");
    expect(source.journal_pnl).toBe(30);
  });

  it("считает сделки биржи за месяц", () => {
    expect(monthTradesOf([day(), day({ date: "2026-09-13" })], "weex")).toBe(4);
    expect(monthTradesOf([day()], "bybit")).toBe(0);
  });
});


// Ученик переключает счёт в профиле, чтобы торговать на другой бирже. Журнал,
// календарь и аналитика обязаны пойти за ним: раньше выбор, сделанный однажды,
// перебивал активную биржу навсегда, и на второй подключённой бирже трейдер
// видел в журнале старую.

describe("выбор уступает смене активной биржи", () => {
  it("активная сменилась - запомненный выбор больше не в счёт", () => {
    expect(freshChoice({ venue: "weex", forActive: "weex" }, "okx")).toBeNull();
  });

  it("активная та же - ручной выбор держится", () => {
    expect(freshChoice({ venue: "weex", forActive: "okx" }, "okx")).toBe("weex");
  });

  it("прежнее написание памяти читается как есть", () => {
    // Раньше хранилась одна строка, без памяти об активной бирже.
    expect(freshChoice({ venue: "mexc", forActive: "" }, "okx")).toBe("mexc");
  });

  it("активной нет - показываем запомненное", () => {
    expect(freshChoice({ venue: "mexc", forActive: "weex" }, undefined)).toBe("mexc");
    expect(freshChoice(null, "okx")).toBeNull();
  });

  it("после смены активной экран показывает именно её", () => {
    const stale = freshChoice({ venue: "weex", forActive: "weex" }, "binance");
    expect(chooseVenue(["weex", "binance", "okx"], stale, "binance")).toBe("binance");
  });
});

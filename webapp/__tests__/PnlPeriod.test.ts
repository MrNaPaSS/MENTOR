import { describe, expect, it } from "vitest";

import type { CalendarDay } from "@/lib/api";
import { cardFromPeriod } from "@/lib/pnl/data";
import { daysOf, periodOf } from "@/lib/pnl/period";

function day(over: Partial<CalendarDay> & { date: string }): CalendarDay {
  return {
    signals: 0,
    balance: 1000,
    pnl_pct: 0,
    estimated: false,
    journal_pnl: 0,
    journal_trades: 0,
    ...over,
  };
}

// Сентябрь 2026: 1-е - вторник, значит неделя 7-13 это понедельник-воскресенье.
const MONTH: CalendarDay[] = [
  day({ date: "2026-09-05", pnl_pct: 2.4, journal_pnl: 24, journal_trades: 3 }),
  day({ date: "2026-09-06", pnl_pct: 1.5, journal_pnl: 15, journal_trades: 2 }),
  day({ date: "2026-09-07", pnl_pct: 1.7, journal_pnl: 17, journal_trades: 4 }),
  day({ date: "2026-09-08", pnl_pct: -0.5, journal_pnl: -5, journal_trades: 1 }),
];

describe("срок карточки", () => {
  it("неделя календарная, с понедельника по воскресенье", () => {
    // Не «последние семь суток»: сетка над кнопками размечена неделями, и срок
    // должен совпасть с тем, что обведено глазами.
    expect(daysOf(MONTH, "week", "2026-09-08").map((d) => d.date)).toEqual([
      "2026-09-07",
      "2026-09-08",
    ]);
    expect(daysOf(MONTH, "week", "2026-09-06").map((d) => d.date)).toEqual([
      "2026-09-05",
      "2026-09-06",
    ]);
  });

  it("день - только он сам, месяц - всё, что пришло", () => {
    expect(daysOf(MONTH, "day", "2026-09-07").map((d) => d.date)).toEqual(["2026-09-07"]);
    expect(daysOf(MONTH, "month", "2026-09-07")).toHaveLength(4);
  });

  it("итог складывается по тем же дням, что и полоса под календарём", () => {
    const p = periodOf(MONTH, "month", "2026-09-08")!;
    expect(p.roi).toBeCloseTo(5.1, 6);
    expect(p.pnl).toBeCloseTo(51, 6);
    expect(p.trades).toBe(10);
    expect(p.winDays).toBe(3);
    expect(p.tradeDays).toBe(4);
    expect(p.title).toBe("Сентябрь 2026");
  });

  it("день на оценке в сводку не идёт", () => {
    // Его процент стоит на перенесённой базе, и сложить его с остальными -
    // значит выдать оценку за факт. Полоса итогов отбирает так же.
    const withGuess = [
      ...MONTH,
      day({ date: "2026-09-09", pnl_pct: 99, journal_pnl: 990, journal_trades: 9, estimated: true }),
    ];
    const p = periodOf(withGuess, "month", "2026-09-09")!;
    expect(p.roi).toBeCloseTo(5.1, 6);
    expect(p.trades).toBe(10);
  });

  it("пустой календарь не роняет страницу", () => {
    // Кнопки сроков рисуются сразу, а календарь приезжает запросом: на первом
    // кадре дней нет и опорной даты тоже. Неделя считала из неё границы, и
    // Invalid Date роняла всю аналитику клиентским исключением.
    for (const span of ["day", "week", "month"] as const) {
      expect(() => periodOf([], span, "")).not.toThrow();
      expect(periodOf([], span, "")).toBeNull();
      expect(daysOf([], span, "")).toEqual([]);
    }
  });

  it("без сделок карточки нет", () => {
    // «+0,00% за 0 сделок» выглядит как результат, хотя означает пустоту.
    const quiet = [day({ date: "2026-09-01" }), day({ date: "2026-09-02" })];
    expect(periodOf(quiet, "month", "2026-09-02")).toBeNull();
    expect(periodOf(MONTH, "day", "2026-09-01")).toBeNull();
  });

  it("заголовок дня и недели - по-русски, с месяцем в родительном", () => {
    expect(periodOf(MONTH, "day", "2026-09-07")!.title).toBe("7 сентября");
    expect(periodOf(MONTH, "week", "2026-09-08")!.title).toBe("7 - 8 сентября");
  });
});

describe("карточка срока", () => {
  it("прибыльный срок идёт на бычьи заготовки, убыточный на медвежьи", () => {
    // Стороны у срока нет, а бланки нарисованы под неё: прибыльный месяц на
    // медвежьем листе читался бы наоборот.
    expect(cardFromPeriod(periodOf(MONTH, "month", "2026-09-08")!).side).toBe("long");
    expect(cardFromPeriod(periodOf(MONTH, "day", "2026-09-08")!).side).toBe("short");
  });

  it("считает сделки по-русски", () => {
    const one = cardFromPeriod(periodOf(MONTH, "day", "2026-09-08")!);
    expect(one.rows).toContainEqual(["Сделок", "1 сделка"]);
    const many = cardFromPeriod(periodOf(MONTH, "month", "2026-09-08")!);
    expect(many.rows).toContainEqual(["Сделок", "10 сделок"]);
    const few = cardFromPeriod(periodOf(MONTH, "day", "2026-09-07")!);
    expect(few.rows).toContainEqual(["Сделок", "4 сделки"]);
  });

  it("один день подписан датой, срок - границами", () => {
    expect(cardFromPeriod(periodOf(MONTH, "day", "2026-09-07")!).footer).toEqual([
      "Дата",
      "07.09.2026",
    ]);
    expect(cardFromPeriod(periodOf(MONTH, "month", "2026-09-08")!).footer).toEqual([
      "Период",
      "05.09.2026 - 08.09.2026",
    ]);
  });
});

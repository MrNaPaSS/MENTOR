// Бланк сигнала: как на нём читаются пара, цены и время.
//
// Само рисование холстом здесь не проверяется - в тестах его нет. Проверяется
// то, из-за чего бланк выходит неверным чаще всего: пара с хвостом биржи,
// цена без нужной точности и время без часового пояса.

import { describe, expect, it } from "vitest";

import { pairOf, price, stamped, templateFor, SIGNAL_TEMPLATES } from "@/lib/signal/card";

describe("пара на бланке", () => {
  it("отделяет монету от котировки", () => {
    expect(pairOf("BTCUSDT")).toBe("BTC / USDT");
    expect(pairOf("ETHUSDC")).toBe("ETH / USDC");
  });

  it("не режет то, что не оканчивается котировкой", () => {
    expect(pairOf("XAUUSD")).toBe("XAU / USD");
    expect(pairOf("SOMETHING")).toBe("SOMETHING");
  });

  it("пустую пару показывает прочерком, а не пустотой", () => {
    expect(pairOf("")).toBe("—");
  });
});

describe("цена на бланке", () => {
  it("у дорогих монет две цифры после точки", () => {
    expect(price(78647.3)).toContain("78");
    expect(price(78647.3).endsWith("30")).toBe(true);
  });

  it("у дешёвых монет точность выше - иначе цена превращается в ноль", () => {
    expect(price(0.00004321)).toContain("0,000043");
  });

  it("пустое место занимает прочерк, а не ноль", () => {
    // Ноль на месте цели читался бы как цель по нулю.
    expect(price(null)).toBe("—");
    expect(price(Number.NaN)).toBe("—");
  });
});

describe("время на бланке", () => {
  it("несёт часовой пояс: без него дата ничего не заверяет", () => {
    expect(stamped("2026-09-08T12:30:00Z")).toMatch(/UTC[+−]\d/);
  });
});

describe("бланки", () => {
  it("свой на каждую сторону", () => {
    expect(templateFor("long").side).toBe("long");
    expect(templateFor("short").side).toBe("short");
  });

  it("у обоих есть место под все поля и под печать", () => {
    for (const template of SIGNAL_TEMPLATES) {
      for (const box of [
        template.pair,
        template.leverage,
        template.entry,
        template.stop,
        template.target,
        template.time,
        template.stamp,
      ]) {
        // Доли, а не пиксели: бланк рисуется в двойном размере, и пиксели
        // разъехались бы вместе с ним.
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.w).toBeLessThanOrEqual(1);
        expect(box.y + box.h).toBeLessThanOrEqual(1);
      }
    }
  });

  it("поля значений не наезжают друг на друга", () => {
    const t = templateFor("long");
    expect(t.entry.x + t.entry.w).toBeLessThan(t.stop.x);
    expect(t.stop.x + t.stop.w).toBeLessThan(t.target.x);
  });

  it("печать стоит справа внизу - там, где на бланке её рамка", () => {
    const t = templateFor("short");
    expect(t.stamp.x).toBeGreaterThan(0.7);
    expect(t.stamp.y).toBeGreaterThan(0.6);
  });
});

import { describe, it, expect } from "vitest";
import {
  MISSING_HOLD_MS,
  MISSING_TOLERANCE,
  noteMiss,
  shouldBury,
  type Miss,
} from "@/lib/trade/missing";
import { readBook } from "@/lib/trade/exchange";

// 10 сентября две живые сделки по ETH ушли с графика от двух пустых ответов
// биржи подряд, пришедших за 2.2 секунды. Позиция при этом стояла на бирже, а
// трейдер остался с пустым экраном. Эти тесты держат выдержку на месте.

/** Промахи подряд с шагом в секунды: как их видит круг опроса. */
function misses(steps: number[]): { miss: Miss; now: number } {
  let now = 0;
  let miss = noteMiss(undefined, now);
  for (const step of steps) {
    now += step * 1000;
    miss = noteMiss(miss, now);
  }
  return { miss, now };
}

describe("пустой ответ биржи и живая сделка", () => {
  it("один пустой ответ не хоронит сделку", () => {
    const miss = noteMiss(undefined, 1000);
    expect(miss.seen).toBe(1);
    expect(shouldBury(miss, 1000, false)).toBe(false);
  });

  it("быстрый повтор одного ответа не считается вторым мнением", () => {
    // Переспросили через восемь десятых секунды - это тот же самый ответ.
    const { miss, now } = misses([0.8]);
    expect(miss.seen).toBe(1);
    expect(shouldBury(miss, now, false)).toBe(false);
  });

  it("случай 10 сентября: две пустоты за 2.2 секунды сделку не хоронят", () => {
    // Так это и выглядело в журнале терминала: 18:04:16 и 18:04:18, а следом
    // запись о закрытии сделки, которая на бирже стояла ещё полчаса.
    const { miss, now } = misses([0.8, 1.4]);
    expect(miss.seen).toBeLessThan(MISSING_TOLERANCE);
    expect(shouldBury(miss, now, false)).toBe(false);
    expect(shouldBury(miss, now, null)).toBe(false);
  });

  it("трёх разнесённых промахов мало, пока не выдержано время", () => {
    const { miss, now } = misses([3, 3]);
    expect(miss.seen).toBe(MISSING_TOLERANCE);
    expect(now - miss.since).toBeLessThan(MISSING_HOLD_MS);
    expect(shouldBury(miss, now, false)).toBe(false);
  });

  it("пустота, которая держится, - это закрытая позиция", () => {
    const { miss, now } = misses([4, 4, 4]);
    expect(shouldBury(miss, now, false)).toBe(true);
  });

  it("пока сделку ведёт сопровождение, хоронить её нельзя", () => {
    // Второе мнение: биржа молчит, а сервер сделку ведёт - значит заминка.
    const { miss, now } = misses([4, 4, 4, 4, 4]);
    expect(shouldBury(miss, now, true)).toBe(false);
  });

  it("сервер не ответил - тоже ждём", () => {
    const { miss, now } = misses([4, 4, 4]);
    expect(shouldBury(miss, now, null)).toBe(false);
  });

  it("позиция вернулась - счёт начинается заново", () => {
    const { miss, now } = misses([4, 4]);
    // Между кругами биржа показала позицию: терминал забывает прошлую пустоту.
    const fresh = noteMiss(undefined, now + 3000);
    expect(fresh.seen).toBe(1);
    expect(shouldBury(fresh, now + 3000, false)).toBe(false);
  });
});

describe("снимок позиций отличает пустоту по монете от пустого ответа", () => {
  it("считает строки всего ответа и по каждой монете", () => {
    const book = readBook([
      { symbol: "BTCUSDT", positionSide: "LONG", total: "0.5", averageOpenPrice: "78000" },
      { symbol: "ETHUSDT", positionSide: "SHORT", total: "20", averageOpenPrice: "2460" },
    ]);
    expect(book.total).toBe(2);
    expect(book.rowsOf.ETHUSDT).toBe(1);
    expect(book.byKey["ETHUSDT:short"].size).toBe(20);
    expect(book.byKey["BTCUSDT:short"]).toBeUndefined();
  });

  it("пустой ответ виден как пустой", () => {
    const book = readBook([]);
    expect(book.total).toBe(0);
    expect(Object.keys(book.byKey)).toHaveLength(0);
  });

  it("строку без стороны записывает под обе: в одностороннем режиме позиция одна", () => {
    const book = readBook([{ symbol: "BTCUSDT", total: "1.5" }]);
    expect(book.byKey["BTCUSDT:long"].size).toBe(1.5);
    expect(book.byKey["BTCUSDT:short"].size).toBe(1.5);
  });

  it("плавающий результат отдаёт за вычетом комиссии входа", () => {
    // Биржа отдаёт его до неё, а в своём приложении показывает уже после.
    const book = readBook([
      {
        symbol: "ETHUSDT",
        holdSide: "short",
        size: "14.1575",
        cumOpenSize: "20.225",
        cumOpenValue: "49998.42",
        cumOpenFee: "8",
        unrealizePnl: "20",
      },
    ]);
    expect(book.byKey["ETHUSDT:short"].unrealized).toBeCloseTo(20 - 5.6, 6);
  });
});

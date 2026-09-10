import { describe, it, expect } from "vitest";
import {
  blendedRate,
  cashbackShare,
  monthlyCommission,
  outcomeFor,
  planOutcome,
  subscriptionBreakeven,
  tierFor,
  upgradeBreakeven,
  yearlyAdvantage,
  MAX_CASHBACK_SHARE,
} from "@/lib/broker/economics";
import { CASHBACK_TIERS, EXCHANGES, exchangeById } from "@/lib/broker/program";
import { RIVAL_PLANS } from "@/lib/broker/rivals";

// Числа с этой страницы человек считает за нами на калькуляторе телефона.
// Разойдись они хоть в одном знаке - дальше он не поверит ничему, поэтому
// проверяем сами суммы, а не то, что функция вернула хоть что-то.

const weex = exchangeById("weex");

describe("средняя ставка", () => {
  it("торговля только по рынку - ставка тейкера", () => {
    expect(blendedRate(weex, 1)).toBeCloseTo(0.0008, 10);
  });

  it("торговля только лимитом - ставка мейкера", () => {
    expect(blendedRate(weex, 0)).toBeCloseTo(0.0002, 10);
  });

  it("половина на половину - середина между ставками", () => {
    expect(blendedRate(weex, 0.5)).toBeCloseTo(0.0005, 10);
  });

  it("доля вне отрезка не ломает расчёт", () => {
    expect(blendedRate(weex, 5)).toBeCloseTo(0.0008, 10);
    expect(blendedRate(weex, -3)).toBeCloseTo(0.0002, 10);
    expect(blendedRate(weex, NaN)).toBeCloseTo(0.0002, 10);
  });
});

describe("комиссия", () => {
  it("оборот на ставку", () => {
    expect(monthlyCommission(1_000_000, 0.0008)).toBeCloseTo(800, 10);
  });

  it("отрицательный оборот считается нулём, а не отрицательной комиссией", () => {
    expect(monthlyCommission(-100, 0.0008)).toBe(0);
  });
});

describe("уровни возврата", () => {
  it("уровень берётся по обороту за 30 дней", () => {
    expect(tierFor(0).id).toBe("base");
    expect(tierFor(999_999).id).toBe("base");
    expect(tierFor(1_000_000).id).toBe("active");
    expect(tierFor(5_000_000).id).toBe("pro");
    expect(tierFor(20_000_000).id).toBe("top");
    expect(tierFor(500_000_000).id).toBe("top");
  });

  it("пороги идут по возрастанию - иначе поиск с конца врёт", () => {
    const thresholds = CASHBACK_TIERS.map((t) => t.fromVolume);
    expect([...thresholds].sort((a, b) => a - b)).toEqual(thresholds);
  });

  it("ни один уровень не обещает больше, чем оставляет ребейт", () => {
    for (const tier of CASHBACK_TIERS) {
      expect(tier.share).toBeLessThanOrEqual(MAX_CASHBACK_SHARE);
    }
  });

  it("возврат ограничен потолком маржи, даже если уровень поднимут", () => {
    expect(cashbackShare(1_000_000_000)).toBeLessThanOrEqual(MAX_CASHBACK_SHARE);
  });
});

describe("расчёт трейдера", () => {
  // Пример из плана программы (§2): оборот $1M по рынку на ставке WEEX.
  const out = outcomeFor(weex, { monthlyVolume: 1_000_000, takerShare: 1 });

  it("комиссия за месяц - $800", () => {
    expect(out.commission).toBeCloseTo(800, 6);
  });

  it("на этом обороте действует уровень 30%", () => {
    expect(out.share).toBeCloseTo(0.3, 10);
    expect(out.cashback).toBeCloseTo(240, 6);
  });

  it("ставка после возврата ниже биржевой ровно на долю возврата", () => {
    expect(out.effectiveRate).toBeCloseTo(0.00056, 10);
  });

  it("за год возвращается двенадцать месячных возвратов", () => {
    expect(out.yearly).toBeCloseTo(2880, 6);
  });

  it("нулевой оборот - нулевые деньги, а не деление на ноль", () => {
    const zero = outcomeFor(weex, { monthlyVolume: 0, takerShare: 1 });
    expect(zero.commission).toBe(0);
    expect(zero.cashback).toBe(0);
    expect(zero.yearly).toBe(0);
    expect(Number.isFinite(zero.effectiveRate)).toBe(true);
  });
});

describe("подписочный тариф", () => {
  const [lite, pro, ultra] = RIVAL_PLANS;
  // Ставка тейкера на бирже, где такие тарифы и продают: 0.05%.
  const rate = 0.0005;

  it("на малом обороте абонплата съедает возврат целиком", () => {
    // Оборот $20k, комиссия $10, возврат по верхнему тарифу $4.5 против $99 платы.
    const outcome = planOutcome(monthlyCommission(20_000, rate), ultra);
    expect(outcome.cashback).toBeCloseTo(4.5, 6);
    expect(outcome.net).toBeCloseTo(-94.5, 6);
    expect(outcome.yearly).toBeCloseTo(-1134, 6);
  });

  it("порог, ниже которого тариф работает в минус", () => {
    expect(subscriptionBreakeven(lite, rate)).toBeCloseTo(47_368.42, 2);
    expect(subscriptionBreakeven(pro, rate)).toBeCloseTo(145_000, 2);
    expect(subscriptionBreakeven(ultra, rate)).toBeCloseTo(440_000, 2);
  });

  it("переход на тариф выше окупается процентом только на миллионах оборота", () => {
    expect(upgradeBreakeven(lite, pro, rate)).toBeCloseTo(2_000_000, 2);
    expect(upgradeBreakeven(pro, ultra, rate)).toBeCloseTo(2_800_000, 2);
  });

  it("тариф без возврата и нулевая ставка не дают порога, а не ноль", () => {
    expect(subscriptionBreakeven({ id: "x", price: 10, share: 0 }, rate)).toBe(Infinity);
    expect(subscriptionBreakeven(lite, 0)).toBe(Infinity);
    expect(upgradeBreakeven(ultra, lite, rate)).toBe(Infinity);
  });

  it("бесплатный переход окупается сразу", () => {
    expect(upgradeBreakeven(lite, { id: "gift", price: 9, share: 0.6 }, rate)).toBe(0);
  });
});

describe("сравнение за год", () => {
  it("на обороте новичка разрыв в пользу программы без абонплаты", () => {
    const profile = { monthlyVolume: 100_000, takerShare: 1 };
    const ours = outcomeFor(weex, profile);
    const theirs = planOutcome(monthlyCommission(profile.monthlyVolume, 0.0005), RIVAL_PLANS[2]);

    // У нас: комиссия $80, возврат 25% - $20 в месяц, $240 за год.
    expect(ours.yearly).toBeCloseTo(240, 6);
    // У них: возврат $22.5 минус $99 подписки - минус $76.5 в месяц.
    expect(theirs.yearly).toBeCloseTo(-918, 6);
    expect(yearlyAdvantage(ours, theirs)).toBeCloseTo(1158, 6);
  });
});

describe("список бирж", () => {
  it("идентификаторы не повторяются - иначе выбор в калькуляторе схлопнется", () => {
    const ids = EXCHANGES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("мейкер везде дешевле тейкера", () => {
    for (const exchange of EXCHANGES) {
      expect(exchange.makerRate).toBeLessThan(exchange.takerRate);
    }
  });

  it("неизвестная биржа возвращает рабочую, а не падает", () => {
    expect(exchangeById("нет-такой").id).toBe("weex");
  });

  it("первой стоит подключённая биржа", () => {
    expect(EXCHANGES[0].status).toBe("live");
  });
});

import { describe, it, expect } from "vitest";
import {
  advance,
  advanceQuote,
  breakevenPrice,
  closeManually,
  closePartially,
  createTrade,
  floatingAt,
  pendingTargets,
  pnlAt,
  wasEntered,
  type ActiveTrade,
} from "@/lib/trade/position";

// Сделка из этого файла попадает в журнал и в календарь прибыли. Ошибка здесь
// не рисуется на графике — она оседает в статистике трейдера, поэтому каждый
// переход зафиксирован тестом.

const T0 = 1_700_000_000_000;

function long(): ActiveTrade {
  return createTrade(
    {
      symbol: "BTCUSDT",
      side: "long",
      entry: 100,
      stop: 99,
      targets: [101, 102, 103],
      qty: 10,
      margin: 100,
      leverage: 10,
    },
    "t1",
  );
}

function short(): ActiveTrade {
  return createTrade(
    {
      symbol: "BTCUSDT",
      side: "short",
      entry: 100,
      stop: 101,
      targets: [99, 98, 97],
      qty: 10,
      margin: 100,
      leverage: 10,
    },
    "t2",
  );
}

describe("вход", () => {
  it("сделка ждёт, пока цена не дошла до уровня", () => {
    const trade = advance(long(), 100.5, T0);
    expect(trade.status).toBe("planned");
    expect(pnlAt(trade, 100.5)).toBe(0);
  });

  it("касание уровня открывает лонг", () => {
    const trade = advance(long(), 100, T0);
    expect(trade.status).toBe("open");
    expect(trade.openedAt).toBe(T0);
  });

  it("шорт открывается ценой сверху", () => {
    expect(advance(short(), 99.5, T0).status).toBe("planned");
    expect(advance(short(), 100, T0).status).toBe("open");
  });

  it("состояние без изменений возвращается той же ссылкой", () => {
    const trade = long();
    expect(advance(trade, 100.5, T0)).toBe(trade);
  });
});

describe("прибыль и убыток", () => {
  it("взятая цель не участвует в плавающем результате", () => {
    // Главная ошибка прежней модели: она оценивала весь исходный объём по
    // текущей цене, хотя часть уже закрылась целью. На экране висело больше,
    // чем приходило на счёт.
    let trade = advance(long(), 100, T0);
    trade = advance(trade, 101, T0 + 1);      // первая цель забрала 30%
    // Забрано 1 × 3 монеты, в рынке осталось 7 монет с движением +0.5.
    expect(trade.qty).toBeCloseTo(7, 6);
    expect(pnlAt(trade, 100.5)).toBeCloseTo(3 + 0.5 * 7, 6);
  });

  it("плавающий результат считается по объёму", () => {
    const trade = advance(long(), 100, T0);
    expect(pnlAt(trade, 100.5)).toBeCloseTo(5, 10);
    expect(pnlAt(trade, 99.5)).toBeCloseTo(-5, 10);
  });

  it("у шорта знак обратный", () => {
    const trade = advance(short(), 100, T0);
    expect(pnlAt(trade, 99)).toBeCloseTo(10, 10);
    expect(pnlAt(trade, 101)).toBeCloseTo(-10, 10);
  });
});

describe("цели", () => {
  it("взятая цель уходит с графика", () => {
    let trade = advance(long(), 100, T0);
    trade = advance(trade, 101, T0 + 1);
    expect(trade.takesHit).toBe(1);
    expect(pendingTargets(trade)).toEqual([102, 103]);
  });

  it("после первой цели стоп переезжает в безубыток", () => {
    let trade = advance(long(), 100, T0);
    trade = advance(trade, 101, T0 + 1);
    expect(trade.breakeven).toBe(true);
    // Безубыток чуть выше входа: комиссия уплачена на входе и будет уплачена
    // на выходе. Стоп ровно на входе — это гарантированный маленький минус.
    expect(trade.stop).toBeGreaterThan(100);
    expect(trade.stop).toBeCloseTo(breakevenPrice(100, true), 6);

    // Первая цель забирает 30% объёма по своей цене.
    expect(trade.qty).toBeCloseTo(7, 6);
    expect(trade.realized).toBeCloseTo(3, 6);

    // Возврат к входу закрывает остаток: взятая цель остаётся с нами, а
    // надбавка над входом уходит бирже комиссией.
    trade = advance(trade, 100, T0 + 2);
    expect(trade.status).toBe("closed");
    expect(trade.pnl).toBeGreaterThan(3);
    expect(trade.pnl).toBeCloseTo(3 + (breakevenPrice(100, true) - 100) * 7, 6);
  });

  it("рывок через несколько целей засчитывает их все", () => {
    let trade = advance(long(), 100, T0);
    trade = advance(trade, 102.5, T0 + 1);
    expect(trade.takesHit).toBe(2);
    expect(trade.status).toBe("open");
  });

  it("последняя цель закрывает сделку по сумме взятых частей", () => {
    // Рывок через все три цели: каждая забрала свою долю по своей цене, а не
    // весь объём по последней. Доли 30 / 50 / 20 процентов от десяти монет.
    let trade = advance(long(), 100, T0);
    trade = advance(trade, 103, T0 + 1);
    expect(trade.status).toBe("closed");
    expect(trade.outcome).toBe("take");
    expect(trade.pnl).toBeCloseTo(1 * 3 + 2 * 5 + 3 * 2, 6);
  });
});

describe("стоп", () => {
  it("закрывает сделку по цене стопа, а не по цене тика", () => {
    let trade = advance(long(), 100, T0);
    // Рынок провалился ниже стопа: в журнал идёт стоп, а не дно свечи.
    trade = advance(trade, 98, T0 + 1);
    expect(trade.status).toBe("closed");
    expect(trade.exit).toBe(99);
    expect(trade.pnl).toBeCloseTo(-10, 10);
  });

  it("в одном тике стоп важнее цели", () => {
    // Цена ушла и вверх, и вниз — что рынок задел первым, неизвестно.
    let trade = advance(long(), 100, T0);
    trade = { ...trade, stop: 99 };
    expect(advance(trade, 98, T0 + 1).outcome).toBe("stop");
  });

  it("закрытая сделка больше не меняется", () => {
    let trade = advance(long(), 100, T0);
    trade = advance(trade, 98, T0 + 1);
    expect(advance(trade, 105, T0 + 2)).toBe(trade);
  });
});

describe("закрытие руками", () => {
  it("считает результат по текущей цене", () => {
    let trade = advance(long(), 100, T0);
    trade = closeManually(trade, 100.7, T0 + 1);
    expect(trade.outcome).toBe("manual");
    expect(trade.pnl).toBeCloseTo(7, 10);
  });

  it("неоткрытая сделка закрывается в ноль", () => {
    const trade = closeManually(long(), 100.7, T0 + 1);
    expect(trade.status).toBe("closed");
    expect(trade.pnl).toBe(0);
  });
});

describe("исполнение по стакану", () => {
  it("лонг входит, когда до уровня дошло предложение", () => {
    // Средняя цена ещё выше уровня, но продать по нему уже готовы.
    const planned = long();
    const filled = advanceQuote(planned, { bid: 99.9, ask: 100 }, T0);
    expect(filled.status).toBe("open");
  });

  it("лонг не входит, пока предложение выше уровня", () => {
    const planned = long();
    expect(advanceQuote(planned, { bid: 100, ask: 100.1 }, T0).status).toBe("planned");
  });

  it("шорт входит по лучшей покупке", () => {
    expect(advanceQuote(short(), { bid: 100, ask: 100.1 }, T0).status).toBe("open");
    expect(advanceQuote(short(), { bid: 99.9, ask: 100 }, T0).status).toBe("planned");
  });

  it("открытый лонг считает стоп по покупке, а не по продаже", () => {
    let trade = advanceQuote(long(), { bid: 99.9, ask: 100 }, T0);
    // Покупка провалилась ниже стопа, продажа ещё выше — позицию закрывать
    // придётся именно в покупку.
    trade = advanceQuote(trade, { bid: 98.9, ask: 99.2 }, T0 + 1);
    expect(trade.status).toBe("closed");
    expect(trade.outcome).toBe("stop");
  });

  it("пустой стакан ничего не меняет", () => {
    const planned = long();
    expect(advanceQuote(planned, { bid: 0, ask: 0 }, T0)).toBe(planned);
  });
});

describe("частичная фиксация", () => {
  it("половина позиции уходит в журнал отдельной записью", () => {
    const opened = advance(long(), 100, T0);
    const { remaining, recorded } = closePartially(opened, 0.5, 100.5, T0 + 1);

    expect(recorded).not.toBeNull();
    expect(recorded!.qty).toBeCloseTo(5, 10);
    expect(recorded!.pnl).toBeCloseTo(2.5, 10);
    expect(recorded!.id).not.toBe(opened.id);      // своя запись, не дубликат

    expect(remaining.status).toBe("open");
    expect(remaining.qty).toBeCloseTo(5, 10);
    expect(remaining.partials).toBe(1);
  });

  it("лестница забирает 30, 50 и остаток", () => {
    // Правило заказчика: первая цель снимает треть риска, вторая выводит
    // половину, до последней едет остаток.
    let trade = advance(long(), 100, T0);
    trade = advance(trade, 101, T0 + 1);
    expect(trade.qty).toBeCloseTo(7, 6);
    trade = advance(trade, 102, T0 + 2);
    expect(trade.qty).toBeCloseTo(2, 6);
  });

  it("доля считается от остатка, а не от исходного объёма", () => {
    let trade = advance(long(), 100, T0);
    trade = closePartially(trade, 0.5, 100.5, T0 + 1).remaining;
    const { remaining } = closePartially(trade, 0.5, 100.5, T0 + 2);
    expect(remaining.qty).toBeCloseTo(2.5, 10);
    expect(remaining.partials).toBe(2);
  });

  it("сто процентов закрывают сделку целиком", () => {
    const opened = advance(long(), 100, T0);
    const { remaining, recorded } = closePartially(opened, 1, 100.5, T0 + 1);
    expect(remaining.status).toBe("closed");
    expect(remaining.pnl).toBeCloseTo(5, 10);
    expect(recorded!.id).toBe(remaining.id);       // одна запись, не две
  });

  it("невошедшая сделка просто снимается, в журнал не идёт", () => {
    const { remaining, recorded } = closePartially(long(), 1, 100.5, T0);
    expect(remaining.status).toBe("closed");
    expect(remaining.pnl).toBe(0);
    expect(recorded).toBeNull();
  });

  it("закрытая сделка не фиксируется повторно", () => {
    let trade = advance(long(), 100, T0);
    trade = closePartially(trade, 1, 100.5, T0 + 1).remaining;
    expect(closePartially(trade, 1, 101, T0 + 2).recorded).toBeNull();
  });
});

describe("что показывать на экране", () => {
  it("плавающий результат - только по остатку, как на бирже", () => {
    // После взятой цели биржа показывает результат по тому, что осталось в
    // позиции. Наша цифра должна совпадать с ней: трейдер сверяет глазами.
    let trade = advance(long(), 100, T0);
    trade = advance(trade, 101, T0 + 1);            // взята первая цель

    expect(floatingAt(trade, 102)).toBeCloseTo(2 * 7, 6);
    // Забранное лежит отдельно и в эту цифру не входит.
    expect(trade.realized).toBeCloseTo(3, 6);
    // Итог по сделке — сумма того и другого.
    expect(pnlAt(trade, 102)).toBeCloseTo(3 + 2 * 7, 6);
  });

  it("до входа и после закрытия плавающего результата нет", () => {
    expect(floatingAt(long(), 100)).toBe(0);
    const closed = advance(advance(long(), 100, T0), 98, T0 + 1);
    expect(floatingAt(closed, 97)).toBe(0);
  });
});

describe("сделка на бирже", () => {
  // Терминал обязан быть зеркалом биржи. Цена может коснуться уровня, а
  // лимитка не исполниться — очередь в стакане длиннее одного касания.
  const waiting = (): ActiveTrade =>
    createTrade(
      {
        symbol: "BTCUSDT",
        side: "long",
        entry: 100,
        stop: 99,
        targets: [101, 102, 103],
        qty: 10,
        margin: 100,
        leverage: 10,
      },
      "live-1",
    );

  it("вход не засчитывается по касанию цены, пока биржа молчит", () => {
    const trade = advanceQuote(waiting(), { bid: 99.9, ask: 100 }, 1, true);
    expect(trade.status).toBe("planned");
    // Без биржи — считаем сами, иначе разметки не будет вовсе.
    expect(advanceQuote(waiting(), { bid: 99.9, ask: 100 }, 1).status).toBe("open");
  });

  it("открытую позицию ведём сами: цели и безубыток - это разметка", () => {
    const open = advanceQuote(waiting(), { bid: 99.9, ask: 100 }, 1);
    const after = advanceQuote(open, { bid: 101, ask: 101.1 }, 2, true);
    expect(after.takesHit).toBe(1);
    expect(after.breakeven).toBe(true);
  });

  it("закрытие тоже за биржей", () => {
    const open = advanceQuote(waiting(), { bid: 99.9, ask: 100 }, 1);
    const stopped = advanceQuote(open, { bid: 98, ask: 98.1 }, 2, true);
    expect(stopped.status).toBe("open");
  });
});

describe("что попадает в журнал", () => {
  const planned = (): ActiveTrade =>
    createTrade(
      {
        symbol: "BTCUSDT",
        side: "long",
        entry: 100,
        stop: 99,
        targets: [101, 102, 103],
        qty: 10,
        margin: 100,
        leverage: 10,
      },
      "cancel-1",
    );

  it("снятая лимитка сделкой не была", () => {
    // Позиции не было, денег не двигалось: такая запись только засоряет
    // список и портит статистику.
    const cancelled = closeManually(planned(), 100, 5);
    expect(cancelled.status).toBe("closed");
    expect(wasEntered(cancelled)).toBe(false);
  });

  it("зашедшая и закрытая руками — была", () => {
    const open = advanceQuote(planned(), { bid: 99.9, ask: 100 }, 1);
    expect(wasEntered(closeManually(open, 100.5, 2))).toBe(true);
  });
});

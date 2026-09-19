/**
 * Подпись последнего снимка сделки.
 *
 * В разборе выход бывает один, и он должен называться тем, чем был: последней
 * целью, безубытком или стопом. Прежде терминал подписывал его «стоп» всегда,
 * когда стоп стоял на бирже, - потому что в миг закрытия с биржи уходит вся
 * защита разом, и по исчезновению заявок цель от стопа не отличить.
 */

import { describe, it, expect } from "vitest";

import { exitKind, stopIsSafe, type ExitTrade } from "@/lib/trade/exitShot";

function long(over: Partial<ExitTrade> = {}): ExitTrade {
  return {
    side: "long",
    entry: 100,
    stop: 98,
    targets: [102, 104, 106],
    ...over,
  };
}

function short(over: Partial<ExitTrade> = {}): ExitTrade {
  return {
    side: "short",
    entry: 100,
    stop: 102,
    targets: [98, 96, 94],
    ...over,
  };
}

describe("стоп в безубытке", () => {
  it("лонг: стоп на входе или выше - безубыток", () => {
    expect(stopIsSafe(long({ stop: 100 }))).toBe(true);
    expect(stopIsSafe(long({ stop: 101 }))).toBe(true);
    expect(stopIsSafe(long({ stop: 99.9 }))).toBe(false);
  });

  it("шорт: стоп на входе или ниже - безубыток", () => {
    expect(stopIsSafe(short({ stop: 100 }))).toBe(true);
    expect(stopIsSafe(short({ stop: 99 }))).toBe(true);
    expect(stopIsSafe(short({ stop: 100.1 }))).toBe(false);
  });
});

describe("чем кончилась сделка", () => {
  it("цена у последней цели - это цель, а не стоп", () => {
    // Стоп к этому мигу уже в безубытке: так и бывает после взятых целей.
    expect(exitKind(long({ stop: 100 }), 106)).toBe("take");
    expect(exitKind(short({ stop: 100 }), 94)).toBe("take");
  });

  it("цена у стопа в безубытке - это безубыток, а не стоп", () => {
    expect(exitKind(long({ stop: 100 }), 100)).toBe("breakeven");
    expect(exitKind(short({ stop: 100 }), 100)).toBe("breakeven");
  });

  it("цена у стопа ниже входа - это стоп", () => {
    expect(exitKind(long(), 98)).toBe("stop");
    expect(exitKind(short(), 102)).toBe("stop");
  });

  it("слово сервера важнее цены", () => {
    // Цена у цели, а сервер говорит «стоп»: он видел сделку целиком.
    expect(exitKind(long({ stop: 100 }), 106, "stop")).toBe("breakeven");
    expect(exitKind(long(), 106, "stop")).toBe("stop");
    // И наоборот: цена у стопа, а сделку закрыла цель.
    expect(exitKind(long(), 98, "take")).toBe("take");
  });

  it("закрытие руками остаётся закрытием руками", () => {
    expect(exitKind(long(), 106, "manual")).toBe("manual");
  });

  it("без цены судим по стопу, а не выдумываем цель", () => {
    expect(exitKind(long(), 0)).toBe("stop");
    expect(exitKind(long({ stop: 100 }), 0)).toBe("breakeven");
  });

  it("сделка без целей: выход - только стоп или безубыток", () => {
    expect(exitKind(long({ targets: [] }), 98)).toBe("stop");
    expect(exitKind(long({ targets: [], stop: 100 }), 100)).toBe("breakeven");
  });
});

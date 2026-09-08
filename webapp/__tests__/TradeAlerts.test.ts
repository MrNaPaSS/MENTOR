// Общий склад уведомлений о сделках.
//
// Одно событие видят двое - опрос объёмов в терминале и наблюдение оболочки, -
// и от того, как склад разбирается с повторами, зависит, придёт уведомление
// один раз или два. Проверяется именно это, а не отрисовка.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Toast } from "@/components/scalping/Toasts";

function toast(id: string, symbol = "BTCUSDT"): Toast {
  return { id, symbol, title: "вход состоялся", text: "лонг", tone: "up" };
}

/** Склад живёт в модуле, поэтому у каждого теста он свой. */
async function fresh() {
  vi.resetModules();
  return import("@/lib/tradeAlerts");
}

beforeEach(() => {
  vi.resetModules();
});

describe("склад уведомлений", () => {
  it("одно событие - одно уведомление, кто бы его ни поднял", async () => {
    const alerts = await fresh();
    alerts.pushToast(toast("trade-1:in"));
    alerts.pushToast(toast("trade-1:in"));

    expect(alerts.snapshot()).toHaveLength(1);
  });

  it("разные события живут рядом", async () => {
    const alerts = await fresh();
    alerts.pushToast(toast("trade-1:in"));
    alerts.pushToast(toast("trade-1:out"));

    expect(alerts.snapshot()).toHaveLength(2);
  });

  it("стена уведомлений поверх графика не растёт", async () => {
    const alerts = await fresh();
    for (let i = 0; i < 9; i++) alerts.pushToast(toast(`trade-${i}:in`));

    const shown = alerts.snapshot();
    expect(shown).toHaveLength(4);
    // Остаются последние: свежее событие важнее того, что случилось раньше.
    expect(shown.at(-1)?.id).toBe("trade-8:in");
  });

  it("крестик убирает своё", async () => {
    const alerts = await fresh();
    alerts.pushToast(toast("a"));
    alerts.pushToast(toast("b"));
    alerts.dismissToast("a");

    expect(alerts.snapshot().map((t) => t.id)).toEqual(["b"]);
  });

  it("открыли монету - её уведомления уходят все", async () => {
    const alerts = await fresh();
    alerts.pushToast(toast("a", "BTCUSDT"));
    alerts.pushToast(toast("b", "BTCUSDT"));
    alerts.pushToast(toast("c", "ETHUSDT"));
    alerts.dismissSymbol("BTCUSDT");

    expect(alerts.snapshot().map((t) => t.id)).toEqual(["c"]);
  });

  it("подписчику сообщают о изменении", async () => {
    const alerts = await fresh();
    const heard = vi.fn();
    const off = alerts.subscribe(heard);
    alerts.pushToast(toast("a"));
    off();
    alerts.pushToast(toast("b"));

    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe("кто наблюдает", () => {
  it("без терминала наблюдает оболочка", async () => {
    const alerts = await fresh();
    expect(alerts.terminalOpen()).toBe(false);
  });

  it("терминал открыт - оболочка молчит", async () => {
    const alerts = await fresh();
    const release = alerts.holdTerminal();

    expect(alerts.terminalOpen()).toBe(true);
    release();
    expect(alerts.terminalOpen()).toBe(false);
  });

  it("переход между разделами не сбрасывает счёт", async () => {
    // Новая страница успевает появиться раньше, чем уходит старая. Флагом это
    // читалось бы как «терминал закрыт» на то самое мгновение, и оболочка
    // успела бы поднять своё уведомление поверх терминального.
    const alerts = await fresh();
    const first = alerts.holdTerminal();
    const second = alerts.holdTerminal();

    first();
    expect(alerts.terminalOpen()).toBe(true);
    second();
    expect(alerts.terminalOpen()).toBe(false);
  });
});

// Просьба открыть монету в терминале.
//
// Два пути - адрес и событие, - и оба ломаются молча: нажатие по паре просто
// ничего не делает, а понять почему по экрану нельзя. Отсюда и тесты.

import { afterEach, describe, expect, it, vi } from "vitest";

import { askSymbol, onSymbolAsked, symbolFromUrl } from "@/lib/openSymbol";

/** Подменить адрес страницы: jsdom позволяет это только так. */
function at(search: string) {
  window.history.replaceState({}, "", `/app/scalping${search}`);
}

afterEach(() => {
  at("");
});

describe("монета из адреса", () => {
  it("читается", () => {
    at("?symbol=BTCUSDT");
    expect(symbolFromUrl()).toBe("BTCUSDT");
  });

  it("приводится к верхнему регистру", () => {
    at("?symbol=ethusdt");
    expect(symbolFromUrl()).toBe("ETHUSDT");
  });

  it("без параметра - ничего", () => {
    at("");
    expect(symbolFromUrl()).toBeNull();
  });

  it("мусор в адресе не выдаётся за монету", () => {
    // Адрес приходит снаружи, и открывать по нему подписку на что попало
    // нельзя: терминал уйдёт с рабочей пары в пустоту.
    for (const junk of ["../../etc", "BTC USDT", "<script>", "", "a".repeat(40)]) {
      at(`?symbol=${encodeURIComponent(junk)}`);
      expect(symbolFromUrl()).toBeNull();
    }
  });
});

describe("просьба открытому терминалу", () => {
  it("доходит до слушателя", () => {
    const heard = vi.fn();
    const off = onSymbolAsked(heard);
    askSymbol("SOLUSDT");
    off();

    expect(heard).toHaveBeenCalledWith("SOLUSDT");
  });

  it("после отписки не доходит", () => {
    const heard = vi.fn();
    onSymbolAsked(heard)();
    askSymbol("SOLUSDT");

    expect(heard).not.toHaveBeenCalled();
  });

  it("мусор не рассылается", () => {
    const heard = vi.fn();
    const off = onSymbolAsked(heard);
    askSymbol("не монета");
    off();

    expect(heard).not.toHaveBeenCalled();
  });
});

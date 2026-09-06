import { describe, it, expect, beforeEach, vi } from "vitest";
import { isMuted, play, setMuted } from "@/lib/sound";

// Звук — вещь необязательная, и терминал не должен от неё зависеть. Проверяем
// именно это: без поддержки в браузере и с выключенным звуком ничего не падает
// и ничего не играет.

describe("звук событий", () => {
  beforeEach(() => {
    setMuted(false);
    vi.unstubAllGlobals();
  });

  it("выключенный звук ничего не создаёт", () => {
    const ctor = vi.fn();
    vi.stubGlobal("AudioContext", ctor);
    setMuted(true);
    play("entry");
    expect(ctor).not.toHaveBeenCalled();
    expect(isMuted()).toBe(true);
  });

  it("браузер без поддержки звука не роняет терминал", () => {
    vi.stubGlobal("AudioContext", undefined);
    expect(() => play("stop")).not.toThrow();
  });

  it("сбой звукового контекста не роняет терминал", () => {
    vi.stubGlobal("AudioContext", function Broken() {
      throw new Error("нет устройства вывода");
    });
    expect(() => play("profit")).not.toThrow();
  });
});

// Вкладка, которую давно не видно, перестаёт грузить сервер.
//
// Терминал на втором устройстве или в свёрнутом окне опрашивал свечи и
// позиции и держал канал стакана, по которому сервер собирал ему кадр восемь
// раз в секунду. Смотреть было некому, а процесс сервера у всех один.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IDLE_AFTER_MS, onTabBack, onTabIdle, resetIdleTab, tabIdle } from "@/lib/idleTab";

function setHidden(value: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("простаивающая вкладка", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetIdleTab();
    setHidden(false);
  });

  afterEach(() => {
    resetIdleTab();
    setHidden(false);
    vi.useRealTimers();
  });

  it("короткое переключение вкладок никого не останавливает", () => {
    // Рвать канал на каждое переключение значит заставлять сервер отпускать и
    // заново собирать стакан монеты.
    const idle = vi.fn();
    const back = vi.fn();
    onTabIdle(idle);
    onTabBack(back);

    setHidden(true);
    vi.advanceTimersByTime(IDLE_AFTER_MS - 1000);
    setHidden(false);

    expect(idle).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    expect(tabIdle()).toBe(false);
  });

  it("через минуту вкладка засыпает, а при возврате просыпается сразу", () => {
    const idle = vi.fn();
    const back = vi.fn();
    onTabIdle(idle);
    onTabBack(back);

    setHidden(true);
    vi.advanceTimersByTime(IDLE_AFTER_MS + 10);
    expect(idle).toHaveBeenCalledTimes(1);
    expect(tabIdle()).toBe(true);

    setHidden(false);
    expect(back).toHaveBeenCalledTimes(1);
    expect(tabIdle()).toBe(false);
  });

  it("отписавшиеся не будятся", () => {
    const back = vi.fn();
    const off = onTabBack(back);
    off();

    setHidden(true);
    vi.advanceTimersByTime(IDLE_AFTER_MS + 10);
    setHidden(false);

    expect(back).not.toHaveBeenCalled();
  });
});

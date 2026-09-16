import { describe, it, expect } from "vitest";
import { fromExtension } from "@/lib/log";

// Журнал держит тысячу записей. Дополнение браузера сыпало ошибками десятками
// в минуту, и сделки в журнале не оставалось - а именно за ней в него и лезут.

describe("шум расширений браузера", () => {
  it("ошибка из дополнения не наша", () => {
    expect(fromExtension("moz-extension://34066bf3/extensionPageScript.js")).toBe(true);
    expect(fromExtension("chrome-extension://abcd/inject.js")).toBe(true);
  });

  it("ошибка самой страницы записывается", () => {
    expect(fromExtension("https://www.nmnh.trade/app/scalping/page.js")).toBe(false);
    expect(fromExtension("")).toBe(false);
    expect(fromExtension(null)).toBe(false);
  });
});

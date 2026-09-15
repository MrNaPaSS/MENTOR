import { describe, it, expect } from "vitest";
import { stopFromExchange } from "@/lib/trade/exchange";

// Стоп на графике рисуется ценой с биржи. Пока перенос в пути, на бирже стоит
// ещё прежняя заявка, и линия прыгала: возвращалась на старое место, а через
// пару секунд уезжала на новое. Трейдер в этот момент не знает, переехал его
// стоп или нет.

describe("какой стоп показывать", () => {
  it("берёт цену биржи, когда ничего не двигали", () => {
    expect(stopFromExchange(79_950, 79_900, false)).toBe(79_950);
  });

  it("держит нарисованный стоп, пока перенос в пути", () => {
    expect(stopFromExchange(79_900, 79_950, true)).toBe(79_950);
  });

  it("не верит пустой цене биржи", () => {
    expect(stopFromExchange(0, 79_900, false)).toBe(79_900);
    expect(stopFromExchange(null, 79_900, false)).toBe(79_900);
    expect(stopFromExchange(undefined, 79_900, false)).toBe(79_900);
  });

  it("отрицательную цену тоже не берёт", () => {
    expect(stopFromExchange(-1, 79_900, false)).toBe(79_900);
  });
});

import { describe, expect, it } from "vitest";
import { directionOf } from "@/lib/analysisCard";

describe("directionOf", () => {
  it("находит направление латиницей и кириллицей", () => {
    expect(directionOf("ENA LONG от накопления")).toBe("long");
    expect(directionOf("Шорт от зоны сопротивления")).toBe("short");
    expect(directionOf("вход в лонг после пробоя")).toBe("long");
  });

  it("берёт первое упоминание, второе - запасной сценарий", () => {
    expect(directionOf("Лонг от 0.42, шорт при пробое 0.38")).toBe("long");
    expect(directionOf("short от уровня, long только выше 1.2")).toBe("short");
  });

  it("не путает слово внутри другого слова", () => {
    expect(directionOf("Longevity протокола и шортлист монет")).toBeNull();
    expect(directionOf("лонгрид о рынке")).toBeNull();
  });

  it("молчит, если направления нет", () => {
    expect(directionOf("Зона интереса и импульс")).toBeNull();
    expect(directionOf("")).toBeNull();
    expect(directionOf(null)).toBeNull();
  });
});

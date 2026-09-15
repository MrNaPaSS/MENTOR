import { describe, it, expect } from "vitest";
import { readSignal } from "@/lib/api";

// Запрос, ушедший в момент перезапуска сервера, висел вечно: терминал ждал
// состояния биржи и не начинал вести сделки до ручной перезагрузки. Чтения
// теперь обрываются по пределу, а заявки - нет: оборванный вход трейдер
// повторил бы, и на бирже встала бы вторая позиция.

describe("предел ожидания запроса", () => {
  it("у чтения есть предел", () => {
    expect(readSignal()).toBeInstanceOf(AbortSignal);
    expect(readSignal({ method: "get" })).toBeInstanceOf(AbortSignal);
  });

  it("заявку и прочие записи не обрываем", () => {
    expect(readSignal({ method: "POST" })).toBeUndefined();
    expect(readSignal({ method: "PUT" })).toBeUndefined();
    expect(readSignal({ method: "DELETE" })).toBeUndefined();
  });

  it("свой сигнал вызывающего не подменяем", () => {
    const own = new AbortController().signal;
    expect(readSignal({ signal: own })).toBe(own);
  });
});

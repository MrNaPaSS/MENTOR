import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openPositions, positionOf } from "@/lib/trading";
import { setStudentTokens, logout } from "@/lib/auth";

// В хедже по одному инструменту на бирже стоят две позиции — лонг и шорт.
// Терминал показывает результат каждой сделки отдельно, и перепутать их
// значит показать лонгу объём и прибыль шорта.

function answer(positions: Record<string, unknown>[]) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ positions }),
  })) as unknown as typeof fetch;
}

describe("позиция глазами биржи", () => {
  beforeEach(() => setStudentTokens("a1", "r1"));
  afterEach(() => {
    logout();
    vi.unstubAllGlobals();
  });

  it("выбирает сторону, когда позиций по инструменту две", async () => {
    vi.stubGlobal(
      "fetch",
      answer([
        { symbol: "BTCUSDT", positionSide: "LONG", total: "0.5", averageOpenPrice: "100" },
        { symbol: "BTCUSDT", positionSide: "SHORT", total: "0.2", averageOpenPrice: "110" },
      ]),
    );

    expect((await positionOf("BTCUSDT", "long"))?.size).toBe(0.5);
    expect((await positionOf("BTCUSDT", "short"))?.size).toBe(0.2);
  });

  it("в одностороннем режиме стороны в ответе нет - берём единственную позицию", async () => {
    vi.stubGlobal("fetch", answer([{ symbol: "BTCUSDT", total: "1.5" }]));
    expect((await positionOf("BTCUSDT", "long"))?.size).toBe(1.5);
    expect((await positionOf("BTCUSDT", "short"))?.size).toBe(1.5);
  });

  it("своей стороны нет - позиция пустая, а не чужая", async () => {
    vi.stubGlobal(
      "fetch",
      answer([{ symbol: "BTCUSDT", holdSide: "long", total: "0.5" }]),
    );
    // Шорта на бирже нет: показать ему объём лонга значит соврать о позиции,
    // которой не существует.
    expect((await positionOf("BTCUSDT", "short"))?.size).toBe(0);
  });

  it("чужой инструмент не считается своим", async () => {
    vi.stubGlobal("fetch", answer([{ symbol: "ETHUSDT", total: "3" }]));
    expect((await positionOf("BTCUSDT", "long"))?.size).toBe(0);
  });

  it("плавающий результат - как считает биржа, без нашего вычета", async () => {
    // Комиссию входа терминал какое-то время вычитал отсюда: на шорте ETH
    // приложение WEEX показывало ровно на неё меньше. На BTC вышло наоборот -
    // у нас 7.37, у биржи 32, - и решено так: живая строка показывает движение
    // цены, а комиссия считается в итоге сделки, по реальным исполнениям.
    vi.stubGlobal(
      "fetch",
      answer([
        {
          symbol: "ETHUSDT",
          positionSide: "SHORT",
          size: "20.225",
          cumOpenSize: "20.225",
          cumOpenValue: "49998.42",
          cumOpenFee: "8",
          unrealizePnl: "36.05",
        },
      ]),
    );
    const one = await positionOf("ETHUSDT", "short");
    expect(one?.unrealized).toBeCloseTo(36.05, 6);
    // Саму комиссию знаем и кладём рядом: она уходит в журнал сверки.
    expect(one?.entry_fee).toBeCloseTo(8, 6);
  });

  it("после взятой цели комиссия считается только на остаток", async () => {
    // 30% позиции закрыто первой целью: её доля комиссии ушла вместе с ней.
    vi.stubGlobal(
      "fetch",
      answer([
        {
          symbol: "ETHUSDT",
          positionSide: "SHORT",
          size: "14.1575",
          cumOpenSize: "20.225",
          cumOpenValue: "49998.42",
          cumOpenFee: "8",
          unrealizePnl: "20",
        },
      ]),
    );
    const rest = await positionOf("ETHUSDT", "short");
    expect(rest?.unrealized).toBeCloseTo(20, 6);
    expect(rest?.entry_fee).toBeCloseTo(5.6, 6);
  });
});

describe("средняя цена входа приезжает вместе с объёмом", () => {
  beforeEach(() => setStudentTokens("a1", "r1"));
  afterEach(() => {
    logout();
    vi.unstubAllGlobals();
  });

  const stub = (body: { positions: Record<string, unknown>[] }) =>
    vi.stubGlobal("fetch", answer(body.positions));

  it("берётся прямо, когда биржа её назвала", async () => {
    // По ней разбирается, какая из нескольких ждущих заявок исполнилась.
    stub({
      positions: [
        { symbol: "BTCUSDT", positionSide: "LONG", total: "0.5", averageOpenPrice: "78576.2" },
      ],
    });
    const rows = await openPositions();
    expect(rows?.["BTCUSDT:long"]).toMatchObject({ size: 0.5, entry: 78576.2 });
  });

  it("считается из оборота, когда прямой цены нет", async () => {
    // В ответе WEEX средней может не быть: есть «сколько денег зашло» и «на
    // какой объём», и отношение и есть средняя.
    stub({
      positions: [
        { symbol: "BTCUSDT", holdSide: "long", total: "2", cumOpenValue: "200", cumOpenSize: "2" },
      ],
    });
    const rows = await openPositions();
    expect(rows?.["BTCUSDT:long"].entry).toBe(100);
  });

  it("без цены строка всё равно приходит - с объёмом", async () => {
    stub({ positions: [{ symbol: "BTCUSDT", holdSide: "long", total: "1" }] });
    const rows = await openPositions();
    expect(rows?.["BTCUSDT:long"]).toMatchObject({ size: 1, entry: null });
  });
});

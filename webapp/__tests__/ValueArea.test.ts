import { describe, it, expect } from "vitest";
import { valueArea, withValueArea } from "@/lib/indicator/valueArea";
import type { FootprintRow } from "@/lib/indicator/footprint";

// Область стоимости — это утверждение о том, где рынок согласился торговать, а
// где пробежал. По её границам ставят стопы, и ошибка в них не выглядит
// ошибкой: панель нарисуется стройной, просто граница окажется не там.

function row(price: number, total: number): FootprintRow {
  // Стороны для области безразличны: она считается по обороту строки целиком.
  const half = total / 2;
  return {
    price,
    buy: half,
    sell: half,
    total,
    delta: 0,
    poc: false,
    whale: false,
    imbalance: 0,
  };
}

describe("границы области стоимости", () => {
  it("самая наторгованная цена становится POC", () => {
    const rows = [row(3, 10), row(2, 100), row(1, 10)];
    expect(valueArea(rows)?.poc).toBe(2);
  });

  it("одна строка держит всю свечу: область схлопывается в неё", () => {
    const area = valueArea([row(5, 42)]);
    expect(area).toEqual({ poc: 5, vah: 5, val: 5, covered: 1 });
  });

  it("область растёт в ту сторону, где строки весомее", () => {
    // Сверху от POC пусто, снизу — вся жизнь свечи. Граница обязана уйти вниз,
    // а не разложиться поровну. И остановиться, как только доля набрана:
    // взятая «за компанию» вторая строка пары раздула бы область до 99%
    // оборота, а такая область не говорит уже ни о чём.
    const rows = [row(5, 1), row(4, 1), row(3, 100), row(2, 40), row(1, 40)];
    const area = valueArea(rows);
    expect(area?.poc).toBe(3);
    expect(area?.val).toBe(2);
    expect(area?.vah).toBe(3);
  });

  it("набирает свою долю оборота и не больше", () => {
    const rows = [row(5, 10), row(4, 20), row(3, 100), row(2, 20), row(1, 10)];
    const area = valueArea(rows);
    expect(area?.covered).toBeGreaterThanOrEqual(0.7);
    // Взяв лишнюю пару строк, область накрыла бы весь профиль — тогда она ни о
    // чём не говорит.
    expect(area?.covered).toBeLessThan(1);
  });

  it("порядок строк на границы не влияет", () => {
    const rows = [row(5, 10), row(4, 20), row(3, 100), row(2, 20), row(1, 10)];
    const up = [...rows].reverse();
    expect(valueArea(up)).toEqual(valueArea(rows));
  });

  it("пустая свеча области не имеет", () => {
    expect(valueArea([])).toBeNull();
    expect(valueArea([row(1, 0), row(2, 0)])).toBeNull();
  });

  it("широкая доля забирает профиль целиком", () => {
    const rows = [row(3, 10), row(2, 100), row(1, 10)];
    const area = valueArea(rows, 1);
    expect(area?.vah).toBe(3);
    expect(area?.val).toBe(1);
  });
});

describe("разметка строк областью", () => {
  it("порядок строк сохраняется", () => {
    const rows = [row(3, 10), row(2, 100), row(1, 10)];
    const marked = withValueArea(rows).rows;
    expect(marked.map((r) => r.price)).toEqual([3, 2, 1]);
  });

  it("строки внутри границ помечены, снаружи — нет", () => {
    const rows = [row(5, 1), row(4, 1), row(3, 100), row(2, 40), row(1, 40)];
    const marked = withValueArea(rows).rows;
    expect(marked.filter((r) => r.value).map((r) => r.price)).toEqual([3, 2]);
  });

  it("подписи стоят только на границах и POC", () => {
    // Область здесь расходится в обе стороны от вершины: только так у свечи
    // есть все три подписи разом.
    const rows = [row(5, 10), row(4, 40), row(3, 60), row(2, 40), row(1, 10)];
    const { rows: marked, area } = withValueArea(rows);
    const edges = marked.filter((r) => r.edge !== null);
    expect(edges.map((r) => r.edge)).toEqual(["vah", "poc", "val"]);
    expect(edges.map((r) => r.price)).toEqual([area?.vah, area?.poc, area?.val]);
  });

  it("схлопнутая в одну строку область подписана POC, а не границей", () => {
    // Одна строка — это и вершина, и оба края. Подпись «VAH» на ней сказала бы
    // о свече неправду: у неё нет ни верха, ни низа области.
    const { rows: marked } = withValueArea([row(5, 42)]);
    expect(marked[0].edge).toBe("poc");
  });

  it("без области строки остаются неразмеченными", () => {
    const { rows: marked, area } = withValueArea([row(1, 0)]);
    expect(area).toBeNull();
    expect(marked[0]).toMatchObject({ value: false, edge: null });
  });
});

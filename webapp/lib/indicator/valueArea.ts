// Область стоимости свечи: POC, VAH и VAL.
//
// Профиль отвечает на вопрос «где стояла цена», но глазами эту границу не
// провести: строк два десятка, и какая из них уже край, а какая ещё середина,
// на глаз не видно. Область стоимости проводит её числом — это те цены, на
// которых прошло семьдесят процентов оборота свечи. Всё, что выше VAH и ниже
// VAL, рынок пробежал: там мало кто согласился торговать, и обратно цена
// проходит эти уровни быстро.
//
// Считается по классическому правилу профиля объёма: от самой наторгованной
// цены область растёт в ту сторону, где следующие две строки весомее, пока не
// наберёт свою долю. Сравниваем именно парами, а не по одной: шаг по одной
// строке сваливается в ту сторону, где просто чаще попадаются мелкие строки, и
// граница уезжает. А вот прибавляем по строке и останавливаемся, как только
// доля набрана: взятая «за компанию» вторая строка пары на тонкой свече
// раздувает область почти до всего оборота, а такая область не говорит уже
// ни о чём.

import type { FootprintRow } from "@/lib/indicator/footprint";

/** Доля оборота свечи, которую держит область стоимости. */
export const VALUE_SHARE = 0.7;

/** Границы области в ценах. */
export type ValueArea = {
  /** Самая наторгованная цена свечи. */
  poc: number;
  /** Верхняя граница области. */
  vah: number;
  /** Нижняя граница. */
  val: number;
  /** Доля оборота, реально попавшая внутрь: набирается строками, не долями. */
  covered: number;
};

/** Строка профиля, размеченная областью стоимости. */
export type AreaRow = FootprintRow & {
  /** Строка внутри области: здесь рынок и стоял. */
  value: boolean;
  /** Подпись у края области. Пусто — строка не граница. */
  edge: "vah" | "poc" | "val" | null;
};

/**
 * Границы области стоимости.
 *
 * Строки принимаются в любом порядке — внутри они выстраиваются по цене снизу
 * вверх, потому что «выше» и «ниже» здесь означают цену, а не место в массиве.
 * Пустая свеча области не имеет: рисовать границы вокруг нуля нечестно.
 */
export function valueArea(rows: FootprintRow[], share = VALUE_SHARE): ValueArea | null {
  const up = [...rows].sort((a, b) => a.price - b.price);
  const total = up.reduce((acc, row) => acc + row.total, 0);
  if (up.length === 0 || total <= 0) return null;

  // POC — самая наторгованная строка. При равенстве берём нижнюю: две строки с
  // одинаковым оборотом бывают на тонкой свече, и выбор «первой попавшейся»
  // означал бы, что граница прыгает от порядка сортировки.
  let peak = 0;
  for (let i = 1; i < up.length; i += 1) {
    if (up[i].total > up[peak].total) peak = i;
  }

  const need = total * share;
  let covered = up[peak].total;
  let high = peak;
  let low = peak;

  while (covered < need && (high < up.length - 1 || low > 0)) {
    // Пара строк с каждой стороны. За краем профиля — ноль: пустота не может
    // перевесить живые строки.
    const above = (up[high + 1]?.total ?? 0) + (up[high + 2]?.total ?? 0);
    const below = (up[low - 1]?.total ?? 0) + (up[low - 2]?.total ?? 0);

    // Ровно поровну — идём вверх: это лишь развязка ничьей, и любой
    // устойчивый выбор здесь лучше случайного.
    if (above >= below && high < up.length - 1) {
      high += 1;
      covered += up[high].total;
      if (covered < need && high < up.length - 1) {
        high += 1;
        covered += up[high].total;
      }
    } else if (low > 0) {
      low -= 1;
      covered += up[low].total;
      if (covered < need && low > 0) {
        low -= 1;
        covered += up[low].total;
      }
    } else {
      // Снизу край, а сверху нечего брать — область выросла во весь профиль.
      break;
    }
  }

  return {
    poc: up[peak].price,
    vah: up[high].price,
    val: up[low].price,
    covered: covered / total,
  };
}

/**
 * Разметить строки областью стоимости, сохранив их порядок.
 *
 * Порядок не трогаем: строки приходят сверху вниз — так их и рисуют, — а
 * перестановка ради счёта означала бы, что карточка и профиль расходятся.
 */
export function withValueArea(
  rows: FootprintRow[],
  share = VALUE_SHARE,
): { rows: AreaRow[]; area: ValueArea | null } {
  const area = valueArea(rows, share);
  if (!area) {
    return { rows: rows.map((row) => ({ ...row, value: false, edge: null })), area: null };
  }

  return {
    rows: rows.map((row) => ({
      ...row,
      value: row.price >= area.val && row.price <= area.vah,
      // POC старше границ: когда область схлопнулась в одну строку, подписью
      // должна быть та, ради которой её и строили.
      edge:
        row.price === area.poc
          ? "poc"
          : row.price === area.vah
            ? "vah"
            : row.price === area.val
              ? "val"
              : null,
    })),
    area,
  };
}

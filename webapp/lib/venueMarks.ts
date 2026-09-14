// Знаки бирж: один файл на все места, где биржа показывается картинкой.
//
// Свою биржу человек узнаёт по знаку раньше, чем прочитает её название, -
// поэтому знак стоит и на главной, и на карточке счёта в профиле, и на
// витрине бирж. Раньше каждое из трёх мест держало свой список путей, и
// подключённая биржа появлялась там вразнобой: на главной знак есть, в
// профиле общий чужой, на витрине нет вовсе.
//
// Свет под знаком - всегда в цвет самого знака: жёлтый под жёлтым Binance,
// синий под BingX и MEXC. Чужой по цвету ореол читается как подсветка
// соседнего элемента. Знак OKX нарисован чернилами, ему свечение не нужно -
// на тёмном листе его переворачивает CSS (`mark-ink`).
//
// Цвет `tint` нужен запасному виду: файла знака может ещё не быть - биржа
// подключается кодом, а картинку кладут руками, - и тогда вместо знака
// пишется имя биржи её же цветом. Ждать картинку значит держать подключённую
// биржу невидимой.

export type VenueMark = {
  /** Путь к знаку в `public`. */
  src: string;
  /** Класс свечения под знаком. */
  glow: string;
  /** Цвет имени, когда файла знака ещё нет. */
  tint: string;
};

const MARKS: Record<string, VenueMark> = {
  weex: { src: "/art/brand/weex-mark.webp", glow: "art-glow", tint: "#f0b90b" },
  okx: { src: "/art/brand/okx-mark.webp", glow: "mark-ink", tint: "currentColor" },
  bingx: { src: "/art/brand/bingx-mark.webp", glow: "art-glow-blue", tint: "#2563eb" },
  mexc: { src: "/art/brand/mexc-mark.webp", glow: "art-glow-blue", tint: "#1652f0" },
  binance: { src: "/art/brand/binance-mark.webp", glow: "art-glow", tint: "#f0b90b" },
};

/** Знак биржи. `null` - знака у неё нет, картинку рисовать нечем. */
export function venueMark(code: string | null | undefined): VenueMark | null {
  return MARKS[(code ?? "").trim().toLowerCase()] ?? null;
}

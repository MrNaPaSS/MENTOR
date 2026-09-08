// Пресеты цвета графика: пять готовых палитр рядом с тёмной и светлой темами.
//
// Тёмная и светлая - это режимы: они задают фон, и вместе с ними светлеет весь
// кабинет. Пресеты фона не трогают - поле остаётся тёмным, иначе график
// выглядел бы вырезанным из другого приложения. Они переодевают свечи и всё,
// что обязано с ними согласоваться: линии полок, средние, объёмы, боксы сделки
// и разрывы структуры.
//
// Цвет задан здесь один раз и растекается и по графику, и по фигурам: иначе
// пресет пришлось бы вносить в два файла порознь, и однажды они разойдутся.

export const CHART_THEMES = [
  "dark",
  "light",
  "fusion",
  "megatron",
  "imperium",
  "keystone",
  "velvet",
] as const;

export type ChartTheme = (typeof CHART_THEMES)[number];

/** Пресеты - всё, кроме двух базовых режимов. */
export type ChartPresetName = Exclude<ChartTheme, "dark" | "light">;

export function isChartTheme(value: unknown): value is ChartTheme {
  return typeof value === "string" && (CHART_THEMES as readonly string[]).includes(value);
}

export type ChartPreset = {
  /** Подпись в списке выбора. Имя собственное - одно на все языки. */
  name: string;

  // Свеча: тело, обводка и фитиль порознь, как в настройках биржи.
  up: string;
  down: string;
  upBorder: string;
  downBorder: string;
  upWick: string;
  downWick: string;

  /**
   * Смысловые цвета роста и падения.
   *
   * Отдельно от тела свечи, потому что телу цвет достаётся не всегда: у
   * Megatron оба тела графитовые, направление несёт обводка, а у Velvet
   * падение белое - объём такой ширины на тёмном поле выжигает глаз. Здесь
   * лежит то, чем на графике честно можно красить смысл: полки, объёмы,
   * боксы риска и цели, разрывы справедливой цены.
   */
  bull: string;
  bear: string;

  /** Подписи осей и цен. */
  ink: string;

  // Средние индикатора: быстрая, медленная и трендовая.
  emaFast: string;
  emaSlow: string;
  emaTrend: string;

  crosshair: string;
  /** Уровни прошлого дня, недели и месяца. */
  mtf: string;
  /** Отметки трейдера на ценах. */
  gold: string;
};

export const CHART_PRESETS: Record<ChartPresetName, ChartPreset> = {
  // Бирюза против оранжевого: пара далека от привычной зелёно-красной, зато
  // различима при любом дальтонизме - разводятся и по тону, и по яркости.
  fusion: {
    name: "Fusion",
    up: "#14B8A6",
    down: "#F97316",
    upBorder: "#14B8A6",
    downBorder: "#F97316",
    upWick: "#DBDBDB",
    downWick: "#FFFFFF",
    bull: "#14B8A6",
    bear: "#F97316",
    ink: "#7E8894",
    emaFast: "#5EEAD4",
    emaSlow: "#FDBA74",
    emaTrend: "#7A8290",
    crosshair: "#2DD4BF",
    // Синий: единственный тон, свободный от обеих сторон пары.
    mtf: "#38BDF8",
    gold: "#F0B90B",
  },

  // Графит и один красный. Направление несёт обводка: рост обведён светлым,
  // падение красным, тела одинаковые. Поэтому и вся остальная разметка держится
  // светло-серого, а красное оставлено только там, где это падение.
  megatron: {
    name: "Megatron",
    up: "#4A4A4A",
    down: "#4A4A4A",
    upBorder: "#DBDBDB",
    downBorder: "#F23645",
    upWick: "#DBDBDB",
    downWick: "#F23645",
    bull: "#DBDBDB",
    bear: "#F23645",
    ink: "#8B9099",
    emaFast: "#EDEFF2",
    emaSlow: "#9AA1AC",
    emaTrend: "#5C636D",
    crosshair: "#DBDBDB",
    mtf: "#B0B6BE",
    gold: "#F0B90B",
  },

  // Золото против стали. Жёлтый отметок трейдера здесь пришлось увести в
  // голубой: на золотых свечах он терялся, а отметка обязана быть заметнее
  // всего остального - её ставят руками и по ней ждут.
  imperium: {
    name: "Imperium",
    up: "#D4AF37",
    down: "#6B7280",
    upBorder: "#DEB326",
    downBorder: "#6B7280",
    upWick: "#DBDBDB",
    downWick: "#FFFFFF",
    bull: "#D4AF37",
    // Светлее тела: серое падение на тёмном поле само по себе почти не видно,
    // а объёмы и боксы должны читаться.
    bear: "#9CA3AF",
    ink: "#8A8272",
    emaFast: "#EFD07A",
    emaSlow: "#8FA0B8",
    emaTrend: "#6B7280",
    crosshair: "#DEB326",
    mtf: "#5B83C7",
    gold: "#7DD3FC",
  },

  // Зелёный и нейтральный графит: биржевая привычка без красного. Падение
  // читается как отсутствие роста, а не как тревога, - под спокойную работу.
  keystone: {
    name: "Keystone",
    up: "#22C55E",
    down: "#525252",
    upBorder: "#22C55E",
    downBorder: "#525252",
    upWick: "#FFFFFF",
    downWick: "#FFFFFF",
    bull: "#22C55E",
    bear: "#A3A3A3",
    ink: "#7A8290",
    emaFast: "#86EFAC",
    emaSlow: "#A3A3A3",
    emaTrend: "#6B7280",
    crosshair: "#4ADE80",
    mtf: "#2157F3",
    gold: "#F0B90B",
  },

  // Пудра и белое: самая тихая палитра набора, под снимки в карточках.
  // Белого много, поэтому прозрачности везде ниже обычных - иначе заливки
  // светятся сильнее самих свечей.
  velvet: {
    name: "Velvet",
    up: "#E7B7A8",
    down: "#FFFFFF",
    upBorder: "#E7B7A8",
    downBorder: "#FFFFFF",
    upWick: "#FFFFFF",
    downWick: "#FFFFFF",
    bull: "#E7B7A8",
    bear: "#FFFFFF",
    ink: "#8E8079",
    emaFast: "#F3D2C7",
    emaSlow: "#B9A7A0",
    emaTrend: "#6E6461",
    crosshair: "#E7B7A8",
    mtf: "#A78BFA",
    gold: "#F0B90B",
  },
};

/**
 * Цвет с прозрачностью.
 *
 * Пресет задан в `#RRGGBB`, а заливки объёмов и боксов нужны полупрозрачными:
 * держать рядом с каждым цветом ещё и его rgba-двойник - верный способ однажды
 * поменять один и забыть про второй.
 */
export function rgba(hex: string, alpha: number): string {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.replace(/./g, (c) => c + c) : raw;
  const n = Number.parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Пара цветов для кружков в списке выбора: рост и падение.
 *
 * У тёмной и светлой тем свечи описаны в самом графике, и оттуда их сюда не
 * дотянуть без круговой зависимости - две пары названы здесь заново. Это
 * единственное место, где цвет продублирован, и он же единственный, который
 * видно в списке рядом с именем.
 */
export function themeSwatch(theme: ChartTheme): { bull: string; bear: string } {
  if (theme === "dark") return { bull: "#0ECB81", bear: "#F6465D" };
  if (theme === "light") return { bull: "#FFFFFF", bear: "#000000" };
  return { bull: CHART_PRESETS[theme].bull, bear: CHART_PRESETS[theme].bear };
}

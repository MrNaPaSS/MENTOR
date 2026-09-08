// Лист и палитра графика - две независимые настройки.
//
// Лист - это бумага: тёмная биржевая или белая, как в самом индикаторе. Он же
// красит кабинет вокруг терминала. Палитра - цвет свечей и всего, что обязано с
// ними согласоваться: линии полок, средние, объёмы, боксы сделки и разрывы
// структуры. Раньше это была одна настройка из семи значений, и пресеты жили
// только на тёмном; теперь любой из них включается на обоих листах.
//
// Белый лист - не тёмный с другим фоном. Фитили в пресетах заданы белым и
// светло-серым: на белом их попросту нет, а у Megatron и Velvet на белом
// пропадает ещё и сама свеча. Поэтому у каждого пресета есть блок light - в нём
// перечислено только то, что на белом обязано поменяться, остальное берётся из
// тёмного.

export const CHART_PAPERS = ["dark", "light"] as const;
export type ChartPaper = (typeof CHART_PAPERS)[number];

export const CHART_PRESET_NAMES = [
  "fusion",
  "megatron",
  "imperium",
  "keystone",
  "velvet",
] as const;

export type ChartPresetName = (typeof CHART_PRESET_NAMES)[number];

/** Выбор палитры: стандартные свечи листа или один из пресетов. */
export const CHART_PALETTES = ["default", ...CHART_PRESET_NAMES] as const;
export type ChartPaletteName = (typeof CHART_PALETTES)[number];

export function isChartPaper(value: unknown): value is ChartPaper {
  return typeof value === "string" && (CHART_PAPERS as readonly string[]).includes(value);
}

export function isChartPresetName(value: unknown): value is ChartPresetName {
  return typeof value === "string" && (CHART_PRESET_NAMES as readonly string[]).includes(value);
}

export function isChartPaletteName(value: unknown): value is ChartPaletteName {
  return typeof value === "string" && (CHART_PALETTES as readonly string[]).includes(value);
}

export type PresetSkin = {
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
   * Megatron оба тела графитовые, направление несёт обводка, а у Velvet на
   * тёмном листе падение белое - объём такой ширины выжигает глаз. Здесь лежит
   * то, чем на графике честно можно красить смысл: полки, объёмы, боксы риска и
   * цели, разрывы справедливой цены.
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

export type ChartPreset = {
  /** Подпись в списке выбора. Имя собственное - одно на все языки. */
  name: string;
  /** Палитра на тёмном листе. */
  dark: PresetSkin;
  /** Что меняется на белом. Всё остальное берётся из тёмной. */
  light: Partial<PresetSkin>;
};

export const CHART_PRESETS: Record<ChartPresetName, ChartPreset> = {
  // Бирюза против оранжевого: пара далека от привычной зелёно-красной, зато
  // различима при любом дальтонизме - разводится и по тону, и по яркости.
  fusion: {
    name: "Fusion",
    dark: {
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
    // Оба цвета пары держатся и на белом - меняется только то, что было светлее
    // бумаги: фитили и пастельные средние.
    light: {
      upWick: "#0D9488",
      downWick: "#EA580C",
      ink: "#3F4652",
      emaFast: "#0D9488",
      emaSlow: "#C2410C",
      emaTrend: "#6B7280",
      crosshair: "#0D9488",
      mtf: "#0284C7",
      gold: "#A97400",
    },
  },

  // Графит и один красный. Направление несёт обводка: рост обведён светлым,
  // падение красным, тела одинаковые. Поэтому и вся остальная разметка держится
  // светло-серого, а красное оставлено только там, где это падение.
  megatron: {
    name: "Megatron",
    dark: {
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
    // На белом светлая обводка роста исчезает вместе со свечой, поэтому пара
    // переворачивается: рост становится пустым телом в графитовой рамке,
    // падение - залитым графитом в красной. Смысл тот же, что и на тёмном:
    // направление несёт обводка, цвет один - красный.
    light: {
      up: "#FFFFFF",
      upBorder: "#4A4A4A",
      upWick: "#4A4A4A",
      bull: "#4A4A4A",
      ink: "#3F4652",
      emaFast: "#374151",
      emaSlow: "#6B7280",
      emaTrend: "#9CA3AF",
      crosshair: "#4A4A4A",
      mtf: "#555F6D",
      gold: "#A97400",
    },
  },

  // Золото против стали. Жёлтый отметок трейдера здесь уведён в голубой: на
  // золотых свечах он терялся, а отметка обязана быть заметнее всего
  // остального - её ставят руками и по ней ждут.
  imperium: {
    name: "Imperium",
    dark: {
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
    // На белом сталь темнеет обратно до цвета тела: подсветлять её было нужно
    // против тёмного поля, на бумаге она читается и так.
    light: {
      upWick: "#B8860B",
      downWick: "#6B7280",
      bear: "#6B7280",
      ink: "#5A5344",
      emaFast: "#B8860B",
      emaSlow: "#5B7093",
      crosshair: "#A9861D",
      mtf: "#3F63A8",
      gold: "#0284C7",
    },
  },

  // Зелёный и нейтральный графит: биржевая привычка без красного. Падение
  // читается как отсутствие роста, а не как тревога, - под спокойную работу.
  keystone: {
    name: "Keystone",
    dark: {
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
    light: {
      upWick: "#16A34A",
      downWick: "#525252",
      bull: "#16A34A",
      bear: "#525252",
      ink: "#3F4652",
      emaFast: "#16A34A",
      emaSlow: "#737373",
      crosshair: "#16A34A",
      gold: "#A97400",
    },
  },

  // Пудра и белое: самая тихая палитра набора, под снимки в карточках.
  velvet: {
    name: "Velvet",
    dark: {
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
    // Белая свеча падения на белом листе не исчезает, а становится пустой: тело
    // остаётся белым, направление берёт на себя тёплая серая рамка. Так и было
    // задумано - падение здесь тише роста, а не громче.
    light: {
      upBorder: "#C98E7B",
      upWick: "#C98E7B",
      downBorder: "#8A7F77",
      downWick: "#8A7F77",
      bull: "#D9A08D",
      bear: "#8A7F77",
      ink: "#6B5F59",
      emaFast: "#C98E7B",
      emaSlow: "#8A7F77",
      emaTrend: "#A39A95",
      crosshair: "#C98E7B",
      mtf: "#7C5FD3",
      gold: "#A97400",
    },
  },
};

/** Пресет на выбранном листе: белые правки поверх тёмных. */
export function presetSkin(preset: ChartPresetName, paper: ChartPaper): PresetSkin {
  const found = CHART_PRESETS[preset];
  return paper === "light" ? { ...found.dark, ...found.light } : found.dark;
}

/**
 * Пара цветов для кружков в списке выбора: рост и падение.
 *
 * У стандартной палитры свечи описаны в самом графике, и оттуда их сюда не
 * дотянуть без круговой зависимости - две пары названы здесь заново. Это
 * единственное место, где цвет продублирован, и он же единственный, который
 * видно в списке рядом с именем.
 */
export function paletteSwatch(
  palette: ChartPaletteName,
  paper: ChartPaper,
): { bull: string; bear: string } {
  if (palette === "default") {
    return paper === "light"
      ? { bull: "#FFFFFF", bear: "#000000" }
      : { bull: "#0ECB81", bear: "#F6465D" };
  }
  const skin = presetSkin(palette, paper);
  return { bull: skin.bull, bear: skin.bear };
}

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

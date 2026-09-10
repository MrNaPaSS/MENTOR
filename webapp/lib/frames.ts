// Рамки аватара NMNH: какие бывают и из чего нарисованы.
//
// Цвета - здесь, а не в рисунке (components/avatar/FramedAvatar.tsx): так
// рамку перекрашивают под палитру, не трогая геометрию. Акцент берётся из
// переменной --frame-accent: задайте её на любой обёртке, и все рамки внутри
// сменят цвет. Металл - три тона градиента, от блика к тени.
//
// Ключи продаваемых рамок - те же, что в backend/frames.py.

export type FrameId =
  | "neon"
  | "carbon"
  | "pulse"
  | "candles"
  | "crown"
  | "gold"
  | "silver"
  | "bronze";

/** Рамки маркета, в порядке каталога. */
export const SHOP_FRAMES: readonly FrameId[] = ["neon", "carbon", "pulse", "candles", "crown"];

/** Рамки лидерборда: 1, 2 и 3 место. Не продаются. */
export const RANK_FRAMES: readonly FrameId[] = ["gold", "silver", "bronze"];

export type FrameStyle = {
  /** Градиент обода: блик, середина, тень. */
  metal: [string, string, string];
  /** Цвет подсветки, дуг, свечей и значка. */
  accent: string;
  /** Две светящиеся дуги снаружи обода. */
  arcs?: boolean;
  /** Бегущий пунктир и второе тонкое кольцо. */
  pulse?: boolean;
  /** Косые сколы по диагоналям. */
  slashes?: boolean;
  /** Свечи графика снизу по бокам. */
  candles?: boolean;
  /** Корона сверху. */
  crown?: boolean;
  /** Значок NMNH с короной снизу. У рамок лидерборда вместо него номер места. */
  emblem?: boolean;
};

/** Зелёный NMNH из набора рамок. Меняется переменной на обёртке. */
const ACCENT = "var(--frame-accent, #19e68c)";

const STEEL: [string, string, string] = ["#eef1f4", "#747d87", "#262b31"];
const DARK: [string, string, string] = ["#3b4b43", "#0f1613", "#2c3832"];

export const FRAME_STYLES: Record<FrameId, FrameStyle> = {
  neon: { metal: DARK, accent: ACCENT, arcs: true, emblem: true },
  carbon: { metal: STEEL, accent: ACCENT, slashes: true, emblem: true },
  pulse: { metal: DARK, accent: ACCENT, pulse: true, emblem: true },
  candles: { metal: STEEL, accent: ACCENT, arcs: true, candles: true, emblem: true },
  crown: { metal: STEEL, accent: ACCENT, arcs: true, crown: true, emblem: true },
  gold: { metal: ["#fff4b8", "#dba71f", "#735008"], accent: ACCENT, arcs: true, crown: true, candles: true },
  silver: { metal: ["#f7f9fb", "#a6afb9", "#4a5159"], accent: ACCENT, arcs: true, crown: true, candles: true },
  bronze: { metal: ["#ffdcbb", "#c47f43", "#613516"], accent: ACCENT, arcs: true, crown: true, candles: true },
};

export function isFrame(value: string | null | undefined): value is FrameId {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(FRAME_STYLES, value as string);
}

/** Рамка, которую открывает доступ маркета (`frame_<id>`), или null. */
export function frameOfFeature(feature: string | null | undefined): FrameId | null {
  if (!feature || !feature.startsWith("frame_")) return null;
  const id = feature.slice("frame_".length);
  return isFrame(id) ? id : null;
}

/** Рамка места в лидерборде: 1 - золото, 2 - серебро, 3 - бронза. */
export function rankFrame(rank: number): FrameId | null {
  return RANK_FRAMES[rank - 1] ?? null;
}

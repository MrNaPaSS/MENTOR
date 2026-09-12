// Тепловая карта рынка: раскладка плиток и цвет по изменению цены.
//
// Раньше на этом месте стоял встроенный скрипт TradingView: чужой бренд, своя
// тема, внешний скрипт на странице ученика. Теперь карта своя, и рисуется она
// по нашим же данным - тем, что отдаёт `/api/market/tickers`.
//
// Здесь только счёт, без разметки: размер плитки, знак и насыщенность цвета.
// Так их можно проверить тестом, не поднимая браузер.

export interface HeatmapTicker {
  symbol: string;
  price: string;
  priceChangePercent: string;
  quoteVolume?: string;
}

export interface Tile {
  /** Пара целиком: BTCUSDT. */
  symbol: string;
  /** Как её называют на экране: BTC. */
  base: string;
  /** Размер плитки - оборот за сутки. */
  size: number;
  /** Изменение цены за сутки, проценты. */
  change: number;
  price: number;
}

export type Tone = "up" | "down" | "flat";

/** Сколько плиток помещается на телефоне так, чтобы подписи читались. */
export const MAX_TILES = 40;

/** Изменение, выше которого цвет уже не насыщается: пять процентов за сутки. */
export const FULL_COLOR_AT = 5;

/** Меньше этого считаем, что цена стоит: мигать из-за сотой доли незачем. */
const FLAT_BELOW = 0.05;

function num(value: string | number | undefined | null): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function baseOf(symbol: string): string {
  return symbol.replace(/USDT$|USDC$|USD$/i, "") || symbol;
}

/**
 * Плитки карты: самые торгуемые первыми, по обороту за сутки.
 *
 * Пары без оборота не показываем вовсе: плитка нулевого размера всё равно не
 * рисуется, а в списке занимает место.
 */
export function buildTiles(rows: HeatmapTicker[], limit: number = MAX_TILES): Tile[] {
  return rows
    .map((row) => ({
      symbol: row.symbol,
      base: baseOf(row.symbol),
      size: num(row.quoteVolume),
      change: num(row.priceChangePercent),
      price: num(row.price),
    }))
    .filter((tile) => tile.size > 0)
    .sort((a, b) => b.size - a.size)
    .slice(0, Math.max(1, limit));
}

/** Знак изменения: вверх, вниз или стоит. */
export function toneOf(change: number): Tone {
  if (change > FLAT_BELOW) return "up";
  if (change < -FLAT_BELOW) return "down";
  return "flat";
}

/**
 * Насыщенность цвета от нуля до единицы.
 *
 * Пропорционально изменению, но с потолком: без него один улетевший альткоин
 * делал бы всю остальную карту бледной.
 */
export function intensity(change: number): number {
  const value = Math.min(Math.abs(change), FULL_COLOR_AT) / FULL_COLOR_AT;
  return Math.round(value * 100) / 100;
}

/**
 * Цвет плитки: наш зелёный или красный, разбавленный фоном панели.
 *
 * Цвета берём переменными темы, а не числами: тёмная и светлая тема получаются
 * сами, и карта остаётся частью терминала, а не вставкой из другого продукта.
 */
export function tileColor(change: number): string {
  const tone = toneOf(change);
  if (tone === "flat") return "var(--pane-border)";
  const mix = 25 + Math.round(intensity(change) * 60);
  const base = tone === "up" ? "var(--pane-up)" : "var(--pane-down)";
  return `color-mix(in srgb, ${base} ${mix}%, var(--pane-bg))`;
}

/** Подпись изменения со знаком: «+1.24%». */
export function formatChange(change: number): string {
  return `${change > 0 ? "+" : ""}${change.toFixed(2)}%`;
}

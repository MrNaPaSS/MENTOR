// Что покупатель выбирает при заказе товара: цвет, размер.
//
// Хранится у товара строкой JSON (`ShopItem.options`), чтобы ментор мог
// завести новый мерч из админки, не трогая схему базы. Здесь - разбор и сборка.

export type ShopOptions = {
  color: string[];
  size: string[];
};

const NONE: ShopOptions = { color: [], size: [] };

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "") : [];
}

export function parseOptions(raw: string | null | undefined): ShopOptions {
  if (!raw) return NONE;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return NONE;
    const obj = data as Record<string, unknown>;
    return { color: list(obj.color), size: list(obj.size) };
  } catch {
    return NONE;
  }
}

export function stringifyOptions(options: ShopOptions): string {
  const out: Partial<ShopOptions> = {};
  if (options.color.length) out.color = options.color;
  if (options.size.length) out.size = options.size;
  return Object.keys(out).length ? JSON.stringify(out) : "";
}

/** Строка «Чёрный, Белый» -> ["Чёрный", "Белый"]: так ментор вводит варианты в админке. */
export function splitList(text: string): string[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

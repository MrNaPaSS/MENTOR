// Как журнал показывает числа.
//
// Отдельным файлом, потому что этими двумя функциями пользуются и календарь, и
// список сделок, и шапка панели: посчитанное по-разному в соседних углах
// одного окна читается как ошибка сервера.

/** Деньги со знаком: доход без плюса читается как остаток на счёте. */
export function money(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}`;
}

/** Цвет числа по знаку. Ноль - серый: это не победа и не поражение. */
export function tone(value: number): string {
  if (value > 0) return "text-[var(--pane-up)]";
  if (value < 0) return "text-[var(--pane-down)]";
  return "text-[var(--pane-muted)]";
}

/**
 * Цена монеты так, как её читают.
 *
 * У биткоина сотые доллара в цели не значат ничего: `76610.2131` глаз читает
 * дольше, чем `76610`, а решение по ним одно и то же. У монеты за полтора
 * доллара всё наоборот - там сотые и есть весь ход.
 *
 * Поэтому знаков после точки столько, сколько нужно этой цене, а не столько,
 * сколько прислала биржа.
 */
export function priceText(value: number): string {
  const size = Math.abs(value);
  if (!Number.isFinite(value)) return "-";
  if (size >= 1000) return Math.round(value).toLocaleString("en-US").replace(/,/g, " ");
  if (size >= 1) return value.toFixed(2);
  if (size >= 0.01) return value.toFixed(4);
  return value.toFixed(6);
}

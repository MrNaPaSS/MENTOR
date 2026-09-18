// Как журнал показывает числа.
//
// Отдельным файлом, потому что этими двумя функциями пользуются и календарь, и
// список сделок, и шапка панели: посчитанное по-разному в соседних углах
// одного окна читается как ошибка сервера.

/** Деньги со знаком: доход без плюса читается как остаток на счёте. */
export function money(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  // Тысячи - точкой, копейки - запятой, как во всём кабинете: «+1.182,23».
  // Слитная запись «+1182.23» на четырёхзначных суммах читается с трудом, а
  // сделки в терминале бывают и на десятки тысяч.
  return `${sign}${Math.abs(value).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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
  // Тысячи разделяются точкой - как суммы и объёмы в кабинете.
  if (size >= 1000) {
    return Math.round(value).toLocaleString("de-DE", { maximumFractionDigits: 0 });
  }
  if (size >= 1) return value.toFixed(2).replace(".", ",");
  if (size >= 0.01) return value.toFixed(4).replace(".", ",");
  return value.toFixed(6).replace(".", ",");
}

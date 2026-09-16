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

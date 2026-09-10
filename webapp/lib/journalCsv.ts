// Журнал сделок файлом CSV - функция, купленная в маркете.
//
// Разделитель - точка с запятой, дробная часть - запятая, а в начале метка
// BOM: так файл открывается двойным щелчком в Excel с русскими настройками,
// не превращаясь в одну колонку с кракозябрами. Google Таблицы читают его так
// же, если при импорте указать разделитель.

import type { JournalTrade } from "./journal";

const HEADER = [
  "Открыта",
  "Закрыта",
  "Монета",
  "Сторона",
  "Вход",
  "Выход",
  "Стоп",
  "Объём",
  "Маржа",
  "Плечо",
  "Целей взято",
  "Исход",
  "Итог USDT",
  "Комиссия USDT",
  "Заметка",
];

const OUTCOME: Record<JournalTrade["outcome"], string> = {
  stop: "стоп",
  take: "цель",
  manual: "вручную",
};

function num(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return String(value).replace(".", ",");
}

function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Ячейка с кавычками, если внутри есть разделитель, кавычка или перенос строки. */
function cell(value: string): string {
  return /[;"\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function journalCsv(trades: readonly JournalTrade[]): string {
  const lines = trades.map((trade) =>
    [
      when(trade.opened_at),
      when(trade.closed_at),
      trade.symbol,
      trade.side === "long" ? "лонг" : "шорт",
      num(trade.entry),
      num(trade.exit_price),
      num(trade.stop),
      num(trade.qty),
      num(trade.margin),
      num(trade.leverage),
      `${trade.takes_hit}/${trade.targets.length}`,
      OUTCOME[trade.outcome] ?? trade.outcome,
      num(trade.pnl),
      num(trade.fee),
      trade.note ?? "",
    ]
      .map(cell)
      .join(";"),
  );
  return "﻿" + [HEADER.join(";"), ...lines].join("\r\n");
}

/** Отдать файл браузеру на сохранение. */
export function saveCsv(name: string, text: string): void {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

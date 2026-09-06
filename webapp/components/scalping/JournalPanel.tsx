"use client";

// Журнал сделок и календарь прибыли.
//
// Сделка попадает сюда закрытой: со стопом, целью или закрытая руками. Пока
// она идёт, её видно на графике, а в журнале ей делать нечего — статистика по
// намерениям не считается.
//
// Календарь и список стоят рядом намеренно. По списку видно, что было в
// конкретной сделке, по календарю — что было с дисциплиной: один красный день
// на весь месяц и десять подряд выглядят одинаково в сумме и совершенно
// по-разному на сетке.

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Trash2, X } from "lucide-react";
import {
  loadCalendar,
  loadTrades,
  removeTrade,
  type JournalDay,
  type JournalSummary,
  type JournalTrade,
} from "@/lib/journal";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const OUTCOMES: Record<JournalTrade["outcome"], string> = {
  take: "цель",
  stop: "стоп",
  manual: "руками",
};

function money(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(2)}`;
}

/**
 * Взятые цели точками: зелёная — сработала, пустая — нет.
 *
 * Одной строкой «1/3» это не показать: цвет достаётся всей ячейке, и сделка с
 * одной взятой целью читается как сделка, отработавшая все три.
 */
function Takes({ trade }: { trade: JournalTrade }) {
  if (trade.targets.length === 0) {
    return <span className="text-[var(--pane-muted)]">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-0.5">
      {trade.targets.map((_, i) => (
        <span
          key={i}
          className={
            i < trade.takes_hit ? "text-[var(--pane-up)]" : "text-[var(--pane-muted)] opacity-50"
          }
        >
          {i < trade.takes_hit ? "●" : "○"}
        </span>
      ))}
    </span>
  );
}

/** Полный список целей с отметкой взятых — в подсказке, чтобы не растить таблицу. */
function takesHint(trade: JournalTrade): string {
  if (trade.targets.length === 0) return "Цели не выставлялись";
  return trade.targets
    .map((price, i) => `${i < trade.takes_hit ? "✓" : "·"} тейк ${i + 1}: ${price}`)
    .join("\n");
}

function tone(value: number): string {
  if (value > 0) return "text-[var(--pane-up)]";
  if (value < 0) return "text-[var(--pane-down)]";
  return "text-[var(--pane-muted)]";
}

/** Сетка месяца: понедельник первым, пустые клетки до первого числа. */
function monthCells(year: number, month: number, days: JournalDay[]) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const first = new Date(Date.UTC(year, month - 1, 1));
  const total = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // getUTCDay(): воскресенье — ноль, а неделя у нас начинается с понедельника.
  const lead = (first.getUTCDay() + 6) % 7;

  const cells: (JournalDay | null | undefined)[] = Array(lead).fill(null);
  for (let day = 1; day <= total; day++) {
    const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push(byDate.get(key));
  }
  return cells;
}

export default function JournalPanel({
  symbol,
  refreshKey,
  onHover,
  onClose,
}: {
  /** Показать только этот инструмент. Пусто — все. */
  symbol?: string;
  /** Меняется, когда терминал записал новую сделку: повод перечитать. */
  refreshKey: number;
  /** Сделка под курсором: её разметка показывается на графике. */
  onHover?: (trade: JournalTrade | null) => void;
  onClose: () => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [onlySymbol, setOnlySymbol] = useState(false);

  const [trades, setTrades] = useState<JournalTrade[]>([]);
  const [summary, setSummary] = useState<JournalSummary | null>(null);
  const [days, setDays] = useState<JournalDay[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [list, cal] = await Promise.all([
        loadTrades(90, onlySymbol ? symbol : undefined),
        loadCalendar(year, month),
      ]);
      if (list) {
        setTrades(list.trades);
        setSummary(list.summary);
      }
      if (cal) {
        setDays(cal.days);
        setTotal(cal.total);
      }
      if (!list && !cal) setError("Журнал доступен после входа в кабинет");
    } catch {
      setError("Не удалось загрузить журнал");
    } finally {
      setBusy(false);
    }
  }, [year, month, onlySymbol, symbol]);

  useEffect(() => {
    reload();
  }, [reload, refreshKey]);

  async function drop(id: number) {
    await removeTrade(id);
    reload();
  }

  function shiftMonth(delta: number) {
    const next = new Date(Date.UTC(year, month - 1 + delta, 1));
    setYear(next.getUTCFullYear());
    setMonth(next.getUTCMonth() + 1);
  }

  return (
    <div className="flex h-full flex-col text-[12px]">
      <div className="flex items-center justify-between border-b border-[var(--pane-border)] px-3 py-2">
        <span className="font-semibold text-[var(--pane-text)]">Журнал сделок</span>
        <div className="flex items-center gap-2">
          {symbol && (
            <button
              onClick={() => setOnlySymbol((v) => !v)}
              className={`rounded px-1.5 py-0.5 text-[11px] transition-colors duration-150 ease-out ${
                onlySymbol
                  ? "bg-[var(--pane-accent-faint)] text-[var(--pane-accent)]"
                  : "text-[var(--pane-muted)] hover:text-[var(--pane-text)]"
              }`}
            >
              только {symbol.replace(/USDT$/, "")}
            </button>
          )}
          <button
            onClick={reload}
            title="Обновить"
            className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={onClose}
            title="Закрыть журнал"
            className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error ? (
        <p className="grid flex-1 place-items-center px-4 text-center text-[var(--pane-muted)]">
          {error}
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          {summary && (
            <div className="mb-3 grid grid-cols-5 gap-2 font-mono tabular-nums">
              <Stat label="Итог, $" value={money(summary.pnl)} tone={tone(summary.pnl)} />
              <Stat label="Сделок" value={String(summary.count)} />
              <Stat label="Прибыльных" value={`${summary.win_rate}%`} />
              <Stat
                label="Лучшая"
                value={summary.wins > 0 ? money(summary.best) : "—"}
                tone={summary.wins > 0 ? tone(summary.best) : undefined}
              />
              <Stat
                label="Худшая"
                value={summary.losses > 0 ? money(summary.worst) : "—"}
                tone={summary.losses > 0 ? tone(summary.worst) : undefined}
              />
            </div>
          )}

          <div className="mb-3 rounded border border-[var(--pane-border)] p-2">
            <div className="mb-2 flex items-center justify-between">
              <button
                onClick={() => shiftMonth(-1)}
                className="px-1 text-[var(--pane-muted)] hover:text-[var(--pane-text)]"
              >
                ←
              </button>
              <span className="font-mono text-[11px] text-[var(--pane-text-2)]">
                {String(month).padStart(2, "0")}.{year} ·{" "}
                <span className={tone(total)}>{money(total)} $</span>
              </span>
              <button
                onClick={() => shiftMonth(1)}
                className="px-1 text-[var(--pane-muted)] hover:text-[var(--pane-text)]"
              >
                →
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center">
              {WEEKDAYS.map((w) => (
                <span key={w} className="text-[10px] text-[var(--pane-muted)]">
                  {w}
                </span>
              ))}
              {monthCells(year, month, days).map((cell, i) => (
                <div
                  key={i}
                  title={cell ? `${cell.trades} сделок · ${money(cell.pnl)} $` : undefined}
                  className={`rounded py-1 font-mono text-[10px] tabular-nums ${
                    cell === null
                      ? ""
                      : cell === undefined
                        ? "text-[var(--pane-muted)]"
                        : cell.pnl >= 0
                          ? "bg-[var(--pane-up-soft)] text-[var(--pane-up)]"
                          : "bg-[var(--pane-down-soft)] text-[var(--pane-down)]"
                  }`}
                >
                  {cell ? money(cell.pnl) : cell === undefined ? "·" : ""}
                </div>
              ))}
            </div>
          </div>

          {trades.length === 0 ? (
            <p className="py-6 text-center text-[var(--pane-muted)]">
              Пока пусто. Закрытая сделка попадёт сюда сама.
            </p>
          ) : (
            <table className="w-full font-mono text-[11px] tabular-nums">
              <thead className="text-[10px] text-[var(--pane-muted)]">
                <tr className="text-left">
                  <th className="py-1">Дата</th>
                  <th>Монета</th>
                  <th>Вход</th>
                  <th>Выход</th>
                  <th>Цели</th>
                  <th className="text-right">Итог</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr
                    key={t.id}
                    onMouseEnter={() => onHover?.(t)}
                    onMouseLeave={() => onHover?.(null)}
                    className="cursor-default border-t border-[var(--pane-border)] transition-colors duration-150 ease-out hover:bg-[var(--pane-hover)]"
                  >
                    <td className="py-1 text-[var(--pane-muted)]">
                      {new Date(t.closed_at).toLocaleString("ru", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td>
                      <span className={t.side === "long" ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"}>
                        {t.symbol.replace(/USDT$/, "")}
                      </span>{" "}
                      <span className="text-[10px] text-[var(--pane-muted)]">
                        ×{t.leverage} · {OUTCOMES[t.outcome]}
                      </span>
                    </td>
                    <td className="text-[var(--pane-text-2)]">{t.entry}</td>
                    <td className="text-[var(--pane-text-2)]">{t.exit_price ?? "—"}</td>
                    <td title={takesHint(t)}>
                      <Takes trade={t} />
                    </td>
                    <td className={`text-right ${tone(t.pnl)}`}>{money(t.pnl)}</td>
                    <td className="pl-2 text-right">
                      <button
                        onClick={() => drop(t.id)}
                        title="Удалить запись"
                        className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-down)]"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded border border-[var(--pane-border)] px-2 py-1">
      <div className="text-[10px] text-[var(--pane-muted)]">{label}</div>
      <div className={tone ?? "text-[var(--pane-text)]"}>{value}</div>
    </div>
  );
}

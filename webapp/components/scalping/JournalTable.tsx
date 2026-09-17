"use client";

// Список закрытых сделок: одна таблица журнала.
//
// Вынесен из панели, потому что таблиц теперь две: на широком окне записи
// делятся пополам и идут двумя колонками рядом. Одна таблица во всю ширину
// растягивала шесть коротких чисел на полтора метра экрана, а в видимую часть
// помещалось вдвое меньше сделок, чем могло бы.

import { Share2, Trash2 } from "lucide-react";

import { useIntlLocale, useT, type Dict } from "@/lib/i18n";
import { money, tone } from "@/lib/journalFormat";
import type { JournalTrade, LiveJournalTrade } from "@/lib/journal";

/**
 * Строка таблицы: закрытая сделка или идущая.
 *
 * Обе рисуются одной таблицей намеренно - это один и тот же журнал, и
 * заводить для идущих отдельный вид значило бы держать две разметки одного
 * списка. Отличия точечные: дата берётся у открытия, результат подписан как
 * зафиксированный, и карточкой такой сделкой не делятся - она не кончилась.
 */
export type JournalRow = JournalTrade | LiveJournalTrade;

function isLive(row: JournalRow): row is LiveJournalTrade {
  return row.closed_at === null;
}

/**
 * Взятые цели точками: зелёная - сработала, пустая - нет.
 *
 * Одной строкой «1/3» это не показать: цвет достаётся всей ячейке, и сделка с
 * одной взятой целью читается как сделка, отработавшая все три.
 */
function Takes({ trade }: { trade: JournalRow }) {
  if (trade.targets.length === 0) {
    return <span className="text-[var(--pane-muted)]">-</span>;
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

/** Полный список целей с отметкой взятых - в подсказке, чтобы не растить таблицу. */
function takesHint(trade: JournalRow, t: Dict): string {
  if (trade.targets.length === 0) return t.journal.noTargets;
  return trade.targets
    .map((price, i) => t.journal.takeLine(i < trade.takes_hit ? "✓" : "·", i + 1, String(price)))
    .join("\n");
}

/** Что показывает подсказка у идущей сделки: сколько взято и сколько закрыто. */
function liveHint(row: LiveJournalTrade, t: Dict): string {
  if (row.takes_hit === 0) return t.journal.liveNone;
  const part = row.qty > 0 ? `${Math.round((row.closed_qty / row.qty) * 100)}%` : "-";
  return t.journal.liveHint(row.takes_hit, row.targets.length, part);
}

export interface JournalTableProps {
  rows: readonly JournalRow[];
  /** Сделка под курсором: её разметка показывается на графике. */
  onHover?: (trade: JournalRow | null) => void;
  /** Нажали на строку: разметка сделки ложится на график. */
  onPick?: (trade: JournalRow) => void;
  /** Открыть карточку сделки. Идущим не предлагается: сделка не кончилась. */
  onCard?: (trade: JournalTrade) => void;
  /** Убрать запись. Пусто - права нет, и колонки не будет. */
  onDrop?: (id: number) => void;
}

export default function JournalTable({ rows, onHover, onPick, onCard, onDrop }: JournalTableProps) {
  const t = useT();
  const numbers = useIntlLocale();

  return (
    <table className="w-full font-mono text-[10px] tabular-nums">
      {/* Шапка держится на месте: список прокручивается сам, своей колонкой, и
          уехавшая шапка оставляла бы шесть колонок чисел без подписей. */}
      <thead className="text-[9px] text-[var(--pane-muted)] [&>tr>th]:sticky [&>tr>th]:top-0 [&>tr>th]:z-10 [&>tr>th]:bg-[var(--pane-bg)]">
        <tr className="text-left">
          <th className="py-1">{t.journal.colDate}</th>
          <th>{t.journal.colCoin}</th>
          <th>{t.journal.colEntry}</th>
          <th>{t.journal.colExit}</th>
          <th>{t.journal.colTargets}</th>
          <th className="text-right">{t.journal.colResult}</th>
          <th />
          {onDrop && <th />}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.id}
            onMouseEnter={() => onHover?.(row)}
            onMouseLeave={() => onHover?.(null)}
            onClick={() => onPick?.(row)}
            title={t.journal.openChart}
            className={`border-t border-[var(--pane-border)] transition-colors duration-150 ease-out hover:bg-[var(--pane-hover)] ${
              onPick ? "cursor-pointer" : "cursor-default"
            }`}
          >
            <td className="py-1 text-[var(--pane-muted)]">
              {/* У идущей сделки даты закрытия нет - показываем, когда вошли. */}
              {new Date(row.closed_at ?? row.opened_at ?? "").toLocaleString(numbers, {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </td>
            <td>
              <span
                className={row.side === "long" ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"}
              >
                {row.symbol.replace(/USDT$/, "")}
              </span>{" "}
              <span className="text-[9px] text-[var(--pane-muted)]">
                ×{row.leverage} · {t.journal.reasons[row.outcome]}
                {/* Где сделка была открыта: биржи считаются порознь, и строка
                    без биржи в общем списке ни о чём не говорит. */}
                {row.exchange && <span className="ml-1 uppercase tracking-wide">{row.exchange}</span>}
              </span>
            </td>
            <td className="text-[var(--pane-text-2)]">{row.entry}</td>
            <td className="text-[var(--pane-text-2)]">{row.exit_price ?? "-"}</td>
            <td title={takesHint(row, t)}>
              <Takes trade={row} />
            </td>
            <td
              className={`text-right ${tone(row.pnl)}`}
              title={
                isLive(row)
                  ? liveHint(row, t)
                  : row.fee
                    ? t.journal.pnlWithFee(
                        money(row.pnl),
                        money(row.pnl + row.fee),
                        row.fee.toFixed(2),
                      )
                    : t.journal.pnlNet
              }
            >
              {/* У идущей сделки это только зафиксированное взятыми целями:
                  плавающее по остатку живёт в строке позиции, и смешивать их
                  в одном числе нельзя - оно читалось бы как итог. */}
              {isLive(row) && <span className="mr-1 text-[9px] opacity-60">●</span>}
              {money(row.pnl)}
              {!isLive(row) && row.fee > 0 && (
                <span className="ml-1 text-[9px] text-[var(--pane-muted)]">
                  -{row.fee.toFixed(2)}
                </span>
              )}
            </td>
            {/* Карточка сделки: та самая, которой делятся в чате. Отдельной
                кнопкой, а не по строке - нажатие по строке уже занято графиком,
                и отбирать его нельзя: «почему так вышло» спрашивают чаще, чем
                «покажи всем». */}
            <td className="pl-2 text-right">
              {onCard && !isLive(row) && (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onCard(row);
                  }}
                  title={t.journal.cardTitle}
                  className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-accent)]"
                >
                  <Share2 className="h-3 w-3" />
                </button>
              )}
            </td>
            {/* Убрать запись может только наставник: журнал - это статистика, и
                право стереть из неё неудачную сделку обесценивает её целиком. */}
            {onDrop && (
              <td className="pl-2 text-right">
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onDrop(row.id);
                  }}
                  title={t.journal.remove}
                  className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-down)]"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

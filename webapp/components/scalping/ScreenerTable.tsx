"use client";

// Список монет с метриками скальпинга.
//
// Таблица живёт в узкой панели рядом со стаканом и графиком, поэтому колонки
// имеют фиксированную ширину, а не делят свободное место: иначе между «Монетой»
// и «Плитой» образуется пустота в половину экрана.
//
// Порядок колонок отвечает вопросу «где сейчас работать»: сначала крупные
// заявки, ради которых раздел и сделан, затем давление и подвижность, и только
// потом оборот. Сортировка — по клику на заголовок.

import { memo } from "react";
import { ArrowDown, Star } from "lucide-react";
import {
  base,
  money,
  price as fmtPrice,
  SORT_LABELS,
  type ScreenerRow,
  type SortKey,
} from "@/lib/scalping";

const COLUMNS: {
  key: SortKey | null;
  label: string;
  width: string;
  align: string;
  hint?: string;
}[] = [
  // Монете отведено больше всех: в неё не влезали цены вроде 79 694.50 и
  // 0.026513, они обрезались многоточием и читать список было нельзя.
  { key: null, label: "Монета", width: "w-[164px]", align: "text-left" },
  {
    key: "walls",
    label: "Плита",
    width: "w-[96px]",
    align: "text-right",
    hint: "Крупная заявка рядом с ценой и её удаление в базисных пунктах",
  },
  {
    key: "imbalance",
    label: "Перевес",
    width: "w-[44px]",
    align: "text-center",
    hint: "Чья сторона стакана плотнее",
  },
  {
    key: "delta",
    label: "Дельта",
    width: "w-[58px]",
    align: "text-right",
    hint: "Покупки минус продажи по рынку за минуту",
  },
  {
    key: "range",
    label: "Ход",
    width: "w-[36px]",
    align: "text-right",
    hint: "Размах цены за минуту, базисные пункты",
  },
  {
    key: "spread",
    label: "Спред",
    width: "w-[36px]",
    align: "text-right",
    hint: "Стоимость входа по рынку, базисные пункты",
  },
  {
    key: "volume",
    label: "Оборот",
    width: "w-[52px]",
    align: "text-right",
    hint: "За сутки",
  },
];

type Props = {
  rows: ScreenerRow[];
  selected: string | null;
  /** Монеты с идущими сделками: они стоят наверху и помечены. */
  active?: Set<string>;
  /** Избранные монеты: свой раздел наверху и звезда в строке. */
  favorites?: Set<string>;
  onToggleFavorite?: (symbol: string) => void;
  sort: SortKey;
  onSort: (key: SortKey) => void;
  onSelect: (symbol: string) => void;
};

export default function ScreenerTable({
  rows,
  selected,
  active,
  favorites,
  onToggleFavorite,
  sort,
  onSort,
  onSelect,
}: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse whitespace-nowrap text-[11px] tabular-nums">
        <thead>
          {/* Шапка держится при прокрутке списка: тридцать строк не помещаются
              в панель, и без неё непонятно, что за колонка перед тобой. */}
          <tr className="text-[var(--pane-muted)]">
            {COLUMNS.map((col) => {
              const active = col.key && col.key === sort;
              return (
                <th
                  key={col.label}
                  title={col.hint}
                  onClick={() => col.key && onSort(col.key)}
                  className={`sticky top-0 z-10 bg-[var(--pane-bg)] px-1.5 py-2 font-medium shadow-[0_1px_0_#2B3139] ${col.width} ${col.align} ${
                    col.key
                      ? "cursor-pointer select-none transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
                      : ""
                  } ${active ? "text-[var(--pane-accent)]" : ""}`}
                >
                  <span className="inline-flex items-center gap-0.5">
                    {col.label}
                    {active && <ArrowDown className="h-2.5 w-2.5" />}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Row
              key={row.symbol}
              row={row}
              selected={row.symbol === selected}
              mine={Boolean(active?.has(row.symbol))}
              starred={Boolean(favorites?.has(row.symbol))}
              onStar={onToggleFavorite}
              onSelect={onSelect}
            />
          ))}
        </tbody>
      </table>

      {rows.length === 0 && (
        <p className="py-10 text-center text-sm text-[var(--pane-muted)]">Собираем стаканы с биржи…</p>
      )}
    </div>
  );
}

const Row = memo(function Row({
  row,
  selected,
  mine,
  starred,
  onStar,
  onSelect,
}: {
  row: ScreenerRow;
  selected: boolean;
  /** По этой монете идёт сделка. */
  mine: boolean;
  /** Монета в избранном. */
  starred: boolean;
  onStar?: (symbol: string) => void;
  onSelect: (symbol: string) => void;
}) {
  return (
    <tr
      // Реакция на нажатие, а не на отпускание: подсветка должна появиться в тот
      // момент, когда палец коснулся строки.
      onPointerDown={() => onSelect(row.symbol)}
      className={`cursor-pointer border-b border-[var(--pane-border)]/40 transition-colors duration-150 ease-out ${
        selected
          ? "bg-[var(--pane-accent-faint)] shadow-[inset_2px_0_0_#0AFFE0]"
          : "hover:bg-[var(--pane-bg)]/60 active:bg-[var(--pane-bg)]"
      }`}
    >
      {/* Тикер фиксированной ширины, цена и изменение — по своим местам:
          иначе длинные имена вроде MARSCOIN распирают строку на две. */}
      <td className="px-1.5 py-1.5">
        <div className="flex items-baseline gap-1.5 whitespace-nowrap">
          {onStar && (
            <button
              // Нажатие не должно открывать монету: звезда - отдельное
              // действие, и промах по ней стоил бы смены инструмента.
              onPointerDown={(event) => {
                event.stopPropagation();
                onStar(row.symbol);
              }}
              title={starred ? "Убрать из избранного" : "В избранное"}
              className={`shrink-0 self-center transition-colors duration-150 ease-out ${
                starred
                  ? "text-[var(--pane-gold)]"
                  : "text-[var(--pane-muted)] opacity-40 hover:opacity-100"
              }`}
            >
              <Star className="h-3 w-3" fill={starred ? "currentColor" : "none"} />
            </button>
          )}
          <span
            className={`w-[62px] shrink-0 overflow-hidden text-ellipsis font-semibold ${
              mine ? "text-[var(--pane-accent)]" : "text-[var(--pane-text)]"
            }`}
            title={mine ? "По этой монете идёт сделка" : undefined}
          >
            {mine && "• "}
            {base(row.symbol)}
          </span>
          <span className="flex-1 text-right font-mono text-[10px] text-[var(--pane-text-2)]">
            {fmtPrice(row.price)}
          </span>
          <span
            className={`w-[40px] shrink-0 text-right font-mono text-[10px] ${
              row.change_pct >= 0 ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"
            }`}
          >
            {row.change_pct >= 0 ? "+" : ""}
            {row.change_pct.toFixed(1)}%
          </span>
        </div>
      </td>

      <td className="px-1.5 py-1.5 text-right">
        <WallCell row={row} />
      </td>

      <td className="px-1.5 py-1.5">
        <ImbalanceBar ratio={row.book_ratio} />
      </td>

      <td
        className={`px-1.5 py-1.5 text-right font-mono ${
          row.delta_notional >= 0 ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"
        }`}
      >
        {row.delta_notional >= 0 ? "+" : "-"}
        {money(Math.abs(row.delta_notional))}
      </td>

      <td className="px-1.5 py-1.5 text-right font-mono text-[var(--pane-text-2)]">
        {row.range_bp.toFixed(0)}
      </td>

      <td className="px-1.5 py-1.5 text-right font-mono text-[var(--pane-text-2)]">
        {row.spread_bp.toFixed(1)}
      </td>

      <td className="px-1.5 py-1.5 text-right font-mono text-[var(--pane-muted)]">
        {money(row.volume_24h)}
      </td>
    </tr>
  );
});

/** Плита: сторона стрелкой, размер в деньгах и удаление от цены. */
function WallCell({ row }: { row: ScreenerRow }) {
  if (!row.wall_notional) return <span className="text-[var(--pane-muted)]">-</span>;
  const isBid = row.wall_side === "bid";
  return (
    <span className="inline-flex items-baseline gap-1 font-mono">
      <span className={isBid ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"}>{isBid ? "▲" : "▼"}</span>
      <span className="font-semibold text-[var(--pane-text)]">{money(row.wall_notional)}</span>
      <span className="text-[10px] text-[var(--pane-muted)]">{row.wall_distance_bp.toFixed(0)}</span>
    </span>
  );
}

/** Перевес стакана одной полоской: влево продавцы, вправо покупатели. */
function ImbalanceBar({ ratio }: { ratio: number }) {
  const buy = Math.round(ratio * 100);
  return (
    <div
      // Полоса меняется несколько раз в секунду — анимировать её нельзя:
      // трейдер видел бы вчерашнее значение, догоняющее сегодняшнее.
      className="mx-auto flex h-2.5 w-11 overflow-hidden rounded-sm bg-[var(--pane-deep)]"
      title={`${buy}% покупок`}
    >
      <div className="bg-[var(--pane-up)]" style={{ width: `${buy}%` }} />
      <div className="bg-[var(--pane-down)]" style={{ width: `${100 - buy}%` }} />
    </div>
  );
}

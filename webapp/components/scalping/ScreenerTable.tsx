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
import { ArrowDown } from "lucide-react";
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
  { key: null, label: "Монета", width: "w-[112px]", align: "text-left" },
  {
    key: "walls",
    label: "Плита",
    width: "w-[104px]",
    align: "text-right",
    hint: "Крупная заявка рядом с ценой и её удаление в базисных пунктах",
  },
  {
    key: "imbalance",
    label: "Перевес",
    width: "w-[52px]",
    align: "text-center",
    hint: "Чья сторона стакана плотнее",
  },
  {
    key: "delta",
    label: "Дельта",
    width: "w-[62px]",
    align: "text-right",
    hint: "Покупки минус продажи по рынку за минуту",
  },
  {
    key: "range",
    label: "Ход",
    width: "w-[40px]",
    align: "text-right",
    hint: "Размах цены за минуту, базисные пункты",
  },
  {
    key: "spread",
    label: "Спред",
    width: "w-[40px]",
    align: "text-right",
    hint: "Стоимость входа по рынку, базисные пункты",
  },
  {
    key: "volume",
    label: "Оборот",
    width: "w-[56px]",
    align: "text-right",
    hint: "За сутки",
  },
];

type Props = {
  rows: ScreenerRow[];
  selected: string | null;
  sort: SortKey;
  onSort: (key: SortKey) => void;
  onSelect: (symbol: string) => void;
};

export default function ScreenerTable({ rows, selected, sort, onSort, onSelect }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-[11px] tabular-nums">
        <thead>
          <tr className="border-b border-border text-text-muted">
            {COLUMNS.map((col) => {
              const active = col.key && col.key === sort;
              return (
                <th
                  key={col.label}
                  title={col.hint}
                  onClick={() => col.key && onSort(col.key)}
                  className={`px-1.5 py-2 font-medium ${col.width} ${col.align} ${
                    col.key
                      ? "cursor-pointer select-none transition-colors duration-150 ease-out hover:text-text-primary"
                      : ""
                  } ${active ? "text-accent-cyan" : ""}`}
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
              onSelect={onSelect}
            />
          ))}
        </tbody>
      </table>

      {rows.length === 0 && (
        <p className="py-10 text-center text-sm text-text-muted">Собираем стаканы с биржи…</p>
      )}
    </div>
  );
}

const Row = memo(function Row({
  row,
  selected,
  onSelect,
}: {
  row: ScreenerRow;
  selected: boolean;
  onSelect: (symbol: string) => void;
}) {
  return (
    <tr
      // Реакция на нажатие, а не на отпускание: подсветка должна появиться в тот
      // момент, когда палец коснулся строки.
      onPointerDown={() => onSelect(row.symbol)}
      className={`cursor-pointer border-b border-border/40 transition-colors duration-150 ease-out ${
        selected ? "bg-accent-cyan/10" : "hover:bg-bg-panel/60 active:bg-bg-panel"
      }`}
    >
      <td className="px-1.5 py-1.5">
        <div className="flex items-baseline gap-1">
          <span className="font-semibold text-text-primary">{base(row.symbol)}</span>
          <span className="truncate font-mono text-[10px] text-text-secondary">
            {fmtPrice(row.price)}
          </span>
          <span
            className={`font-mono text-[10px] ${
              row.change_pct >= 0 ? "text-success" : "text-danger"
            }`}
          >
            {row.change_pct >= 0 ? "+" : ""}
            {row.change_pct.toFixed(1)}
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
          row.delta_notional >= 0 ? "text-success" : "text-danger"
        }`}
      >
        {row.delta_notional >= 0 ? "+" : "−"}
        {money(Math.abs(row.delta_notional))}
      </td>

      <td className="px-1.5 py-1.5 text-right font-mono text-text-secondary">
        {row.range_bp.toFixed(0)}
      </td>

      <td className="px-1.5 py-1.5 text-right font-mono text-text-secondary">
        {row.spread_bp.toFixed(1)}
      </td>

      <td className="px-1.5 py-1.5 text-right font-mono text-text-muted">
        {money(row.volume_24h)}
      </td>
    </tr>
  );
});

/** Плита: сторона стрелкой, размер в деньгах и удаление от цены. */
function WallCell({ row }: { row: ScreenerRow }) {
  if (!row.wall_notional) return <span className="text-text-muted">—</span>;
  const isBid = row.wall_side === "bid";
  return (
    <span className="inline-flex items-baseline gap-1 font-mono">
      <span className={isBid ? "text-success" : "text-danger"}>{isBid ? "▲" : "▼"}</span>
      <span className="font-semibold text-text-primary">{money(row.wall_notional)}</span>
      <span className="text-[10px] text-text-muted">{row.wall_distance_bp.toFixed(0)}</span>
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
      className="mx-auto flex h-2.5 w-11 overflow-hidden rounded-sm bg-bg-deep"
      title={`${buy}% покупок`}
    >
      <div className="bg-success/70" style={{ width: `${buy}%` }} />
      <div className="bg-danger/70" style={{ width: `${100 - buy}%` }} />
    </div>
  );
}

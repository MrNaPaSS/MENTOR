"use client";

// Список монет с метриками скальпинга.
//
// Порядок колонок отвечает вопросу трейдера «где сейчас работать»: сначала
// крупные заявки, ради которых раздел и сделан, затем давление и подвижность,
// и только потом оборот. Сортировка — по клику на заголовок.

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

const COLUMNS: { key: SortKey | null; label: string; align: string; hint?: string }[] = [
  { key: null, label: "Монета", align: "text-left" },
  { key: "walls", label: "Плита", align: "text-right", hint: "Крупная заявка рядом с ценой" },
  { key: "imbalance", label: "Перевес", align: "text-center", hint: "Чья сторона плотнее" },
  { key: "delta", label: "Дельта 1м", align: "text-right", hint: "Покупки минус продажи по рынку" },
  { key: "spike", label: "Всплеск", align: "text-right", hint: "Активность против своей нормы" },
  { key: "range", label: "Ход 1м", align: "text-right", hint: "Размах цены, базисные пункты" },
  { key: "spread", label: "Спред", align: "text-right", hint: "Стоимость входа по рынку" },
  { key: "volume", label: "Оборот", align: "text-right", hint: "За сутки" },
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
      <table className="w-full min-w-[720px] border-collapse text-xs">
        <thead>
          <tr className="border-b border-border text-text-muted">
            {COLUMNS.map((col) => {
              const active = col.key && col.key === sort;
              return (
                <th
                  key={col.label}
                  title={col.hint}
                  onClick={() => col.key && onSort(col.key)}
                  className={`px-2 py-2 font-medium ${col.align} ${
                    col.key ? "cursor-pointer select-none hover:text-text-primary" : ""
                  } ${active ? "text-accent-cyan" : ""}`}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {active && <ArrowDown className="h-3 w-3" />}
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
        <p className="py-10 text-center text-sm text-text-muted">
          Собираем стаканы с биржи…
        </p>
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
      onClick={() => onSelect(row.symbol)}
      className={`cursor-pointer border-b border-border/40 transition-colors ${
        selected ? "bg-accent-cyan/10" : "hover:bg-bg-panel/60"
      }`}
    >
      <td className="px-2 py-2">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-text-primary">{base(row.symbol)}</span>
          <span className="font-mono text-[11px] text-text-secondary">
            {fmtPrice(row.price)}
          </span>
          <span
            className={`font-mono text-[11px] ${
              row.change_pct >= 0 ? "text-success" : "text-danger"
            }`}
          >
            {row.change_pct >= 0 ? "+" : ""}
            {row.change_pct.toFixed(1)}%
          </span>
        </div>
      </td>

      <td className="px-2 py-2 text-right">
        <WallCell row={row} />
      </td>

      <td className="px-2 py-2">
        <ImbalanceBar ratio={row.book_ratio} />
      </td>

      <td
        className={`px-2 py-2 text-right font-mono ${
          row.delta_notional >= 0 ? "text-success" : "text-danger"
        }`}
      >
        {row.delta_notional >= 0 ? "+" : "−"}
        {money(Math.abs(row.delta_notional))}
      </td>

      <td className="px-2 py-2 text-right font-mono">
        <span className={row.spike >= 2 ? "text-accent-gold" : "text-text-secondary"}>
          ×{row.spike.toFixed(1)}
        </span>
      </td>

      <td className="px-2 py-2 text-right font-mono text-text-secondary">
        {row.range_bp.toFixed(0)}
      </td>

      <td className="px-2 py-2 text-right font-mono text-text-secondary">
        {row.spread_bp.toFixed(1)}
      </td>

      <td className="px-2 py-2 text-right font-mono text-text-muted">
        {money(row.volume_24h)}
      </td>
    </tr>
  );
});

/** Плита: сторона, размер в деньгах и насколько далеко от цены. */
function WallCell({ row }: { row: ScreenerRow }) {
  if (!row.wall_notional) {
    return <span className="text-text-muted">—</span>;
  }
  const isBid = row.wall_side === "bid";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`rounded px-1 py-0.5 text-[10px] font-semibold ${
          isBid ? "bg-success/15 text-success" : "bg-danger/15 text-danger"
        }`}
      >
        {isBid ? "покупка" : "продажа"}
      </span>
      <span className="font-mono font-semibold text-text-primary">
        {money(row.wall_notional)}
      </span>
      <span className="font-mono text-[10px] text-text-muted">
        {row.wall_distance_bp.toFixed(0)} б.п.
      </span>
    </span>
  );
}

/** Перевес стакана одной полоской: влево — продавцы, вправо — покупатели. */
function ImbalanceBar({ ratio }: { ratio: number }) {
  const buy = Math.round(ratio * 100);
  return (
    <div className="mx-auto flex h-3 w-20 overflow-hidden rounded-sm bg-bg-deep" title={`${buy}% покупок`}>
      <div className="bg-success/70" style={{ width: `${buy}%` }} />
      <div className="bg-danger/70" style={{ width: `${100 - buy}%` }} />
    </div>
  );
}

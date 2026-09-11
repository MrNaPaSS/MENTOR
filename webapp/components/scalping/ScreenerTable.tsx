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

import { useT } from "@/lib/i18n";
import { memo } from "react";
import { ArrowDown, Star } from "lucide-react";
import {
  base,
  money,
  price as fmtPrice,
  type ScreenerRow,
  type SortKey,
} from "@/lib/scalping";

const COLUMNS: {
  key: SortKey | null;
  /** Ключ подписи в словаре. */
  text: "coin" | "wall" | "imbalance" | "delta" | "range" | "spread" | "volume";
  width: string;
  align: string;
}[] = [
  // Монете отведено больше всех: в неё не влезали цены вроде 79 694.50 и
  // 0.026513, они обрезались многоточием и читать список было нельзя.
  { key: null, text: "coin", width: "w-[164px]", align: "text-left" },
  { key: "walls", text: "wall", width: "w-[96px]", align: "text-right" },
  { key: "imbalance", text: "imbalance", width: "w-[44px]", align: "text-center" },
  { key: "delta", text: "delta", width: "w-[58px]", align: "text-right" },
  { key: "range", text: "range", width: "w-[36px]", align: "text-right" },
  { key: "spread", text: "spread", width: "w-[36px]", align: "text-right" },
  { key: "volume", text: "volume", width: "w-[52px]", align: "text-right" },
];

type Props = {
  rows: ScreenerRow[];
  selected: string | null;
  /**
   * Что происходит по монете: точка в строке.
   *
   * Раньше пометка была одна на всё - и ждущая заявка, и набранная позиция
   * выглядели одинаково. Разница между ними - деньги в рынке: у первой их там
   * нет, у второй есть, и по списку это должно читаться не приглядываясь.
   */
  state?: Map<string, "planned" | "open">;
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
  state,
  favorites,
  onToggleFavorite,
  sort,
  onSort,
  onSelect,
}: Props) {
  const t = useT();
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
                  key={col.text}
                  title={col.text === "coin" ? undefined : t.domScreener[col.text].hint}
                  onClick={() => col.key && onSort(col.key)}
                  className={`sticky top-0 z-10 bg-[var(--pane-bg)] px-1.5 py-2 font-medium shadow-[0_1px_0_#2B3139] ${col.width} ${col.align} ${
                    col.key
                      ? "cursor-pointer select-none transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
                      : ""
                  } ${active ? "text-[var(--pane-accent)]" : ""}`}
                >
                  <span className="inline-flex items-center gap-0.5">
                    {col.text === "coin" ? t.domScreener.coin : t.domScreener[col.text].label}
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
              state={state?.get(row.symbol)}
              starred={Boolean(favorites?.has(row.symbol))}
              onStar={onToggleFavorite}
              onSelect={onSelect}
            />
          ))}
        </tbody>
      </table>

      {rows.length === 0 && (
        <p className="py-10 text-center text-sm text-[var(--pane-muted)]">{t.domScreener.collecting}</p>
      )}
    </div>
  );
}

const Row = memo(function Row({
  row,
  selected,
  state,
  starred,
  onStar,
  onSelect,
}: {
  row: ScreenerRow;
  selected: boolean;
  /** Ждущая заявка, набранная позиция или ничего. */
  state?: "planned" | "open";
  /** Монета в избранном. */
  starred: boolean;
  onStar?: (symbol: string) => void;
  onSelect: (symbol: string) => void;
}) {
  const t = useT();
  return (
    <tr
      // Реакция на нажатие, а не на отпускание: подсветка должна появиться в тот
      // момент, когда палец коснулся строки.
      onPointerDown={() => onSelect(row.symbol)}
      className={`cursor-pointer border-b border-[color:color-mix(in_srgb,var(--pane-border)_40%,transparent)] transition-colors duration-150 ease-out ${
        selected
          ? "bg-[var(--pane-accent-faint)] shadow-[inset_2px_0_0_#0AFFE0]"
          : "hover:bg-[color:color-mix(in_srgb,var(--pane-bg)_60%,transparent)] active:bg-[var(--pane-bg)]"
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
              title={starred ? t.domScreener.unstar : t.domScreener.star}
              className={`shrink-0 self-center transition-colors duration-150 ease-out ${
                starred
                  ? "text-[var(--pane-gold)]"
                  : "text-[var(--pane-muted)] opacity-40 hover:opacity-100"
              }`}
            >
              <Star className="h-3 w-3" fill={starred ? "currentColor" : "none"} />
            </button>
          )}
          {/* Точка состояния. Полая - заявка ждёт своей цены, залитая - позиция
              набрана и деньги в рынке. Разные и цветом, и формой: цвет один
              несёт смысл плохо, когда строк тридцать и глаз скользит по ним. */}
          {state && (
            <span
              aria-hidden
              title={
                state === "open"
                  ? t.domScreener.hasPosition
                  : t.domScreener.hasOrder
              }
              className="h-1.5 w-1.5 shrink-0 self-center rounded-full border"
              style={{
                borderColor:
                  state === "open" ? "var(--pane-gold)" : "var(--pane-accent)",
                background: state === "open" ? "var(--pane-gold)" : "transparent",
              }}
            />
          )}
          {/* Сам тикер цветом ничего не говорит: раньше он красился в акцент у
              своих монет и спорил с подсветкой выбранной строки - два разных
              смысла одним цветом. Смысл теперь на точке. */}
          <span
            className="w-[62px] shrink-0 overflow-hidden text-ellipsis font-semibold text-[var(--pane-text)]"

          >

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
  const t = useT();
  const buy = Math.round(ratio * 100);
  return (
    <div
      // Полоса меняется несколько раз в секунду — анимировать её нельзя:
      // трейдер видел бы вчерашнее значение, догоняющее сегодняшнее.
      className="mx-auto flex h-2.5 w-11 overflow-hidden rounded-sm bg-[var(--pane-deep)]"
      title={t.domScreener.buysPct(String(buy))}
    >
      <div className="bg-[var(--pane-up)]" style={{ width: `${buy}%` }} />
      <div className="bg-[var(--pane-down)]" style={{ width: `${100 - buy}%` }} />
    </div>
  );
}

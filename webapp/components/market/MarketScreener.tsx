"use client";

// Скринер рынка на данных нашего же терминала.
//
// Раньше здесь стоял чужой виджет: он рисовал свою рамку, свои шрифты и свои
// цвета, знал про монеты то же, что знает любой сайт, и не знал ничего из
// того, ради чего в терминал заходят - ни плит, ни перевеса стакана, ни
// дельты. Смотреть рынок в одном месте, а работать в другом бессмысленно.
//
// Поток тот же, что кормит скальпинг: сервер уже считает эти метрики восемь
// раз в секунду. Здесь они показаны шире, чем в узкой панели терминала - на
// целую страницу, где помещаются и оборот, и спред, и частота сделок.
//
// Строка ведёт в терминал на эту же монету: скринер отвечает на вопрос «где
// сегодня работать», и ответ должен открываться в один клик.

import { useT, type Dict } from "@/lib/i18n";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, Search } from "lucide-react";
import {
  base,
  money,
  price as fmtPrice,
  useScalpingFeed,
  type ScreenerRow,
  type SortKey,
} from "@/lib/scalping";
import { askSymbol } from "@/lib/openSymbol";
import { LiveBadge, PaneLabel } from "./Pane";

type Column = {
  key: SortKey | null;
  /** Ключ подписи в словаре. */
  text: keyof Dict["market"]["screener"]["cols"];
  align: "left" | "right" | "center";
  /** Прячется на узких экранах: колонка полезная, но не первая по важности. */
  wide?: boolean;
};

/**
 * Колонки таблицы. Ключ подписи, а не сама подпись: заголовок и подсказку
 * берём из словаря в момент отрисовки.
 */
const COLUMNS: Column[] = [
  { key: null, text: "coin", align: "left" },
  { key: "change", text: "change", align: "right" },
  { key: "volume", text: "volume", align: "right" },
  { key: "walls", text: "wall", align: "right" },
  { key: "imbalance", text: "imbalance", align: "center" },
  { key: "delta", text: "delta", align: "right", wide: true },
  { key: "range", text: "range", align: "right", wide: true },
  { key: "spread", text: "spread", align: "right", wide: true },
  { key: null, text: "trades", align: "right", wide: true },
];

/** Перевес стакана словом и цветом: цифра 1.8 сама по себе ничего не значит. */
function Imbalance({ ratio }: { ratio: number }) {
  const t = useT();
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return <span className="text-[var(--pane-muted)]">-</span>;
  }
  const bids = ratio >= 1;
  const force = bids ? ratio : 1 / ratio;
  const strong = force >= 2;
  return (
    <span
      className="font-mono text-[11px] tabular-nums"
      style={{
        color: strong
          ? bids
            ? "var(--pane-up)"
            : "var(--pane-down)"
          : "var(--pane-muted)",
      }}
title={bids ? t.market.screener.bidsDenser : t.market.screener.asksDenser}
    >
      {bids ? "▲" : "▼"}
      {force.toFixed(1)}
    </span>
  );
}

/** Плита: сумма и на сколько она отстоит от цены. */
function Wall({ row }: { row: ScreenerRow }) {
  const t = useT();
  if (!row.wall_notional || !row.wall_side) {
    return <span className="text-[var(--pane-muted)]">-</span>;
  }
  const bid = row.wall_side === "bid";
  return (
    <span
      className="font-mono text-[11px] tabular-nums"
      style={{ color: bid ? "var(--pane-up)" : "var(--pane-down)" }}
      title={
        bid
          ? t.market.screener.bigBid
          : t.market.screener.bigAsk
      }
    >
      {money(row.wall_notional)}
      <span className="ml-1 text-[var(--pane-muted)]">{Math.round(row.wall_distance_bp)}</span>
    </span>
  );
}

export default function MarketScreener() {
  const t = useT();
  const [sort, setSort] = useState<SortKey>("volume");
  const [query, setQuery] = useState("");

  // Стакан здесь не нужен - только список. Инструмент не запрашиваем, и
  // сервер не тратит кадры на монету, которую никто не смотрит.
  const { screener, connected } = useScalpingFeed({
    symbol: null,
    rows: 0,
    agg: 1,
    sort,
    shelf: 0,
    interval: "1m",
  });

  const rows = useMemo(() => {
    const needle = query.trim().toUpperCase();
    if (!needle) return screener;
    return screener.filter((r) => r.symbol.includes(needle));
  }, [screener, query]);

  return (
    <section className="overflow-hidden rounded-lg border border-[var(--pane-border)] bg-[var(--pane-bg)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--pane-border)] px-3 py-2">
        <div>
          <h2 className="text-[12px] font-semibold text-[var(--pane-text)]">{t.market.screener.title}</h2>
          <p className="text-[10px] text-[var(--pane-muted)]">
            {t.market.screener.subtitle(rows.length)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 rounded border border-[var(--pane-border)] bg-[var(--pane-deep)] px-2 py-1">
            <Search className="h-3 w-3 text-[var(--pane-muted)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.market.screener.searchPlaceholder}
              className="w-24 bg-transparent font-mono text-[11px] uppercase text-[var(--pane-text)] outline-none placeholder:normal-case placeholder:text-[var(--pane-muted)]"
            />
          </label>
          <LiveBadge live={connected} label={connected ? t.market.screener.streamOn : t.market.screener.streamOff} />
        </div>
      </header>

      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-[var(--pane-bg)]">
            <tr className="border-b border-[var(--pane-border)]">
              {COLUMNS.map((c) => {
                const active = c.key !== null && c.key === sort;
                const clickable = c.key !== null;
                return (
                  <th
                    key={c.text}
                    title={t.market.screener.cols[c.text].hint}
                    className={`px-2 py-2 ${c.wide ? "hidden lg:table-cell" : ""} ${
                      c.align === "right"
                        ? "text-right"
                        : c.align === "center"
                          ? "text-center"
                          : "text-left"
                    }`}
                  >
                    <button
                      type="button"
                      disabled={!clickable}
                      onClick={() => c.key && setSort(c.key)}
                      className={`inline-flex items-center gap-1 ${
                        clickable ? "cursor-pointer" : "cursor-default"
                      }`}
                      style={{ color: active ? "var(--pane-chip)" : undefined }}
                    >
                      <PaneLabel>{t.market.screener.cols[c.text].label}</PaneLabel>
                      {active && <ArrowDown className="h-2.5 w-2.5" />}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {rows.map((r) => {
              const up = r.change_pct >= 0;
              return (
                <tr
                  key={r.symbol}
                  className="border-b border-[var(--pane-border)] transition-colors hover:bg-[var(--pane-hover)]"
                >
                  <td className="px-2 py-1.5">
                    <Link
                      href={`/app/scalping?symbol=${r.symbol}`}
                      onClick={() => askSymbol(r.symbol)}
                      className="flex items-baseline gap-2"
                      title={t.market.screener.openInTerminal}
                    >
                      <span className="font-mono text-[12px] font-semibold text-[var(--pane-text)]">
                        {base(r.symbol)}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-[var(--pane-text-2)]">
                        {fmtPrice(r.price)}
                      </span>
                      {!r.live && (
                        <span
                          className="text-[9px] uppercase text-[var(--pane-muted)]"
                          title={t.market.screener.quietTitle}
                        >
                          {t.market.screener.quiet}
                        </span>
                      )}
                    </Link>
                  </td>

                  <td
                    className="px-2 py-1.5 text-right font-mono text-[12px] tabular-nums"
                    style={{ color: up ? "var(--pane-up)" : "var(--pane-down)" }}
                  >
                    {up ? "+" : ""}
                    {r.change_pct.toFixed(2)}%
                  </td>

                  <td className="px-2 py-1.5 text-right font-mono text-[11px] tabular-nums text-[var(--pane-text-2)]">
                    {money(r.volume_24h)}
                  </td>

                  <td className="px-2 py-1.5 text-right">
                    <Wall row={r} />
                  </td>

                  <td className="px-2 py-1.5 text-center">
                    <Imbalance ratio={r.book_ratio} />
                  </td>

                  <td
                    className="hidden px-2 py-1.5 text-right font-mono text-[11px] tabular-nums lg:table-cell"
                    style={{
                      color:
                        r.delta_notional > 0
                          ? "var(--pane-up)"
                          : r.delta_notional < 0
                            ? "var(--pane-down)"
                            : "var(--pane-muted)",
                    }}
                  >
                    {r.delta_notional > 0 ? "+" : ""}
                    {money(r.delta_notional)}
                  </td>

                  <td className="hidden px-2 py-1.5 text-right font-mono text-[11px] tabular-nums text-[var(--pane-text-2)] lg:table-cell">
                    {Math.round(r.range_bp)}
                  </td>

                  <td className="hidden px-2 py-1.5 text-right font-mono text-[11px] tabular-nums text-[var(--pane-text-2)] lg:table-cell">
                    {r.spread_bp.toFixed(1)}
                  </td>

                  <td className="hidden px-2 py-1.5 text-right font-mono text-[11px] tabular-nums text-[var(--pane-muted)] lg:table-cell">
                    {Math.round(r.trades_per_min)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {rows.length === 0 && (
          <p className="py-10 text-center text-[11px] text-[var(--pane-muted)]">
            {connected
              ? query
                ? t.market.screener.notInList
                : t.market.screener.waitingFrame
              : t.market.screener.noStream}
          </p>
        )}
      </div>
    </section>
  );
}

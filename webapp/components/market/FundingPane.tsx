"use client";

// Ставки финансирования: кто кому платит за то, что держит позицию.
//
// Показатель настроения, за который платят деньгами. Ставка положительная -
// лонгов больше, и они платят шортам; отрицательная - наоборот. Крайние
// значения означают перекос толпы, а перекос толпы кончается тем, что её
// выносят - поэтому список отсортирован по величине, а не по алфавиту.
//
// Ноль здесь двусмыслен: он же приходит и тогда, когда биржа ставку не
// назвала. Выдавать «0.0000%» за настоящую ставку нельзя - такие строки
// показаны прочерком и уходят вниз списка.

import { Percent } from "lucide-react";
import CoinLogo from "./CoinLogo";
import { useT, type Dict } from "@/lib/i18n";
import { useEffect, useMemo, useState } from "react";
import { api, type FundingRate } from "@/lib/api";
import { useCached } from "@/lib/paneCache";
import { base } from "@/lib/scalping";
import Pane, { LiveBadge, PaneLabel, type PaneState } from "./Pane";
import SourceMark from "./SourceMark";
import type { Origin } from "@/lib/marketOrigin";

/** Сколько инструментов показываем: остальные считаются в подписи. */
const SHOWN = 10;

type Row = {
  symbol: string;
  /** Ставка в процентах. `null` - биржа её не назвала. */
  pct: number | null;
  next: number | null;
};

/** Через сколько следующий расчёт: «3ч 12м». Прошедшее время - прочерк. */
function untilLabel(next: number | null, now: number, t: Dict): string {
  if (!next) return "-";
  const left = next - now;
  if (left <= 0) return t.market.funding.soon;
  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  return t.market.funding.countdown(hours, minutes);
}

function parse(rates: FundingRate[]): Row[] {
  const rows = rates.map((r) => {
    const raw = Number(r.fundingRate);
    // Ставка приходит долей: 0.0001 - это 0.01%.
    const pct = Number.isFinite(raw) && raw !== 0 ? raw * 100 : null;
    return { symbol: r.symbol, pct, next: r.nextFundingTime };
  });
  // Сначала названные ставки по убыванию перекоса, безымянные - в конец.
  return rows.sort((a, b) => {
    if (a.pct === null && b.pct === null) return a.symbol.localeCompare(b.symbol);
    if (a.pct === null) return 1;
    if (b.pct === null) return -1;
    return Math.abs(b.pct) - Math.abs(a.pct);
  });
}

export default function FundingPane({ className = "" }: { className?: string }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  // Ставка меняется раз в восемь часов - пяти минут жизни хватает с запасом.
  const { data: answer, loading, failed } = useCached(
    "market:funding",
    () => api.marketFunding(),
    { ttl: 5 * 60_000 },
  );
  const rows = useMemo(() => parse(answer?.rates ?? []), [answer]);
  const origin: Origin | null = answer
    ? { source: answer.source ?? null, stale: answer.stale }
    : null;
  const state: PaneState = loading ? "loading" : failed || !rows.length ? "error" : "ready";

  // Обратный счёт до расчёта идёт всё время, и минутного шага хватает: сама
  // ставка приезжает из общей памяти, а тикать надо только цифрам «через».
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);

  // Масштаб полос - по самой большой ставке в списке, а не по абсолютной
  // шкале: в спокойный день все ставки мелкие, и полосы по фиксированной
  // шкале выглядели бы пустыми.
  const peak = rows.reduce((max, r) => Math.max(max, Math.abs(r.pct ?? 0)), 0) || 1;

  const named = rows.filter((r) => r.pct !== null).length;
  const longsPay = rows.filter((r) => (r.pct ?? 0) > 0).length;

  return (
    <Pane
      icon={<Percent className="h-3.5 w-3.5" />}
      title={t.market.funding.title}
      hint={
        named > 0
          ? t.market.funding.hintLongsPay(longsPay, named)
          : t.market.funding.hintDefault
      }
      badge={
        <span className="flex items-center gap-2">
          <SourceMark origin={origin} />
          <LiveBadge live={state === "ready"} label={t.market.funding.live5m} />
        </span>
      }
      state={state}
      emptyNote={t.market.funding.emptyNote}
      className={className}
    >
      {/* Десять инструментов без прокрутки: ставку смотрят по верхушке
          списка, а колесо внутри панели мешает листать саму страницу. */}
      <div className="-mx-1">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-[var(--pane-bg)]">
            <tr>
              <th className="px-1 pb-1.5 text-left">
                <PaneLabel>{t.market.funding.colInstrument}</PaneLabel>
              </th>
              <th className="px-1 pb-1.5 text-right">
                <PaneLabel>{t.market.funding.colRate}</PaneLabel>
              </th>
              <th className="hidden px-1 pb-1.5 text-left sm:table-cell">
                <PaneLabel>{t.market.funding.colSkew}</PaneLabel>
              </th>
              <th className="px-1 pb-1.5 text-right">
                <PaneLabel>{t.market.funding.colSettle}</PaneLabel>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, SHOWN).map((r) => {
              const unknown = r.pct === null;
              const up = (r.pct ?? 0) > 0;
              const color = unknown
                ? "var(--pane-muted)"
                : up
                  ? "var(--pane-down)"
                  : "var(--pane-up)";
              return (
                <tr
                  key={r.symbol}
                  className="border-t border-[var(--pane-border)] transition-colors hover:bg-[var(--pane-hover)]"
                  title={
                    unknown
                      ? t.market.funding.noRateFor
                      : up
                        ? t.market.funding.longsPay
                        : t.market.funding.shortsPay
                  }
                >
                  <td className="px-1 py-1.5">
                    <span className="flex items-center gap-2 font-mono text-[12px] font-semibold text-[var(--pane-text)]">
                      <CoinLogo symbol={base(r.symbol)} size={18} />
                      {base(r.symbol)}
                    </span>
                  </td>
                  <td
                    className="px-1 py-1.5 text-right font-mono text-[12px] tabular-nums"
                    style={{ color }}
                  >
                    {unknown ? "-" : `${up ? "+" : ""}${r.pct!.toFixed(4)}%`}
                  </td>
                  <td className="hidden px-1 py-1.5 sm:table-cell">
                    {/* Полоса от середины: вправо платят лонги, влево - шорты.
                        Так перекос виден стороной, а не только знаком. */}
                    <div className="relative h-[3px] w-full rounded-full bg-[var(--pane-border)]">
                      <div
                        className="absolute top-0 h-full rounded-full transition-[width,left] duration-500"
                        style={{
                          background: color,
                          width: `${(Math.abs(r.pct ?? 0) / peak) * 50}%`,
                          left: up ? "50%" : undefined,
                          right: up ? undefined : "50%",
                        }}
                      />
                    </div>
                  </td>
                  <td className="px-1 py-1.5 text-right font-mono text-[11px] tabular-nums text-[var(--pane-muted)]">
                    {untilLabel(r.next, now, t)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Pane>
  );
}

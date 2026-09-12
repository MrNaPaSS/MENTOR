"use client";

// Что ищут прямо сейчас.
//
// Список не про цену, а про внимание: сюда монета попадает, когда её начали
// искать все разом. Для трейдера это ранняя новость - объём приходит следом за
// вниманием, а не наоборот.
//
// Цена показана в биткоинах, а не в долларах: источник считает её так, и
// переводить самим значило бы выдавать свой пересчёт за его число.

import { Flame } from "lucide-react";
import CoinLogo from "./CoinLogo";
import { useT } from "@/lib/i18n";

import { api, type TrendingCoin } from "@/lib/api";
import { useCached } from "@/lib/paneCache";
import Pane, { type PaneState } from "./Pane";

/** Цена в биткоинах: у трендовых монет она уходит в восьмой знак. */
function btc(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "-";
  if (value >= 0.001) return value.toFixed(5);
  return value.toFixed(8);
}

export default function TrendingPane({ className = "" }: { className?: string }) {
  const t = useT();
  // Две минуты: список самых искомых монет меняется медленно, а при возврате
  // на «Рынок» он должен стоять на месте, а не собираться заново.
  const { data, loading, failed } = useCached<{ coins: TrendingCoin[] }>(
    "market:trending",
    () => api.marketTrending(),
    { ttl: 120_000 },
  );
  const coins = data?.coins ?? [];
  const state: PaneState = loading ? "loading" : failed || !coins.length ? "error" : "ready";

  return (
    <Pane
      icon={<Flame className="h-3.5 w-3.5" />}
      title={t.market.trending.title}
      hint={`${t.market.trending.hint} · ${t.market.trending.priceInBtc}`}
      state={state}
      emptyNote={t.market.trending.emptyNote}
      className={className}
    >
      <ol className="space-y-0.5">
        {coins.map((c, i) => (
          <li
            key={c.id || c.symbol}
            className="flex items-center gap-2.5 rounded px-1 py-[3px] transition-colors hover:bg-[var(--pane-hover)]"
          >
            <span className="w-4 shrink-0 text-right font-mono text-[11px] tabular-nums text-[var(--pane-muted)]">
              {i + 1}
            </span>
            <CoinLogo symbol={c.symbol} src={c.thumb} size={20} />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-mono text-[12px] font-semibold text-[var(--pane-text)]">
                {c.symbol}
              </span>
              <span className="ml-2 text-[11px] text-[var(--pane-muted)]">{c.name}</span>
            </span>
            {c.rank !== null && (
              <span
                className="shrink-0 rounded border border-[var(--pane-border)] px-1 font-mono text-[10px] tabular-nums text-[var(--pane-muted)]"
                title={t.market.trending.rankTitle}
              >
                #{c.rank}
              </span>
            )}
            <span className="w-[74px] shrink-0 text-right font-mono text-[11px] tabular-nums text-[var(--pane-text-2)]">
              {btc(c.price_btc)}
            </span>
          </li>
        ))}
      </ol>
    </Pane>
  );
}

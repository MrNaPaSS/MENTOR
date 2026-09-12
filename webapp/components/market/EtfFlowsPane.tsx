"use client";

// Потоки биткоин-ETF - своя панель вместо карты американских акций.
//
// На этом месте стоял встроенный `etf-heatmap` TradingView: ETF фондового
// рынка США. Для академии крипто-фьючерсов это чужая тема. Данные, которые
// здесь нужны, мы уже считаем сами - `/api/institutional/etf-flows`: сколько
// биткоина держит каждый фонд и как сегодня ходит его бумага.

import { useT } from "@/lib/i18n";

import { Landmark } from "lucide-react";

import { api, type EtfFlows } from "@/lib/api";
import { useCached } from "@/lib/paneCache";
import Pane, { PaneBar, PaneLabel, PaneValue, type PaneState } from "./Pane";

/** Как часто спрашиваем. Активы фондов меняются раз в сутки. */
const POLL_MS = 10 * 60_000;

function btc(value: number): string {
  return value >= 1000 ? `${Math.round(value / 1000)}K` : Math.round(value).toString();
}

function usd(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${Math.round(value).toLocaleString("ru-RU")}`;
}

/** Всего биткоина будет 21 миллион: доля фондов считается от этого числа. */
const BTC_SUPPLY = 21_000_000;

function supplyShare(total: number): string {
  return `${((total / BTC_SUPPLY) * 100).toFixed(1)}%`;
}

/** Имя фонда без тикера: «BlackRock IBIT» на экране это IBIT и BlackRock. */
function shortName(name: string, ticker: string): string {
  return name.replace(ticker, "").trim() || name;
}

export default function EtfFlowsPane({
  className = "",
  height,
}: {
  className?: string;
  /** Высота тела панели: список растягивается на неё, а не жмётся кверху. */
  height?: number;
}) {
  const t = useT();
  const { data, loading, failed } = useCached<EtfFlows>(
    "market:etf-flows",
    () => api.etfFlows(),
    { ttl: POLL_MS },
  );
  const state: PaneState = loading
    ? "loading"
    : failed || !data?.etfs?.length
      ? "error"
      : "ready";

  const funds = [...(data?.etfs ?? [])].sort((a, b) => b.btc - a.btc);
  const peak = funds.reduce((max, f) => Math.max(max, f.btc), 0) || 1;
  const totalUsd = (data?.total_btc ?? 0) * (data?.btc_price ?? 0);

  return (
    <Pane
      icon={<Landmark className="h-3.5 w-3.5" />}
      title={t.market.widgets.etf.title}
      hint={t.market.widgets.etf.hint}
      state={state}
      emptyNote={t.market.pane.emptyNote}
      className={className}
      bodyClass="flex flex-col"
    >
      <div className="flex flex-col gap-3" style={height ? { height } : undefined}>
        <div className="flex items-baseline justify-between gap-2 border-b border-[var(--pane-border)] pb-2">
          <PaneLabel>{t.market.etf.totalLabel}</PaneLabel>
          <span className="flex items-baseline gap-2">
            <PaneValue size="lg" tone="gold">{btc(data?.total_btc ?? 0)} BTC</PaneValue>
            {totalUsd > 0 && (
              <PaneValue size="sm" tone="muted">{usd(totalUsd)}</PaneValue>
            )}
          </span>
        </div>

        {/* Строки идут подряд и плотно. Растягивать их по высоте нельзя: между
            четырьмя фондами появлялись дыры в полпанели, и это читалось хуже
            пустоты внизу. Пустоту снизу забирает итог. */}
        <ul className="space-y-2.5">
          {funds.map((fund) => (
            <li key={fund.ticker} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate" title={fund.name}>
                  <span className="text-[13px] font-semibold text-[var(--pane-text)]">
                    {fund.ticker}
                  </span>
                  <span className="ml-2 text-[11px] text-[var(--pane-muted)]">
                    {shortName(fund.name, fund.ticker)}
                  </span>
                </span>
                <PaneValue
                  size="sm"
                  tone={fund.changePct > 0 ? "up" : fund.changePct < 0 ? "down" : "muted"}
                >
                  {fund.changePct > 0 ? "+" : ""}
                  {fund.changePct.toFixed(2)}%
                </PaneValue>
              </div>
              <PaneBar fill={fund.btc / peak} tone={fund.changePct >= 0 ? "up" : "down"} />
              <div className="flex items-baseline justify-between gap-2 text-[11px] text-[var(--pane-muted)]">
                <span className="font-mono tabular-nums">{btc(fund.btc)} BTC</span>
                <span className="font-mono tabular-nums">{t.market.etf.share(fund.sharePct)}</span>
              </div>
            </li>
          ))}
        </ul>

        {/* Итог у нижнего края: он же забирает остаток высоты панели. */}
        <div className="mt-auto space-y-1 border-t border-[var(--pane-border)] pt-2">
          <div className="flex items-baseline justify-between gap-2">
            <PaneLabel>{t.market.etf.btcPrice}</PaneLabel>
            <PaneValue size="sm">{usd(data?.btc_price ?? 0)}</PaneValue>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <PaneLabel>{t.market.etf.supplyLabel}</PaneLabel>
            <PaneValue size="sm" tone="gold">
              {supplyShare(data?.total_btc ?? 0)}
            </PaneValue>
          </div>
          <PaneBar fill={(data?.total_btc ?? 0) / BTC_SUPPLY} tone="gold" />
        </div>
      </div>
    </Pane>
  );
}

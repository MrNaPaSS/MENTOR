"use client";

// Потоки биткоин-ETF - своя панель вместо карты американских акций.
//
// На этом месте стоял встроенный `etf-heatmap` TradingView: ETF фондового
// рынка США. Для академии крипто-фьючерсов это чужая тема. Данные, которые
// здесь нужны, мы уже считаем сами - `/api/institutional/etf-flows`: сколько
// биткоина держит каждый фонд и как сегодня ходит его бумага.

import { useT } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { Landmark } from "lucide-react";

import { api, type EtfFlows } from "@/lib/api";
import Pane, { PaneBar, PaneLabel, PaneValue, type PaneState } from "./Pane";

/** Как часто спрашиваем. Активы фондов меняются раз в сутки. */
const POLL_MS = 10 * 60_000;

function btc(value: number): string {
  return value >= 1000 ? `${Math.round(value / 1000)}K` : Math.round(value).toString();
}

function usd(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${Math.round(value)}`;
}

export default function EtfFlowsPane({ className = "" }: { className?: string }) {
  const t = useT();
  const [data, setData] = useState<EtfFlows | null>(null);
  const [state, setState] = useState<PaneState>("loading");

  useEffect(() => {
    let dropped = false;
    function load() {
      api
        .etfFlows()
        .then((r) => {
          if (dropped) return;
          setData(r);
          setState(r.etfs?.length ? "ready" : "error");
        })
        .catch(() => {
          if (!dropped) setState("error");
        });
    }
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      dropped = true;
      clearInterval(timer);
    };
  }, []);

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
    >
      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <PaneLabel>{t.market.etf.totalLabel}</PaneLabel>
          <span className="flex items-baseline gap-2">
            <PaneValue size="lg" tone="gold">{btc(data?.total_btc ?? 0)} BTC</PaneValue>
            {totalUsd > 0 && (
              <PaneValue size="sm" tone="muted">{usd(totalUsd)}</PaneValue>
            )}
          </span>
        </div>

        <ul className="space-y-2">
          {funds.map((fund) => (
            <li key={fund.ticker} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[12px] text-[var(--pane-text)]" title={fund.name}>
                  <span className="font-semibold">{fund.ticker}</span>
                  <span className="ml-1.5 text-[10px] text-[var(--pane-muted)]">
                    {t.market.etf.share(fund.sharePct)}
                  </span>
                </span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <PaneValue size="sm">{btc(fund.btc)} BTC</PaneValue>
                  <PaneValue
                    size="sm"
                    tone={fund.changePct > 0 ? "up" : fund.changePct < 0 ? "down" : "muted"}
                  >
                    {fund.changePct > 0 ? "+" : ""}
                    {fund.changePct.toFixed(2)}%
                  </PaneValue>
                </span>
              </div>
              <PaneBar fill={fund.btc / peak} tone={fund.changePct >= 0 ? "up" : "down"} />
            </li>
          ))}
        </ul>
      </div>
    </Pane>
  );
}

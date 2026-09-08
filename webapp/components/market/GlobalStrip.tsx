"use client";

// Строка состояния рынка: то, с чего начинают день.
//
// Стоит над всем разделом и отвечает на один вопрос - «что вообще происходит».
// Пять чисел, дальше начинаются подробности. Порядок не случаен: сначала
// размер рынка, потом его движение, потом кто в нём главный.
//
// Отдельная строка, а не панель среди панелей: у терминала есть шапка, и
// раздел рынка обязан начинаться так же, иначе он выглядит другим приложением.

import { useIntlLocale, useT } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { api, type GlobalMarket } from "@/lib/api";
import { money } from "@/lib/scalping";
import { LiveBadge, PaneLabel } from "./Pane";

function Cell({
  label,
  value,
  tone = "plain",
  hint,
}: {
  label: string;
  value: string;
  tone?: "plain" | "up" | "down" | "gold";
  hint?: string;
}) {
  const color = {
    plain: "text-[var(--pane-text)]",
    up: "text-[var(--pane-up)]",
    down: "text-[var(--pane-down)]",
    gold: "text-[var(--pane-gold)]",
  }[tone];
  return (
    <div className="min-w-0 px-3 py-2" title={hint}>
      <PaneLabel>{label}</PaneLabel>
      <div className={`truncate font-mono text-[15px] font-semibold tabular-nums ${color}`}>
        {value}
      </div>
    </div>
  );
}

export default function GlobalStrip() {
  const t = useT();
  const numbers = useIntlLocale();
  const [data, setData] = useState<GlobalMarket | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let dropped = false;
    // Раз в минуту: сервер и сам держит ответ минуту в кэше, чаще спрашивать
    // значит получать ту же строку и греть сеть.
    function load() {
      api
        .marketGlobal()
        .then((r) => {
          if (dropped) return;
          setData(r);
          setFailed(false);
        })
        .catch(() => {
          if (!dropped) setFailed(true);
        });
    }
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      dropped = true;
      clearInterval(timer);
    };
  }, []);

  const change = data?.market_cap_change_24h ?? 0;

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--pane-border)] bg-[var(--pane-bg)]">
      <div className="flex items-center justify-between border-b border-[var(--pane-border)] px-3 py-1.5">
        <span className="text-[11px] font-semibold text-[var(--pane-text)]">{t.market.global.title}</span>
        <LiveBadge live={!!data && !failed} label={data ? t.market.global.live1m : t.market.global.noData} />
      </div>

      {data ? (
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--pane-border)] sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
          <Cell
            label={t.market.global.marketCap.label}
            value={`$${money(data.total_market_cap_usd)}`}
            hint={t.market.global.marketCap.hint}
          />
          <Cell
            label={t.market.global.volume24h.label}
            value={`$${money(data.total_volume_usd)}`}
            hint={t.market.global.volume24h.hint}
          />
          <Cell
            label={t.market.global.change24h.label}
            value={`${change > 0 ? "+" : ""}${change.toFixed(2)}%`}
            tone={change > 0 ? "up" : change < 0 ? "down" : "plain"}
            hint={t.market.global.change24h.hint}
          />
          <Cell
            label={t.market.global.btcDominance.label}
            value={`${data.btc_dominance.toFixed(1)}%`}
            tone="gold"
            hint={t.market.global.btcDominance.hint}
          />
          <Cell
            label={t.market.global.coins.label}
            value={data.active_cryptos.toLocaleString(numbers)}
            hint={t.market.global.coins.hint}
          />
        </div>
      ) : (
        <div className="px-3 py-4 text-[11px] text-[var(--pane-muted)]">
          {failed ? t.market.global.failed : t.market.global.asking}
        </div>
      )}
    </div>
  );
}

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

import { api, type GlobalMarket } from "@/lib/api";
import { useCached } from "@/lib/paneCache";
import { money } from "@/lib/scalping";
import { Activity, ArrowDown, ArrowUp, BarChart3, Bitcoin, Coins, Globe } from "lucide-react";

/**
 * Карточка показателя по макету: крупный цветной значок, подпись, число и,
 * если есть, изменение за сутки справа.
 */
function Cell({
  label,
  value,
  icon,
  tone = "plain",
  change,
  hint,
}: {
  label: string;
  value: string;
  /** Значок показателя: пять чисел в ряд различаются им быстрее, чем подписью. */
  icon: React.ReactNode;
  tone?: "plain" | "up" | "down" | "gold";
  /** Изменение за сутки, в процентах. */
  change?: number;
  hint?: string;
}) {
  const color = {
    plain: "text-[var(--pane-text)]",
    up: "text-[var(--pane-up)]",
    down: "text-[var(--pane-down)]",
    gold: "text-[var(--pane-gold)]",
  }[tone];
  return (
    <div
      className="flex min-w-0 items-center gap-3 rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] px-3.5 py-2 transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-16px_rgba(0,0,0,0.45)]"
      title={hint}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] text-[var(--pane-muted)]">{label}</div>
        <div className={`truncate font-mono text-[20px] font-bold leading-tight tabular-nums ${color}`}>{value}</div>
      </div>
      {change !== undefined && Number.isFinite(change) && (
        <span
          className={`flex shrink-0 items-center gap-0.5 self-end font-mono text-[12px] font-semibold tabular-nums ${
            change >= 0 ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"
          }`}
        >
          {change >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {change >= 0 ? "+" : ""}
          {change.toFixed(2)}%
        </span>
      )}
    </div>
  );
}

export default function GlobalStrip() {
  const t = useT();
  const numbers = useIntlLocale();
  // Раз в минуту: сервер и сам держит ответ минуту в кэше, чаще спрашивать
  // значит получать ту же строку и греть сеть. Значение общее для всех
  // разделов, поэтому при возврате строка уже стоит на месте.
  const { data, failed } = useCached<GlobalMarket>(
    "market:global",
    () => api.marketGlobal(),
    { ttl: 60_000 },
  );

  const change = data?.market_cap_change_24h ?? 0;

  // Без рамки-строки и шапки: на макете это пять отдельных карточек, и
  // каждая читается сама по себе.
  if (!data) {
    return (
      <div className="rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] px-3 py-4 text-[11px] text-[var(--pane-muted)]">
        {failed ? t.market.global.failed : t.market.global.asking}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Cell
        icon={<Globe className="h-9 w-9 text-[#f0a020]" strokeWidth={1.6} />}
        label={t.market.global.marketCap.label}
        value={`$${money(data.total_market_cap_usd)}`}
        change={change}
        hint={t.market.global.marketCap.hint}
      />
      <Cell
        icon={<BarChart3 className="h-9 w-9 text-[var(--pane-up)]" strokeWidth={2.2} />}
        label={t.market.global.volume24h.label}
        value={`$${money(data.total_volume_usd)}`}
        hint={t.market.global.volume24h.hint}
      />
      <Cell
        icon={
          <Activity
            className={`h-9 w-9 ${change >= 0 ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"}`}
            strokeWidth={2.2}
          />
        }
        label={t.market.global.change24h.label}
        value={`${change > 0 ? "+" : ""}${change.toFixed(2)}%`}
        tone={change > 0 ? "up" : change < 0 ? "down" : "plain"}
        hint={t.market.global.change24h.hint}
      />
      <Cell
        icon={
          <span className="grid h-9 w-9 place-items-center rounded-full bg-[#f7931a] text-white">
            <Bitcoin className="h-6 w-6" />
          </span>
        }
        label={t.market.global.btcDominance.label}
        value={`${data.btc_dominance.toFixed(1)}%`}
        tone="gold"
        hint={t.market.global.btcDominance.hint}
      />
      <Cell
        icon={<Coins className="h-9 w-9 text-[var(--pane-muted)]" strokeWidth={1.6} />}
        label={t.market.global.coins.label}
        value={data.active_cryptos.toLocaleString(numbers)}
        hint={t.market.global.coins.hint}
      />
    </div>
  );
}

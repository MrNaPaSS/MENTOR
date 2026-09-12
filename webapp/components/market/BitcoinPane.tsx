"use client";

// Биткоин целиком: цена, позиции по нему и состояние его сети.
//
// Три вещи, которые смотрят подряд и по разным поводам, но всегда про одну
// монету. Цена говорит, где рынок сейчас; открытый интерес и ставка - сколько
// на этом стоит заёмных денег и в какую сторону перекошена толпа; комиссии и
// сложность - что происходит под всем этим, в самой сети.
//
// Держать их врозь незачем: разнесённые по трём панелям, они заставляли
// сводить биткоин из кусочков глазами. Здесь порядок сверху вниз - от того,
// что меняется ежесекундно, к тому, что меняется раз в две недели.
//
// Цена берётся у биржи, а не у обозревателя сети: сделки заключают на бирже, и
// расхождение в полпроцента между «ценой на карточке» и ценой в терминале -
// это вопрос, которого быть не должно.

import { Bitcoin } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { api, type Derivatives, type OnChainStats } from "@/lib/api";
import { useCached } from "@/lib/paneCache";
import { money } from "@/lib/scalping";
import Pane, { LiveBadge, PaneBar, PaneLabel, type PaneState } from "./Pane";
import MiniCandles from "./MiniCandles";

/** Порог, выше которого комиссия считается высокой. Сатоши за виртуальный байт. */
const BUSY_FEE = 60;

function Fee({ label, value, hint }: { label: string; value: number; hint: string }) {
  const hot = value >= BUSY_FEE;
  return (
    <div title={hint}>
      <PaneLabel>{label}</PaneLabel>
      <div
        className="font-mono text-[14px] font-semibold tabular-nums"
        style={{ color: hot ? "var(--pane-down)" : "var(--pane-text)" }}
      >
        {value}
      </div>
      <div className="mt-1">
        <PaneBar fill={value / (BUSY_FEE * 2)} tone={hot ? "down" : "accent"} />
      </div>
    </div>
  );
}

/** Пара «подпись - число» в два столбца: их здесь четыре, и все одинаковые. */
function Stat({
  label,
  value,
  unit,
  tone = "plain",
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: "plain" | "up" | "down" | "gold" | "muted";
  hint?: string;
}) {
  const color = {
    plain: "var(--pane-text)",
    up: "var(--pane-up)",
    down: "var(--pane-down)",
    gold: "var(--pane-gold)",
    muted: "var(--pane-muted)",
  }[tone];
  return (
    <div title={hint}>
      <PaneLabel>{label}</PaneLabel>
      <div className="font-mono text-[14px] font-semibold tabular-nums" style={{ color }}>
        {value}
        {unit && (
          <span className="ml-1 text-[10px] font-normal text-[var(--pane-muted)]">{unit}</span>
        )}
      </div>
    </div>
  );
}

type Part = "all" | "price" | "network";

/**
 * Панель биткоина целиком или одной из двух частей.
 *
 * В Пульсе по макету цена со свечами и сеть стоят разными карточками: над
 * сетью - баннер. Данные те же, поэтому и панель та же, а часть выбирается
 * параметром: каждая спрашивает только своё.
 */
export default function BitcoinPane({ className = "", part = "all" }: { className?: string; part?: Part }) {
  const t = useT();
  const showPrice = part !== "network";
  const showNet = part !== "price";
  // Сеть меняется медленно: комиссии и сложность живут минуту.
  const chainAnswer = useCached<OnChainStats>(
    "market:onchain",
    () => api.marketOnchain(),
    { ttl: 60_000, enabled: showNet },
  );
  const chain = chainAnswer.data;
  const chainState: PaneState = chainAnswer.loading
    ? "loading"
    : chainAnswer.failed || !chain
      ? "error"
      : "ready";

  // Цена и позиции - каждые полминуты. Реже - и цена на панели начинает
  // спорить с ценой в терминале.
  const derivAnswer = useCached<Derivatives>(
    "market:derivatives:BTCUSDT",
    () => api.marketDerivatives("BTCUSDT"),
    { ttl: 30_000, enabled: showPrice },
  );
  const deriv = derivAnswer.data;
  const derivFailed = derivAnswer.failed;

  const diff = chain?.difficulty_change_pct ?? 0;
  const change = deriv?.priceChangePct ?? 0;
  // Ставка приходит долей: 0.0001 - это 0.01%. Ноль означает и настоящий ноль,
  // и молчание биржи, поэтому показывается прочерком.
  const fundingRaw = Number(deriv?.fundingRate);
  const funding = Number.isFinite(fundingRaw) && fundingRaw !== 0 ? fundingRaw * 100 : null;

  const priceState: PaneState = deriv ? "ready" : derivFailed ? "error" : "loading";
  const state: PaneState =
    part === "price" ? priceState : part === "network" ? chainState : chain || deriv ? "ready" : chainState;

  const price = (
    <>
      {/* Цена: то, ради чего смотрят первым делом. */}
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#f7931a] text-white shadow-[0_6px_16px_-6px_rgba(247,147,26,0.8)]">
          <Bitcoin className="h-7 w-7" />
        </span>
        <div className="min-w-0">
          <PaneLabel>{t.market.bitcoin.exchangePrice}</PaneLabel>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[26px] font-bold leading-none tabular-nums text-[var(--pane-text)]">
              {deriv?.lastPrice ? `$${deriv.lastPrice.toLocaleString("en-US", { maximumFractionDigits: 1 })}` : "-"}
            </span>
            {deriv && (
              <span
                className="font-mono text-[13px] font-semibold tabular-nums"
                style={{
                  color: change > 0 ? "var(--pane-up)" : change < 0 ? "var(--pane-down)" : "var(--pane-muted)",
                }}
                title={t.market.bitcoin.change24hTitle}
              >
                {change > 0 ? "+" : ""}
                {change.toFixed(2)}%
              </span>
            )}
          </div>
        </div>
      </div>

      <MiniCandles symbol="BTCUSDT" />

      {/* Позиции: сколько денег стоит на этой цене и кто за них платит. */}
      <div className="grid grid-cols-2 gap-3 border-t border-[var(--pane-border)] pt-3">
        <Stat
          label={t.market.bitcoin.openInterest.label}
          value={deriv?.openInterestUsd ? `$${money(deriv.openInterestUsd)}` : "-"}
          hint={t.market.bitcoin.openInterest.hint}
        />
        <Stat
          label={t.market.bitcoin.funding8h}
          value={funding === null ? "-" : `${funding > 0 ? "+" : ""}${funding.toFixed(4)}%`}
          tone={funding === null ? "muted" : funding > 0 ? "down" : "up"}
          hint={
            funding === null
              ? t.market.bitcoin.noRate
              : funding > 0
                ? t.market.bitcoin.longsPay
                : t.market.bitcoin.shortsPay
          }
        />
      </div>
    </>
  );

  const network = chain && (
    <>
      {/* Сеть: комиссии за перевод прямо сейчас. */}
      <div className={showPrice ? "border-t border-[var(--pane-border)] pt-3" : ""}>
        <div className="mb-2">
          <PaneLabel>{t.market.bitcoin.feeLabel}</PaneLabel>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <Fee label={t.market.bitcoin.feeFastest.label} value={chain.fees.fastest} hint={t.market.bitcoin.feeFastest.hint} />
          <Fee label={t.market.bitcoin.feeHalfHour.label} value={chain.fees.half_hour} hint={t.market.bitcoin.feeHalfHour.hint} />
          <Fee label={t.market.bitcoin.feeHour.label} value={chain.fees.hour} hint={t.market.bitcoin.feeHour.hint} />
          <Fee label={t.market.bitcoin.feeEconomy.label} value={chain.fees.economy} hint={t.market.bitcoin.feeEconomy.hint} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-[var(--pane-border)] pt-3">
        <Stat
          label={t.market.bitcoin.hashrate.label}
          value={`≈ ${chain.hash_rate_ehs.toLocaleString("ru-RU")}`}
          unit="EH/s"
          hint={t.market.bitcoin.hashrate.hint}
        />
        <Stat
          label={t.market.bitcoin.txPerDay.label}
          value={`≈ ${chain.tx_count_24h.toLocaleString("ru-RU")}`}
          hint={t.market.bitcoin.txPerDay.hint}
        />
      </div>

      {part === "all" && (
        <>
      {/* Сложность: самый медленный показатель панели - и потому последний. */}
        <div className="border-t border-[var(--pane-border)] pt-3">
          <div className="flex items-baseline justify-between">
            <PaneLabel>{t.market.bitcoin.retarget}</PaneLabel>
            <span
              className="font-mono text-[12px] font-semibold tabular-nums"
              style={{ color: diff > 0 ? "var(--pane-up)" : diff < 0 ? "var(--pane-down)" : "var(--pane-muted)" }}
              title={t.market.bitcoin.retargetTitle}
            >
              {diff > 0 ? "+" : ""}
              {diff.toFixed(2)}%
            </span>
          </div>
          <div className="mt-2">
            <PaneBar fill={chain.retarget_progress_pct / 100} tone="gold" />
          </div>
          <div className="mt-1 text-right text-[10px] text-[var(--pane-muted)]">
            {t.market.bitcoin.retargetProgress(chain.retarget_progress_pct.toFixed(1))}
          </div>
        </div>
        </>
      )}
    </>
  );

  return (
    <Pane
      icon={<Bitcoin className="h-3.5 w-3.5" />}
      title={part === "network" ? t.market.bitcoin.networkTitle : t.market.bitcoin.title}
      hint={
        part === "network"
          ? t.market.bitcoin.networkHint
          : part === "price"
            ? t.market.bitcoin.priceHint
            : t.market.bitcoin.hint
      }
      badge={
        showPrice ? (
          <LiveBadge live={!!deriv} label={deriv ? t.market.bitcoin.live30s : t.market.bitcoin.noPrice} />
        ) : undefined
      }
      state={state}
      emptyNote={t.market.bitcoin.emptyNote}
      className={className}
    >
      <div className="space-y-4">
        {showPrice && price}
        {showNet && network}
      </div>
    </Pane>
  );
}

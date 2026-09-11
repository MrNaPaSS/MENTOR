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
import { money } from "@/lib/scalping";
import Pane, { LiveBadge, PaneBar, PaneLabel, type PaneState } from "./Pane";

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

export default function BitcoinPane({ className = "" }: { className?: string }) {
  const t = useT();
  const [chain, setChain] = useState<OnChainStats | null>(null);
  const [deriv, setDeriv] = useState<Derivatives | null>(null);
  const [state, setState] = useState<PaneState>("loading");

  useEffect(() => {
    let dropped = false;

    // Сеть спрашиваем один раз: комиссии и сложность меняются медленнее, чем
    // человек успевает уйти со страницы.
    api
      .marketOnchain()
      .then((r) => {
        if (dropped) return;
        setChain(r);
        setState(r ? "ready" : "error");
      })
      .catch(() => {
        if (!dropped) setState("error");
      });

    // Цена и позиции - каждые полминуты. Реже - и цена на панели начинает
    // спорить с ценой в терминале.
    function loadDeriv() {
      api
        .marketDerivatives("BTCUSDT")
        .then((r) => {
          if (!dropped) setDeriv(r);
        })
        .catch(() => {
          // Биржа промолчала - остаются цифры сети, панель не пустеет.
        });
    }
    loadDeriv();
    const timer = setInterval(loadDeriv, 30_000);

    return () => {
      dropped = true;
      clearInterval(timer);
    };
  }, []);

  const diff = chain?.difficulty_change_pct ?? 0;
  const change = deriv?.priceChangePct ?? 0;
  // Ставка приходит долей: 0.0001 - это 0.01%. Ноль означает и настоящий ноль,
  // и молчание биржи, поэтому показывается прочерком.
  const fundingRaw = Number(deriv?.fundingRate);
  const funding = Number.isFinite(fundingRaw) && fundingRaw !== 0 ? fundingRaw * 100 : null;

  return (
    <Pane
      icon={<Bitcoin className="h-3.5 w-3.5" />}
      title={t.market.bitcoin.title}
      hint={t.market.bitcoin.hint}
      badge={<LiveBadge live={!!deriv} label={deriv ? t.market.bitcoin.live30s : t.market.bitcoin.noPrice} />}
      state={state}
      emptyNote={t.market.bitcoin.emptyNote}
      className={className}
    >
      <div className="space-y-4">
        {/* Цена: то, ради чего смотрят первым делом. */}
        <div className="flex items-end justify-between gap-3">
          <div>
            <PaneLabel>{t.market.bitcoin.exchangePrice}</PaneLabel>
            <div className="font-mono text-[26px] font-bold leading-none tabular-nums text-[var(--pane-text)]">
              {deriv?.lastPrice
                ? `$${deriv.lastPrice.toLocaleString("en-US", { maximumFractionDigits: 1 })}`
                : "-"}
            </div>
          </div>
          {deriv && (
            <div
              className="font-mono text-[15px] font-semibold tabular-nums"
              style={{
                color:
                  change > 0
                    ? "var(--pane-up)"
                    : change < 0
                      ? "var(--pane-down)"
                      : "var(--pane-muted)",
              }}
              title={t.market.bitcoin.change24hTitle}
            >
              {change > 0 ? "+" : ""}
              {change.toFixed(2)}%
            </div>
          )}
        </div>

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

        {chain && (
          <>
            {/* Сеть: комиссии за перевод прямо сейчас. */}
            <div className="border-t border-[var(--pane-border)] pt-3">
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
                value={chain.hash_rate_ehs.toLocaleString("ru-RU")}
                unit="EH/s"
                hint={t.market.bitcoin.hashrate.hint}
              />
              <Stat
                label={t.market.bitcoin.txPerDay.label}
                value={chain.tx_count_24h.toLocaleString("ru-RU")}
                hint={t.market.bitcoin.txPerDay.hint}
              />
            </div>

            {/* Сложность: самый медленный показатель панели - и потому последний. */}
            <div className="border-t border-[var(--pane-border)] pt-3">
              <div className="flex items-baseline justify-between">
                <PaneLabel>{t.market.bitcoin.retarget}</PaneLabel>
                <span
                  className="font-mono text-[12px] font-semibold tabular-nums"
                  style={{
                    color:
                      diff > 0
                        ? "var(--pane-up)"
                        : diff < 0
                          ? "var(--pane-down)"
                          : "var(--pane-muted)",
                  }}
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
      </div>
    </Pane>
  );
}

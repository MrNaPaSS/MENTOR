"use client";

// Фиксация позиции: сколько закрыть и что от этого получится.
//
// Крестик на ярлыке позиции раньше закрывал сделку сразу и целиком. Так нельзя:
// закрытие — необратимое действие с деньгами, и одно случайное попадание по
// нему стоило бы трейдеру позиции. Теперь крестик открывает это окно, а долю
// он выбирает сам — скальперы редко выходят разом.

import { useT } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { price as fmtPrice } from "@/lib/scalping";
import { floatingAt, TAKER_FEE, type ActiveTrade } from "@/lib/trade/position";

const SHARES = [25, 50, 75, 100];

// Комиссия тейкера на бирже. Платится и на входе, и на выходе, поэтому в
// оценке она удваивается.

const BUTTON =
  "rounded-md px-4 py-2 text-[12px] font-semibold transition-[background-color,transform] " +
  "duration-150 ease-out active:scale-[0.98]";

export default function CloseDialog({
  trade,
  price,
  tick,
  onConfirm,
  onCancel,
}: {
  trade: ActiveTrade;
  /** Текущая цена рынка: по ней считается результат. */
  price: number;
  tick: number;
  /** Доля от 0 до 1. */
  onConfirm: (share: number) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const d = t.dialogs.close;
  const [percent, setPercent] = useState(100);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
      if (event.key === "Enter") onConfirm(percent / 100);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, onConfirm, percent]);

  const long = trade.side === "long";
  const share = percent / 100;
  // По открытой позиции — как на бирже. Забранное по целям сюда не входит: его
  // уже нет в рынке, и закрывать нечего.
  const floating = floatingAt(trade, price);
  const part = floating * share;
  const qty = trade.qty * share;
  const waiting = trade.status === "planned";
  // Комиссия тейкера на обеих ногах — вход уже уплачен, выход предстоит.
  // Ровно из-за неё «плюс 209» превращается в «пришло 75» на большом плече.
  const fee = qty * trade.entry * TAKER_FEE * 2;

  return (
    <div
      className="fixed inset-0 z-50 grid animate-fade-in place-items-center bg-black/60 p-4 motion-reduce:animate-none"
      onClick={onCancel}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-[420px] max-w-full animate-dialog-in rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] shadow-2xl motion-reduce:animate-none"
      >
        <div className="flex items-start justify-between border-b border-[var(--pane-border)] px-5 py-4">
          <div>
            <div className="flex items-baseline gap-2">
              <span
                className={`text-[11px] font-semibold uppercase ${
                  long ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"
                }`}
              >
                {long ? d.long : d.short}
              </span>
              <span className="font-mono text-[17px] font-semibold text-[var(--pane-text)]">
                {fmtPrice(trade.entry, tick)}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-[var(--pane-muted)]">
              {waiting
                ? d.notEntered
                : d.inPosition(trade.qty.toPrecision(4), fmtPrice(price, tick))}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!waiting && (
          <div className="px-5 py-4">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[11px] text-[var(--pane-muted)]">{d.partial}</span>
              <span className="font-mono text-[17px] font-semibold text-[var(--pane-text)]">
                {percent}%
              </span>
            </div>

            <input
              type="range"
              min={1}
              max={100}
              step={1}
              value={percent}
              onChange={(e) => setPercent(Number(e.target.value))}
              className="w-full accent-[var(--pane-accent)]"
            />

            <div className="mt-2 flex gap-1">
              {SHARES.map((value) => (
                <button
                  key={value}
                  onClick={() => setPercent(value)}
                  className={`rounded px-2 py-0.5 font-mono text-[11px] transition-colors duration-150 ease-out ${
                    percent === value
                      ? "bg-[var(--pane-accent-faint)] text-[var(--pane-accent)]"
                      : "text-[var(--pane-muted)] hover:bg-[var(--pane-bg)] hover:text-[var(--pane-text)]"
                  }`}
                >
                  {value}%
                </button>
              ))}
            </div>

            <div className="mt-4 space-y-1 border-t border-[var(--pane-border)] pt-3 font-mono text-[12px] tabular-nums">
              <Line label={d.closing} value={qty.toPrecision(4)} />
              <Line
                label={d.remains}
                value={percent >= 100 ? d.nothing : (trade.qty - qty).toPrecision(4)}
              />
              {trade.realized !== 0 && (
                <Line
                  label={d.alreadyTaken}
                  value={`${trade.realized >= 0 ? "+" : "-"}${Math.abs(trade.realized).toFixed(2)} $`}
                  tone="text-[var(--pane-muted)]"
                />
              )}
              <Line
                label={d.result}
                value={`${part >= 0 ? "+" : "-"}${Math.abs(part).toFixed(2)} $`}
                tone={part >= 0 ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"}
              />
              <Line
                label={d.fee}
                value={`-${fee.toFixed(2)} $`}
                tone="text-[var(--pane-muted)]"
              />
              <Line
                label={d.toAccount}
                value={`${part - fee >= 0 ? "+" : "-"}${Math.abs(part - fee).toFixed(2)} $`}
                tone={part - fee >= 0 ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"}
              />
            </div>

            <p className="mt-3 text-[11px] leading-snug text-[var(--pane-muted)]">
              {d.note}
            </p>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-[var(--pane-border)] px-5 py-3">
          <button onClick={onCancel} className={`${BUTTON} text-[var(--pane-muted)] hover:text-[var(--pane-text)]`}>
            {t.common.cancel}
          </button>
          <button
            onClick={() => onConfirm(share)}
            className={`${BUTTON} bg-[var(--pane-accent-faint)] text-[var(--pane-accent)]`}
          >
            {waiting ? d.dropDraft : d.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

function Line({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[var(--pane-muted)]">{label}</span>
      <span className={tone ?? "text-[var(--pane-text)]"}>{value}</span>
    </div>
  );
}

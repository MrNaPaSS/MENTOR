"use client";

// Окно расчёта сделки от полки ликвидности.
//
// Открывается по нажатию на полку — на графике или в списке под ним. Сторона
// не спрашивается: полка в заявках на покупку это поддержка, значит лонг,
// полка в продажах — сопротивление, значит шорт. Спрашивать у трейдера то,
// что уже известно из стакана, значит давать ему возможность ошибиться.
//
// Трейдер вводит два числа — сумму и плечо, — а видит все, которые нужны для
// решения: объём позиции, потери на стопе, прибыль по каждой цели и цену
// ликвидации. Пока окно открыто, разметка уже нарисована на графике: цифры и
// картинка меняются вместе, и нажимать «применить» не нужно.

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { money, price as fmtPrice, type Wall } from "@/lib/scalping";
import {
  computeTrade,
  MAX_LEVERAGE,
  MAX_STOP_PCT,
  MIN_STOP_PCT,
  sideForShelf,
  DEFAULT_TAKES,
} from "@/lib/trade/plan";

export type TradeDraft = {
  shelf: Wall;
  tick: number;
  margin: number;
  leverage: number;
  stopPct: number;
};

const FIELD =
  "w-full rounded border border-border bg-bg-deep px-2 py-1.5 text-right font-mono text-sm " +
  "text-text-primary outline-none transition-colors duration-150 ease-out focus:border-accent-cyan";

export default function TradeDialog({
  draft,
  onChange,
  onClose,
}: {
  draft: TradeDraft;
  onChange: (next: TradeDraft) => void;
  onClose: () => void;
}) {
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Escape закрывает: окно перекрывает график, и тянуться мышью к крестику
  // посреди работы — лишнее движение.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    firstFieldRef.current?.select();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const side = sideForShelf(draft.shelf.side);
  const long = side === "long";
  const plan = computeTrade({
    entry: draft.shelf.price,
    side,
    stopPct: draft.stopPct,
    margin: draft.margin,
    leverage: draft.leverage,
    takes: DEFAULT_TAKES,
  });

  const tick = draft.tick;

  return (
    <div
      className="fixed inset-0 z-50 grid animate-fade-in place-items-center bg-black/60 p-4 motion-reduce:animate-none"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-[460px] max-w-full animate-dialog-in rounded-xl border border-border bg-bg-card shadow-2xl motion-reduce:animate-none"
      >
        <div className="flex items-start justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-text-primary">
              Сделка от полки {fmtPrice(draft.shelf.price, tick)}
            </p>
            <p className="mt-0.5 text-[11px] text-text-muted">
              {money(draft.shelf.notional)} в стакане —{" "}
              {long ? "поддержка, вход в лонг" : "сопротивление, вход в шорт"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                long ? "bg-success/15 text-success" : "bg-danger/15 text-danger"
              }`}
            >
              {long ? "ЛОНГ" : "ШОРТ"}
            </span>
            <button
              onClick={onClose}
              title="Закрыть · Esc"
              className="text-text-muted transition-colors duration-150 ease-out hover:text-text-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 px-4 py-3">
          <label className="block">
            <span className="mb-1 block text-[11px] text-text-muted">Сумма, $</span>
            <input
              ref={firstFieldRef}
              type="number"
              min={1}
              step="any"
              value={draft.margin}
              onChange={(e) => onChange({ ...draft, margin: Number(e.target.value) })}
              className={FIELD}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-text-muted">Плечо</span>
            <input
              type="number"
              min={1}
              max={MAX_LEVERAGE}
              step={1}
              value={draft.leverage}
              onChange={(e) => onChange({ ...draft, leverage: Number(e.target.value) })}
              className={FIELD}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-text-muted">Стоп, %</span>
            <input
              type="number"
              min={MIN_STOP_PCT}
              max={MAX_STOP_PCT}
              step={0.01}
              value={draft.stopPct}
              onChange={(e) => onChange({ ...draft, stopPct: Number(e.target.value) })}
              className={FIELD}
            />
          </label>
        </div>

        {plan ? (
          <div className="border-t border-border px-4 py-3 font-mono text-[12px] tabular-nums">
            <Line label="Вход" value={fmtPrice(plan.entry, tick)} tone="text-text-primary" />
            <Line
              label="Стоп"
              value={`${fmtPrice(plan.stop, tick)}  −${money(plan.risk)} (${plan.riskPct.toFixed(1)}%)`}
              tone="text-danger"
            />
            {plan.targets.map((target, i) => (
              <Line
                key={target.r}
                label={`Тейк ${i + 1} · ${target.r}R`}
                value={`${fmtPrice(target.price, tick)}  +${money(target.profit)}`}
                tone="text-success"
              />
            ))}

            <div className="mt-2 border-t border-border pt-2">
              <Line
                label="Объём"
                value={`${money(plan.notional)} · ${plan.qty.toPrecision(4)} монет`}
                tone="text-text-secondary"
              />
              <Line
                label="Ликвидация ≈"
                value={fmtPrice(plan.liquidation, tick)}
                tone={plan.liquidatedFirst ? "text-danger" : "text-text-secondary"}
              />
            </div>

            {plan.liquidatedFirst && (
              <p className="mt-2 rounded bg-danger/10 px-2 py-1.5 text-[11px] leading-snug text-danger">
                Ликвидация ближе стопа: при таком плече позицию вынесет раньше,
                чем сработает стоп. Уменьшите плечо или подтяните стоп.
              </p>
            )}
          </div>
        ) : (
          <p className="border-t border-border px-4 py-4 text-center text-[12px] text-text-muted">
            Введите сумму, плечо и стоп — расчёт появится здесь
          </p>
        )}
      </div>
    </div>
  );
}

function Line({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="flex items-baseline justify-between py-0.5">
      <span className="text-text-muted">{label}</span>
      <span className={tone}>{value}</span>
    </div>
  );
}

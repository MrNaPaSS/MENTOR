"use client";

// Окно расчёта сделки от полки ликвидности.
//
// Открывается по нажатию на полку — на графике или в стакане. Сторона не
// спрашивается: полка в заявках на покупку это поддержка, значит лонг, полка в
// продажах — сопротивление, значит шорт. Спрашивать у трейдера то, что уже
// известно из стакана, значит давать ему возможность ошибиться.
//
// Трейдер вводит два числа — сумму и плечо, — а видит все, которые нужны для
// решения: объём позиции, потери на стопе, прибыль по каждой цели и цену
// ликвидации. Разметка на графике меняется вместе с цифрами, поэтому «Войти»
// здесь не отправляет ордер на биржу, а закрепляет расчёт: сделка начинает
// ждать свою цену.

import { useEffect, useRef, useState } from "react";
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

// Готовые значения под пальцем: скальпер работает одними и теми же суммами, и
// набирать «50» с клавиатуры двадцать раз за сессию — потерянное время. Своё
// число вводится там же, список только предлагает частое.
const MARGINS = [5, 10, 15, 25, 50, 100, 250, 500, 1000];
const LEVERAGES = [5, 10, 20, 25, 50, 75, 100, 125, 200, 400];
const STOPS = [0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1, 2];

const FIELD =
  "w-full rounded border border-border bg-bg-deep px-2 py-1.5 text-right font-mono text-sm " +
  "text-text-primary outline-none transition-colors duration-150 ease-out focus:border-accent-cyan";

const BUTTON =
  "rounded px-3 py-1.5 text-[12px] font-semibold transition-[background-color,transform] " +
  "duration-150 ease-out active:scale-[0.98]";

export default function TradeDialog({
  draft,
  onChange,
  onConfirm,
  onCancel,
}: {
  draft: TradeDraft;
  onChange: (next: TradeDraft) => void;
  /** Расчёт принят: окно закрывается, разметка остаётся на графике. */
  onConfirm: () => void;
  /** Отказ: сделка снимается с графика целиком. */
  onCancel: () => void;
}) {
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
      if (event.key === "Enter") onConfirm();
    }
    document.addEventListener("keydown", onKey);
    firstFieldRef.current?.select();
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, onConfirm]);

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
      onClick={onCancel}
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
              onClick={onCancel}
              title="Отмена · Esc"
              className="text-text-muted transition-colors duration-150 ease-out hover:text-text-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 px-4 py-3">
          <PickerField
            label="Сумма, $"
            value={draft.margin}
            presets={MARGINS}
            format={(v) => String(v)}
            min={1}
            step="any"
            inputRef={firstFieldRef}
            onPick={(margin) => onChange({ ...draft, margin })}
          />
          <PickerField
            label="Плечо"
            value={draft.leverage}
            presets={LEVERAGES}
            format={(v) => `x${v}`}
            min={1}
            max={MAX_LEVERAGE}
            step={1}
            onPick={(leverage) => onChange({ ...draft, leverage })}
          />
          <PickerField
            label="Стоп, %"
            value={draft.stopPct}
            presets={STOPS}
            format={(v) => `${v}%`}
            min={MIN_STOP_PCT}
            max={MAX_STOP_PCT}
            step={0.01}
            onPick={(stopPct) => onChange({ ...draft, stopPct })}
          />
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

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button onClick={onCancel} className={`${BUTTON} text-text-muted hover:text-text-primary`}>
            Отмена
          </button>
          <button
            onClick={onConfirm}
            disabled={!plan}
            className={`${BUTTON} ${
              long ? "bg-success/20 text-success" : "bg-danger/20 text-danger"
            } disabled:opacity-40`}
          >
            Войти
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Поле с готовыми значениями.
 *
 * Список раскрывается по нажатию на само поле: это одно движение вместо
 * отдельной кнопки рядом. Ввести своё число можно там же — поле остаётся
 * обычным полем ввода.
 */
function PickerField({
  label,
  value,
  presets,
  format,
  onPick,
  min,
  max,
  step,
  inputRef,
}: {
  label: string;
  value: number;
  presets: number[];
  format: (value: number) => string;
  onPick: (value: number) => void;
  min?: number;
  max?: number;
  step?: number | "any";
  inputRef?: React.RefObject<HTMLInputElement>;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Закрытие по клику мимо: список перекрывает расчёт, и оставлять его висеть,
  // пока трейдер смотрит цифры, нельзя.
  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={boxRef} className="relative">
      <span className="mb-1 block text-[11px] text-text-muted">{label}</span>
      <input
        ref={inputRef}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => onPick(Number(e.target.value))}
        className={FIELD}
      />

      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-52 overflow-auto rounded border border-border bg-bg-panel py-1 shadow-xl">
          {presets.map((preset) => (
            <button
              key={preset}
              onClick={() => {
                onPick(preset);
                setOpen(false);
              }}
              className={`block w-full px-2 py-1 text-right font-mono text-[12px] transition-colors duration-150 ease-out hover:bg-accent-cyan/10 ${
                preset === value ? "text-accent-cyan" : "text-text-secondary"
              }`}
            >
              {format(preset)}
            </button>
          ))}
        </div>
      )}
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

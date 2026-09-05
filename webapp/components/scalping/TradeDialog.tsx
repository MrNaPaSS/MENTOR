"use client";

// Окно расчёта сделки от полки ликвидности.
//
// Открывается по нажатию на полку — на графике или в стакане. Сторона не
// спрашивается: полка в заявках на покупку это поддержка, значит лонг, полка в
// продажах — сопротивление, значит шорт. Спрашивать у трейдера то, что уже
// известно из стакана, значит давать ему возможность ошибиться.
//
// Готовые значения стоят под полями строкой, а не выпадающим списком: список
// перекрывал сам расчёт, ради которого окно и открыто. Цифры и кнопки видны
// одновременно — трейдер меняет плечо и сразу видит, что стало с риском.
//
// «Войти» не отправляет ордер на биржу: сделка начинает ждать свою цену, а
// разметка остаётся на графике.

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

// Частые значения под пальцем: скальпер работает одними и теми же суммами, и
// набирать «50» с клавиатуры двадцать раз за сессию — потерянное время.
const MARGINS = [10, 25, 50, 100, 250, 500];
const LEVERAGES = [10, 25, 50, 100, 200, 400];
const STOPS = [0.05, 0.1, 0.2, 0.5, 1];

// Стрелки числового поля убраны: они съедают ширину и промахиваются пальцем.
const FIELD =
  "w-full rounded-md border border-border bg-bg-deep px-2.5 py-2 text-right font-mono text-[15px] " +
  "text-text-primary outline-none transition-colors duration-150 ease-out focus:border-accent-cyan " +
  "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none " +
  "[&::-webkit-outer-spin-button]:appearance-none";

const CHIP =
  "rounded px-1.5 py-0.5 font-mono text-[11px] transition-[background-color,color,transform] " +
  "duration-150 ease-out active:scale-[0.97]";

const BUTTON =
  "rounded-md px-4 py-2 text-[12px] font-semibold transition-[background-color,transform] " +
  "duration-150 ease-out active:scale-[0.98]";

export default function TradeDialog({
  draft,
  onChange,
  onConfirm,
  onCancel,
  live = false,
}: {
  draft: TradeDraft;
  onChange: (next: TradeDraft) => void;
  /** Расчёт принят: окно закрывается, разметка остаётся на графике. */
  onConfirm: () => void;
  /** Отказ: сделка снимается с графика целиком. */
  onCancel: () => void;
  /** Боевой режим: подтверждение отправит ордер на биржу. */
  live?: boolean;
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
  const tone = long ? "text-success" : "text-danger";
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
        className="w-[520px] max-w-full animate-dialog-in overflow-hidden rounded-xl border border-border bg-bg-card shadow-2xl motion-reduce:animate-none"
      >
        {/* Шапка: что за уровень и в какую сторону от него работаем. */}
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <div className="flex items-baseline gap-2">
              <span className={`text-[11px] font-semibold uppercase ${tone}`}>
                {long ? "лонг" : "шорт"}
              </span>
              <span className="font-mono text-[19px] font-semibold text-text-primary">
                {fmtPrice(draft.shelf.price, tick)}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-text-muted">
              {money(draft.shelf.notional)} в стакане —{" "}
              {long ? "поддержка под ценой" : "сопротивление над ценой"}
            </p>
          </div>
          <button
            onClick={onCancel}
            title="Отмена · Esc"
            className="text-text-muted transition-colors duration-150 ease-out hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-4 px-5 py-4">
          <Field
            label="Сумма, $"
            value={draft.margin}
            presets={MARGINS}
            format={(v) => String(v)}
            min={1}
            step="any"
            inputRef={firstFieldRef}
            onPick={(margin) => onChange({ ...draft, margin })}
          />
          <Field
            label="Плечо"
            value={draft.leverage}
            presets={LEVERAGES}
            format={(v) => `x${v}`}
            min={1}
            max={MAX_LEVERAGE}
            step={1}
            onPick={(leverage) => onChange({ ...draft, leverage })}
          />
          <Field
            label="Стоп, %"
            value={draft.stopPct}
            presets={STOPS}
            format={(v) => String(v)}
            min={MIN_STOP_PCT}
            max={MAX_STOP_PCT}
            step={0.01}
            onPick={(stopPct) => onChange({ ...draft, stopPct })}
          />
        </div>

        {plan ? (
          <div className="border-t border-border bg-bg-deep/40 px-5 py-4">
            <Row
              label="Вход"
              price={fmtPrice(plan.entry, tick)}
              note={`${money(plan.notional)} · ${plan.qty.toPrecision(4)}`}
            />
            <Row
              label="Стоп"
              price={fmtPrice(plan.stop, tick)}
              note={`−${money(plan.risk)} · ${plan.riskPct.toFixed(1)}% от суммы`}
              tone="text-danger"
            />
            {plan.targets.map((target, i) => (
              <Row
                key={target.r}
                label={`Тейк ${i + 1}`}
                price={fmtPrice(target.price, tick)}
                note={`+${money(target.profit)} · ${target.r}R`}
                tone="text-success"
              />
            ))}
            <Row
              label="Ликвидация ≈"
              price={fmtPrice(plan.liquidation, tick)}
              note={plan.liquidatedFirst ? "ближе стопа" : ""}
              tone={plan.liquidatedFirst ? "text-danger" : "text-text-muted"}
            />

            {plan.liquidatedFirst && (
              <p className="mt-3 rounded-md bg-danger/10 px-3 py-2 text-[11px] leading-snug text-danger">
                При таком плече позицию вынесет раньше, чем сработает стоп.
                Уменьшите плечо или отодвиньте стоп.
              </p>
            )}
          </div>
        ) : (
          <p className="border-t border-border px-5 py-6 text-center text-[12px] text-text-muted">
            Введите сумму, плечо и стоп — расчёт появится здесь
          </p>
        )}

        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <span className="text-[11px] text-text-muted">
            {live ? (
              <span className="text-danger">Ордер уйдёт на биржу</span>
            ) : (
              "Enter — войти, Esc — отмена"
            )}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className={`${BUTTON} text-text-muted hover:text-text-primary`}
            >
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
    </div>
  );
}

/** Поле ввода с частыми значениями строкой под ним. */
function Field({
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
  return (
    <div>
      <span className="mb-1.5 block text-[11px] text-text-muted">{label}</span>
      <input
        ref={inputRef}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onPick(Number(e.target.value))}
        className={FIELD}
      />
      <div className="mt-1.5 flex flex-wrap gap-1">
        {presets.map((preset) => (
          <button
            key={preset}
            onClick={() => onPick(preset)}
            className={`${CHIP} ${
              preset === value
                ? "bg-accent-cyan/15 text-accent-cyan"
                : "text-text-muted hover:bg-bg-panel hover:text-text-primary"
            }`}
          >
            {format(preset)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Строка расчёта: название, цена и что она значит в деньгах. */
function Row({
  label,
  price,
  note,
  tone = "text-text-primary",
}: {
  label: string;
  price: string;
  note: string;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between py-1 font-mono text-[12px] tabular-nums">
      <span className="text-text-muted">{label}</span>
      <span className="flex items-baseline gap-3">
        <span className={`text-[11px] ${tone === "text-text-primary" ? "text-text-muted" : tone}`}>
          {note}
        </span>
        <span className={`w-28 text-right ${tone}`}>{price}</span>
      </span>
    </div>
  );
}

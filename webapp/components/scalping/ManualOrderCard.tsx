"use client";

// Окно ручной лимитки: цифры сделки и всё, что в ней можно поправить.
//
// Уровни трейдер ставит мышью на графике, но не всякую цену удобно поймать
// курсором: у монеты с шагом в сотую доллара точное число быстрее набрать. И
// наоборот - сумма, плечо и соотношение с графика не читаются вовсе. Поэтому
// окно показывает и то и другое: цены правятся числом, деньги считаются сами.
//
// Окно перетаскивается за шапку. Оно стоит поверх графика, а закрывать собой
// именно тот уровень, к которому трейдер тянется, ему нельзя.

import { useT } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { GripHorizontal, X } from "lucide-react";

import { price as fmtPrice } from "@/lib/scalping";
import {
  flip,
  maxMargin,
  moveLevel,
  qtyOf,
  rewardOf,
  riskOf,
  rrOf,
  type LevelKind,
  type ManualDraft,
} from "@/lib/trade/manual";
import { TAKER_FEE } from "@/lib/trade/position";

const MARGINS = [10, 25, 50, 100, 250, 500];
const LEVERAGES = [5, 10, 25, 50, 100, 200];

const CHIP =
  "rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors duration-150 ease-out";

const FIELD =
  "w-full rounded border bg-transparent px-1.5 py-1 text-right font-mono text-[11px] tabular-nums " +
  "outline-none transition-colors duration-150 ease-out";

/** Где окно стоит по умолчанию: верхний правый угол графика, с отступом. */
const HOME = { x: -232, y: 12 };

export default function ManualOrderCard({
  draft,
  tick,
  maxLeverage,
  takerFee = TAKER_FEE,
  maxQty,
  maxPosition,
  free = 0,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: ManualDraft;
  tick: number;
  /** Потолок плеча по этой монете: кнопка выше него - гарантированный отказ. */
  maxLeverage?: number;
  /** Комиссия тейкера этой монеты: платится на входе и на выходе. */
  takerFee?: number;
  /** Потолок одной заявки по монете, в самой монете. */
  maxQty?: number;
  /** Потолок всей позиции по монете. */
  maxPosition?: number;
  /** Свободные деньги счёта: маржу больше остатка внести нечем. */
  free?: number;
  onChange: (next: ManualDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const d = t.dialogs.manual;
  // Положение окна: справа сверху, дальше - куда перетащат. Держим в точках от
  // правого верхнего угла графика, чтобы окно не уезжало при смене размера.
  const [at, setAt] = useState(HOME);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Esc закрывает заготовку: заявки на бирже ещё нет, терять нечего.
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") cancelRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const cap = maxLeverage && maxLeverage > 0 ? maxLeverage : null;
  const leverages = cap
    ? [...LEVERAGES.filter((l) => l < cap), cap].filter((l, i, all) => all.indexOf(l) === i)
    : LEVERAGES;
  // Плечо выше потолка монеты подводим к потолку. Вниз и только вниз: поднимать
  // плечо за трейдера нельзя, это его риск.
  useEffect(() => {
    if (cap !== null && draft.leverage > cap) onChange({ ...draft, leverage: cap });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cap, draft.leverage]);

  // Предельная сумма: остаток счёта и потолки биржи по этой монете. Ноль -
  // предел неизвестен, и тогда не ограничиваем: запретить возможное хуже, чем
  // не подсказать.
  const ceiling = maxMargin(draft.entry, draft.leverage, free, { maxQty, maxPosition });
  const margins = ceiling > 0 ? capped(MARGINS, ceiling) : MARGINS;
  const overSize = ceiling > 0 && draft.margin > ceiling;

  const long = draft.side === "long";
  const qty = qtyOf(draft);
  const risk = riskOf(draft);
  const reward = rewardOf(draft);
  const rr = rrOf(draft);
  // Комиссия обеих ног: она платится и на входе, и на выходе, и на плече в
  // сотню съедает заметную часть цели.
  const fee = qty * (draft.entry + draft.take) * takerFee;
  // Ликвидация по изолированной марже, без поддерживающей: у биржи она чуть
  // ближе, поэтому подписана как ориентировочная.
  const liquidation = long
    ? draft.entry * (1 - 1 / draft.leverage)
    : draft.entry * (1 + 1 / draft.leverage);
  const doomed = long ? draft.stop <= liquidation : draft.stop >= liquidation;

  const away = (price: number) =>
    draft.entry > 0 ? `${(Math.abs(price - draft.entry) / draft.entry * 100).toFixed(2)}%` : "";

  function grab(event: React.PointerEvent<HTMLDivElement>) {
    // Кнопки в шапке перетаскиванием не считаются. Иначе нажатие на них
    // начинало тащить окно, а `preventDefault` съедал само нажатие - крестик
    // не закрывал окно, разворот не разворачивал.
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX - at.x, y: event.clientY - at.y };
    setDragging(true);
  }

  function move(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    event.preventDefault();
    setAt({ x: event.clientX - dragRef.current.x, y: event.clientY - dragRef.current.y });
  }

  function release(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <div
      className="absolute z-40 w-56 rounded-lg border shadow-xl"
      style={{
        // От правого верхнего угла: окно должно оставаться на месте, когда
        // график меняет ширину, а не уезжать вместе с ней.
        right: -at.x,
        top: at.y,
        borderColor: "var(--pane-border)",
        background: "var(--pane-bg)",
      }}
    >
      <div
        onPointerDown={grab}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={release}
        className={
          "flex items-center gap-1.5 rounded-t-lg border-b px-2 py-1.5 " +
          (dragging ? "cursor-grabbing" : "cursor-grab")
        }
        style={{ borderColor: "var(--pane-border)", touchAction: "none" }}
      >
        <GripHorizontal className="h-3 w-3 shrink-0 text-[var(--pane-muted)]" />
        <button
          onClick={() => onChange(flip(draft))}
          title={d.flip}
          className={`${CHIP} font-semibold ${
            long
              ? "bg-[var(--pane-up-faint)] text-[var(--pane-up)]"
              : "bg-[var(--pane-down-faint)] text-[var(--pane-down)]"
          }`}
        >
          {long ? d.long : d.short}
        </button>
        <span className="font-mono text-[10px] tabular-nums text-[var(--pane-muted)]">
          ×{draft.leverage}
        </span>
        <button
          onClick={onCancel}
          title={d.dismiss}
          className="ml-auto text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-1.5 p-2">
        {/* Цены: те же три уровня, что тянутся на графике. Здесь их можно
            набрать числом - в монете с мелким шагом так точнее. */}
        <PriceRow
          label={d.entry}
          value={draft.entry}
          tick={tick}
          color="var(--pane-text)"
          onSet={(value) => onChange(moveLevel(draft, "entry", value, tick))}
        />
        <PriceRow
          label={d.stop}
          value={draft.stop}
          tick={tick}
          color="var(--pane-down)"
          note={away(draft.stop)}
          onSet={(value) => onChange(moveLevel(draft, "stop", value, tick))}
        />
        <PriceRow
          label={d.target}
          value={draft.take}
          tick={tick}
          color="var(--pane-up)"
          note={away(draft.take)}
          onSet={(value) => onChange(moveLevel(draft, "take", value, tick))}
        />

        {/* Сумма и плечо готовыми значениями: скальпер работает одними и теми
            же, и набирать их с клавиатуры двадцать раз за сессию незачем. */}
        <Chips
          label={d.amount}
          values={margins}
          current={draft.margin}
          format={(v) => `${v}`}
          onPick={(value) => onChange({ ...draft, margin: value })}
        />
        <Chips
          label={d.leverage}
          values={leverages}
          current={draft.leverage}
          format={(v) => `×${v}`}
          onPick={(value) => onChange({ ...draft, leverage: value })}
        />

        <dl
          className="space-y-0.5 border-t pt-1.5 font-mono text-[10px] tabular-nums"
          style={{ borderColor: "var(--pane-border)" }}
        >
          <Fact name={d.qty} value={qty > 0 ? qty.toFixed(6) : "-"} />
          <Fact name={d.inPosition} value={`${(draft.margin * draft.leverage).toFixed(0)} $`} />
          <Fact name={d.risk} value={`-${risk.toFixed(2)} $`} tone="down" />
          <Fact name={d.reward} value={`+${reward.toFixed(2)} $`} tone="up" />
          <Fact name={d.fee} value={`-${fee.toFixed(2)} $`} />
          <Fact
            name={d.ratio}
            value={`${rr.toFixed(2)}R`}
            // Меньше единицы - берут меньше, чем рискуют. Молчать об этом
            // нельзя: такая сделка требует попадать чаще, чем ошибаться.
            tone={rr < 1 ? "down" : "up"}
          />
          <Fact
            name={d.liquidation}
            value={fmtPrice(liquidation, tick)}
            tone={doomed ? "down" : undefined}
          />
        </dl>

        {/* Ликвидация ближе стопа - позицию вынесет раньше, чем сработает
            защита. Это не подсказка, а предупреждение, и молчать о нём нельзя. */}
        {doomed && (
          <p className="text-[10px] leading-tight text-[var(--pane-down)]">
            {d.liqCloser}
          </p>
        )}

        {/* Предел биржи по этой монете и плечу. Отказ «position exceed max
            size» приходит уже после нажатия - сказать надо до. */}
        {overSize && (
          <p className="text-[10px] leading-tight text-[var(--pane-down)]">
            {d.ceiling(ceiling.toFixed(0), draft.leverage)}
          </p>
        )}

        <button
          onClick={onSubmit}
          disabled={overSize}
          className="w-full rounded-md disabled:cursor-not-allowed disabled:opacity-50 py-1.5 text-[11px] font-semibold transition-transform duration-150 ease-out active:scale-[0.98]"
          style={{
            background: long ? "var(--pane-up)" : "var(--pane-down)",
            color: "var(--pane-deep)",
          }}
        >
          {d.place(long ? t.dialogs.trade.long : t.dialogs.trade.short)}
        </button>
        <p className="text-center text-[10px] leading-tight text-[var(--pane-muted)]">
          {d.dragHint}
        </p>
      </div>
    </div>
  );
}

/**
 * Строка цены: число можно набрать, а можно оставить как есть.
 *
 * Держим набранное отдельно от цены сделки: пока трейдер печатает, в поле
 * бывает и «7», и «79.», и пустая строка - применять такое к заявке нельзя, а
 * стирать за ним набранное тем более.
 */
function PriceRow({
  label,
  value,
  tick,
  color,
  note,
  onSet,
}: {
  label: string;
  value: number;
  tick: number;
  color: string;
  note?: string;
  onSet: (price: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? fmtPrice(value, tick).replace(/,/g, "");

  function apply(raw: string) {
    setText(null);
    const price = Number(raw.replace(",", "."));
    if (Number.isFinite(price) && price > 0) onSet(price);
  }

  return (
    <label className="flex items-center gap-1.5">
      <span className="w-10 shrink-0 text-[10px]" style={{ color }}>
        {label}
      </span>
      <input
        value={shown}
        onChange={(event) => setText(event.target.value)}
        onBlur={(event) => apply(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          if (event.key === "Escape") setText(null);
        }}
        inputMode="decimal"
        className={FIELD}
        style={{ borderColor: "var(--pane-border)", color: "var(--pane-text)" }}
      />
      <span className="w-10 shrink-0 text-right font-mono text-[10px] tabular-nums text-[var(--pane-muted)]">
        {note ?? ""}
      </span>
    </label>
  );
}

/**
 * Готовые суммы не выше предела, и сам предел последней кнопкой.
 *
 * Так же, как с плечом: кнопка, которая гарантированно приведёт к отказу
 * биржи, - это не выбор, а ловушка. А встать ровно в потолок трейдер вправе.
 */
function capped(values: number[], ceiling: number): number[] {
  const fits = values.filter((value) => value <= ceiling);
  const top = Math.floor(ceiling);
  if (top > 0 && !fits.includes(top)) fits.push(top);
  return fits.length > 0 ? fits : [top > 0 ? top : values[0]];
}

function Chips({
  label,
  values,
  current,
  format,
  onPick,
}: {
  label: string;
  values: number[];
  current: number;
  format: (value: number) => string;
  onPick: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-10 shrink-0 text-[10px] text-[var(--pane-muted)]">{label}</span>
      <div className="flex flex-wrap gap-0.5">
        {values.map((value) => (
          <button
            key={value}
            onClick={() => onPick(value)}
            className={`${CHIP} ${
              current === value
                ? "bg-[var(--pane-accent-faint)] text-[var(--pane-accent)]"
                : "text-[var(--pane-muted)] hover:text-[var(--pane-text)]"
            }`}
          >
            {format(value)}
          </button>
        ))}
      </div>
    </div>
  );
}

function Fact({
  name,
  value,
  tone,
}: {
  name: string;
  value: string;
  tone?: "up" | "down";
}) {
  const color =
    tone === "up"
      ? "text-[var(--pane-up)]"
      : tone === "down"
        ? "text-[var(--pane-down)]"
        : "text-[var(--pane-text)]";
  return (
    <div className="flex justify-between">
      <dt className="text-[var(--pane-muted)]">{name}</dt>
      <dd className={color}>{value}</dd>
    </div>
  );
}

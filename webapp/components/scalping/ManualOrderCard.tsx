"use client";

// Цифры ручной лимитки: то, что нельзя увидеть по самим уровням на графике.
//
// Цены трейдер и так видит - они стоят у квадратов, которые он тянет. Здесь
// только то, что из цен не читается: объём, риск и прибыль в деньгах,
// соотношение. И две кнопки: выставить или убрать.
//
// Карточка маленькая и стоит в углу графика, а не окном поверх него: окно
// закрыло бы ровно ту разметку, ради которой всё и затевалось.

import { X } from "lucide-react";

import { price as fmtPrice } from "@/lib/scalping";
import {
  flip,
  qtyOf,
  rewardOf,
  riskOf,
  rrOf,
  type ManualDraft,
} from "@/lib/trade/manual";

const MARGINS = [10, 25, 50, 100, 250, 500];
const LEVERAGES = [10, 25, 50, 100, 200, 400];

const CHIP =
  "rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors duration-150 ease-out";

export default function ManualOrderCard({
  draft,
  tick,
  maxLeverage,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: ManualDraft;
  tick: number;
  /** Потолок плеча по этой монете: кнопка выше него - гарантированный отказ. */
  maxLeverage?: number;
  onChange: (next: ManualDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const cap = maxLeverage && maxLeverage > 0 ? maxLeverage : null;
  const leverages = cap
    ? [...LEVERAGES.filter((l) => l < cap), cap].filter((l, i, all) => all.indexOf(l) === i)
    : LEVERAGES;

  const risk = riskOf(draft);
  const reward = rewardOf(draft);
  const rr = rrOf(draft);
  const long = draft.side === "long";

  return (
    <div className="absolute right-3 top-3 z-30 w-52 rounded-lg border border-[var(--pane-border)] bg-[var(--pane-bg)] p-2.5 shadow-xl">
      <div className="mb-2 flex items-center gap-2">
        <button
          onClick={() => onChange(flip(draft))}
          title="Развернуть сделку в другую сторону"
          className={`${CHIP} font-semibold ${
            long
              ? "bg-[var(--pane-up)]/15 text-[var(--pane-up)]"
              : "bg-[var(--pane-down)]/15 text-[var(--pane-down)]"
          }`}
        >
          {long ? "ЛОНГ" : "ШОРТ"}
        </button>
        <span className="font-mono text-[11px] tabular-nums text-[var(--pane-text)]">
          {fmtPrice(draft.entry, tick)}
        </span>
        <button
          onClick={onCancel}
          title="Убрать лимитку"
          className="ml-auto text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Сумма и плечо - готовыми значениями: скальпер работает одними и теми
          же, и набирать их с клавиатуры двадцать раз за сессию незачем. */}
      <Row label="сумма">
        {MARGINS.map((value) => (
          <button
            key={value}
            onClick={() => onChange({ ...draft, margin: value })}
            className={`${CHIP} ${
              draft.margin === value
                ? "bg-[var(--pane-accent-faint)] text-[var(--pane-accent)]"
                : "text-[var(--pane-muted)] hover:text-[var(--pane-text)]"
            }`}
          >
            {value}
          </button>
        ))}
      </Row>

      <Row label="плечо">
        {leverages.map((value) => (
          <button
            key={value}
            onClick={() => onChange({ ...draft, leverage: value })}
            className={`${CHIP} ${
              draft.leverage === value
                ? "bg-[var(--pane-accent-faint)] text-[var(--pane-accent)]"
                : "text-[var(--pane-muted)] hover:text-[var(--pane-text)]"
            }`}
          >
            ×{value}
          </button>
        ))}
      </Row>

      <dl className="mt-2 space-y-1 border-t border-[var(--pane-border)] pt-2 font-mono text-[11px] tabular-nums">
        <Fact name="объём" value={`${qtyOf(draft).toFixed(6)}`} />
        <Fact name="риск" value={`-${risk.toFixed(2)}`} tone="down" />
        <Fact name="цель" value={`+${reward.toFixed(2)}`} tone="up" />
        <Fact
          name="соотношение"
          value={`${rr.toFixed(2)}R`}
          // Меньше единицы - берут меньше, чем рискуют. Молчать об этом нельзя:
          // такая сделка требует попадать чаще, чем ошибаться.
          tone={rr < 1 ? "down" : undefined}
        />
      </dl>

      <button
        onClick={onSubmit}
        className="mt-2.5 w-full rounded-md bg-[var(--pane-accent)] py-1.5 text-[11px] font-semibold text-[var(--pane-deep)] transition-transform duration-150 ease-out active:scale-[0.98]"
      >
        Выставить лимитку
      </button>
      <p className="mt-1.5 text-center text-[10px] leading-tight text-[var(--pane-muted)]">
        Тяните квадраты на графике: вход, стоп и цель
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1 flex items-center gap-1">
      <span className="w-10 shrink-0 text-[10px] text-[var(--pane-muted)]">{label}</span>
      <div className="flex flex-wrap gap-0.5">{children}</div>
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

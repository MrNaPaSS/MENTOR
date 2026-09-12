"use client";

// Общие детали расширенной аналитики: из них собраны все виды раздела.
//
// Виды отличаются раскладкой и подачей, а не данными: одна и та же плитка
// показателя стоит в «Классике» в рамке, а в «Минимализме» голым числом. Класть
// её в каждый вид своим экземпляром значило бы править цвет плюса в пяти
// местах и на шестой раз забыть.

import type { ReactNode } from "react";

export type Tone = "plain" | "up" | "down";

export function toneClass(tone: Tone): string {
  return tone === "up"
    ? "text-[var(--pane-up)]"
    : tone === "down"
      ? "text-[var(--pane-down)]"
      : "text-[var(--pane-text)]";
}

/** Панель вида: рамка, значок, название и подпись рядом с ним. */
export function Card({
  title,
  hint,
  icon,
  right,
  className = "",
  bodyClass = "p-2.5",
  children,
}: {
  title: string;
  hint?: string;
  /** Значок панели: её различают им раньше, чем прочитают название. */
  icon?: ReactNode;
  /** Что встаёт в правом углу шапки: легенда, переключатель. */
  right?: ReactNode;
  className?: string;
  bodyClass?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] ${className}`}
    >
      <header className="flex items-baseline gap-2 border-b border-[var(--pane-border)] px-3 py-1.5">
        {icon && <span className="self-center text-[var(--pane-gold)]">{icon}</span>}
        <h3 className="shrink-0 text-[12px] font-semibold text-[var(--pane-text)]">{title}</h3>
        {hint && <p className="truncate text-[10px] text-[var(--pane-muted)]">{hint}</p>}
        {right && <div className="ml-auto shrink-0 self-center">{right}</div>}
      </header>
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

/** Изменение к прошлому периоду такой же длины. */
export function Delta({ value, suffix = "%" }: { value: number | null; suffix?: string }) {
  if (value === null) return null;
  const pct = Math.round(value * 1000) / 10;
  if (Math.abs(pct) < 0.1) return null;
  return (
    <span
      className={`font-mono text-[10px] font-semibold ${
        pct > 0 ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"
      }`}
    >
      {pct > 0 ? "+" : ""}
      {pct}
      {suffix}
    </span>
  );
}

/**
 * Цена сделки словами.
 *
 * Журнал хранит её как есть, с биржи: 76635.4899483668. В таблице такой хвост
 * не значит ничего, зато ломает колонку и мешает сравнить вход с выходом.
 * Знаков после точки берём столько, сколько нужно самой цене: у биткойна их
 * два, у монеты за десятую цента - шесть.
 */
export function price(value: number): string {
  const size = Math.abs(value);
  const digits = size >= 1000 ? 1 : size >= 10 ? 2 : size >= 1 ? 3 : size >= 0.01 ? 5 : 7;
  return value.toFixed(digits).replace(/\.?0+$/, "");
}

/** Значок монеты: кружок с тикером. Настоящих логотипов у нас нет. */
export function CoinDot({ symbol, size = 22 }: { symbol: string; size?: number }) {
  const name = symbol.replace(/USDT$/, "");
  // Цвет из самого тикера: он должен быть одним и тем же в каждом списке, а
  // таблицы соответствий на все монеты рынка не напасёшься.
  let hash = 0;
  for (const letter of name) hash = (hash * 31 + letter.charCodeAt(0)) % 360;

  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-bold"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        background: `hsl(${hash} 70% 50% / 0.18)`,
        color: `hsl(${hash} 70% 42%)`,
      }}
    >
      {name.slice(0, 3)}
    </span>
  );
}

/** Переключатель внутри шапки панели: чем мерить разрез. */
export function Pick<T extends string>({
  value,
  options,
  onPick,
}: {
  value: T;
  options: readonly { key: T; label: string }[];
  onPick: (key: T) => void;
}) {
  return (
    <div className="flex gap-0.5 rounded-lg bg-[var(--pane-hover)] p-0.5">
      {options.map((one) => (
        <button
          key={one.key}
          type="button"
          onClick={() => onPick(one.key)}
          className={`rounded-md px-2 py-0.5 text-[10px] font-semibold transition-colors ${
            value === one.key
              ? "bg-[var(--pane-bg)] text-[var(--pane-text)] shadow-sm"
              : "text-[var(--pane-muted)] hover:text-[var(--pane-text)]"
          }`}
        >
          {one.label}
        </button>
      ))}
    </div>
  );
}

/** Плитка показателя в рамке: «Классика» и «Профессиональный». */
export function Kpi({
  label,
  value,
  tone = "plain",
  delta,
  note,
}: {
  label: string;
  value: string;
  tone?: Tone;
  /** Изменение к прошлому периоду, в долях. */
  delta?: number | null;
  note?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] px-2.5 py-1.5">
      <div className="truncate text-[9px] uppercase leading-tight tracking-wider text-[var(--pane-muted)]">
        {label}
      </div>
      <div
        className={`font-mono text-[18px] font-extrabold leading-tight tabular-nums ${toneClass(tone)}`}
      >
        {value}
      </div>
      <div className="flex items-baseline gap-1.5 leading-tight">
        <Delta value={delta ?? null} />
        {note && <span className="truncate text-[9px] text-[var(--pane-muted)]">{note}</span>}
      </div>
    </div>
  );
}

/**
 * Плитка показателя с мини-графиком справа.
 *
 * Форма рядом с числом отвечает на вопрос, который иначе требует открыть
 * большой график: месяц копилось или свалилось за день.
 */
export function KpiCard({
  label,
  value,
  tone = "plain",
  delta,
  note,
  chart,
}: {
  label: string;
  value: string;
  tone?: Tone;
  delta?: number | null;
  note?: string;
  /** Мини-график, кольцо или значок: что угодно ростом в строку. */
  chart?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[9px] uppercase leading-tight tracking-wider text-[var(--pane-muted)]">
          {label}
        </div>
        <div
          className={`font-mono text-[20px] font-extrabold leading-tight tabular-nums ${toneClass(tone)}`}
        >
          {value}
        </div>
        <div className="flex items-baseline gap-1.5 leading-tight">
          <Delta value={delta ?? null} />
          {note && <span className="truncate text-[9px] text-[var(--pane-muted)]">{note}</span>}
        </div>
      </div>
      {chart}
    </div>
  );
}

/** Голое число без рамки: «Минимализм» и «Табличный». */
export function Big({
  label,
  value,
  tone = "plain",
  delta,
  size = 24,
}: {
  label: string;
  value: string;
  tone?: Tone;
  delta?: number | null;
  /** Кегль числа: в минимализме крупнее, в таблице скромнее. */
  size?: number;
}) {
  return (
    <div className="min-w-0">
      <div
        className={`flex items-baseline gap-1.5 font-mono font-extrabold leading-none tabular-nums ${toneClass(tone)}`}
        style={{ fontSize: size }}
      >
        <span className="truncate">{value}</span>
        <Delta value={delta ?? null} />
      </div>
      <div className="mt-1 truncate text-[10px] text-[var(--pane-muted)]">{label}</div>
    </div>
  );
}

/** Строка показателя внутри панели: подпись, число, пояснение. */
export function Metric({
  label,
  value,
  note,
  tone = "plain",
}: {
  label: string;
  value: string;
  note?: string;
  tone?: Tone;
}) {
  return (
    <div className="rounded-lg bg-[var(--pane-hover)] px-2 py-1">
      <div className="truncate text-[9px] uppercase leading-tight tracking-wider text-[var(--pane-muted)]">
        {label}
      </div>
      <div
        className={`font-mono text-[15px] font-extrabold leading-tight tabular-nums ${toneClass(tone)}`}
      >
        {value}
      </div>
      {note && <div className="truncate text-[9px] leading-tight text-[var(--pane-muted)]">{note}</div>}
    </div>
  );
}

/** Монеты: полоса доли, число сделок, винрейт и итог. Нажатие фильтрует. */
export function SymbolList({
  rows,
  picked,
  onPick,
  money,
  empty,
  showRate = true,
}: {
  rows: readonly { key: string; trades: number; pnl: number; wins: number }[];
  picked: string | null;
  onPick: (key: string) => void;
  money: (value: number) => string;
  empty: string;
  /** Показывать число сделок и винрейт: в тесной колонке они лишние. */
  showRate?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="py-5 text-center text-[11px] text-[var(--pane-muted)]">{empty}</p>;
  }
  const peak = Math.max(...rows.map((row) => Math.abs(row.pnl)), 1);

  return (
    <div className="space-y-0.5">
      {rows.map((row) => {
        const up = row.pnl >= 0;
        const rate = row.trades > 0 ? Math.round((row.wins / row.trades) * 100) : 0;
        return (
          <button
            key={row.key}
            type="button"
            onClick={() => onPick(row.key)}
            className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors ${
              picked === row.key ? "bg-[var(--pane-hover)]" : "hover:bg-[var(--pane-hover)]"
            }`}
          >
            <CoinDot symbol={row.key} size={20} />
            <span className="w-11 shrink-0 truncate text-[11px] font-bold text-[var(--pane-text)]">
              {row.key.replace(/USDT$/, "")}
            </span>
            <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--pane-hover)]">
              <span
                className="block h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${(Math.abs(row.pnl) / peak) * 100}%`,
                  background: up ? "var(--pane-up)" : "var(--pane-down)",
                }}
              />
            </span>
            {showRate && (
              <span className="w-16 shrink-0 text-right font-mono text-[10px] text-[var(--pane-muted)]">
                {row.trades} · {rate}%
              </span>
            )}
            <span
              className={`w-16 shrink-0 text-right font-mono text-[11px] font-bold ${
                up ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"
              }`}
            >
              {money(row.pnl)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

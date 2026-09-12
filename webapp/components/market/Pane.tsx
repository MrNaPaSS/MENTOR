"use client";

// Панель раздела «Рынок»: одна рамка на всех.
//
// Раздел собран из полутора десятков показателей, и каждый норовит завести
// свою шапку: где-то заголовок жирнее, где-то подпись мельче, где-то рамка
// другого тона. Пятнадцать почти одинаковых шапок читаются хуже одной - глаз
// каждый раз заново ищет, где кончается заголовок и начинаются цифры.
//
// Поэтому рамка здесь одна и она же отвечает за три состояния, которые есть у
// любого показателя: ждём ответа, ответа нет, данные пришли. Раньше каждая
// панель решала это по-своему, и «нет данных» выглядело как пустая панель -
// то есть как будто раздел сломан.

import { useT } from "@/lib/i18n";
import type { ReactNode } from "react";

/** Что показывает панель, пока цифр нет. */
export type PaneState = "loading" | "error" | "ready";

const HEAD =
  "flex items-baseline justify-between gap-3 border-b border-[var(--pane-border)] px-3 py-2";

/** Подпись показателя: везде одна - прописные, разрядка, приглушённый тон. */
export function PaneLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--pane-muted)]">
      {children}
    </span>
  );
}

/**
 * Число показателя.
 *
 * Моноширинные и с табличными цифрами: в столбце из десяти ставок разной
 * длины пропорциональные цифры пляшут, и колонка перестаёт быть колонкой.
 */
export function PaneValue({
  children,
  tone = "plain",
  size = "md",
}: {
  children: ReactNode;
  /** Цвет по смыслу: рост, падение, внимание или обычный. */
  tone?: "plain" | "up" | "down" | "gold" | "accent" | "muted";
  size?: "sm" | "md" | "lg";
}) {
  const color = {
    plain: "text-[var(--pane-text)]",
    up: "text-[var(--pane-up)]",
    down: "text-[var(--pane-down)]",
    gold: "text-[var(--pane-gold)]",
    accent: "text-[var(--pane-accent)]",
    muted: "text-[var(--pane-muted)]",
  }[tone];
  const scale = { sm: "text-[12px]", md: "text-[15px]", lg: "text-[22px]" }[size];
  return (
    <span className={`font-mono font-semibold tabular-nums ${scale} ${color}`}>
      {children}
    </span>
  );
}

/**
 * Полоса-шкала под числом: доля от целого.
 *
 * Числу нужен масштаб. «Комиссия 14 сат/вб» ничего не говорит тому, кто не
 * помнит, сколько бывает; полоса, заполненная на четверть, говорит сразу.
 */
export function PaneBar({
  fill,
  tone = "accent",
}: {
  /** Доля от нуля до единицы. За пределами - обрезается, а не растягивает панель. */
  fill: number;
  tone?: "up" | "down" | "gold" | "accent";
}) {
  const color = {
    up: "var(--pane-up)",
    down: "var(--pane-down)",
    gold: "var(--pane-gold)",
    accent: "var(--pane-accent)",
  }[tone];
  const width = Math.max(0, Math.min(1, Number.isFinite(fill) ? fill : 0)) * 100;
  return (
    <div className="h-[3px] w-full overflow-hidden rounded-full bg-[var(--pane-border)]">
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${width}%`, background: color }}
      />
    </div>
  );
}

export default function Pane({
  title,
  hint,
  icon,
  badge,
  state = "ready",
  /** Чем объяснить пустоту: у каждого показателя своя причина молчать. */
  emptyNote,
  children,
  className = "",
  bodyClass = "",
}: {
  title: string;
  hint?: string;
  /** Значок перед названием: панели рынка различаются им раньше, чем прочитаны. */
  icon?: ReactNode;
  badge?: ReactNode;
  state?: PaneState;
  emptyNote?: string;
  children: ReactNode;
  className?: string;
  /** Как ведёт себя содержимое: например, тянется на всю высоту панели. */
  bodyClass?: string;
}) {
  const t = useT();
  return (
    <section
      className={`flex flex-col overflow-hidden rounded-lg border border-[var(--pane-border)] bg-[var(--pane-bg)] ${className}`}
    >
      <header className={HEAD}>
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 truncate text-[12px] font-semibold text-[var(--pane-text)]">
            {icon && <span className="shrink-0 text-[var(--pane-gold)]">{icon}</span>}
            {title}
          </h2>
          {hint && (
            <p className="mt-0.5 truncate text-[10px] text-[var(--pane-muted)]">{hint}</p>
          )}
        </div>
        {badge && <div className="shrink-0">{badge}</div>}
      </header>

      <div className={`flex-1 p-3 ${bodyClass}`}>
        {state === "loading" && <PaneSkeleton />}
        {state === "error" && (
          <p className="py-6 text-center text-[11px] text-[var(--pane-muted)]">
            {emptyNote ?? t.market.pane.emptyNote}
          </p>
        )}
        {state === "ready" && children}
      </div>
    </section>
  );
}

/** Заглушка на время ожидания: три строки вместо слова «загрузка». */
function PaneSkeleton() {
  return (
    <div className="space-y-2">
      {[70, 90, 55].map((w, i) => (
        <div
          key={i}
          className="h-3 animate-pulse rounded bg-[var(--pane-border)]"
          style={{ width: `${w}%`, animationDelay: `${i * 120}ms` }}
        />
      ))}
    </div>
  );
}

/**
 * Метка живого источника.
 *
 * Не украшение: половина показателей здесь обновляется сама, половина взята
 * один раз при открытии. Не сказав об этом, мы заставляем считать свежими и
 * те, и другие - а по несвежему фандингу входят в сделку.
 */
export function LiveBadge({ live, label }: { live: boolean; label?: string }) {
  const t = useT();
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded border border-[var(--pane-border)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
      style={{ color: live ? "var(--pane-up)" : "var(--pane-muted)" }}
      title={live ? t.market.pane.liveTitle : t.market.pane.snapshotTitle}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${live ? "animate-pulse" : ""}`}
        style={{ background: live ? "var(--pane-up)" : "var(--pane-muted)" }}
      />
      {label ?? (live ? "Live" : t.market.pane.snapshot)}
    </span>
  );
}

"use client";

// Карточка лендинга: подложка, градиентная рамка и свечение на наведении.
//
// Заведена отдельно, потому что разделов с карточками на главной стало много,
// и собранные каждый раз заново они выглядели беднее соседних: голая рамка с
// текстом рядом с карточкой шагов читается как заготовка, а не как продукт.
//
// Свечение и рамка появляются только на наведении и только на устройствах с
// курсором: на телефоне ховера нет, а лишние слои там стоят кадров.

import type { ReactNode } from "react";

export type CardAccent = "cyan" | "gold" | "violet" | "green" | "rose";

export const CARD_ACCENTS: Record<
  CardAccent,
  { ring: string; text: string; grad: string; edge: string; quote: string }
> = {
  cyan: {
    ring: "bg-cyan-500/10 ring-cyan-500/30",
    text: "text-cyan-400",
    grad: "from-cyan-500/20 to-blue-500/10",
    edge: "linear-gradient(135deg, rgba(6,182,212,0.45), transparent 60%)",
    quote: "border-cyan-400/40",
  },
  gold: {
    ring: "bg-amber-500/10 ring-amber-500/30",
    text: "text-amber-400",
    grad: "from-amber-500/20 to-orange-500/10",
    edge: "linear-gradient(135deg, rgba(245,158,11,0.45), transparent 60%)",
    quote: "border-amber-400/40",
  },
  violet: {
    ring: "bg-purple-500/10 ring-purple-500/30",
    text: "text-purple-400",
    grad: "from-purple-500/20 to-pink-500/10",
    edge: "linear-gradient(135deg, rgba(168,85,247,0.45), transparent 60%)",
    quote: "border-purple-400/40",
  },
  green: {
    ring: "bg-emerald-500/10 ring-emerald-500/30",
    text: "text-emerald-400",
    grad: "from-emerald-500/20 to-teal-500/10",
    edge: "linear-gradient(135deg, rgba(16,185,129,0.45), transparent 60%)",
    quote: "border-emerald-400/40",
  },
  rose: {
    ring: "bg-rose-500/10 ring-rose-500/30",
    text: "text-rose-400",
    grad: "from-rose-500/20 to-orange-500/10",
    edge: "linear-gradient(135deg, rgba(244,63,94,0.45), transparent 60%)",
    quote: "border-rose-400/40",
  },
};

interface GlowCardProps {
  accent?: CardAccent;
  children: ReactNode;
  className?: string;
}

export default function GlowCard({ accent = "cyan", children, className = "" }: GlowCardProps) {
  const a = CARD_ACCENTS[accent];

  return (
    <div
      className={`group relative h-full overflow-hidden rounded-2xl border border-border bg-bg-panel/95 backdrop-blur-2xl transition-all duration-500 hover:-translate-y-1.5 hover:shadow-2xl ${className}`}
    >
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${a.grad} opacity-0 transition-opacity duration-500 group-hover:opacity-100`}
      />

      {/* Рамка градиентом: обычная граница остаётся на месте, эта ложится
          поверх неё только на наведении. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background: a.edge,
          WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          WebkitMaskComposite: "destination-out",
          maskComposite: "exclude",
          padding: "1px",
        }}
      />

      <div className="relative z-10 flex h-full flex-col p-6">{children}</div>
    </div>
  );
}

/** Иконка карточки: кружок с кольцом и подсветкой того же цвета. */
export function CardIcon({
  accent = "cyan",
  children,
}: {
  accent?: CardAccent;
  children: ReactNode;
}) {
  const a = CARD_ACCENTS[accent];
  return (
    <span
      className={`grid h-12 w-12 place-items-center rounded-2xl ring-1 transition-all duration-300 ${a.ring} ${a.text}`}
    >
      {children}
    </span>
  );
}

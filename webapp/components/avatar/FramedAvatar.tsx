"use client";

// Аватар в рамке NMNH.
//
// Рамки нарисованы кодом, а не картинками: набор пришёл одним листом на
// тёмном фоне, без прозрачной середины, и перекрасить его под палитру нельзя.
// Здесь каждая рамка - несколько колец и деталей в SVG, а цвета берутся из
// lib/frames.ts: акцент - переменной --frame-accent, металл - тремя тонами.
//
// Рамка выходит за аватар наружу и места в разметке не занимает: ничего
// вокруг не сдвигается, когда её надевают или снимают.
//
// На маленьких размерах (чат, 20-28 точек) детали пропадают - остаются обод
// и акцентные дуги, как в упрощённых версиях набора. Корона и свечи
// появляются с 40 точек, значок снизу - с 32.

import { useId, useState } from "react";
import { FRAME_STYLES, isFrame, type FrameId } from "@/lib/frames";

/** Во сколько раз рисунок рамки больше аватара: запас на обод, корону и значок. */
const BLEED = 1.36;
/** Сторона рисунка в условных единицах. Аватар занимает квадрат 18..118. */
const VB = 136;
const C = VB / 2;

type Shape = "circle" | "square";

export default function FramedAvatar({
  src,
  name,
  size,
  frame,
  shape = "circle",
  radius = 8,
  rank,
  className = "",
}: {
  src?: string | null;
  name: string;
  /** Сторона самого аватара, точки. Рамка рисуется вокруг, наружу. */
  size: number;
  frame?: string | null;
  shape?: Shape;
  /** Скругление квадратного аватара, точки. */
  radius?: number;
  /** Номер места на значке рамки лидерборда. */
  rank?: number;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const round = shape === "circle" ? "50%" : `${radius}px`;
  const framed = isFrame(frame);

  let face: React.ReactNode;
  if (src && !broken) {
    face = (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={name} onError={() => setBroken(true)} className="h-full w-full object-cover" />
    );
  } else {
    // Цвет по имени, а не случайный: у одного человека он один и тот же всегда.
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;
    face = (
      <span
        className="grid h-full w-full place-items-center font-semibold uppercase text-white/90"
        style={{ background: `hsl(${hash} 45% 40%)`, fontSize: size * 0.45 }}
      >
        {name.slice(0, 1)}
      </span>
    );
  }

  return (
    <span className={`relative inline-block shrink-0 align-middle ${className}`} style={{ width: size, height: size }}>
      <span
        className={`block h-full w-full overflow-hidden ${framed ? "" : "ring-1 ring-black/10"}`}
        style={{ borderRadius: round }}
      >
        {face}
      </span>
      {framed && frame && (
        <FrameArt frame={frame} size={size} shape={shape} radius={radius} rank={rank} />
      )}
    </span>
  );
}

type Paint = {
  stroke: string;
  width: number;
  opacity?: number;
  dash?: string;
  offset?: number;
  round?: boolean;
  filter?: string;
};

function FrameArt({
  frame,
  size,
  shape,
  radius,
  rank,
}: {
  frame: FrameId;
  size: number;
  shape: Shape;
  radius: number;
  rank?: number;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const s = FRAME_STYLES[frame];
  const box = size * BLEED;
  const small = size < 32;
  // Обод толще на маленьких: в двадцать точек тонкий обод пропадает вовсе.
  const ring = small ? 9 : size < 50 ? 7 : 6;
  const rx = shape === "circle" ? 0 : (radius * 100) / size;
  const metal = `url(#${uid}m)`;
  // Размытие - только крупным: на чатовых двадцати точках оно даёт кашу, а
  // в длинной ленте десятки фильтров стоят заметно.
  const blur = size >= 40 ? `url(#${uid}b)` : undefined;
  const mid = ring / 2 + 0.5;
  const out = ring + 2.8;

  function edge(d: number, p: Paint, key: string) {
    const common = {
      fill: "none",
      pathLength: 100,
      strokeWidth: p.width,
      opacity: p.opacity,
      strokeDasharray: p.dash,
      strokeDashoffset: p.offset,
      strokeLinecap: p.round ? ("round" as const) : undefined,
      filter: p.filter,
      style: { stroke: p.stroke },
    };
    return shape === "circle" ? (
      <circle key={key} cx={C} cy={C} r={50 + d} {...common} />
    ) : (
      <rect key={key} x={18 - d} y={18 - d} width={100 + 2 * d} height={100 + 2 * d} rx={rx + d} {...common} />
    );
  }

  const parts: React.ReactNode[] = [
    edge(mid, { stroke: s.accent, width: ring + 5, opacity: 0.28, filter: blur }, "glow"),
    edge(mid, { stroke: metal, width: ring }, "metal"),
    edge(ring + 0.4, { stroke: "rgba(0,0,0,0.55)", width: 0.9 }, "shade"),
    edge(0.7, { stroke: s.accent, width: small ? 1.8 : 1.3, opacity: 0.95 }, "inner"),
  ];

  if (s.arcs) {
    parts.push(
      edge(out, { stroke: s.accent, width: small ? 2.8 : 3.2, opacity: 0.45, dash: "14 36", offset: 8, round: true, filter: blur }, "arcs-glow"),
      edge(out, { stroke: s.accent, width: small ? 2.4 : 2, dash: "14 36", offset: 8, round: true }, "arcs"),
    );
  }

  if (s.pulse) {
    parts.push(
      edge(out, { stroke: s.accent, width: small ? 2 : 1.7, dash: "1 2.4", round: true }, "pulse"),
      edge(out + 3.4, { stroke: s.accent, width: 0.8, opacity: 0.45 }, "pulse-outer"),
    );
  }

  if (s.slashes && !small) {
    // Косые сколы на диагоналях: у квадрата угол дальше от центра, чем у круга.
    const from = shape === "circle" ? 47 : 60;
    [45, 135, 225, 315].forEach((deg) => {
      const a = (deg * Math.PI) / 180;
      const r2 = from + ring + 9;
      parts.push(
        <line
          key={`slash-${deg}`}
          x1={C + Math.cos(a) * from}
          y1={C + Math.sin(a) * from}
          x2={C + Math.cos(a) * r2}
          y2={C + Math.sin(a) * r2}
          strokeWidth={3.6}
          strokeLinecap="round"
          style={{ stroke: s.metal[0] }}
        />,
        <line
          key={`slash-glow-${deg}`}
          x1={C + Math.cos(a) * (from + 2)}
          y1={C + Math.sin(a) * (from + 2)}
          x2={C + Math.cos(a) * (r2 - 2)}
          y2={C + Math.sin(a) * (r2 - 2)}
          strokeWidth={1}
          strokeLinecap="round"
          style={{ stroke: s.accent }}
        />,
      );
    });
  }

  if (s.candles && size >= 40) {
    // Свечи графика по нижним углам - как на рамках набора.
    const bars: [number, number][] = [
      [24, 10], [30, 16], [36, 8],
      [100, 8], [106, 16], [112, 11],
    ];
    bars.forEach(([x, h]) => {
      parts.push(
        <g key={`candle-${x}`}>
          <line x1={x} y1={128 - h - 3} x2={x} y2={130} strokeWidth={0.8} style={{ stroke: s.accent }} />
          <rect x={x - 1.8} y={128 - h} width={3.6} height={h - 1} rx={0.6} opacity={0.92} style={{ fill: s.accent }} />
        </g>,
      );
    });
  }

  if (s.crown && size >= 26) {
    parts.push(
      <g key="crown">
        <path
          d="M50 19 L52.5 4.5 L60.5 11.5 L68 1.5 L75.5 11.5 L83.5 4.5 L86 19 Z"
          strokeWidth={1}
          strokeLinejoin="round"
          stroke="rgba(0,0,0,0.55)"
          style={{ fill: metal }}
        />
        <circle cx={68} cy={13.5} r={1.9} style={{ fill: s.accent }} />
      </g>,
    );
  }

  if (rank && size >= 44) {
    // Номер места на шестиграннике, как на золоте, серебре и бронзе набора.
    const hex = Array.from({ length: 6 }, (_, i) => {
      const a = ((60 * i - 90) * Math.PI) / 180;
      return `${68 + Math.cos(a) * 12.5},${119 + Math.sin(a) * 12.5}`;
    }).join(" ");
    parts.push(
      <g key="rank">
        <polygon points={hex} stroke="rgba(0,0,0,0.6)" strokeWidth={1} style={{ fill: metal }} />
        <text x={68} y={123.8} textAnchor="middle" fontSize={13} fontWeight={800} fill="#15171a">
          {rank}
        </text>
      </g>,
    );
  } else if (s.emblem && size >= 32) {
    parts.push(
      <g key="emblem">
        <circle cx={68} cy={120} r={10} strokeWidth={1.4} style={{ fill: "#0b100d", stroke: s.accent }} />
        <path
          d="M61.6 123.4 L62.6 115.4 L65.8 118.7 L68 114 L70.2 118.7 L73.4 115.4 L74.4 123.4 Z"
          style={{ fill: s.accent }}
        />
      </g>,
    );
  }

  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${VB} ${VB}`}
      className="pointer-events-none absolute overflow-visible"
      style={{ width: box, height: box, left: (size - box) / 2, top: (size - box) / 2 }}
    >
      <defs>
        <linearGradient id={`${uid}m`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" style={{ stopColor: s.metal[0] }} />
          <stop offset="50%" style={{ stopColor: s.metal[1] }} />
          <stop offset="100%" style={{ stopColor: s.metal[2] }} />
        </linearGradient>
        <filter id={`${uid}b`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>
      {parts}
    </svg>
  );
}

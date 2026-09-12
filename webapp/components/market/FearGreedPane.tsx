"use client";

// Индекс страха и жадности.
//
// Число само по себе немо: «47» не значит ничего, пока не видно, откуда оно
// пришло. Поэтому рядом с текущим значением стоит месяц истории - на нём
// видно, рынок успокаивается или сваливается в панику, а это и есть вопрос,
// ради которого на индекс смотрят.
//
// Шкала не сплошная радуга, а пять зон с именами: индекс их и публикует, и
// именно ими о нём говорят вслух. Плавный градиент выглядел бы наряднее, но
// по нему нельзя сказать, кончился страх или ещё нет.

import { Gauge as GaugeIcon } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useEffect, useId, useState } from "react";
import { api, type FearGreedPoint } from "@/lib/api";
import Pane, { PaneLabel, type PaneState } from "./Pane";

/** Пять зон индекса: границы и названия те же, что публикует источник. */
const ZONES = [
  { upto: 25, key: "extremeFear", color: "var(--pane-down)" },
  { upto: 45, key: "fear", color: "#ff8c00" },
  { upto: 55, key: "neutral", color: "var(--pane-gold)" },
  { upto: 75, key: "greed", color: "var(--pane-up)" },
  { upto: 100, key: "extremeGreed", color: "var(--pane-accent)" },
] as const;

function zoneOf(value: number) {
  return ZONES.find((z) => value <= z.upto) ?? ZONES[ZONES.length - 1];
}

/** Значение точки числом. Источник отдаёт строки, и пустые в том числе. */
function valueOf(point: FearGreedPoint | undefined): number | null {
  if (!point) return null;
  const n = Number(point.value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Шкала индекса: дуга в 220 градусов с переходом цвета от страха к жадности.
 *
 * Разомкнутая дуга, а не кольцо: у индекса есть низ и верх, и концы шкалы
 * показывают их. Число и название зоны стоят под стрелкой, внутри дуги, -
 * как на макете. Переход цвета плавный, но зоны названы в легенде рядом:
 * по ней видно, кончился ли страх.
 */
const CX = 100;
const CY = 92;
const R = 78;
const FROM = 200;
const SWEEP = 220;

function point(deg: number, r = R): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [CX + Math.cos(a) * r, CY - Math.sin(a) * r];
}

function Gauge({ value, color, label }: { value: number; color: string; label: string }) {
  const id = useId().replace(/:/g, "");
  const [x0, y0] = point(FROM);
  const [x1, y1] = point(FROM - SWEEP);
  const needle = FROM - (SWEEP * Math.max(0, Math.min(100, value))) / 100;
  const [nx, ny] = point(needle, R - 26);

  return (
    <div className="relative w-[184px] shrink-0 pb-7">
      <svg viewBox="0 0 200 130" className="w-full" aria-hidden>
        <defs>
          <linearGradient id={`fg-${id}`} x1="0" x2="1" y1="0" y2="0">
            {ZONES.map((z, i) => (
              <stop key={z.key} offset={i / (ZONES.length - 1)} stopColor={z.color} />
            ))}
          </linearGradient>
        </defs>
        <path
          d={`M ${x0} ${y0} A ${R} ${R} 0 1 1 ${x1} ${y1}`}
          fill="none"
          stroke={`url(#fg-${id})`}
          strokeWidth={14}
          strokeLinecap="round"
        />
        {/* Тонкая внутренняя дуга - глубина шкалы, как на циферблате. */}
        <path
          d={`M ${point(FROM, R - 20).join(" ")} A ${R - 20} ${R - 20} 0 1 1 ${point(FROM - SWEEP, R - 20).join(" ")}`}
          fill="none"
          stroke="var(--pane-border)"
          strokeWidth={1}
        />
        <line x1={CX} y1={CY} x2={nx} y2={ny} stroke="var(--pane-text)" strokeWidth={3} strokeLinecap="round" />
        <circle cx={CX} cy={CY} r={5} fill="var(--pane-text)" />
      </svg>
      {/* Число - под осью стрелки, между концами дуги; название зоны - под ним. */}
      <div className="pointer-events-none absolute inset-x-0 top-[64%] text-center">
        <div className="font-mono text-[34px] font-bold leading-none tabular-nums text-[var(--pane-text)]">{value}</div>
        <div className="mt-0.5 text-[13px] font-semibold" style={{ color }}>
          {label}
        </div>
      </div>
    </div>
  );
}

/** Месяц истории столбиками: слева месяц назад, справа сегодня. */
function History({ points }: { points: FearGreedPoint[] }) {
  const t = useT();
  // Источник отдаёт от свежего к старому - разворачиваем, время идёт вправо.
  const rows = [...points].reverse();
  return (
    <div>
      <div className="flex h-10 items-end gap-[2px]">
        {rows.map((p, i) => {
          const v = valueOf(p) ?? 0;
          const zone = zoneOf(v);
          const last = i === rows.length - 1;
          return (
            <div
              key={p.timestamp || i}
              className="flex-1 rounded-[1px] transition-opacity"
              style={{
                height: `${Math.max(6, v)}%`,
                background: zone.color,
                opacity: last ? 1 : 0.85,
              }}
              title={`${v} - ${t.market.fearGreed.levels[zone.key]}`}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between">
        <PaneLabel>{t.market.fearGreed.daysAgo30}</PaneLabel>
        <PaneLabel>{t.market.fearGreed.today}</PaneLabel>
      </div>
    </div>
  );
}

/** Что было тогда: значение и насколько оно отличается от нынешнего. */
function Then({ label, now, then }: { label: string; now: number; then: number | null }) {
  if (then === null) {
    return (
      <div>
        <PaneLabel>{label}</PaneLabel>
        <div className="font-mono text-[13px] text-[var(--pane-muted)]">-</div>
      </div>
    );
  }
  const diff = now - then;
  const tone =
    diff > 0 ? "text-[var(--pane-up)]" : diff < 0 ? "text-[var(--pane-down)]" : "text-[var(--pane-muted)]";
  return (
    <div>
      <PaneLabel>{label}</PaneLabel>
      <div className="font-mono text-[13px] tabular-nums text-[var(--pane-text)]">
        {then}
        <span className={`ml-1.5 text-[11px] ${tone}`}>
          {diff > 0 ? "+" : ""}
          {diff}
        </span>
      </div>
    </div>
  );
}

export default function FearGreedPane({ className = "" }: { className?: string }) {
  const t = useT();
  const [data, setData] = useState<FearGreedPoint[]>([]);
  const [state, setState] = useState<PaneState>("loading");

  useEffect(() => {
    let dropped = false;
    api
      .marketFearGreed()
      .then((r) => {
        if (dropped) return;
        const history = r.history?.length ? r.history : r.current ? [r.current] : [];
        setData(history);
        setState(history.length ? "ready" : "error");
      })
      .catch(() => {
        if (!dropped) setState("error");
      });
    return () => {
      dropped = true;
    };
  }, []);

  const now = valueOf(data[0]);
  const zone = now === null ? null : zoneOf(now);

  return (
    <Pane
      icon={<GaugeIcon className="h-3.5 w-3.5" />}
      title={t.market.fearGreed.title}
      hint={t.market.fearGreed.hint}
      state={now === null && state !== "loading" ? "error" : state}
      emptyNote={t.market.fearGreed.emptyNote}
      className={className}
    >
      {now !== null && zone && (
        <div className="space-y-3">
          {/* Шкала с числом, рядом - все пять зон с границами, справа бык.
              Легенда нужна не для красоты: без неё «56» на шкале не говорит,
              далеко ли до жадности. */}
          <div className="flex items-center gap-4">
            <Gauge value={now} color={zone.color} label={t.market.fearGreed.levels[zone.key]} />

            <ul className="min-w-0 flex-1 space-y-1.5">
              {ZONES.map((z, i) => {
                const from = i === 0 ? 0 : ZONES[i - 1].upto + 1;
                const on = z === zone;
                return (
                  <li key={z.key} className="flex items-center gap-2 text-[11px]">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: z.color }} />
                    <span
                      className={`min-w-0 flex-1 truncate ${
                        on ? "font-semibold text-[var(--pane-text)]" : "text-[var(--pane-text-2)]"
                      }`}
                    >
                      {t.market.fearGreed.levels[z.key]}
                    </span>
                    <span className="shrink-0 font-mono tabular-nums text-[var(--pane-muted)]">
                      {from} - {z.upto}
                    </span>
                  </li>
                );
              })}
            </ul>

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/art/market/bull-geo.webp"
              alt=""
              className="art-glow pointer-events-none -my-4 hidden h-40 w-auto shrink-0 min-[1400px]:block"
            />
          </div>

          <div className="grid grid-cols-3 gap-2 border-t border-[var(--pane-border)] pt-3">
            <Then label={t.market.fearGreed.yesterday} now={now} then={valueOf(data[1])} />
            <Then label={t.market.fearGreed.weekAgo} now={now} then={valueOf(data[7])} />
            <Then label={t.market.fearGreed.monthAgo} now={now} then={valueOf(data[29])} />
          </div>

          {data.length > 2 && <History points={data} />}
        </div>
      )}
    </Pane>
  );
}

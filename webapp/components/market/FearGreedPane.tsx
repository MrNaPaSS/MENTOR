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
import { useEffect, useState } from "react";
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
 * Стрелка полукруглой шкалы.
 *
 * Полукруг, а не кольцо: у индекса есть низ и верх, и разомкнутая шкала
 * показывает их концами, а замкнутая заставляет искать, где начало.
 */
function Gauge({ value }: { value: number }) {
  const zone = zoneOf(value);
  // Ноль слева, сотня справа: полукруг проходит через верх.
  const angle = Math.PI * (1 - value / 100);
  const cx = 60;
  const cy = 56;
  const r = 44;
  const nx = cx + Math.cos(angle) * r;
  const ny = cy - Math.sin(angle) * r;

  return (
    <svg viewBox="0 0 120 66" className="w-full max-w-[168px]" aria-hidden>
      {/* Дуга по зонам: каждая своим цветом, встык. */}
      {ZONES.map((z, i) => {
        const from = i === 0 ? 0 : ZONES[i - 1].upto;
        const a0 = Math.PI * (1 - from / 100);
        const a1 = Math.PI * (1 - z.upto / 100);
        const x0 = cx + Math.cos(a0) * r;
        const y0 = cy - Math.sin(a0) * r;
        const x1 = cx + Math.cos(a1) * r;
        const y1 = cy - Math.sin(a1) * r;
        return (
          <path
            key={z.key}
            d={`M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`}
            fill="none"
            stroke={z.color}
            strokeWidth={7}
            strokeLinecap="butt"
            opacity={z === zone ? 1 : 0.28}
          />
        );
      })}
      {/* Стрелка. Тонкая: она указывает, а не спорит с дугой за внимание. */}
      <line
        x1={cx}
        y1={cy}
        x2={nx}
        y2={ny}
        stroke={zone.color}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r={3.5} fill="var(--pane-bg)" stroke={zone.color} strokeWidth={2} />
    </svg>
  );
}

/** Месяц истории столбиками: слева месяц назад, справа сегодня. */
function History({ points }: { points: FearGreedPoint[] }) {
  const t = useT();
  // Источник отдаёт от свежего к старому - разворачиваем, время идёт вправо.
  const rows = [...points].reverse();
  return (
    <div>
      <div className="flex h-12 items-end gap-[2px]">
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
                opacity: last ? 1 : 0.42,
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
        <div className="space-y-4">
          {/* Шкала с числом, рядом - все пять зон с границами, справа бык.
              Легенда нужна не для красоты: без неё «56» на шкале не говорит,
              далеко ли до жадности. */}
          <div className="flex items-center gap-4">
            <div className="flex w-[168px] shrink-0 flex-col items-center">
              <Gauge value={now} />
              <div
                className="-mt-1 font-mono text-[34px] font-bold leading-none tabular-nums"
                style={{ color: zone.color }}
              >
                {now}
              </div>
              <div className="mt-1 truncate text-[12px] font-semibold" style={{ color: zone.color }}>
                {t.market.fearGreed.levels[zone.key]}
              </div>
            </div>

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
              className="pointer-events-none -my-4 hidden h-40 w-auto shrink-0 drop-shadow-[0_10px_20px_rgba(0,0,0,0.25)] min-[1500px]:block"
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

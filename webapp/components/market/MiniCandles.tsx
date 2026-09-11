"use client";

// Свечи монеты за последние сутки-двое: картинка движения рядом с ценой.
//
// Не график терминала - без масштаба, перекрестия и уровней. Здесь нужно одно:
// видеть, откуда пришла цена на карточке. Свечи берём с той же ручки, что и
// терминал, - те же данные, что человек увидит, открыв монету.

import { useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/api";

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Высота рисунка постоянная: с шириной экрана растёт только ширина, и
 *  панель не вытягивается вниз на широком мониторе. */
const H = 118;
/** Поле справа под подписи цены. */
const AXIS = 44;
/** Высота полосы объёма внизу. */
const VOL_H = 18;
/** Свечи перечитываем раз в пять минут: часовая свеча за это время меняется мало. */
const REFRESH_MS = 5 * 60_000;

function label(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}K`;
  if (n >= 100) return n.toFixed(0);
  return n.toPrecision(4);
}

export default function MiniCandles({
  symbol,
  interval = "1h",
  limit = 48,
  className = "",
}: {
  symbol: string;
  interval?: string;
  limit?: number;
  className?: string;
}) {
  const [rows, setRows] = useState<Candle[] | null>(null);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(480);

  useEffect(() => {
    const node = box.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(240, Math.round(entry.contentRect.width))));
    ro.observe(node);
    return () => ro.disconnect();
  }, [rows]);

  useEffect(() => {
    let dropped = false;
    async function load() {
      try {
        const res = await fetch(`${API_URL}/api/scalping/klines/${symbol}?interval=${interval}&limit=${limit}`);
        if (!res.ok) throw new Error(String(res.status));
        const body: { candles: Candle[] } = await res.json();
        if (dropped) return;
        if (body.candles?.length) setRows(body.candles);
        else setFailed(true);
      } catch {
        // Биржа промолчала: прежняя картинка остаётся, а если её не было -
        // места под пустой график не держим.
        if (!dropped) setFailed(true);
      }
    }
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      dropped = true;
      clearInterval(timer);
    };
  }, [symbol, interval, limit]);

  if (!rows) {
    return failed ? null : (
      <div className={`animate-pulse rounded-lg bg-[var(--pane-hover)] ${className}`} style={{ height: H }} />
    );
  }

  const hi = Math.max(...rows.map((r) => r.high));
  const lo = Math.min(...rows.map((r) => r.low));
  const span = hi - lo || 1;
  const vmax = Math.max(...rows.map((r) => r.volume)) || 1;
  const plotW = W - AXIS;
  const plotH = H - VOL_H - 6;
  const step = plotW / rows.length;
  const body = Math.max(1.2, step * 0.62);
  const y = (p: number) => 4 + ((hi - p) / span) * (plotH - 4);
  const ticks = [0, 1 / 3, 2 / 3, 1].map((f) => hi - f * span);

  return (
    <div ref={box} className={`w-full ${className}`}>
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block w-full" role="img" aria-label={symbol}>
      {ticks.map((p) => (
        <g key={p}>
          <line x1={0} x2={plotW} y1={y(p)} y2={y(p)} stroke="var(--pane-border)" strokeWidth={0.5} strokeDasharray="2 3" />
          <text x={W - 2} y={y(p) + 3} textAnchor="end" fontSize={9} fill="var(--pane-muted)" fontFamily="ui-monospace, monospace">
            {label(p)}
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const up = r.close >= r.open;
        const color = up ? "var(--pane-up)" : "var(--pane-down)";
        const cx = i * step + step / 2;
        const top = y(Math.max(r.open, r.close));
        const bottom = y(Math.min(r.open, r.close));
        const vh = (r.volume / vmax) * VOL_H;
        return (
          <g key={r.time}>
            <line x1={cx} x2={cx} y1={y(r.high)} y2={y(r.low)} stroke={color} strokeWidth={0.8} />
            <rect x={cx - body / 2} y={top} width={body} height={Math.max(0.8, bottom - top)} fill={color} rx={0.4} />
            <rect x={cx - body / 2} y={H - vh} width={body} height={vh} fill={color} opacity={0.28} />
          </g>
        );
      })}
    </svg>
    </div>
  );
}

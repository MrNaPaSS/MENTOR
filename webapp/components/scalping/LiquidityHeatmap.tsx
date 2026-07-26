"use client";

import { useEffect, useRef } from "react";
import type { DomSnapshot } from "@/lib/api";

interface Props {
  /** Хронология снимков стакана, старые слева. */
  history: DomSnapshot[];
  height?: number;
}

/** Диапазон цен по всей истории — общая вертикальная шкала для всех колонок. */
export function priceBounds(history: DomSnapshot[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const snap of history) {
    for (const l of snap.bids) {
      if (l.price < min) min = l.price;
      if (l.price > max) max = l.price;
    }
    for (const l of snap.asks) {
      if (l.price < min) min = l.price;
      if (l.price > max) max = l.price;
    }
  }
  if (!isFinite(min) || !isFinite(max) || min === max) return { min: 0, max: 0 };
  return { min, max };
}

/** Максимальный объём уровня по всей истории — нормировка яркости. */
export function maxLevelSize(history: DomSnapshot[]): number {
  let max = 0;
  for (const snap of history) {
    for (const l of snap.bids) if (l.size > max) max = l.size;
    for (const l of snap.asks) if (l.size > max) max = l.size;
  }
  return max;
}

export default function LiquidityHeatmap({ history, height = 260 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const w = canvas.clientWidth;
    const h = height;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = "#0B0E11";
    ctx.fillRect(0, 0, w, h);

    if (history.length === 0) return;

    const { min, max } = priceBounds(history);
    const peak = maxLevelSize(history);
    if (max <= min || peak <= 0) return;

    const colW = w / history.length;
    const yOf = (price: number) => h - ((price - min) / (max - min)) * h;

    history.forEach((snap, i) => {
      const x = i * colW;
      // Высота ячейки — один шаг агрегации; плюс пиксель, чтобы не было щелей.
      const cellH = Math.max(1, (snap.tick / (max - min)) * h + 1);

      const paint = (levels: typeof snap.bids, rgb: string) => {
        for (const l of levels) {
          // Корень сглаживает разброс: иначе одна плита гасит всю остальную карту.
          const alpha = Math.min(1, Math.sqrt(l.size / peak));
          ctx.fillStyle = `rgba(${rgb}, ${alpha.toFixed(3)})`;
          ctx.fillRect(x, yOf(l.price) - cellH / 2, Math.max(1, colW), cellH);
        }
      };

      paint(snap.bids, "14, 203, 129");
      paint(snap.asks, "246, 70, 93");
    });

    // Линия средней цены поверх карты плотности.
    ctx.strokeStyle = "rgba(234, 236, 239, 0.85)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    history.forEach((snap, i) => {
      const x = i * colW + colW / 2;
      const y = yOf(snap.mid);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [history, height]);

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-bg-deep">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5">
        <span className="text-[10px] uppercase tracking-wider text-text-muted">
          Карта ликвидности
        </span>
        <span className="text-[10px] text-text-muted">
          {history.length > 0 ? `${history.length} снимков` : "накопление…"}
        </span>
      </div>
      <canvas ref={canvasRef} style={{ width: "100%", height }} data-testid="heatmap-canvas" />
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { TrendingUp } from "lucide-react";

/**
 * Премиальный живой свечной график для Hero (canvas 2D).
 * Стриминг свечей, тики цены в реальном времени, неоновое свечение, градиентная заливка,
 * сетка и лайв-ценник. DPR-aware, учитывает prefers-reduced-motion.
 */

interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
}

const COUNT = 44;
const TF = ["15m", "1H", "4H"] as const;

function seedCandles(base: number): Candle[] {
  const out: Candle[] = [];
  let price = base;
  for (let i = 0; i < COUNT; i++) {
    const o = price;
    const drift = (Math.random() - 0.48) * base * 0.012;
    const c = Math.max(o + drift, base * 0.5);
    const h = Math.max(o, c) + Math.random() * base * 0.006;
    const l = Math.min(o, c) - Math.random() * base * 0.006;
    out.push({ o, h, l, c });
    price = c;
  }
  return out;
}

export default function HeroChart() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [price, setPrice] = useState(0);
  const [changePct, setChangePct] = useState(0);
  const [tf, setTf] = useState<(typeof TF)[number]>("15m");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Не-null ссылки (hoisted-функции ниже теряют сужение типа).
    const cv = canvas as HTMLCanvasElement;
    const g = ctx as CanvasRenderingContext2D;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const BASE = 64000;
    let candles = seedCandles(BASE);
    let current = candles[candles.length - 1].c;
    const first = candles[0].o;
    let tickAccum = 0;

    let width = 0;
    let height = 0;
    function resize() {
      const rect = cv.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      cv.width = Math.floor(width * dpr);
      cv.height = Math.floor(height * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    const PAD_R = 58; // место под ценовую шкалу
    const PAD_Y = 16;

    function draw() {
      const data = candles;
      let min = Infinity;
      let max = -Infinity;
      for (const c of data) {
        if (c.l < min) min = c.l;
        if (c.h > max) max = c.h;
      }
      const range = max - min || 1;
      min -= range * 0.08;
      max += range * 0.08;
      const span = max - min;

      const plotW = width - PAD_R;
      const x = (i: number) => (i / (COUNT - 1)) * (plotW - 8) + 4;
      const y = (p: number) => PAD_Y + (1 - (p - min) / span) * (height - PAD_Y * 2);

      g.clearRect(0, 0, width, height);

      // Сетка
      g.strokeStyle = "rgba(255,255,255,0.05)";
      g.lineWidth = 1;
      g.font = "10px 'JetBrains Mono', monospace";
      g.fillStyle = "rgba(160,170,190,0.55)";
      g.textBaseline = "middle";
      for (let gi = 0; gi <= 4; gi++) {
        const gy = PAD_Y + (gi / 4) * (height - PAD_Y * 2);
        g.beginPath();
        g.moveTo(0, gy);
        g.lineTo(plotW, gy);
        g.stroke();
        const gp = max - (gi / 4) * span;
        g.fillText(gp.toFixed(0), plotW + 8, gy);
      }

      // Градиентная заливка под линией закрытий
      const grad = g.createLinearGradient(0, PAD_Y, 0, height);
      grad.addColorStop(0, "rgba(10,255,224,0.22)");
      grad.addColorStop(1, "rgba(10,255,224,0)");
      g.beginPath();
      g.moveTo(x(0), y(data[0].c));
      for (let i = 1; i < COUNT; i++) g.lineTo(x(i), y(data[i].c));
      g.lineTo(x(COUNT - 1), height);
      g.lineTo(x(0), height);
      g.closePath();
      g.fillStyle = grad;
      g.fill();

      // Линия закрытий с неоновым свечением
      g.beginPath();
      g.moveTo(x(0), y(data[0].c));
      for (let i = 1; i < COUNT; i++) g.lineTo(x(i), y(data[i].c));
      g.strokeStyle = "rgba(10,255,224,0.85)";
      g.lineWidth = 1.6;
      g.shadowColor = "rgba(10,255,224,0.7)";
      g.shadowBlur = 10;
      g.stroke();
      g.shadowBlur = 0;

      // Свечи
      const cw = Math.max((plotW / COUNT) * 0.55, 2);
      for (let i = 0; i < COUNT; i++) {
        const c = data[i];
        const up = c.c >= c.o;
        const col = up ? "#00D4A0" : "#FF4757";
        const cx = x(i);
        // фитиль
        g.strokeStyle = col;
        g.globalAlpha = 0.5 + (i / COUNT) * 0.5;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(cx, y(c.h));
        g.lineTo(cx, y(c.l));
        g.stroke();
        // тело
        const yo = y(c.o);
        const yc = y(c.c);
        const top = Math.min(yo, yc);
        const bh = Math.max(Math.abs(yc - yo), 1);
        g.fillStyle = col;
        if (i === COUNT - 1) {
          g.shadowColor = col;
          g.shadowBlur = 12;
        }
        g.fillRect(cx - cw / 2, top, cw, bh);
        g.shadowBlur = 0;
      }
      g.globalAlpha = 1;

      // Лайв-цена: пунктирная линия + ценник
      const cy = y(current);
      g.setLineDash([4, 4]);
      g.strokeStyle = "rgba(255,215,0,0.55)";
      g.beginPath();
      g.moveTo(0, cy);
      g.lineTo(plotW, cy);
      g.stroke();
      g.setLineDash([]);

      g.fillStyle = "#FFD700";
      const label = current.toFixed(0);
      const lw = g.measureText(label).width + 12;
      g.fillRect(plotW + 2, cy - 9, Math.min(lw, PAD_R - 4), 18);
      g.fillStyle = "#0A0A1A";
      g.textBaseline = "middle";
      g.fillText(label, plotW + 8, cy + 1);

      // Точка последней цены с пульсацией
      g.beginPath();
      g.fillStyle = "#0AFFE0";
      g.shadowColor = "#0AFFE0";
      g.shadowBlur = 14;
      g.arc(x(COUNT - 1), y(current), 3, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
    }

    function tick(dtMs: number) {
      // Живой тик последней свечи
      const last = candles[candles.length - 1];
      const vol = BASE * 0.0009;
      current += (Math.random() - 0.5) * vol;
      last.c = current;
      last.h = Math.max(last.h, current);
      last.l = Math.min(last.l, current);

      tickAccum += dtMs;
      if (tickAccum > 1400) {
        tickAccum = 0;
        candles = [...candles.slice(1), { o: current, h: current, l: current, c: current }];
      }
      setPrice(current);
      setChangePct(((current - first) / first) * 100);
    }

    let raf = 0;
    let prev = performance.now();
    function loop(now: number) {
      raf = requestAnimationFrame(loop);
      const dt = now - prev;
      prev = now;
      if (!reduce) tick(dt);
      draw();
    }

    if (reduce) {
      setPrice(current);
      setChangePct(((current - first) / first) * 100);
      draw();
    } else {
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  const up = changePct >= 0;

  return (
    <div className="glass overflow-hidden rounded-2xl">
      {/* Шапка терминала */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent-cyan/15 text-accent-cyan ring-1 ring-accent-cyan/30">
            <TrendingUp className="h-4 w-4" />
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-white">BTCUSDT</div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted">Perpetual</div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-base font-bold text-white tabular">
            {price ? price.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—"}
            <span className="text-text-muted"> $</span>
          </div>
          <div className={`text-xs font-semibold ${up ? "text-success" : "text-danger"}`}>
            {up ? "▲" : "▼"} {Math.abs(changePct).toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Таймфреймы */}
      <div className="flex items-center gap-1 px-4 pt-3">
        {TF.map((t) => (
          <button
            key={t}
            onClick={() => setTf(t)}
            className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
              tf === t ? "bg-accent-cyan/15 text-accent-cyan" : "text-text-muted hover:text-white"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Холст графика */}
      <canvas ref={canvasRef} aria-hidden className="h-[260px] w-full md:h-[300px]" />
    </div>
  );
}

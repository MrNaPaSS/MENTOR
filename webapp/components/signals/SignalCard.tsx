"use client";

import { useEffect, useRef, useState } from "react";
import { TrendingUp, TrendingDown, CandlestickChart, ExternalLink, ArrowLeft } from "lucide-react";
import { SignalOut } from "@/lib/api";
import { fmtUsd, isLong } from "@/lib/format";
import TradingChart from "@/components/market/TradingChart";
import OrderBook from "@/components/market/OrderBook";

function tvImageUrl(url: string): string | null {
  const m = url.match(/tradingview\.com\/x\/([A-Za-z0-9]+)/);
  if (!m) return null;
  const id = m[1];
  return `https://s3.tradingview.com/snapshots/${id[0].toLowerCase()}/${id}.png`;
}

interface CalcResult {
  margin: number;
  position: number;
  risk: number;
  tp1_profit: number;
  tp2_profit: number;
  tp3_profit: number;
  rr1: number;
}

function calcPosition(signal: SignalOut, balance: number): CalcResult | null {
  if (!balance || !signal.entry_price) return null;
  const entry = parseFloat(signal.entry_price);
  const sl = parseFloat(signal.stop_loss || "0");
  const tp1 = parseFloat(signal.tp1 || "0");
  const tp2 = parseFloat(signal.tp2 || "0");
  const tp3 = parseFloat(signal.tp3 || "0");
  if (!entry || !sl) return null;

  const riskPct = 0.02;
  const margin = balance * riskPct;
  const position = margin * signal.leverage;
  const slDist = Math.abs(entry - sl) / entry;
  const risk = position * slDist;

  const tp1Dist = tp1 ? Math.abs(tp1 - entry) / entry : 0;
  const tp2Dist = tp2 ? Math.abs(tp2 - entry) / entry : 0;
  const tp3Dist = tp3 ? Math.abs(tp3 - entry) / entry : 0;

  return {
    margin,
    position,
    risk,
    tp1_profit: position * tp1Dist,
    tp2_profit: position * tp2Dist,
    tp3_profit: position * tp3Dist,
    rr1: slDist ? tp1Dist / slDist : 0,
  };
}

/** Горизонтальная шкала: SL → Entry → TP с подписями под маркерами. */
function PriceTrack({ signal, currentPrice }: { signal: SignalOut; currentPrice?: number }) {
  const entry = parseFloat(signal.entry_price);
  const sl = parseFloat(signal.stop_loss || "0");
  const tp3val = parseFloat(signal.tp3 || signal.tp2 || signal.tp1 || "0");
  if (!sl || !tp3val) return null;

  const min = Math.min(sl, entry, tp3val) * 0.9992;
  const max = Math.max(sl, entry, tp3val) * 1.0008;
  const range = max - min;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - min) / range) * 100));

  const cur = currentPrice || entry;
  const longDir = isLong(signal.direction);
  const curVsEntry = ((cur - entry) / entry) * 100;

  const slPct = pct(sl);
  const entryPct = pct(entry);
  const tp3Pct = pct(tp3val);
  const curPct = pct(cur);

  return (
    <div className="space-y-2.5 pt-1">
      {/* Track */}
      <div className="relative h-2 rounded-full bg-white/[0.04]">
        {/* Loss zone */}
        {longDir ? (
          <div className="absolute inset-y-0 left-0 rounded-l-full bg-danger/25" style={{ width: `${entryPct}%` }} />
        ) : (
          <div className="absolute inset-y-0 right-0 rounded-r-full bg-danger/25" style={{ width: `${100 - entryPct}%` }} />
        )}
        {/* Profit zone */}
        {longDir ? (
          <div className="absolute inset-y-0 bg-gradient-to-r from-success/30 to-accent-cyan/35" style={{ left: `${entryPct}%`, width: `${tp3Pct - entryPct}%` }} />
        ) : (
          <div className="absolute inset-y-0 bg-gradient-to-l from-success/30 to-accent-cyan/35" style={{ left: `${tp3Pct}%`, width: `${entryPct - tp3Pct}%` }} />
        )}

        {/* Markers */}
        <Dot pos={slPct} className="bg-danger ring-danger/30" />
        <Dot pos={entryPct} className="bg-white ring-white/30" />
        <Dot pos={tp3Pct} className="bg-accent-cyan ring-accent-cyan/30" />

        {/* Current price marker */}
        <div
          className="absolute top-1/2 z-10 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg-panel bg-white shadow-[0_0_8px_rgba(255,255,255,0.5)] transition-all duration-500"
          style={{ left: `${curPct}%` }}
        />
      </div>

      {/* Labels under markers */}
      <div className="relative h-9 text-[10px] font-mono">
        <Label pos={slPct} value={fmtUsd(sl, 4)} caption="SL" tone="text-danger" />
        <Label
          pos={entryPct}
          value={fmtUsd(entry, 4)}
          caption={`${curVsEntry >= 0 ? "+" : ""}${curVsEntry.toFixed(2)}%`}
          tone="text-white/80"
          captionTone={curVsEntry >= 0 ? "text-success" : "text-danger"}
        />
        <Label pos={tp3Pct} value={fmtUsd(tp3val, 4)} caption="TP" tone="text-accent-cyan" />
      </div>
    </div>
  );
}

function Dot({ pos, className }: { pos: number; className: string }) {
  return (
    <div
      className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ${className}`}
      style={{ left: `${pos}%` }}
    />
  );
}

function Label({
  pos,
  value,
  caption,
  tone,
  captionTone,
}: {
  pos: number;
  value: string;
  caption: string;
  tone: string;
  captionTone?: string;
}) {
  const align = pos < 12 ? "left-0 items-start" : pos > 88 ? "right-0 items-end" : "-translate-x-1/2 items-center";
  const style = pos < 12 ? { left: 0 } : pos > 88 ? { right: 0 } : { left: `${pos}%` };
  return (
    <div className={`absolute flex flex-col ${align}`} style={style}>
      <span className={`font-bold ${tone}`}>{value}</span>
      <span className={`text-[9px] font-semibold uppercase tracking-wider ${captionTone ?? "text-white/30"}`}>
        {caption}
      </span>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-3">
      <span className="text-[8px] font-semibold uppercase tracking-[0.15em] text-white/30">{label}</span>
      <span className={`font-mono text-[13px] font-bold tabular-nums ${tone}`}>{value}</span>
    </div>
  );
}

const BACK_HEIGHT = 620; // высота развёрнутого экрана график+стакан

interface Props {
  signal: SignalOut;
  balance?: number;
  currentPrice?: number;
}

export default function SignalCard({ signal: s, balance = 1000, currentPrice }: Props) {
  const [flipped, setFlipped] = useState(false);
  const [everFlipped, setEverFlipped] = useState(false); // ленивая загрузка тяжёлых виджетов
  const [frontH, setFrontH] = useState<number>();
  const frontRef = useRef<HTMLDivElement>(null);

  const calc = calcPosition(s, balance);
  const long = isLong(s.direction);
  const active = s.status === "active";
  const DirectionIcon = long ? TrendingUp : TrendingDown;
  const bestProfit = calc ? calc.tp3_profit || calc.tp2_profit || calc.tp1_profit : 0;

  // Меряем высоту лицевой стороны, чтобы плавно анимировать переворот к/от большого экрана
  useEffect(() => {
    const el = frontRef.current;
    if (!el) return;
    const update = () => setFrontH(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function openChart() {
    setEverFlipped(true);
    setFlipped(true);
  }

  return (
    <div style={{ perspective: "1800px" }}>
      <div
        className="relative"
        style={{
          transformStyle: "preserve-3d",
          height: frontH ? (flipped ? BACK_HEIGHT : frontH) : undefined,
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
          transition: "transform 700ms cubic-bezier(.22,.68,.16,1), height 700ms cubic-bezier(.22,.68,.16,1)",
        }}
      >
        {/* ── ЛИЦЕВАЯ СТОРОНА — сигнал ─────────────────────────── */}
        <div ref={frontRef} style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}>
          <div
            className={`group relative overflow-hidden rounded-2xl border bg-[#0f1318] transition-colors duration-300 ${
              active
                ? "border-white/[0.08] shadow-[0_4px_24px_rgba(0,0,0,0.45)] hover:border-white/[0.16]"
                : "border-white/[0.05] opacity-55"
            }`}
          >
            {/* Accent line */}
            <div className={`h-px w-full ${long ? "bg-gradient-to-r from-transparent via-success/50 to-transparent" : "bg-gradient-to-r from-transparent via-danger/50 to-transparent"}`} />

            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-3.5 pb-3">
              <div className="flex items-center gap-3">
                <div
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${
                    long ? "border-success/25 bg-success/[0.12] text-success" : "border-danger/25 bg-danger/[0.12] text-danger"
                  }`}
                >
                  <DirectionIcon className="h-3.5 w-3.5" strokeWidth={2.5} />
                  {s.direction}
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="font-mono text-[17px] font-extrabold tracking-tight text-white">{s.symbol}</span>
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-white/30">Плечо ×{s.leverage}</span>
                </div>
              </div>
              <div
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                  active ? "border-success/20 bg-success/[0.08] text-success" : "border-white/[0.08] bg-white/[0.03] text-white/30"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-success shadow-[0_0_6px] shadow-success/70" : "bg-white/30"}`} />
                {active ? "Live" : "Closed"}
              </div>
            </div>

            <div className="space-y-3.5 px-4 pb-4">
              {/* Snapshot */}
              {s.chart_url && tvImageUrl(s.chart_url) && (
                <a href={s.chart_url} target="_blank" rel="noopener noreferrer">
                  <img
                    src={tvImageUrl(s.chart_url)!}
                    alt="chart"
                    className="max-h-44 w-full rounded-xl border border-white/[0.06] object-cover transition-colors hover:border-white/[0.14]"
                  />
                </a>
              )}

              <PriceTrack signal={s} currentPrice={currentPrice} />

              {/* Levels */}
              <div className="grid grid-cols-4 divide-x divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.015]">
                <Metric label="Вход" value={s.entry_price ? fmtUsd(parseFloat(s.entry_price), 4) : "-"} tone="text-white" />
                <Metric label="Стоп" value={s.stop_loss ? fmtUsd(parseFloat(s.stop_loss), 4) : "-"} tone="text-danger" />
                <Metric label="TP1" value={s.tp1 ? fmtUsd(parseFloat(s.tp1), 4) : "-"} tone="text-success" />
                <Metric label="TP2/3" value={(s.tp3 || s.tp2) ? fmtUsd(parseFloat(s.tp3 || s.tp2!), 4) : "-"} tone="text-accent-cyan" />
              </div>

              {/* Calc */}
              {calc && (
                <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.015]">
                  <div className="grid grid-cols-3 divide-x divide-white/[0.05]">
                    <Metric label="Маржа" value={`$${calc.margin.toFixed(0)}`} tone="text-white/80" />
                    <Metric label="Риск" value={`−$${calc.risk.toFixed(0)}`} tone="text-danger" />
                    <Metric
                      label={calc.tp3_profit > 0 ? "Профит TP3" : calc.tp2_profit > 0 ? "Профит TP2" : "Профит TP1"}
                      value={`+$${bestProfit.toFixed(0)}`}
                      tone="text-success"
                    />
                  </div>
                  <div className="flex items-center justify-between border-t border-white/[0.05] bg-white/[0.01] px-4 py-2.5">
                    <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">Risk / Reward</span>
                    <span className="bg-gradient-to-r from-accent-gold to-yellow-300 bg-clip-text font-mono text-sm font-black text-transparent">
                      1 : {calc.rr1.toFixed(1)}
                    </span>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-0.5">
                <a
                  href={`https://www.weex.com/ru/futures/${s.symbol}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent-cyan py-2.5 text-[12px] font-bold tracking-wide text-bg-deep transition-all duration-200 hover:brightness-110"
                >
                  Войти в сделку
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <button
                  onClick={openChart}
                  title="Открыть график и стакан"
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-white/[0.02] px-3.5 py-2.5 text-[12px] font-semibold text-white/50 ring-1 ring-inset ring-white/[0.07] transition-all duration-150 hover:text-white/80 hover:ring-white/[0.16]"
                >
                  <CandlestickChart className="h-3.5 w-3.5" />
                  График
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── ОБРАТНАЯ СТОРОНА — большой график (Heikin-Ashi) + стакан ── */}
        <div
          className="absolute inset-0"
          style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
        >
          <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0b0e11] shadow-[0_8px_36px_rgba(0,0,0,0.6)]">
            {/* Шапка с кнопкой назад */}
            <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-3 py-2.5">
              <button
                onClick={() => setFlipped(false)}
                className="flex items-center gap-1.5 rounded-lg bg-white/[0.04] px-3 py-1.5 text-[12px] font-semibold text-white/70 ring-1 ring-inset ring-white/[0.08] transition hover:bg-white/[0.08] hover:text-white"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Назад
              </button>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-extrabold text-white">{s.symbol}</span>
                <span
                  className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                    long ? "border-success/25 bg-success/[0.1] text-success" : "border-danger/25 bg-danger/[0.1] text-danger"
                  }`}
                >
                  <DirectionIcon className="h-3 w-3" strokeWidth={2.5} />
                  {s.direction}
                </span>
              </div>
              <span className="rounded-md border border-accent-cyan/25 bg-accent-cyan/[0.08] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent-cyan">
                Heikin-Ashi
              </span>
            </div>

            {/* График (свечи Heikin-Ashi) */}
            <div className="h-[360px] shrink-0">
              {everFlipped && (
                <TradingChart symbol={s.symbol} interval="15" height={360} chartStyle="8" showToolbar />
              )}
            </div>

            {/* Стакан */}
            <div className="flex min-h-0 flex-1 flex-col border-t border-white/[0.07]">
              <div className="flex shrink-0 items-center justify-between px-4 py-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Стакан цен</span>
                <span className="font-mono text-[10px] text-text-muted">{s.symbol}</span>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {everFlipped && <OrderBook symbol={s.symbol} rows={12} compact />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

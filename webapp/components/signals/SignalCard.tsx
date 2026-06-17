"use client";

import { useState } from "react";

function tvImageUrl(url: string): string | null {
  const m = url.match(/tradingview\.com\/x\/([A-Za-z0-9]+)/);
  if (!m) return null;
  const id = m[1];
  return `https://s3.tradingview.com/snapshots/${id[0].toLowerCase()}/${id}.png`;
}

import { TrendingUp, TrendingDown, AreaChart, Layers, ExternalLink } from "lucide-react";
import { SignalOut } from "@/lib/api";
import { fmtUsd, isLong, modeLabel } from "@/lib/format";
import TradingChartWidget from "@/components/market/TradingChartWidget";
import OrderBook from "@/components/market/OrderBook";
import Link from "next/link";

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
    rr1: tp1Dist / slDist,
  };
}

function PriceTrack({ signal, currentPrice }: { signal: SignalOut; currentPrice?: number }) {
  const entry = parseFloat(signal.entry_price);
  const sl = parseFloat(signal.stop_loss || "0");
  const tp3val = parseFloat(signal.tp3 || signal.tp2 || signal.tp1 || "0");
  if (!sl || !tp3val) return null;

  const min = Math.min(sl, entry, tp3val) * 0.9995;
  const max = Math.max(sl, entry, tp3val) * 1.0005;
  const range = max - min;
  const pct = (v: number) => ((v - min) / range) * 100;

  const cur = currentPrice || entry;
  const curPct = Math.max(0, Math.min(100, pct(cur)));
  const longDir = isLong(signal.direction);
  const curVsEntry = ((cur - entry) / entry) * 100;

  const slPct = pct(sl);
  const entryPct = pct(entry);
  const tp3Pct = pct(tp3val);

  return (
    <div className="space-y-2">
      {/* Track */}
      <div className="relative h-7 rounded-xl overflow-hidden bg-white/[0.03] border border-white/[0.06]">
        {/* Loss zone */}
        {longDir ? (
          <div className="absolute inset-y-0 left-0 bg-danger/[0.15]" style={{ width: `${entryPct}%` }} />
        ) : (
          <div className="absolute inset-y-0 right-0 bg-danger/[0.15]" style={{ width: `${100 - entryPct}%` }} />
        )}
        {/* Profit zone */}
        {longDir ? (
          <div className="absolute inset-y-0 bg-success/[0.12]" style={{ left: `${entryPct}%`, width: `${tp3Pct - entryPct}%` }} />
        ) : (
          <div className="absolute inset-y-0 bg-success/[0.12]" style={{ left: `${tp3Pct}%`, width: `${entryPct - tp3Pct}%` }} />
        )}

        {/* SL vertical */}
        <div className="absolute inset-y-0 w-[2px] bg-danger/60" style={{ left: `${slPct}%` }} />
        {/* Entry vertical */}
        <div className="absolute inset-y-0 w-[2px] bg-white/50" style={{ left: `${entryPct}%` }} />
        {/* TP verticals */}
        {signal.tp1 && (
          <div className="absolute inset-y-0 w-px bg-success/45" style={{ left: `${pct(parseFloat(signal.tp1))}%` }} />
        )}
        {signal.tp2 && (
          <div className="absolute inset-y-0 w-px bg-success/55" style={{ left: `${pct(parseFloat(signal.tp2))}%` }} />
        )}
        {signal.tp3 && (
          <div className="absolute inset-y-0 w-px bg-accent-cyan/60" style={{ left: `${pct(parseFloat(signal.tp3))}%` }} />
        )}

        {/* Current price bar */}
        <div
          className="absolute inset-y-0 w-[3px] rounded-sm transition-all duration-500 shadow-[0_0_6px_rgba(255,255,255,0.6)] bg-white"
          style={{ left: `${curPct}%`, transform: "translateX(-50%)" }}
        />

        {/* Zone text labels */}
        <div className="absolute inset-0 flex items-center justify-between px-2.5 pointer-events-none select-none">
          <span className="text-[9px] font-bold tracking-wider text-danger/60 uppercase">SL</span>
          <span className="text-[9px] font-bold tracking-wider text-white/30 uppercase">Entry</span>
          <span className="text-[9px] font-bold tracking-wider text-accent-cyan/60 uppercase">TP</span>
        </div>
      </div>

      {/* Price row below track */}
      <div className="flex items-center justify-between font-mono text-[10px]">
        <span className="text-danger font-bold">{fmtUsd(sl, 2)}</span>
        <span className="flex items-center gap-1 text-white/50">
          {fmtUsd(cur, 2)}
          <span className={`text-[9px] font-semibold ${curVsEntry >= 0 ? "text-success" : "text-danger"}`}>
            {curVsEntry >= 0 ? "+" : ""}{curVsEntry.toFixed(2)}%
          </span>
        </span>
        <span className="text-accent-cyan font-bold">{fmtUsd(tp3val, 2)}</span>
      </div>
    </div>
  );
}

interface Props {
  signal: SignalOut;
  balance?: number;
  currentPrice?: number;
  showChart?: boolean;
  showBook?: boolean;
  linkToDetail?: boolean;
}

export default function SignalCard({
  signal: s,
  balance = 1000,
  currentPrice,
  showChart = false,
  showBook = false,
  linkToDetail = true,
}: Props) {
  const [chartOpen, setChartOpen] = useState(showChart);
  const [bookOpen, setBookOpen] = useState(showBook);
  const calc = calcPosition(s, balance);
  const long = isLong(s.direction);
  const active = s.status === "active";
  const DirectionIcon = long ? TrendingUp : TrendingDown;

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border transition-all duration-300 ${
        active
          ? "border-white/[0.08] bg-[#0f1318] shadow-[0_4px_24px_rgba(0,0,0,0.5)] hover:border-white/[0.14] hover:shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
          : "border-white/[0.05] bg-[#0c0f13]/70 opacity-60"
      }`}
    >
      {/* Top direction banner */}
      <div
        className={`relative flex items-center justify-between px-4 py-3 ${
          long
            ? "bg-gradient-to-r from-success/[0.14] via-success/[0.06] to-transparent"
            : "bg-gradient-to-r from-danger/[0.14] via-danger/[0.06] to-transparent"
        }`}
      >
        {/* Direction + Symbol */}
        <div className="flex items-center gap-3">
          <div
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-bold text-xs tracking-widest uppercase border ${
              long
                ? "bg-success/[0.12] text-success border-success/25"
                : "bg-danger/[0.12] text-danger border-danger/25"
            }`}
          >
            <DirectionIcon className="h-3 w-3" strokeWidth={2.5} />
            {s.direction}
          </div>
          <span className="font-mono text-[17px] font-extrabold tracking-tight text-white leading-none">
            {s.symbol}
          </span>
        </div>

        {/* Meta chips */}
        <div className="flex items-center gap-1.5">
          <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] font-bold text-white/70">
            ×{s.leverage}
          </span>
          <span className="rounded-md border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/40">
            {modeLabel(s.target_audience)}
          </span>
          <span
            className={`rounded-md px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border ${
              active
                ? "bg-success/[0.10] text-success border-success/20"
                : "bg-white/[0.04] text-white/30 border-white/8"
            }`}
          >
            {active ? "Live" : "Closed"}
          </span>
        </div>
      </div>

      <div className="p-4 space-y-3.5">
        {/* TradingView chart snapshot */}
        {s.chart_url && tvImageUrl(s.chart_url) && (
          <a href={s.chart_url} target="_blank" rel="noopener noreferrer">
            <img
              src={tvImageUrl(s.chart_url)!}
              alt="chart"
              className="w-full rounded-xl border border-white/[0.06] object-cover max-h-44 hover:border-white/[0.14] transition-colors"
            />
          </a>
        )}

        {/* Price track */}
        <PriceTrack signal={s} currentPrice={currentPrice} />

        {/* Price levels grid */}
        <div className="grid grid-cols-4 gap-0 rounded-xl overflow-hidden border border-white/[0.06]">
          {[
            { label: "Вход", value: s.entry_price, cls: "text-white" },
            { label: "Стоп", value: s.stop_loss, cls: "text-danger" },
            { label: "TP1", value: s.tp1, cls: "text-success" },
            { label: "TP2/3", value: s.tp3 || s.tp2, cls: "text-accent-cyan" },
          ].map((item, idx) => (
            <div
              key={item.label}
              className={`flex flex-col items-center py-2.5 px-1 bg-white/[0.02] hover:bg-white/[0.04] transition-colors ${
                idx < 3 ? "border-r border-white/[0.05]" : ""
              }`}
            >
              <span className="text-[8px] font-semibold uppercase tracking-widest text-white/30 mb-1">
                {item.label}
              </span>
              <span className={`font-mono text-[11px] font-bold tabular-nums ${item.cls}`}>
                {item.value ? fmtUsd(parseFloat(item.value), 2) : "-"}
              </span>
            </div>
          ))}
        </div>

        {/* Calc row */}
        {calc && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
            {/* Top row: margin / risk / profit */}
            <div className="grid grid-cols-3 divide-x divide-white/[0.05]">
              <div className="flex flex-col items-center py-2.5 px-2">
                <span className="text-[8px] font-semibold uppercase tracking-widest text-white/30 mb-1">Маржа</span>
                <span className="font-mono text-[11px] font-bold text-white/80 tabular-nums">
                  ${calc.margin.toFixed(0)}
                </span>
              </div>
              <div className="flex flex-col items-center py-2.5 px-2">
                <span className="text-[8px] font-semibold uppercase tracking-widest text-white/30 mb-1">Риск</span>
                <span className="font-mono text-[11px] font-bold text-danger tabular-nums">
                  −${calc.risk.toFixed(1)}
                </span>
              </div>
              <div className="flex flex-col items-center py-2.5 px-2">
                <span className="text-[8px] font-semibold uppercase tracking-widest text-white/30 mb-1">
                  {calc.tp3_profit > 0 ? "TP3 +" : calc.tp2_profit > 0 ? "TP2 +" : "TP1 +"}
                </span>
                <span className="font-mono text-[11px] font-bold text-success tabular-nums">
                  ${(calc.tp3_profit || calc.tp2_profit || calc.tp1_profit).toFixed(0)}
                </span>
              </div>
            </div>

            {/* Bottom: RR ratio */}
            <div className="flex items-center justify-between border-t border-white/[0.05] px-4 py-2">
              <span className="text-[9px] font-semibold uppercase tracking-widest text-white/25">
                Risk / Reward
              </span>
              <span className="font-mono text-sm font-black bg-gradient-to-r from-accent-gold to-yellow-300 bg-clip-text text-transparent">
                1 : {calc.rr1.toFixed(1)}
              </span>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 pt-0.5">
          {linkToDetail && (
            <Link
              href={`/app/signals/detail?id=${s.id}`}
              className="flex items-center justify-center gap-1.5 flex-1 rounded-xl border border-accent-cyan/20 bg-accent-cyan/[0.06] py-2 text-[11px] font-bold tracking-wide text-accent-cyan transition-all duration-200 hover:border-accent-cyan/40 hover:bg-accent-cyan/[0.12] hover:shadow-[0_0_12px_rgba(10,255,224,0.12)]"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Детали
            </Link>
          )}
          <button
            onClick={() => setChartOpen(!chartOpen)}
            className={`flex items-center justify-center gap-1.5 rounded-xl border py-2 px-3 text-[11px] font-semibold transition-all duration-150 ${
              chartOpen
                ? "border-accent-cyan/30 bg-accent-cyan/[0.08] text-accent-cyan"
                : "border-white/[0.08] bg-white/[0.02] text-white/40 hover:border-white/[0.14] hover:text-white/70"
            }`}
          >
            <AreaChart className="h-3.5 w-3.5" />
            График
          </button>
          <button
            onClick={() => setBookOpen(!bookOpen)}
            className={`flex items-center justify-center gap-1.5 rounded-xl border py-2 px-3 text-[11px] font-semibold transition-all duration-150 ${
              bookOpen
                ? "border-accent-cyan/30 bg-accent-cyan/[0.08] text-accent-cyan"
                : "border-white/[0.08] bg-white/[0.02] text-white/40 hover:border-white/[0.14] hover:text-white/70"
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            Стакан
          </button>
        </div>

        {/* Expandable chart */}
        {chartOpen && (
          <div className="overflow-hidden rounded-xl border border-white/[0.08]">
            <TradingChartWidget symbol={s.symbol} height={240} compact />
          </div>
        )}

        {/* Expandable orderbook */}
        {bookOpen && (
          <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-bg-panel">
            <OrderBook symbol={s.symbol} rows={10} compact />
          </div>
        )}
      </div>
    </div>
  );
}

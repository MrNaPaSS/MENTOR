"use client";

import Link from "next/link";
import { useState } from "react";
import { TrendingUp, TrendingDown, CandlestickChart, ExternalLink, MessageSquare } from "lucide-react";
import { SignalOut } from "@/lib/api";
import { fmtUsd, isLong } from "@/lib/format";
import ChartOverlay from "@/components/market/ChartOverlay";
import { useLocale, useT } from "@/lib/i18n";
import { weexFuturesUrl } from "@/lib/content";

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
      <div className="relative h-2 rounded-full bg-[var(--pane-hover)]">
        {/* Loss zone */}
        {longDir ? (
          <div className="absolute inset-y-0 left-0 rounded-l-full bg-[var(--pane-down)]/25" style={{ width: `${entryPct}%` }} />
        ) : (
          <div className="absolute inset-y-0 right-0 rounded-r-full bg-[var(--pane-down)]/25" style={{ width: `${100 - entryPct}%` }} />
        )}
        {/* Profit zone */}
        {longDir ? (
          <div className="absolute inset-y-0 bg-gradient-to-r from-success/30 to-accent-cyan/35" style={{ left: `${entryPct}%`, width: `${tp3Pct - entryPct}%` }} />
        ) : (
          <div className="absolute inset-y-0 bg-gradient-to-l from-success/30 to-accent-cyan/35" style={{ left: `${tp3Pct}%`, width: `${entryPct - tp3Pct}%` }} />
        )}

        {/* Markers */}
        <Dot pos={slPct} className="bg-[var(--pane-down)] ring-danger/30" />
        <Dot pos={entryPct} className="bg-white ring-white/30" />
        <Dot pos={tp3Pct} className="bg-[var(--pane-accent)] ring-accent-cyan/30" />

        {/* Current price marker */}
        <div
          className="absolute top-1/2 z-10 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg-panel bg-white shadow-[0_0_8px_rgba(255,255,255,0.5)] transition-all duration-500"
          style={{ left: `${curPct}%` }}
        />
      </div>

      {/* Labels under markers */}
      <div className="relative h-9 text-[10px] font-mono">
        <Label pos={slPct} value={fmtUsd(sl, 4)} caption="SL" tone="text-[var(--pane-down)]" />
        <Label
          pos={entryPct}
          value={fmtUsd(entry, 4)}
          caption={`${curVsEntry >= 0 ? "+" : ""}${curVsEntry.toFixed(2)}%`}
          tone="text-[var(--pane-text)]/80"
          captionTone={curVsEntry >= 0 ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"}
        />
        <Label pos={tp3Pct} value={fmtUsd(tp3val, 4)} caption="TP" tone="text-[var(--pane-accent)]" />
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
      <span className={`text-[9px] font-semibold uppercase tracking-wider ${captionTone ?? "text-[var(--pane-text)]/30"}`}>
        {caption}
      </span>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-3">
      <span className="text-[8px] font-semibold uppercase tracking-[0.15em] text-[var(--pane-text)]/30">{label}</span>
      <span className={`font-mono text-[13px] font-bold tabular-nums ${tone}`}>{value}</span>
    </div>
  );
}

interface Props {
  signal: SignalOut;
  balance?: number;
  currentPrice?: number;
}

export default function SignalCard({ signal: s, balance = 1000, currentPrice }: Props) {
  const t = useT();
  const locale = useLocale();
  const [chartOpen, setChartOpen] = useState(false);

  const calc = calcPosition(s, balance);
  const long = isLong(s.direction);
  const active = s.status === "active";
  const DirectionIcon = long ? TrendingUp : TrendingDown;
  const bestProfit = calc ? calc.tp3_profit || calc.tp2_profit || calc.tp1_profit : 0;

  return (
    <>
      <div
        className={`group relative overflow-hidden rounded-xl border bg-[#0f1318] transition-all duration-300 ${
          active
            ? "border-[var(--pane-border)] shadow-[0_4px_24px_rgba(0,0,0,0.45)] hover:border-[var(--pane-border)] hover:shadow-[0_8px_36px_rgba(0,0,0,0.6)]"
            : "border-[var(--pane-border)] opacity-55"
        }`}
      >
        {/* Accent line */}
        <div className={`h-px w-full ${long ? "bg-gradient-to-r from-transparent via-success/50 to-transparent" : "bg-gradient-to-r from-transparent via-danger/50 to-transparent"}`} />

        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3.5 pb-3">
          <div className="flex items-center gap-3">
            <div
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${
                long ? "border-success/25 bg-[var(--pane-up)]/[0.12] text-[var(--pane-up)]" : "border-danger/25 bg-[var(--pane-down)]/[0.12] text-[var(--pane-down)]"
              }`}
            >
              <DirectionIcon className="h-3.5 w-3.5" strokeWidth={2.5} />
              {s.direction}
            </div>
            <div className="flex flex-col leading-tight">
              <span className="font-mono text-[17px] font-extrabold tracking-tight text-[var(--pane-text)]">{s.symbol}</span>
              <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--pane-text)]/30">{t.signals.leverage(s.leverage)}</span>
            </div>
          </div>
          <div
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
              active ? "border-success/20 bg-[var(--pane-up)]/[0.08] text-[var(--pane-up)]" : "border-[var(--pane-border)] bg-[var(--pane-hover)] text-[var(--pane-text)]/30"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-[var(--pane-up)] shadow-[0_0_6px] shadow-success/70" : "bg-[var(--pane-hover)]/30"}`} />
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
                className="max-h-44 w-full rounded-xl border border-[var(--pane-border)] object-cover transition-colors hover:border-[var(--pane-border)]"
              />
            </a>
          )}

          {/* Обсуждение: сигнал вырос из заявки, показанной в чате, и там уже
              лежит разговор о ней. */}
          {s.chat_message_id && (
            <Link
              href={`/app/scalping?chat=${s.chat_message_id}`}
              className="flex items-center gap-1.5 text-xs font-semibold text-[var(--pane-accent)] transition-opacity hover:opacity-80"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              {t.signals.discussion}
            </Link>
          )}

          <PriceTrack signal={s} currentPrice={currentPrice} />

          {/* Levels */}
          <div className="grid grid-cols-4 divide-x divide-white/[0.05] overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-hover)]">
            <Metric label={t.signals.entry} value={s.entry_price ? fmtUsd(parseFloat(s.entry_price), 4) : "-"} tone="text-[var(--pane-text)]" />
            <Metric label={t.signals.stop} value={s.stop_loss ? fmtUsd(parseFloat(s.stop_loss), 4) : "-"} tone="text-[var(--pane-down)]" />
            <Metric label="TP1" value={s.tp1 ? fmtUsd(parseFloat(s.tp1), 4) : "-"} tone="text-[var(--pane-up)]" />
            <Metric label="TP2/3" value={(s.tp3 || s.tp2) ? fmtUsd(parseFloat(s.tp3 || s.tp2!), 4) : "-"} tone="text-[var(--pane-accent)]" />
          </div>

          {/* Calc */}
          {calc && (
            <div className="overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-hover)]">
              <div className="grid grid-cols-3 divide-x divide-white/[0.05]">
                <Metric label={t.signals.margin} value={`$${calc.margin.toFixed(0)}`} tone="text-[var(--pane-text)]/80" />
                <Metric label={t.signals.risk} value={`-$${calc.risk.toFixed(0)}`} tone="text-[var(--pane-down)]" />
                <Metric
                  label={t.signals.profitTp(calc.tp3_profit > 0 ? 3 : calc.tp2_profit > 0 ? 2 : 1)}
                  value={`+$${bestProfit.toFixed(0)}`}
                  tone="text-[var(--pane-up)]"
                />
              </div>
              <div className="flex items-center justify-between border-t border-[var(--pane-border)] bg-[var(--pane-hover)] px-4 py-2.5">
                <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--pane-text)]/30">Risk / Reward</span>
                <span className="bg-gradient-to-r from-accent-gold to-yellow-300 bg-clip-text font-mono text-sm font-black text-transparent">
                  1 : {calc.rr1.toFixed(1)}
                </span>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-0.5">
            <a
              href={weexFuturesUrl(s.symbol, locale)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--pane-accent)] py-2.5 text-[12px] font-bold tracking-wide text-bg-deep transition-all duration-200 hover:brightness-110"
            >
              {t.signals.enterTrade}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <button
              onClick={() => setChartOpen(true)}
              title={t.signals.chartTitle}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-[var(--pane-hover)] px-3.5 py-2.5 text-[12px] font-semibold text-[var(--pane-text)]/50 ring-1 ring-inset ring-white/[0.07] transition-all duration-150 hover:text-[var(--pane-text)]/80 hover:ring-white/[0.16]"
            >
              <CandlestickChart className="h-3.5 w-3.5" />
              {t.signals.chart}
            </button>
          </div>
        </div>
      </div>

      {chartOpen && <ChartOverlay symbol={s.symbol} direction={s.direction} onClose={() => setChartOpen(false)} />}
    </>
  );
}

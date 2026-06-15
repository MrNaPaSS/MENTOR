"use client";

import { useState } from "react";
import { ChevronDown, BarChart3, AreaChart, Layers } from "lucide-react";
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

  const riskPct = 0.02; // 2% от баланса
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

function PriceBar({ signal, currentPrice }: { signal: SignalOut; currentPrice?: number }) {
  const entry = parseFloat(signal.entry_price);
  const sl = parseFloat(signal.stop_loss || "0");
  const tp1 = parseFloat(signal.tp1 || "0");
  const tp3 = parseFloat(signal.tp3 || signal.tp2 || signal.tp1 || "0");
  if (!sl || !tp3) return null;

  const min = Math.min(sl, entry, tp3) * 0.999;
  const max = Math.max(sl, entry, tp3) * 1.001;
  const range = max - min;
  const pct = (v: number) => ((v - min) / range) * 100;

  const cur = currentPrice || entry;
  const curPct = pct(Math.max(min, Math.min(max, cur)));
  const longDir = isLong(signal.direction);
  const curVsEntry = ((cur - entry) / entry) * 100;

  return (
    <div className="mt-4">
      {/* Прогресс-бар */}
      <div className="relative h-1.5 rounded-full bg-border/40">
        {/* Зона риска (красная) */}
        <div className="absolute inset-y-0 rounded-full bg-danger/20"
          style={{ left: `${longDir ? 0 : pct(tp1)}%`, width: `${longDir ? pct(sl) : 100 - pct(tp1)}%` }} />
        {/* Зона профита (зелёная) */}
        <div className="absolute inset-y-0 rounded-full bg-success/20"
          style={{ left: `${longDir ? pct(entry) : 0}%`, width: `${longDir ? pct(tp3) - pct(entry) : pct(entry)}%` }} />
        {/* Маркеры SL, Entry, TP */}
        {[
          { v: sl, color: "bg-danger" },
          { v: entry, color: "bg-white" },
          ...(signal.tp1 ? [{ v: parseFloat(signal.tp1), color: "bg-success" }] : []),
          ...(signal.tp2 ? [{ v: parseFloat(signal.tp2), color: "bg-success" }] : []),
          ...(signal.tp3 ? [{ v: parseFloat(signal.tp3), color: "bg-accent-cyan" }] : []),
        ].map((m, i) => (
          <div key={i} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${pct(m.v)}%` }}>
            <div className={`h-2.5 w-2.5 rounded-full ${m.color} border border-bg-deep`} />
          </div>
        ))}
        {/* Текущая цена */}
        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-all duration-500"
          style={{ left: `${curPct}%` }}>
          <div className="h-3 w-3 rounded-full bg-accent-cyan animate-pulse-glow shadow-glow-cyan border-2 border-bg-deep" />
        </div>
      </div>
      {/* Ценовые метки */}
      <div className="mt-2 flex justify-between font-mono text-[10px] text-text-muted">
        <span className="text-danger font-semibold">{fmtUsd(sl, 2)}</span>
        <span className="rounded bg-white/5 px-1.5 py-0.5 text-white font-bold flex items-center gap-1">
          {fmtUsd(cur, 2)}
          <span className={`text-[9px] ${curVsEntry >= 0 ? "text-success" : "text-danger"}`}>
            {curVsEntry >= 0 ? "▲" : "▼"}{Math.abs(curVsEntry).toFixed(2)}%
          </span>
        </span>
        <span className="text-accent-cyan font-semibold">{fmtUsd(tp3, 2)}</span>
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

  return (
    <div className={`group relative overflow-hidden rounded-2xl border transition-all duration-300 ${s.status === "active"
      ? "border-accent-cyan/25 bg-gradient-to-b from-bg-card to-bg-deep shadow-[0_8px_32px_rgba(0,0,0,0.4)] hover:border-accent-cyan/45 hover:shadow-[0_12px_40px_rgba(10,255,224,0.08)]"
      : "border-border/60 bg-bg-card/50 opacity-75"
      } backdrop-blur-md`}
    >
      {/* Мягкое радиальное свечение в углу */}
      <div className={`absolute -right-12 -top-12 h-32 w-32 rounded-full ${long ? "bg-success/4" : "bg-danger/4"} blur-3xl pointer-events-none transition-all duration-300 group-hover:scale-110`} />

      {/* Левая градиентная полоса */}
      <div className={`absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b ${long ? "from-success to-success/40" : "from-danger to-danger/40"} opacity-90`} />

      <div className="p-4 pl-5">
        {/* Заголовок */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider border ${
              long 
                ? "bg-success/8 text-success border-success/20 shadow-[0_0_12px_rgba(14,203,129,0.12)]" 
                : "bg-danger/8 text-danger border-danger/20 shadow-[0_0_12px_rgba(246,70,93,0.12)]"
            }`}>
              {s.direction}
            </span>
            <span className="text-lg font-bold tracking-tight text-white font-mono">{s.symbol}</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] font-semibold text-text-secondary">
              x{s.leverage}
            </span>
            <span className="badge-muted text-[9px] uppercase tracking-wider font-semibold">{modeLabel(s.target_audience)}</span>
          </div>
          <span className={`badge ${s.status === "active" ? "badge-cyan" : "badge-muted"} text-[9px] uppercase tracking-wider font-semibold`}>
            {s.status === "active" ? "🟢 Активен" : "⚫ Закрыт"}
          </span>
        </div>

        {/* Прогресс-бар цены */}
        <PriceBar signal={s} currentPrice={currentPrice} />

        {/* Ценовая таблица */}
        <div className="mt-3.5 grid grid-cols-4 gap-2 rounded-xl bg-white/[0.02] border border-white/5 p-3">
          {[
            { label: "Вход", value: s.entry_price, color: "text-white" },
            { label: "Стоп", value: s.stop_loss, color: "text-danger/90" },
            { label: "TP1", value: s.tp1, color: "text-success/90" },
            { label: "TP2/TP3", value: s.tp3 || s.tp2, color: "text-accent-cyan/90" },
          ].map((item) => (
            <div key={item.label} className="text-center group/item">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-text-muted transition-colors group-hover/item:text-text-secondary">{item.label}</div>
              <div className={`mt-1 font-mono text-xs font-bold tabular ${item.color}`}>
                {item.value ? fmtUsd(parseFloat(item.value), 2) : "—"}
              </div>
            </div>
          ))}
        </div>

        {/* Персональный расчёт */}
        {calc && (
          <div className="mt-3.5 grid grid-cols-3 gap-2.5 rounded-xl border border-white/5 bg-white/[0.01] p-3 backdrop-blur-sm">
            <div className="border-r border-white/5 pr-1">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-text-muted">Маржа</div>
              <div className="mt-0.5 font-mono text-xs font-bold text-white tabular">${calc.margin.toFixed(0)}</div>
            </div>
            <div className="border-r border-white/5 px-1">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-text-muted">Объём</div>
              <div className="mt-0.5 font-mono text-xs font-bold text-white tabular">${calc.position.toFixed(0)}</div>
            </div>
            <div className="pl-1">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-text-muted">Риск (2%)</div>
              <div className="mt-0.5 font-mono text-xs font-bold text-danger tabular">-${calc.risk.toFixed(1)}</div>
            </div>

            {/* Профит таргеты */}
            <div className="col-span-3 mt-1.5 grid grid-cols-3 gap-1.5 border-t border-white/5 pt-2">
              {calc.tp1_profit > 0 && (
                <div className="text-center">
                  <div className="text-[8px] font-semibold uppercase tracking-wider text-text-muted">TP1 Profit</div>
                  <div className="font-mono text-[11px] font-bold text-success/90 tabular">+${calc.tp1_profit.toFixed(0)}</div>
                </div>
              )}
              {calc.tp2_profit > 0 && (
                <div className="text-center">
                  <div className="text-[8px] font-semibold uppercase tracking-wider text-text-muted">TP2 Profit</div>
                  <div className="font-mono text-[11px] font-bold text-success/90 tabular">+${calc.tp2_profit.toFixed(0)}</div>
                </div>
              )}
              {calc.tp3_profit > 0 && (
                <div className="text-center">
                  <div className="text-[8px] font-semibold uppercase tracking-wider text-text-muted">TP3 Profit</div>
                  <div className="font-mono text-[11px] font-bold text-accent-cyan/90 tabular">+${calc.tp3_profit.toFixed(0)}</div>
                </div>
              )}
            </div>

            <div className="col-span-3 flex items-center justify-between border-t border-white/5 pt-2 px-1">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-text-muted">Risk/Reward:</span>
              <span className="bg-gradient-to-r from-accent-gold to-yellow-400 bg-clip-text font-mono text-xs font-black text-transparent">
                1 : {calc.rr1.toFixed(1)}
              </span>
            </div>
          </div>
        )}

        {/* Кнопки */}
        <div className="mt-4 flex items-center gap-2">
          {linkToDetail && (
            <Link href={`/app/signals/${s.id}`}
              className="btn bg-gradient-to-r from-accent-cyan/15 to-accent-cyan/5 hover:from-accent-cyan/25 hover:to-accent-cyan/10 text-accent-cyan border border-accent-cyan/30 hover:border-accent-cyan/50 hover:shadow-[0_0_12px_rgba(10,255,224,0.15)] flex-1 py-2 text-xs font-bold tracking-wide transition-all duration-200">
              <BarChart3 className="h-3.5 w-3.5" /> Детали
            </Link>
          )}
          <button
            onClick={() => setChartOpen(!chartOpen)}
            className={`btn border border-white/10 hover:border-white/20 text-text-secondary hover:text-white py-2 text-xs transition-all duration-150 ${
              chartOpen ? "bg-accent-cyan/10 border-accent-cyan/30 text-accent-cyan" : "bg-white/[0.02]"
            }`}
          >
            <AreaChart className="h-3.5 w-3.5" /> {chartOpen ? "Скрыть" : "График"}
          </button>
          <button
            onClick={() => setBookOpen(!bookOpen)}
            className={`btn border border-white/10 hover:border-white/20 text-text-secondary hover:text-white py-2 text-xs transition-all duration-150 ${
              bookOpen ? "bg-accent-cyan/10 border-accent-cyan/30 text-accent-cyan" : "bg-white/[0.02]"
            }`}
          >
            <Layers className="h-3.5 w-3.5" /> {bookOpen ? "Скрыть" : "Стакан"}
          </button>
        </div>

        {/* Встроенный график */}
        {chartOpen && (
          <div className="mt-3 overflow-hidden rounded-xl border border-border">
            <TradingChartWidget symbol={s.symbol} height={240} compact />
          </div>
        )}

        {/* Встроенный стакан */}
        {bookOpen && (
          <div className="mt-3 overflow-hidden rounded-xl border border-border bg-bg-panel">
            <OrderBook symbol={s.symbol} rows={10} compact />
          </div>
        )}
      </div>
    </div>
  );
}

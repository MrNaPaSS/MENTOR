"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { api, API_URL } from "@/lib/api";
import { getAccessToken, logout } from "@/lib/auth";
import { useRouter } from "next/navigation";

const TradingChart = dynamic(() => import("@/components/market/TradingChart"), { ssr: false });
const OrderBook    = dynamic(() => import("@/components/market/OrderBook"),    { ssr: false });

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT"];
const SKIP_NGROK = { headers: { "ngrok-skip-browser-warning": "1" } };
const COIN_COLOR: Record<string, string> = {
  BTC: "#F7931A", ETH: "#627EEA", SOL: "#9945FF", XRP: "#346AA9", BNB: "#F3BA2F",
};

// ── Форматирование ────────────────────────────────────────────────────────────

function fmtVol(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000)     return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000)         return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(2);
}

function fmtPx(n: number): string {
  if (n >= 10_000) return n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (n >= 100)    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

function parseBookLevel(l: unknown): { price: number; size: number } {
  if (Array.isArray(l)) return { price: parseFloat(String(l[0])), size: parseFloat(String(l[1])) };
  const o = l as Record<string, unknown>;
  return {
    price: parseFloat(String(o.price ?? o.p ?? 0)),
    size:  parseFloat(String(o.size  ?? o.s ?? o.qty ?? 0)),
  };
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/[0.07] bg-white/[0.025] ${className}`}>
      {children}
    </div>
  );
}

function WidgetHeader({ label, badge, badgeCls }: { label: string; badge?: string; badgeCls?: string }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-white/35">{label}</span>
      {badge && (
        <span className={`rounded-full border px-2 py-0.5 text-[7px] font-bold uppercase tracking-wider ${badgeCls}`}>
          {badge}
        </span>
      )}
    </div>
  );
}

// ── Ticker + Symbol Switcher ──────────────────────────────────────────────────

interface TickerData {
  lastPrice?: string; priceChange?: string; priceChangePercent?: string;
  highPrice?: string; lowPrice?: string; volume?: string; quoteVolume?: string;
  markPrice?: string; fundingRate?: string;
}

function TickerBar({ symbol, onSymChange }: { symbol: string; onSymChange: (s: string) => void }) {
  const [data, setData] = useState<TickerData | null>(null);

  useEffect(() => {
    const load = () =>
      fetch(`${API_URL}/api/market/ticker/${symbol}`, SKIP_NGROK)
        .then(r => r.ok ? r.json() : null)
        .then((d: TickerData | null) => { if (d) setData(d); })
        .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [symbol]);

  const lastPrice = parseFloat(data?.lastPrice ?? "0");
  const pct       = parseFloat(data?.priceChangePercent ?? "0");
  const change    = parseFloat(data?.priceChange ?? "0");
  const fr        = parseFloat(data?.fundingRate ?? "0");
  const pos       = pct >= 0;
  const frPos     = fr >= 0;
  const ticker    = symbol.replace("USDT", "");

  const stats = [
    ...(data?.markPrice
      ? [{ label: "Mark", val: fmtPx(parseFloat(data.markPrice)), color: "text-white/60" }]
      : []),
    ...(data?.fundingRate
      ? [{ label: "FR 8h", val: `${frPos ? "+" : ""}${(fr * 100).toFixed(4)}%`, color: frPos ? "text-accent-gold" : "text-success" }]
      : []),
    { label: "High",      val: data ? fmtPx(parseFloat(data.highPrice    ?? "0")) : "—", color: "text-success/70" },
    { label: "Low",       val: data ? fmtPx(parseFloat(data.lowPrice     ?? "0")) : "—", color: "text-danger/70"  },
    { label: `Vol ${ticker}`, val: data ? fmtVol(parseFloat(data.volume      ?? "0")) : "—", color: "text-white/35" },
    { label: "Vol USDT",      val: data ? fmtVol(parseFloat(data.quoteVolume ?? "0")) : "—", color: "text-white/35" },
  ];

  return (
    <div className="flex items-stretch bg-bg-deep" style={{ height: 56 }}>

      {/* Symbol pills */}
      <div className="flex items-center gap-0.5 border-r border-white/[0.05] px-3">
        {SYMBOLS.map(s => {
          const t = s.replace("USDT", "");
          const active = s === symbol;
          return (
            <button key={s} onClick={() => onSymChange(s)}
              className={`relative rounded-lg px-2.5 py-1.5 font-mono text-[11px] font-bold transition-all ${
                active ? "bg-white/[0.09] text-white" : "text-white/25 hover:text-white/55"
              }`}>
              {active && (
                <span className="absolute bottom-0.5 left-1/2 h-[2px] w-3 -translate-x-1/2 rounded-full bg-accent-cyan" />
              )}
              {t}
            </button>
          );
        })}
      </div>

      {/* Price + change */}
      <div className="flex items-center gap-3 border-r border-white/[0.05] px-5">
        <span className={`font-mono text-[22px] font-bold tabular-nums leading-none ${pos ? "text-success" : "text-danger"}`}>
          {data ? fmtPx(lastPrice) : <span className="text-white/15">——</span>}
        </span>
        <div className="flex flex-col gap-[3px]">
          <span className={`font-mono text-[10px] tabular-nums leading-none ${pos ? "text-success/80" : "text-danger/80"}`}>
            {data ? `${pos ? "+" : ""}${pct.toFixed(2)}%` : "—"}
          </span>
          <span className={`font-mono text-[9px] tabular-nums leading-none ${pos ? "text-success/40" : "text-danger/40"}`}>
            {data ? `${pos ? "+" : ""}${fmtPx(Math.abs(change))}` : ""}
          </span>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center overflow-x-auto">
        {stats.map(({ label, val, color }) => (
          <div key={label} className="flex h-full flex-shrink-0 flex-col justify-center border-r border-white/[0.04] px-4">
            <div className="text-[8px] uppercase tracking-wider text-white/20 leading-none">{label}</div>
            <div className={`mt-1 font-mono text-[12px] font-medium tabular-nums leading-none ${color}`}>{val}</div>
          </div>
        ))}
      </div>

    </div>
  );
}

// ── Widget: Кластерный анализ ─────────────────────────────────────────────────

function ClusterWidget({ symbol }: { symbol: string }) {
  const [data, setData] = useState<{ bids: unknown[]; asks: unknown[] } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const load = () =>
      fetch(`${API_URL}/api/market/orderbook/${symbol}?limit=40`, SKIP_NGROK)
        .then(r => r.ok ? r.json() : null)
        .then((d: { bids: unknown[]; asks: unknown[] } | null) => { if (d) setData(d); })
        .catch(() => {});
    load();
    timerRef.current = setInterval(load, 2000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [symbol]);

  if (!data) {
    return (
      <div className="space-y-2 animate-pulse">
        <div className="h-10 rounded-xl bg-white/[0.04]" />
        {[...Array(8)].map((_, i) => <div key={i} className="h-6 rounded-lg bg-white/[0.03]" />)}
      </div>
    );
  }

  const bids = (data.bids ?? []).map(parseBookLevel);
  const asks = (data.asks ?? []).map(parseBookLevel);
  if (!bids.length && !asks.length) return null;

  const allPrices = [...bids, ...asks].map(l => l.price);
  const minP  = Math.min(...allPrices);
  const maxP  = Math.max(...allPrices);
  const range = maxP - minP || 1;
  const N = 10;

  type Bucket = { bidVol: number; askVol: number; midPrice: number };
  const buckets: Bucket[] = Array.from({ length: N }, (_, i) => ({
    midPrice: minP + (range / N) * (i + 0.5),
    bidVol: 0, askVol: 0,
  }));

  bids.forEach(({ price, size }) => {
    const idx = Math.min(Math.floor(((price - minP) / range) * N), N - 1);
    buckets[idx].bidVol += size;
  });
  asks.forEach(({ price, size }) => {
    const idx = Math.min(Math.floor(((price - minP) / range) * N), N - 1);
    buckets[idx].askVol += size;
  });

  const maxVol      = Math.max(...buckets.map(b => b.bidVol + b.askVol), 1);
  const totalBidVol = buckets.reduce((s, b) => s + b.bidVol, 0);
  const totalAskVol = buckets.reduce((s, b) => s + b.askVol, 0);
  const totalVol    = totalBidVol + totalAskVol || 1;
  const bidPct      = Math.round((totalBidVol / totalVol) * 100);

  const reversed = [...buckets].reverse();
  const wallIdx  = reversed.reduce((mi, b, i) =>
    (b.bidVol + b.askVol > reversed[mi].bidVol + reversed[mi].askVol ? i : mi), 0);

  const pressure = bidPct >= 60 ? { label: "СПРОС", col: "text-success", barCol: "bg-success" }
                 : bidPct <= 40 ? { label: "ПРЕДЛ", col: "text-danger",  barCol: "bg-danger"  }
                 :                { label: "БАЛАНС", col: "text-white/40", barCol: "bg-white/30" };

  return (
    <div className="space-y-3">

      {/* Сводка давления */}
      <div className="rounded-xl border border-white/[0.05] bg-white/[0.03] px-3 py-2.5">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2 text-[8px] text-white/30">
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-success/60" />биды {bidPct}%</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-danger/60" />аски {100 - bidPct}%</span>
          </div>
          <span className={`font-mono text-[11px] font-bold ${pressure.col}`}>{pressure.label}</span>
        </div>
        <div className="h-[5px] overflow-hidden rounded-full bg-white/[0.06]">
          <div className={`h-full rounded-full transition-all duration-500 ${pressure.barCol}`}
            style={{ width: `${bidPct}%`, opacity: 0.6 }} />
        </div>
      </div>

      {/* Кластеры */}
      <div className="space-y-[2px]">
        {reversed.map((b, i) => {
          const total    = b.bidVol + b.askVol || 1;
          const barW     = (total / maxVol) * 100;
          const bidFrac  = b.bidVol / total;
          const delta    = bidFrac - 0.5;
          const isWall   = i === wallIdx;
          const deltaCol = delta > 0.12 ? "text-success" : delta < -0.12 ? "text-danger" : "text-white/20";

          return (
            <div key={i}
              className={`flex items-center gap-2 rounded-lg px-2 py-[4px] transition-all ${
                isWall
                  ? "border border-white/[0.08] bg-white/[0.05]"
                  : "border border-transparent hover:bg-white/[0.02]"
              }`}>

              {/* Маркер стены + цена */}
              <div className="flex w-[58px] shrink-0 items-center justify-end gap-1">
                {isWall
                  ? <span className="text-[8px] text-accent-gold leading-none">◆</span>
                  : <span className="w-[8px]" />}
                <span className={`font-mono text-[9px] ${isWall ? "text-white/60" : "text-white/30"}`}>
                  {fmtPx(b.midPrice)}
                </span>
              </div>

              {/* Объёмный бар */}
              <div className="relative flex-1">
                <div className="h-[14px] overflow-hidden rounded-sm bg-white/[0.04]">
                  <div className="absolute inset-0 flex">
                    <div className={`h-full transition-all duration-400 ${isWall ? "bg-success/60" : "bg-success/35"}`}
                      style={{ width: `${bidFrac * barW}%` }} />
                    <div className={`h-full transition-all duration-400 ${isWall ? "bg-danger/60" : "bg-danger/35"}`}
                      style={{ width: `${(1 - bidFrac) * barW}%` }} />
                  </div>
                </div>
              </div>

              {/* Дельта */}
              <span className={`w-9 shrink-0 text-right font-mono text-[9px] font-semibold ${deltaCol}`}>
                {delta > 0 ? "+" : ""}{(delta * 100).toFixed(0)}%
              </span>

            </div>
          );
        })}
      </div>

      {/* Легенда */}
      <div className="flex items-center justify-between text-[8px] text-white/20">
        <span>дельта = дисбаланс бид/аск</span>
        <span className="flex items-center gap-1 text-accent-gold/60">
          <span>◆</span> стена ликвидности
        </span>
      </div>

    </div>
  );
}

// ── Widget: Уровни ликвидации ─────────────────────────────────────────────────

function LiquidationWidget({ symbol }: { symbol: string }) {
  const [price, setPrice] = useState<number>(0);

  useEffect(() => {
    const load = () =>
      fetch(`${API_URL}/api/market/ticker/${symbol}`, SKIP_NGROK)
        .then(r => r.ok ? r.json() : null)
        .then((d: TickerData | null) => { if (d?.lastPrice) setPrice(parseFloat(d.lastPrice)); })
        .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [symbol]);

  if (!price) {
    return (
      <div className="animate-pulse space-y-2">
        {[...Array(7)].map((_, i) => <div key={i} className="h-10 rounded-xl bg-white/[0.04]" />)}
      </div>
    );
  }

  const MM = 0.005;
  const LEVERAGES = [10, 20, 25, 50, 75, 100, 125];
  const maxDist = (1 / 10 - MM) * 100;

  function riskColor(dist: number) {
    if (dist > 5) return { text: "text-success",     bar: "#0ecb81", bg: "bg-success/[0.06]",     border: "border-success/15"     };
    if (dist > 2) return { text: "text-accent-gold", bar: "#f0b90b", bg: "bg-accent-gold/[0.06]", border: "border-accent-gold/15" };
    return              { text: "text-danger",        bar: "#f6465d", bg: "bg-danger/[0.07]",      border: "border-danger/20"      };
  }

  return (
    <div className="space-y-1.5">
      {/* Шапка */}
      <div className="grid items-center gap-3 px-1 pb-1" style={{ gridTemplateColumns: "52px 1fr 120px 1fr 52px" }}>
        <span className="text-center text-[8px] uppercase tracking-wider text-white/20">Плечо</span>
        <span className="text-right text-[8px] uppercase tracking-wider text-success/40">Long</span>
        <span className="text-center text-[8px] uppercase tracking-wider text-white/15">← дист →</span>
        <span className="text-[8px] uppercase tracking-wider text-danger/40">Short</span>
        <span className="text-center text-[8px] uppercase tracking-wider text-white/20">Риск</span>
      </div>

      {LEVERAGES.map(lev => {
        const longLiq  = price * (1 - 1 / lev + MM);
        const shortLiq = price * (1 + 1 / lev - MM);
        const dist     = (1 / lev - MM) * 100;
        const rc       = riskColor(dist);
        const barPct   = Math.min((dist / maxDist) * 100, 100);

        return (
          <div key={lev}
            className={`grid items-center gap-3 rounded-xl border px-3 py-2.5 transition ${rc.bg} ${rc.border}`}
            style={{ gridTemplateColumns: "52px 1fr 120px 1fr 52px" }}>

            <div className="text-center">
              <span className={`font-mono text-[14px] font-extrabold ${rc.text}`}>{lev}×</span>
            </div>

            <div className="text-right">
              <div className="font-mono text-[12px] font-bold text-success leading-none">{fmtPx(longLiq)}</div>
              <div className="mt-0.5 font-mono text-[9px] text-success/50">−{dist.toFixed(2)}%</div>
            </div>

            <div className="flex items-center gap-1">
              <div className="flex h-[16px] flex-1 items-center justify-end overflow-hidden rounded-l-full bg-white/[0.05]">
                <div className="h-full rounded-l-full transition-all duration-500"
                  style={{ width: `${barPct}%`, background: `${rc.bar}88` }} />
              </div>
              <div className="h-3.5 w-[2px] flex-shrink-0 rounded-full bg-white/30" />
              <div className="flex h-[16px] flex-1 overflow-hidden rounded-r-full bg-white/[0.05]">
                <div className="h-full rounded-r-full transition-all duration-500"
                  style={{ width: `${barPct}%`, background: `${rc.bar}88` }} />
              </div>
            </div>

            <div>
              <div className="font-mono text-[12px] font-bold text-danger leading-none">{fmtPx(shortLiq)}</div>
              <div className="mt-0.5 font-mono text-[9px] text-danger/50">+{dist.toFixed(2)}%</div>
            </div>

            <div className="text-center">
              {dist > 5
                ? <span className="rounded-md border border-success/25 bg-success/10 px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-wider text-success">safe</span>
                : dist > 2
                ? <span className="rounded-md border border-accent-gold/25 bg-accent-gold/10 px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-wider text-accent-gold">med</span>
                : <span className="rounded-md border border-danger/30 bg-danger/10 px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-wider text-danger">high</span>
              }
            </div>

          </div>
        );
      })}

      <div className="flex items-center justify-end gap-4 pt-1 text-[8px] text-white/20">
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-success/50" />safe &gt;5%</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-accent-gold/50" />med 2–5%</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-danger/50" />high &lt;2%</span>
        <span>MM 0.5% · при входе по рынку</span>
      </div>
    </div>
  );
}

// ── Widget: Fear & Greed ──────────────────────────────────────────────────────

interface FngPoint { value: string; value_classification: string }

function fngColor(v: number) {
  if (v <= 25) return "#f6465d";
  if (v <= 45) return "#FF8C00";
  if (v <= 55) return "#FFD700";
  if (v <= 75) return "#0ecb81";
  return "#0affe0";
}
function fngLabel(cls: string) {
  const m: Record<string, string> = {
    "Extreme Fear": "Крайний страх", "Fear": "Страх",
    "Neutral": "Нейтрально", "Greed": "Жадность", "Extreme Greed": "Крайняя жадность",
  };
  return m[cls] ?? cls;
}

function FearGreedWidget() {
  const [current, setCurrent] = useState<FngPoint | null>(null);
  const [history, setHistory] = useState<FngPoint[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/api/market/fear-greed`, SKIP_NGROK);
        if (!res.ok) return;
        const d = await res.json();
        setCurrent(d.current);
        setHistory(d.history ?? []);
      } catch { /* silent */ }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  if (!current) return <div className="h-36 animate-pulse rounded-xl bg-white/[0.04]" />;

  const val   = parseInt(current.value);
  const color = fngColor(val);
  const W = 260, H = 124, cx = W / 2, cy = H - 8, r = 100;
  const circ  = Math.PI * r;

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block", overflow: "visible" }}>
        {/* Track */}
        <path d={`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}`}
          fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="12" strokeLinecap="round" />
        {/* Active arc */}
        <path d={`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}`}
          fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${(val/100)*circ} ${circ}`}
          style={{ transition: "stroke-dasharray 1s ease", filter: `drop-shadow(0 0 8px ${color}66)` }} />
        {/* Tick marks */}
        {[0, 25, 50, 75, 100].map(pct => {
          const ang = Math.PI - (pct / 100) * Math.PI;
          return (
            <text key={pct} x={cx + (r + 16) * Math.cos(ang)} y={cy - (r + 16) * Math.sin(ang)}
              textAnchor="middle" fill="rgba(255,255,255,0.15)" fontSize="8" fontFamily="monospace">{pct}</text>
          );
        })}
        {/* Needle */}
        {(() => {
          const ang = Math.PI - (val / 100) * Math.PI;
          const nx = cx + (r - 10) * Math.cos(ang);
          const ny = cy - (r - 10) * Math.sin(ang);
          return (
            <line x1={cx} y1={cy} x2={nx} y2={ny}
              stroke={color} strokeWidth="2" strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
          );
        })()}
        <circle cx={cx} cy={cy} r="4" fill={color} style={{ filter: `drop-shadow(0 0 6px ${color})` }} />
        {/* Value */}
        <text x={cx} y={cy - 26} textAnchor="middle" fill="white"
          fontSize="38" fontWeight="800" fontFamily="monospace">{val}</text>
        <text x={cx} y={cy - 8} textAnchor="middle" fill={color}
          fontSize="11" fontWeight="600" fontFamily="sans-serif">{fngLabel(current.value_classification)}</text>
      </svg>

      {history.length > 1 && (
        <div>
          <div className="flex items-end gap-[2px] rounded-xl bg-white/[0.03] p-2" style={{ height: 36 }}>
            {history.slice(0, 14).reverse().map((h, i) => {
              const v = parseInt(h.value);
              return (
                <div key={i} className="flex-1 rounded-sm transition-all duration-300" title={String(v)}
                  style={{ height: `${Math.max((v / 100) * 30, 3)}px`, background: fngColor(v), opacity: 0.5 + 0.5 * (v / 100) }} />
              );
            })}
          </div>
          <div className="mt-1.5 flex justify-between text-[8px] text-white/20">
            <span>14 дн. назад</span>
            <span>сегодня</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Widget: Финансирование ────────────────────────────────────────────────────

type FundingEntry = { symbol?: string; pair?: string; fundingRate?: string; rate?: string; fr?: string };

const FUNDING_FALLBACK: FundingEntry[] = [
  { symbol: "BTCUSDT", rate: "0.0001" }, { symbol: "ETHUSDT", rate: "-0.0050" },
  { symbol: "SOLUSDT", rate: "0.0320" }, { symbol: "XRPUSDT", rate: "0.0150" },
  { symbol: "BNBUSDT", rate: "-0.0080" },
];

function nextFundingCountdown(): string {
  const now   = new Date();
  const total = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
  const left  = 8 * 3600 - (total % (8 * 3600));
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function FundingWidget({ symbol }: { symbol: string }) {
  const [rates, setRates]         = useState<FundingEntry[]>([]);
  const [countdown, setCountdown] = useState(nextFundingCountdown());

  useEffect(() => {
    const id = setInterval(() => setCountdown(nextFundingCountdown()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    fetch(`${API_URL}/api/market/funding-rates`, SKIP_NGROK)
      .then(r => r.ok ? r.json() : null)
      .then((d: { rates?: FundingEntry[] } | null) => {
        setRates(d?.rates?.length ? d.rates.slice(0, 5) : FUNDING_FALLBACK);
      })
      .catch(() => setRates(FUNDING_FALLBACK));
  }, []);

  const raw    = rates.length ? rates : FUNDING_FALLBACK;
  const active = symbol.replace("USDT", "");
  const list   = [...raw].sort((a, b) => {
    const aIsActive = (a.symbol ?? a.pair ?? "").replace("USDT", "") === active;
    const bIsActive = (b.symbol ?? b.pair ?? "").replace("USDT", "") === active;
    return aIsActive ? -1 : bIsActive ? 1 : 0;
  });
  const maxAbs    = Math.max(...list.map(r => Math.abs(parseFloat(r.fundingRate ?? r.rate ?? r.fr ?? "0"))), 0.0001);
  const longCount = list.filter(r => parseFloat(r.fundingRate ?? r.rate ?? r.fr ?? "0") > 0).length;
  const bias      = longCount > list.length / 2
    ? { label: "лонг перегрет",  col: "text-danger"   }
    : longCount < list.length / 2
    ? { label: "шорт перегрет",  col: "text-success"  }
    : { label: "нейтрально",     col: "text-white/35" };

  return (
    <div className="space-y-2">

      {/* Таймер */}
      <div className="flex items-center justify-between rounded-xl border border-white/[0.05] bg-white/[0.03] px-3 py-2">
        <span className="text-[8px] uppercase tracking-wider text-white/25">след. списание</span>
        <span className="font-mono text-[14px] font-bold tabular-nums text-white/55">{countdown}</span>
      </div>

      {/* Монеты */}
      {list.map((r) => {
        const sym      = (r.symbol ?? r.pair ?? "?").replace("USDT", "");
        const rate     = parseFloat(r.fundingRate ?? r.rate ?? r.fr ?? "0");
        const pos      = rate >= 0;
        const frac     = Math.min(Math.abs(rate) / maxAbs, 1);
        const apr      = rate * 3 * 365 * 100;
        const coinBg   = COIN_COLOR[sym] ?? "#6b7280";
        const isActive = sym === active;

        return (
          <div key={sym} className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition hover:bg-white/[0.04] ${
            isActive
              ? "border-white/[0.12] bg-white/[0.05]"
              : "border-white/[0.05] bg-white/[0.02]"
          }`}>

            <span className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
              style={{ background: coinBg }}>{sym.charAt(0)}</span>
            <span className="w-8 font-mono text-[12px] font-bold text-white/75">{sym}</span>

            {/* Двунаправленный бар */}
            <div className="flex flex-1 items-center gap-[2px]">
              <div className="flex h-[8px] flex-1 justify-end overflow-hidden rounded-l-full bg-white/[0.05]">
                {!pos && (
                  <div className="h-full rounded-l-full bg-success/55 transition-all duration-500"
                    style={{ width: `${frac * 100}%` }} />
                )}
              </div>
              <div className="h-3 w-[1px] flex-shrink-0 bg-white/20" />
              <div className="flex h-[8px] flex-1 overflow-hidden rounded-r-full bg-white/[0.05]">
                {pos && (
                  <div className="h-full rounded-r-full bg-danger/55 transition-all duration-500"
                    style={{ width: `${frac * 100}%` }} />
                )}
              </div>
            </div>

            <div className="text-right">
              <div className={`font-mono text-[11px] font-bold tabular-nums ${pos ? "text-danger" : "text-success"}`}>
                {pos ? "+" : ""}{(rate * 100).toFixed(4)}%
              </div>
              <div className={`font-mono text-[8px] tabular-nums ${pos ? "text-danger/45" : "text-success/45"}`}>
                {pos ? "+" : ""}{apr.toFixed(1)}% APR
              </div>
            </div>

          </div>
        );
      })}

      {/* Итог */}
      <div className="flex items-center justify-between pt-0.5 text-[8px]">
        <span className="text-white/20">{longCount} лонг · {list.length - longCount} шорт</span>
        <span className={`font-semibold ${bias.col}`}>{bias.label}</span>
      </div>

    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const router = useRouter();
  const [activeSym, setActiveSym] = useState("BTCUSDT");

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    api.profile(token).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("401") || msg.includes("Unauthorized") || msg.includes("токен")) {
        logout();
        router.replace("/login");
      }
    });
  }, [router]);

  return (
    <div className="-mx-4 md:-mx-6 flex flex-col">

      {/* Ticker + Symbol Switcher */}
      <div className="border-b border-white/[0.05]">
        <TickerBar symbol={activeSym} onSymChange={setActiveSym} />
      </div>

      {/* Chart + OrderBook */}
      <div className="flex" style={{ height: 600 }}>
        <div className="min-w-0 flex-1 overflow-hidden">
          <TradingChart symbol={activeSym} interval="15" height={600} showToolbar={false}
            studies={["PUB;RmG5HL1Q", "PUB;CnB3fSph"]} />
        </div>
        <div className="hidden flex-shrink-0 overflow-hidden border-l border-white/[0.05] lg:flex lg:flex-col"
          style={{ width: 260 }}>
          <OrderBook symbol={activeSym} rows={16} />
        </div>
      </div>

      {/* Widgets */}
      <div className="flex flex-col gap-3 p-3">

        <div className="grid gap-3 sm:grid-cols-3">

          <Card className="p-5">
            <WidgetHeader
              label="Настроение рынка"
              badge="LIVE"
              badgeCls="border-accent-cyan/25 bg-accent-cyan/10 text-accent-cyan"
            />
            <FearGreedWidget />
          </Card>

          <Card className="p-5">
            <WidgetHeader
              label="Финансирование"
              badge="8ч"
              badgeCls="border-white/[0.08] text-white/30"
            />
            <FundingWidget symbol={activeSym} />
          </Card>

          <Card className="p-5">
            <WidgetHeader
              label="Кластерный анализ"
              badge="2с"
              badgeCls="border-success/20 bg-success/10 text-success"
            />
            <ClusterWidget symbol={activeSym} />
          </Card>

        </div>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-white/35">Уровни ликвидации</span>
            <span className="text-[8px] text-white/20">при входе по рынку · MM 0.5%</span>
          </div>
          <LiquidationWidget symbol={activeSym} />
        </Card>

      </div>
    </div>
  );
}

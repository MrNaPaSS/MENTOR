"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { api, API_URL } from "@/lib/api";
import { getAccessToken, logout } from "@/lib/auth";
import { useRouter } from "next/navigation";

const TradingChart = dynamic(() => import("@/components/market/TradingChart"), { ssr: false });
const OrderBook    = dynamic(() => import("@/components/market/OrderBook"),    { ssr: false });

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

function LiveBadge() {
  return (
    <span className="flex items-center gap-1 rounded-md border border-success/30 bg-success/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-success">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
      </span>
      LIVE
    </span>
  );
}

function WidgetHeader({ label, badge, badgeCls, badgeNode }: {
  label: string; badge?: string; badgeCls?: string; badgeNode?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-white/35">{label}</span>
      {badgeNode ?? (badge && (
        <span className={`rounded-full border px-2 py-0.5 text-[7px] font-bold uppercase tracking-wider ${badgeCls}`}>
          {badge}
        </span>
      ))}
    </div>
  );
}

// ── Ticker + Symbol Switcher ──────────────────────────────────────────────────

interface TickerData {
  lastPrice?: string; priceChange?: string; priceChangePercent?: string;
  highPrice?: string; lowPrice?: string; volume?: string; quoteVolume?: string;
  markPrice?: string; fundingRate?: string;
}

const FALLBACK_SYMBOLS = [
  "BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT","BNBUSDT","DOGEUSDT","AVAXUSDT",
  "ADAUSDT","LINKUSDT","DOTUSDT","MATICUSDT","LTCUSDT","ATOMUSDT","NEARUSDT",
  "FTMUSDT","ARBUSDT","OPUSDT","SUIUSDT","APTUSDT","INJUSDT","TIAUSDT",
  "SEIUSDT","WLDUSDT","ORDIUSDT","PEPEUSDT","FLOKIUSDT","BONKUSDT","JUPUSDT",
  "PENDLEUSDT","STRKUSDT","EIGENUSDT","MOODENGUSDT","PNUTUSDT","ACTUSDT",
];

function SymbolSearch({ symbol, onSymChange }: { symbol: string; onSymChange: (s: string) => void }) {
  const [allSymbols, setAllSymbols] = useState<string[]>(FALLBACK_SYMBOLS);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/market/symbols`, SKIP_NGROK)
      .then(r => r.ok ? r.json() : null)
      .then((d: { symbols: string[] } | null) => {
        if (d?.symbols?.length) setAllSymbols(d.symbols);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const ticker = symbol.replace("USDT", "");
  const filtered = allSymbols.filter(s =>
    s.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 50);

  return (
    <div ref={ref} className="relative flex items-center border-r border-white/[0.05] px-3">
      <button
        onClick={() => { setOpen(o => !o); setQuery(""); }}
        className="flex items-center gap-1.5 rounded-lg bg-white/[0.07] px-3 py-1.5 font-mono text-[13px] font-bold text-white transition hover:bg-white/[0.11]"
      >
        <span className="text-accent-cyan">{ticker}</span>
        <span className="text-white/30 text-[10px]">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-xl border border-white/[0.08] bg-bg-deep shadow-2xl">
          <div className="border-b border-white/[0.06] p-2">
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Поиск пары..."
              className="w-full rounded-lg bg-white/[0.05] px-3 py-1.5 font-mono text-[12px] text-white placeholder-white/25 outline-none"
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="py-4 text-center text-[11px] text-white/25">Не найдено</p>
            ) : filtered.map(s => {
              const t = s.replace("USDT", "");
              const active = s === symbol;
              return (
                <button key={s} onClick={() => { onSymChange(s); setOpen(false); setQuery(""); }}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left transition hover:bg-white/[0.05] ${active ? "bg-white/[0.08]" : ""}`}>
                  <span className="font-mono text-[12px] font-bold text-white">{t}</span>
                  <span className="text-[10px] text-white/25">USDT</span>
                  {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent-cyan" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
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

      {/* Symbol search */}
      <SymbolSearch symbol={symbol} onSymChange={onSymChange} />

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

// ── Widget: Настроение рынка (кастомный) ────────────────────────────────────

type Signal = "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell";

const SIGNAL_META: Record<Signal, { label: string; color: string; arc: number }> = {
  strong_buy:  { label: "Активно покупать", color: "#0ecb81", arc: 0.92 },
  buy:         { label: "Покупать",          color: "#5ac87a", arc: 0.68 },
  neutral:     { label: "Нейтрально",        color: "#9ca3af", arc: 0.50 },
  sell:        { label: "Продавать",          color: "#f59e0b", arc: 0.32 },
  strong_sell: { label: "Активно продавать", color: "#f6465d", arc: 0.08 },
};

function calcSignal(pct: number, fr: number, volRatio: number): Signal {
  // pct: 24h price change %, fr: funding rate, volRatio: vol vs typical
  let score = 0;
  // Price momentum (weight 60%)
  score += Math.max(-3, Math.min(3, pct / 2)) * 0.6;
  // Funding rate: positive = longs overheated = slightly bearish
  score += Math.max(-3, Math.min(3, -fr * 500)) * 0.25;
  // Volume confirmation (weight 15%)
  score += Math.max(-1, Math.min(1, (volRatio - 1) * 2)) * 0.15;

  if (score >  1.5) return "strong_buy";
  if (score >  0.5) return "buy";
  if (score > -0.5) return "neutral";
  if (score > -1.5) return "sell";
  return "strong_sell";
}

function SentimentGauge({ value, color }: { value: number; color: string }) {
  const W = 290, H = 158, cx = W / 2, cy = H - 8, r = 114;

  const ang = Math.PI - value * Math.PI;
  const needleLen = r - 20;
  const nx = cx + needleLen * Math.cos(ang);
  const ny = cy - needleLen * Math.sin(ang);
  const pa = ang + Math.PI / 2;
  const hw = 5.5;
  const bx1 = cx + hw * Math.cos(pa), by1 = cy - hw * Math.sin(pa);
  const bx2 = cx - hw * Math.cos(pa), by2 = cy + hw * Math.sin(pa);

  const zones = [
    { from: 0, to: 0.2, col: "#f6465d" },
    { from: 0.2, to: 0.4, col: "#f59e0b" },
    { from: 0.4, to: 0.6, col: "#6b7280" },
    { from: 0.6, to: 0.8, col: "#22c55e" },
    { from: 0.8, to: 1.0, col: "#0ecb81" },
  ];

  const ticks = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  const labels = [
    { v: 0.05, t: "Продажа" },
    { v: 0.5,  t: "Нейтрально" },
    { v: 0.95, t: "Покупка" },
  ];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block", overflow: "visible" }}>
      <defs>
        <radialGradient id="gaugeBg" cx="50%" cy="100%" r="80%">
          <stop offset="0%" stopColor={color} stopOpacity="0.08" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Radial glow background */}
      <ellipse cx={cx} cy={cy} rx={r + 30} ry={r * 0.7} fill="url(#gaugeBg)" />

      {/* Track */}
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="14" strokeLinecap="butt" />

      {/* Colored zones */}
      {zones.map((z, i) => {
        const a1 = Math.PI - z.from * Math.PI;
        const a2 = Math.PI - z.to * Math.PI;
        const x1 = cx + r * Math.cos(a1), y1 = cy - r * Math.sin(a1);
        const x2 = cx + r * Math.cos(a2), y2 = cy - r * Math.sin(a2);
        return (
          <path key={i}
            d={`M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`}
            fill="none" stroke={z.col} strokeWidth="14" strokeLinecap="butt" opacity="0.28" />
        );
      })}

      {/* Active zone glow overlay */}
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none" stroke={color} strokeWidth="14" strokeLinecap="butt"
        strokeDasharray={`${value * Math.PI * r} ${Math.PI * r}`}
        opacity="0.55"
        style={{ transition: "stroke-dasharray 0.9s ease, stroke 0.4s ease",
          filter: `drop-shadow(0 0 8px ${color}90)` }} />

      {/* Tick marks */}
      {ticks.map(t => {
        const a = Math.PI - t * Math.PI;
        const isMajor = t === 0 || t === 0.5 || t === 1;
        const outer = r + 1, inner = r - 15 - (isMajor ? 6 : 2);
        return (
          <line key={t}
            x1={cx + outer * Math.cos(a)} y1={cy - outer * Math.sin(a)}
            x2={cx + inner * Math.cos(a)} y2={cy - inner * Math.sin(a)}
            stroke={isMajor ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.12)"}
            strokeWidth={isMajor ? 1.5 : 1} strokeLinecap="round" />
        );
      })}

      {/* Zone labels */}
      {labels.map(({ v, t }) => {
        const a = Math.PI - v * Math.PI;
        return (
          <text key={t}
            x={cx + (r + 22) * Math.cos(a)} y={cy - (r + 22) * Math.sin(a)}
            textAnchor="middle" dominantBaseline="middle"
            fill="rgba(255,255,255,0.22)" fontSize="8.5" fontFamily="sans-serif" fontWeight="600">
            {t}
          </text>
        );
      })}

      {/* Needle shadow */}
      <polygon points={`${nx},${ny} ${bx1},${by1} ${bx2},${by2}`}
        fill={color} opacity="0.2" filter="url(#glow)"
        style={{ transition: "all 0.9s cubic-bezier(0.34,1.56,0.64,1)" }} />

      {/* Needle */}
      <polygon points={`${nx},${ny} ${bx1},${by1} ${bx2},${by2}`}
        fill={color}
        style={{ filter: `drop-shadow(0 0 5px ${color})`,
          transition: "all 0.9s cubic-bezier(0.34,1.56,0.64,1)" }} />

      {/* Hub outer ring */}
      <circle cx={cx} cy={cy} r="11" fill="rgba(10,14,20,0.95)"
        stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
      {/* Hub inner glow */}
      <circle cx={cx} cy={cy} r="7" fill={color} opacity="0.15" />
      <circle cx={cx} cy={cy} r="4.5" fill={color}
        style={{ filter: `drop-shadow(0 0 8px ${color})` }} />
    </svg>
  );
}

function MarketSentimentWidget({ symbol }: { symbol: string }) {
  const [ticker, setTicker] = useState<TickerData | null>(null);
  const [prevVol, setPrevVol] = useState(0);

  useEffect(() => {
    const load = () =>
      fetch(`${API_URL}/api/market/ticker/${symbol}`, SKIP_NGROK)
        .then(r => r.ok ? r.json() : null)
        .then((d: TickerData | null) => {
          if (d) {
            setPrevVol(v => v || parseFloat(d.quoteVolume ?? "0"));
            setTicker(d);
          }
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [symbol]);

  if (!ticker) {
    return <div className="h-[340px] animate-pulse rounded-xl bg-white/[0.04]" />;
  }

  const pct    = parseFloat(ticker.priceChangePercent ?? "0");
  const fr     = parseFloat(ticker.fundingRate ?? "0");
  const curVol = parseFloat(ticker.quoteVolume ?? "0");
  const volRatio = prevVol > 0 ? curVol / prevVol : 1;

  const signal = calcSignal(pct, fr, volRatio);
  const meta   = SIGNAL_META[signal];
  const pos    = pct >= 0;
  const c      = meta.color;

  const stats = [
    { label: "24ч изм.", value: `${pos ? "+" : ""}${pct.toFixed(2)}%`,
      isPos: pos, col: pos ? "#0ecb81" : "#f6465d" },
    { label: "Funding 8ч", value: `${fr >= 0 ? "+" : ""}${(fr * 100).toFixed(4)}%`,
      isPos: fr < 0, col: fr < 0 ? "#0ecb81" : "#f6465d" },
    { label: "Объём USDT",
      value: curVol >= 1e9 ? `${(curVol/1e9).toFixed(1)}B` : `${(curVol/1e6).toFixed(0)}M`,
      isPos: true, col: "#9ca3af" },
  ];

  return (
    <div className="space-y-2">
      <div className="-mx-1">
        <SentimentGauge value={meta.arc} color={c} />
      </div>

      {/* Signal label */}
      <div className="relative flex items-center justify-center py-0.5">
        <div className="absolute inset-x-4 h-px"
          style={{ background: `linear-gradient(90deg, transparent, ${c}40, transparent)` }} />
        <span className="relative rounded-lg px-4 py-1 text-[14px] font-extrabold tracking-wide"
          style={{ color: c, background: `${c}14`,
            textShadow: `0 0 20px ${c}80, 0 0 40px ${c}40` }}>
          {meta.label}
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 pt-1">
        {stats.map(s => (
          <div key={s.label} className="rounded-xl px-2.5 py-2.5 text-center"
            style={{ background: `${s.col}0d`, border: `1px solid ${s.col}25` }}>
            <div className="text-[7.5px] uppercase tracking-widest text-white/30 leading-none mb-1.5">
              {s.label}
            </div>
            <div className="font-mono text-[13px] font-bold tabular-nums leading-none"
              style={{ color: s.col }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      <p className="text-center text-[7.5px] text-white/12 tracking-wide">
        импульс · финансирование · объём
      </p>
    </div>
  );
}

// ── Widget: Финансирование ────────────────────────────────────────────────────

type FundingEntry = { symbol: string; fundingRate: string };

const FUNDING_FALLBACK: FundingEntry[] = [
  { symbol: "BTCUSDT", fundingRate: "0.0001" },
  { symbol: "ETHUSDT", fundingRate: "-0.0050" },
  { symbol: "SOLUSDT", fundingRate: "0.0320" },
  { symbol: "XRPUSDT", fundingRate: "0.0150" },
  { symbol: "BNBUSDT", fundingRate: "-0.0080" },
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
    const FUNDING_SYMBOLS = ["BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT","BNBUSDT","DOGEUSDT","AVAXUSDT","ADAUSDT","LINKUSDT","DOTUSDT"];
    Promise.all(
      FUNDING_SYMBOLS.map(sym =>
        fetch(`${API_URL}/api/market/ticker/${sym}`, SKIP_NGROK)
          .then(r => r.ok ? r.json() : null)
          .then((d: TickerData | null) => ({ symbol: sym, fundingRate: d?.fundingRate ?? "0" }))
          .catch(() => ({ symbol: sym, fundingRate: "0" }))
      )
    ).then(results => {
      const valid = results.filter(r => r.fundingRate && r.fundingRate !== "0");
      setRates(valid.length ? results : FUNDING_FALLBACK);
    });
  }, []);

  const active = symbol.replace("USDT", "");
  const list = [...(rates.length ? rates : FUNDING_FALLBACK)].sort((a, b) => {
    const aActive = a.symbol.replace("USDT", "") === active;
    const bActive = b.symbol.replace("USDT", "") === active;
    return aActive ? -1 : bActive ? 1 : 0;
  });
  const maxAbs    = Math.max(...list.map(r => Math.abs(parseFloat(r.fundingRate))), 0.0001);
  const longCount = list.filter(r => parseFloat(r.fundingRate) > 0).length;
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
        const sym      = r.symbol.replace("USDT", "");
        const rate     = parseFloat(r.fundingRate);
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

          <div className="relative overflow-hidden rounded-2xl p-5"
            style={{
              background: "linear-gradient(160deg, rgba(10,255,224,0.04) 0%, rgba(255,255,255,0.015) 60%)",
              border: "1px solid rgba(10,255,224,0.12)",
              boxShadow: "0 0 40px -8px rgba(10,255,224,0.12), inset 0 1px 0 rgba(255,255,255,0.05)",
            }}>
            <div className="absolute inset-x-0 top-0 h-[1px]"
              style={{ background: "linear-gradient(90deg, transparent, #0affe090, transparent)" }} />
            <WidgetHeader label="Настроение рынка" badgeNode={<LiveBadge />} />
            <MarketSentimentWidget symbol={activeSym} />
          </div>

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

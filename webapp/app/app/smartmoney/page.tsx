"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import {
  Building2, TrendingUp, TrendingDown, Minus,
  AlertTriangle, ChevronDown, ChevronUp,
  BarChart3, DollarSign, Activity, Zap,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CotRow {
  date: string; oi: number;
  nc_long: number; nc_short: number; nc_net: number; nc_net_chg: number;
  nc_long_pct: number; nc_short_pct: number;
  c_long: number; c_short: number; c_net: number; c_net_chg: number;
  c_long_pct: number; c_short_pct: number;
  nr_long: number; nr_short: number; nr_net: number;
}

interface MacroItem {
  key: string; label: string;
  price: number; change: number; changePct: number;
}

interface EtfItem {
  name: string; ticker: string; btc: number; aum_usd?: number;
  price: number; change: number; changePct: number; sharePct: number;
}

// ── Встроенные демо-данные (работают всегда, даже без бэкенда) ────────────────

const DEMO_COT: Record<"BTC" | "ETH", CotRow[]> = {
  BTC: [
    {date:"2026-06-10",oi:82450,nc_long:22100,nc_short:8320,nc_net:13780,nc_net_chg:890,nc_long_pct:26.8,nc_short_pct:10.1,c_long:9200,c_short:24800,c_net:-15600,c_net_chg:-420,c_long_pct:11.2,c_short_pct:30.1,nr_long:4100,nr_short:2730,nr_net:1370},
    {date:"2026-06-03",oi:81100,nc_long:21210,nc_short:8320,nc_net:12890,nc_net_chg:340,nc_long_pct:26.2,nc_short_pct:10.3,c_long:9400,c_short:24200,c_net:-14800,c_net_chg:-210,c_long_pct:11.6,c_short_pct:29.8,nr_long:4050,nr_short:2720,nr_net:1330},
    {date:"2026-05-27",oi:80200,nc_long:20870,nc_short:8320,nc_net:12550,nc_net_chg:-120,nc_long_pct:26.0,nc_short_pct:10.4,c_long:9100,c_short:23900,c_net:-14800,c_net_chg:180,c_long_pct:11.3,c_short_pct:29.8,nr_long:3900,nr_short:2610,nr_net:1290},
    {date:"2026-05-20",oi:78600,nc_long:20350,nc_short:8020,nc_net:12330,nc_net_chg:510,nc_long_pct:25.9,nc_short_pct:10.2,c_long:8800,c_short:23500,c_net:-14700,c_net_chg:-90,c_long_pct:11.2,c_short_pct:29.9,nr_long:3800,nr_short:2580,nr_net:1220},
    {date:"2026-05-13",oi:76900,nc_long:19840,nc_short:8020,nc_net:11820,nc_net_chg:670,nc_long_pct:25.8,nc_short_pct:10.4,c_long:8600,c_short:23200,c_net:-14600,c_net_chg:-180,c_long_pct:11.2,c_short_pct:30.2,nr_long:3700,nr_short:2560,nr_net:1140},
    {date:"2026-05-06",oi:74300,nc_long:19170,nc_short:8020,nc_net:11150,nc_net_chg:-380,nc_long_pct:25.8,nc_short_pct:10.8,c_long:8300,c_short:22800,c_net:-14500,c_net_chg:220,c_long_pct:11.2,c_short_pct:30.7,nr_long:3500,nr_short:2400,nr_net:1100},
    {date:"2026-04-29",oi:72100,nc_long:18500,nc_short:7970,nc_net:10530,nc_net_chg:290,nc_long_pct:25.7,nc_short_pct:11.1,c_long:8100,c_short:22300,c_net:-14200,c_net_chg:100,c_long_pct:11.2,c_short_pct:30.9,nr_long:3350,nr_short:2310,nr_net:1040},
    {date:"2026-04-22",oi:69800,nc_long:18210,nc_short:7970,nc_net:10240,nc_net_chg:520,nc_long_pct:26.1,nc_short_pct:11.4,c_long:7900,c_short:21800,c_net:-13900,c_net_chg:140,c_long_pct:11.3,c_short_pct:31.2,nr_long:3200,nr_short:2140,nr_net:1060},
    {date:"2026-04-15",oi:67200,nc_long:17690,nc_short:8000,nc_net:9690,nc_net_chg:-80,nc_long_pct:26.3,nc_short_pct:11.9,c_long:7650,c_short:21400,c_net:-13750,c_net_chg:-60,c_long_pct:11.4,c_short_pct:31.8,nr_long:3100,nr_short:2040,nr_net:1060},
    {date:"2026-04-08",oi:65500,nc_long:17130,nc_short:7820,nc_net:9310,nc_net_chg:360,nc_long_pct:26.2,nc_short_pct:11.9,c_long:7400,c_short:21000,c_net:-13600,c_net_chg:90,c_long_pct:11.3,c_short_pct:32.1,nr_long:3020,nr_short:1930,nr_net:1090},
  ],
  ETH: [
    {date:"2026-06-10",oi:32100,nc_long:8200,nc_short:3450,nc_net:4750,nc_net_chg:310,nc_long_pct:25.5,nc_short_pct:10.7,c_long:3100,c_short:9800,c_net:-6700,c_net_chg:-150,c_long_pct:9.7,c_short_pct:30.5,nr_long:1450,nr_short:1050,nr_net:400},
    {date:"2026-06-03",oi:31400,nc_long:7890,nc_short:3450,nc_net:4440,nc_net_chg:120,nc_long_pct:25.1,nc_short_pct:11.0,c_long:3050,c_short:9600,c_net:-6550,c_net_chg:-80,c_long_pct:9.7,c_short_pct:30.6,nr_long:1400,nr_short:1000,nr_net:400},
    {date:"2026-05-27",oi:30700,nc_long:7770,nc_short:3450,nc_net:4320,nc_net_chg:-80,nc_long_pct:25.3,nc_short_pct:11.2,c_long:2980,c_short:9400,c_net:-6420,c_net_chg:60,c_long_pct:9.7,c_short_pct:30.6,nr_long:1360,nr_short:970,nr_net:390},
    {date:"2026-05-20",oi:29900,nc_long:7520,nc_short:3120,nc_net:4400,nc_net_chg:190,nc_long_pct:25.2,nc_short_pct:10.4,c_long:2900,c_short:9200,c_net:-6300,c_net_chg:30,c_long_pct:9.7,c_short_pct:30.8,nr_long:1320,nr_short:940,nr_net:380},
    {date:"2026-05-13",oi:28800,nc_long:7330,nc_short:3120,nc_net:4210,nc_net_chg:240,nc_long_pct:25.5,nc_short_pct:10.8,c_long:2820,c_short:8980,c_net:-6160,c_net_chg:-40,c_long_pct:9.8,c_short_pct:31.2,nr_long:1280,nr_short:920,nr_net:360},
    {date:"2026-05-06",oi:27600,nc_long:7090,nc_short:3120,nc_net:3970,nc_net_chg:-140,nc_long_pct:25.7,nc_short_pct:11.3,c_long:2750,c_short:8800,c_net:-6050,c_net_chg:80,c_long_pct:10.0,c_short_pct:31.9,nr_long:1230,nr_short:880,nr_net:350},
    {date:"2026-04-29",oi:26300,nc_long:6800,nc_short:2910,nc_net:3890,nc_net_chg:110,nc_long_pct:25.9,nc_short_pct:11.1,c_long:2680,c_short:8610,c_net:-5930,c_net_chg:30,c_long_pct:10.2,c_short_pct:32.7,nr_long:1190,nr_short:840,nr_net:350},
    {date:"2026-04-22",oi:25100,nc_long:6690,nc_short:2910,nc_net:3780,nc_net_chg:200,nc_long_pct:26.7,nc_short_pct:11.6,c_long:2600,c_short:8420,c_net:-5820,c_net_chg:50,c_long_pct:10.4,c_short_pct:33.5,nr_long:1140,nr_short:800,nr_net:340},
  ],
};

const DEMO_MACRO: MacroItem[] = [
  {key:"DXY",   label:"Индекс доллара USD",  price:99.21,  change:-0.44, changePct:-0.44},
  {key:"US10Y", label:"US 10Y Treasury",     price:4.41,   change:0.03,  changePct:0.68},
  {key:"SPX",   label:"S&P 500",             price:5921.0, change:42.1,  changePct:0.72},
  {key:"GOLD",  label:"Золото XAU/USD",      price:3247.5, change:18.3,  changePct:0.57},
  {key:"OIL",   label:"Нефть WTI",           price:61.8,   change:-0.94, changePct:-1.50},
  {key:"VIX",   label:"VIX",                 price:17.2,   change:-0.80, changePct:-4.44},
];

const DEMO_ETF = {
  total_btc: 1_237_000,
  etfs: [
    {name:"BlackRock IBIT",    ticker:"IBIT",  btc:907000, aum_usd:61_200_000_000, price:63.42, change:1.18, changePct:1.89, sharePct:73.3},
    {name:"Fidelity FBTC",     ticker:"FBTC",  btc:214000, aum_usd:14_420_000_000, price:97.55, change:1.81, changePct:1.89, sharePct:17.3},
    {name:"ARK 21Shares ARKB", ticker:"ARKB",  btc:47200,  aum_usd:3_182_000_000,  price:37.14, change:0.69, changePct:1.89, sharePct:3.8},
    {name:"Bitwise BITB",      ticker:"BITB",  btc:40100,  aum_usd:2_702_000_000,  price:38.87, change:0.73, changePct:1.91, sharePct:3.2},
    {name:"VanEck HODL",       ticker:"HODL",  btc:16200,  aum_usd:1_092_000_000,  price:31.74, change:0.59, changePct:1.89, sharePct:1.3},
    {name:"Invesco BTCO",      ticker:"BTCO",  btc:6800,   aum_usd:458_000_000,    price:111.6, change:2.07, changePct:1.89, sharePct:0.5},
    {name:"Franklin EZBC",     ticker:"EZBC",  btc:5700,   aum_usd:384_000_000,    price:64.81, change:1.20, changePct:1.89, sharePct:0.5},
  ] as EtfItem[],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number, dec = 0) {
  return n.toLocaleString("en-US", {minimumFractionDigits: dec, maximumFractionDigits: dec});
}
function fmtK(n: number) {
  return Math.abs(n) >= 1000 ? (n / 1000).toFixed(1) + "K" : String(n);
}
function signColor(n: number) {
  return n > 0 ? "text-success" : n < 0 ? "text-danger" : "text-text-muted";
}
function signBg(n: number) {
  return n > 0
    ? "bg-success/10 border-success/20"
    : n < 0
    ? "bg-danger/10 border-danger/20"
    : "bg-white/[0.04] border-white/[0.08]";
}
function Arrow({n}: {n: number}) {
  if (n > 0) return <TrendingUp  className="h-3.5 w-3.5 text-success" />;
  if (n < 0) return <TrendingDown className="h-3.5 w-3.5 text-danger" />;
  return <Minus className="h-3.5 w-3.5 text-text-muted" />;
}

async function fetchJson<T>(url: string, opts?: RequestInit): Promise<T | null> {
  try {
    const r = await fetch(url, { ...opts, headers: { "ngrok-skip-browser-warning": "1", ...(opts?.headers || {}) } });
    if (!r.ok) return null;
    return r.json() as Promise<T>;
  } catch {
    return null;
  }
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({icon, title, sub, badge, children}: {
  icon: React.ReactNode; title: string; sub?: string;
  badge?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-bg-panel">
      <div className="flex items-center gap-2 border-b border-border/40 px-4 py-3">
        {icon}
        <span className="text-[13px] font-semibold text-white">{title}</span>
        {badge}
        {sub && <span className="ml-auto text-[10px] text-text-muted">{sub}</span>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function DemoBadge() {
  return (
    <span className="rounded border border-accent-gold/40 bg-accent-gold/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-accent-gold">
      ДЕМО
    </span>
  );
}

function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-8 rounded-lg bg-white/[0.05]" style={{ width: `${75 + (i % 3) * 10}%` }} />
      ))}
    </div>
  );
}

// ── COT Section ───────────────────────────────────────────────────────────────

function CotSection() {
  const [asset, setAsset]     = useState<"BTC" | "ETH">("BTC");
  const [cot,   setCot]       = useState<CotRow[] | null>(null);
  const [isDemo, setIsDemo]   = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetchJson<{cot: CotRow[]; demo?: boolean}>(`${API_URL}/api/institutional/cot/${asset}`)
      .then(d => {
        if (cancelled) return;
        if (d?.cot?.length) {
          setCot(d.cot);
          setIsDemo(!!d.demo);
        } else {
          setCot(DEMO_COT[asset]);
          setIsDemo(true);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [asset]);

  const cur     = cot?.[0] as CotRow;
  const prev    = cot?.[1] as CotRow | undefined;
  const maxNet  = cot ? Math.max(...cot.map(r => Math.abs(r.nc_net)), 1) : 1;

  return (
    <Section
      icon={<Building2 className="h-4 w-4 text-accent-gold" />}
      title="COT - Позиции институционалов"
      badge={isDemo ? <DemoBadge /> : undefined}
      sub={!cot ? "CFTC · загрузка…" : isDemo ? "CFTC · ориентировочные данные" : "CFTC CME · актуально"}
    >
      {/* Asset tabs */}
      <div className="mb-4 flex items-center gap-1">
        {/* tabs always visible so user can switch while loading */}
        {(["BTC", "ETH"] as const).map(a => (
          <button
            key={a}
            onClick={() => setAsset(a)}
            className={`rounded-lg px-4 py-1.5 text-[12px] font-semibold transition ${
              asset === a
                ? "bg-accent-gold/15 text-accent-gold"
                : "text-text-muted hover:bg-white/[0.05] hover:text-white"
            }`}
          >
            {a}
          </button>
        ))}
        {loading && (
          <div className="ml-2 h-3.5 w-3.5 animate-spin rounded-full border border-accent-gold/30 border-t-accent-gold" />
        )}
      </div>

      {!cot ? <Skeleton rows={5} /> : <>

      {isDemo && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-accent-gold/20 bg-accent-gold/[0.06] px-3 py-2 text-[11px] text-accent-gold">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          CFTC API недоступен - отображаются ориентировочные данные на основе реальной структуры отчётов
        </div>
      )}

      <div className="space-y-5">

        {/* 3 KPI cards */}
        <div className="grid grid-cols-3 gap-3">
          <div className={`rounded-xl border p-4 ${signBg(cur.nc_net)}`}>
            <div className="mb-1 text-[9px] uppercase tracking-wider text-text-muted">Хедж-фонды нетто</div>
            <div className={`font-mono text-[22px] font-bold leading-none ${signColor(cur.nc_net)}`}>
              {cur.nc_net > 0 ? "+" : ""}{fmtK(cur.nc_net)}
            </div>
            <div className="mt-1.5 flex items-center gap-1">
              <Arrow n={cur.nc_net_chg} />
              <span className={`font-mono text-[11px] ${signColor(cur.nc_net_chg)}`}>
                {cur.nc_net_chg > 0 ? "+" : ""}{fmtK(cur.nc_net_chg)} нед.
              </span>
            </div>
          </div>

          <div className={`rounded-xl border p-4 ${signBg(cur.c_net)}`}>
            <div className="mb-1 text-[9px] uppercase tracking-wider text-text-muted">Коммерческие нетто</div>
            <div className={`font-mono text-[22px] font-bold leading-none ${signColor(cur.c_net)}`}>
              {cur.c_net > 0 ? "+" : ""}{fmtK(cur.c_net)}
            </div>
            <div className="mt-1.5 flex items-center gap-1">
              <Arrow n={cur.c_net_chg} />
              <span className={`font-mono text-[11px] ${signColor(cur.c_net_chg)}`}>
                {cur.c_net_chg > 0 ? "+" : ""}{fmtK(cur.c_net_chg)} нед.
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
            <div className="mb-1 text-[9px] uppercase tracking-wider text-text-muted">Открытый интерес</div>
            <div className="font-mono text-[22px] font-bold leading-none text-white">
              {fmtK(cur.oi)}
            </div>
          </div>
        </div>

        {/* Long/Short bar */}
        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-wider text-text-muted">
            Хедж-фонды - структура позиций (% от ОИ)
          </div>
          <div className="mb-1 flex justify-between text-[10px]">
            <span className="text-text-muted">Lev. Money (хедж-фонды)</span>
            <div className="flex gap-3">
              <span className="font-mono text-success">L {cur.nc_long_pct.toFixed(1)}%</span>
              <span className="font-mono text-danger">S {cur.nc_short_pct.toFixed(1)}%</span>
            </div>
          </div>
          <div className="flex h-3 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full bg-success/60" style={{width:`${cur.nc_long_pct}%`}} />
            <div className="h-full bg-danger/60"  style={{width:`${cur.nc_short_pct}%`}} />
          </div>
          <div className="mt-1 flex justify-between text-[10px]">
            <span className="text-text-muted">Asset Manager (институт.)</span>
            <div className="flex gap-3">
              <span className="font-mono text-success">L {cur.c_long_pct.toFixed(1)}%</span>
              <span className="font-mono text-danger">S {cur.c_short_pct.toFixed(1)}%</span>
            </div>
          </div>
          <div className="mt-1 flex h-3 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full bg-success/40" style={{width:`${cur.c_long_pct}%`}} />
            <div className="h-full bg-danger/40"  style={{width:`${cur.c_short_pct}%`}} />
          </div>
        </div>

        {/* History bars */}
        <div>
          <div className="mb-2 text-[10px] uppercase tracking-wider text-text-muted">
            Нетто позиция хедж-фондов - {cot.length} нед.
          </div>
          <div className="flex items-end gap-1.5" style={{height:56}}>
            {[...cot].reverse().map((row, i) => {
              const h = Math.max((Math.abs(row.nc_net) / maxNet) * 52, 4);
              return (
                <div key={i} className="flex flex-1 flex-col items-center justify-end" style={{height:56}}
                  title={`${row.date}: ${row.nc_net > 0 ? "+" : ""}${fmt(row.nc_net)}`}>
                  <div
                    className={`w-full rounded-[2px] ${row.nc_net >= 0 ? "bg-success/65" : "bg-danger/65"}`}
                    style={{height:`${h}px`}}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-1 text-center text-[9px] text-text-muted">
            ← старше · новее →
          </div>
        </div>

        {/* Footer note */}
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[10px] leading-relaxed text-text-muted">
          <span className="font-semibold text-accent-gold">Leveraged Money нетто &gt; 0</span> - хедж-фонды в лонге, бычий сигнал.{" "}
          <span className="font-semibold text-accent-gold">Asset Manager</span> - институциональные, часто контртрендовые.{" "}
          {prev && (
            <>
              Недельное изменение нетто:{" "}
              <span className={signColor(cur.nc_net - prev.nc_net)}>
                {cur.nc_net >= prev.nc_net ? "▲" : "▼"} {Math.abs(cur.nc_net - prev.nc_net).toLocaleString()}
              </span>
              {" · "}
            </>
          )}
          <span className="text-text-muted/60">CFTC публикует каждую пятницу - данные за предыдущий вторник.</span>
        </div>
      </div>

      </>}
    </Section>
  );
}

// ── Macro Section ─────────────────────────────────────────────────────────────

const MACRO_CONTEXT: Record<string, string> = {
  DXY:   "Сильный $ давит крипто",
  US10Y: "Рост доходности = риск-офф",
  SPX:   "Корреляция с крипто ~0.6",
  GOLD:  "Хедж от инфляции",
  OIL:   "Proxy на глобальный спрос",
  VIX:   ">25 страх · <15 жадность",
};

function MacroSection() {
  const [items, setItems]   = useState<MacroItem[] | null>(null);
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    fetchJson<{indicators: Record<string, MacroItem>; demo?: boolean}>(`${API_URL}/api/institutional/macro`)
      .then(d => {
        if (d?.indicators) {
          const list = Object.values(d.indicators);
          if (list.some(v => v.price > 0)) {
            setItems(list);
            setIsDemo(!!d.demo);
          } else {
            setItems(DEMO_MACRO);
            setIsDemo(true);
          }
        } else {
          setItems(DEMO_MACRO);
          setIsDemo(true);
        }
      });
  }, []);

  return (
    <Section
      icon={<BarChart3 className="h-4 w-4 text-accent-cyan" />}
      title="Макро индикаторы"
      badge={isDemo ? <DemoBadge /> : undefined}
      sub={!items ? "загрузка…" : isDemo ? "Yahoo Finance · ориентировочные данные" : "Yahoo Finance · live"}
    >
      {!items ? <Skeleton rows={3} /> : <>

      {isDemo && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-accent-gold/20 bg-accent-gold/[0.06] px-3 py-2 text-[11px] text-accent-gold">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          Yahoo Finance недоступен - ориентировочные данные
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map(item => {
          const pos = item.changePct >= 0;
          const dec = item.key === "US10Y" || item.key === "VIX" ? 2 : item.price > 1000 ? 1 : 2;
          return (
            <div
              key={item.key}
              className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 transition hover:border-white/20"
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-text-muted">{item.label}</span>
                <span className="font-mono text-[9px] text-accent-gold">{item.key}</span>
              </div>
              <div className="font-mono text-[18px] font-bold leading-none text-white">
                {fmt(item.price, dec)}
              </div>
              <div className={`mt-1.5 flex items-center gap-1 font-mono text-[11px] ${pos ? "text-success" : "text-danger"}`}>
                {pos ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {pos ? "+" : ""}{item.changePct.toFixed(2)}%
              </div>
              <div className="mt-1.5 text-[9px] text-text-muted/70">{MACRO_CONTEXT[item.key]}</div>
            </div>
          );
        })}
      </div>

      </>}
    </Section>
  );
}

// ── ETF Section ───────────────────────────────────────────────────────────────

function EtfSection() {
  const [data, setData]         = useState<typeof DEMO_ETF | null>(null);
  const [isDemo, setIsDemo]     = useState(false);
  const [btcPrice, setBtcPrice] = useState(0);

  useEffect(() => {
    fetchJson<{etfs: EtfItem[]; total_btc: number; btc_price?: number}>(`${API_URL}/api/institutional/etf-flows`)
      .then(d => {
        if (d?.etfs?.length) {
          setData(d);
          if (d.btc_price) setBtcPrice(d.btc_price);
          const hasLiveBtc = d.etfs.some(e => e.btc > 0);
          setIsDemo(!hasLiveBtc);
        } else {
          setData(DEMO_ETF);
          setIsDemo(true);
        }
      });
  }, []);

  return (
    <Section
      icon={<DollarSign className="h-4 w-4 text-success" />}
      title="Bitcoin Spot ETF - Институциональные холдинги"
      badge={isDemo ? <DemoBadge /> : undefined}
      sub={!data ? "загрузка…" : isDemo ? "оценочные данные" : "Nasdaq · Yahoo Finance · CoinGecko · live"}
    >
      {!data ? <Skeleton rows={5} /> : <div className="space-y-4">

        {/* Total BTC banner */}
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-accent-gold/20 bg-accent-gold/[0.06] px-4 py-3">
          <div>
            <div className="text-[9px] uppercase tracking-wider text-text-muted">Всего BTC в ETF</div>
            <div className="font-mono text-[26px] font-bold leading-none text-accent-gold">
              ~{(data.total_btc / 1000).toFixed(0)}K
              <span className="ml-1 text-[14px] font-medium">BTC</span>
            </div>
          </div>
          <div className="h-10 w-px bg-white/[0.08]" />
          <div>
            <div className="text-[9px] uppercase tracking-wider text-text-muted">% от эмиссии</div>
            <div className="font-mono text-[20px] font-bold leading-none text-white">
              {((data.total_btc / 21_000_000) * 100).toFixed(2)}%
            </div>
          </div>
          <div className="h-10 w-px bg-white/[0.08]" />
          {btcPrice > 0 && (
            <>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-text-muted">BTC/USD</div>
                <div className="font-mono text-[20px] font-bold leading-none text-accent-cyan">
                  ${btcPrice.toLocaleString("en-US")}
                </div>
              </div>
              <div className="h-10 w-px bg-white/[0.08]" />
            </>
          )}
          <div>
            <div className="text-[9px] uppercase tracking-wider text-text-muted">Фондов</div>
            <div className="font-mono text-[20px] font-bold leading-none text-white">{data.etfs.length}</div>
          </div>
        </div>

        {/* ETF rows */}
        <div className="space-y-1.5">
          <div className="grid grid-cols-[1fr_70px_65px_55px_80px] gap-2 px-2 text-[9px] uppercase tracking-wider text-text-muted">
            <span>Фонд</span>
            <span className="text-right">BTC</span>
            <span className="text-right">AUM</span>
            <span className="text-right">Доля</span>
            <span className="text-right">Цена ETF</span>
          </div>

          {data.etfs.map((etf, i) => (
            <div key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
              <div className="grid grid-cols-[1fr_70px_65px_55px_80px] items-center gap-2">
                <div>
                  <div className="text-[12px] font-bold text-white">{etf.ticker}</div>
                  <div className="text-[9px] text-text-muted">{etf.name}</div>
                </div>
                <div className="text-right font-mono text-[11px] text-white">
                  {etf.btc > 0 ? `${(etf.btc / 1000).toFixed(0)}K` : "-"}
                </div>
                <div className="text-right font-mono text-[10px] text-text-muted">
                  {etf.aum_usd && etf.aum_usd > 0
                    ? `$${(etf.aum_usd / 1e9).toFixed(1)}B`
                    : "-"}
                </div>
                <div className="text-right font-mono text-[11px] text-accent-cyan">
                  {etf.sharePct}%
                </div>
                <div className="text-right">
                  <div className="font-mono text-[11px] text-white">
                    {etf.price > 0 ? `$${etf.price}` : "-"}
                  </div>
                  {etf.price > 0 && (
                    <div className={`font-mono text-[9px] ${etf.changePct >= 0 ? "text-success" : "text-danger"}`}>
                      {etf.changePct >= 0 ? "+" : ""}{etf.changePct.toFixed(2)}%
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-white/[0.06]">
                <div className="h-full rounded-full bg-accent-gold/50" style={{width:`${etf.sharePct}%`}} />
              </div>
            </div>
          ))}
        </div>

        <p className="text-[9px] text-text-muted/60">
          AUM и BTC холдинги - Nasdaq API (live). Цены ETF - Yahoo Finance. BTC/USD - CoinGecko.
        </p>
      </div>}
    </Section>
  );
}

// ── Derivatives Section (реальные данные Bybit) ───────────────────────────────

const ALT_ME_API = "https://api.alternative.me/fng/?limit=1";
const COINGECKO_API = "https://api.coingecko.com/api/v3";
const SKIP = { headers: { "ngrok-skip-browser-warning": "1" } };
const DERIV_SYMS = ["BTC", "ETH", "SOL", "XRP", "BNB"];
const FR_SYMS = ["BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT","BNBUSDT","DOGEUSDT","ADAUSDT","AVAXUSDT","LINKUSDT","DOTUSDT"];

interface DerivRow {
  sym: string; oi: number; oiChg: number;
  longPct: number; shortPct: number; fr: number; pct24h?: number;
}

function fmtB(n: number) {
  if (n >= 1e9) return `$${(n/1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n/1e6).toFixed(0)}M`;
  return `$${n.toFixed(0)}`;
}

function DerivativesSection() {
  const [rows, setRows]     = useState<DerivRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState("");

  useEffect(() => {
    const load = async () => {
      const results = await Promise.all(
        DERIV_SYMS.map(async sym => {
          const ticker = sym + "USDT";
          const [derivRes, tkRes] = await Promise.allSettled([
            fetch(`${API_URL}/api/market/derivatives/${ticker}`, SKIP).then(r => r.json()),
            fetch(`${API_URL}/api/market/ticker/${ticker}`, SKIP).then(r => r.json()),
          ]);

          const d  = derivRes.status === "fulfilled" ? derivRes.value : null;
          const tk = tkRes.status    === "fulfilled" ? tkRes.value    : null;

          const fr  = parseFloat(d?.fundingRate ?? tk?.fundingRate ?? "0");
          const pct = parseFloat(d?.priceChangePct ?? tk?.priceChangePercent ?? "0");
          const oi  = parseFloat(d?.openInterestUsd ?? "0");

          return {
            sym,
            oi,
            oiChg:    0,   // WEEX не отдаёт исторический OI — показываем текущий
            longPct:  50,  // WEEX не имеет public L/S ratio endpoint
            shortPct: 50,
            fr,
            pct24h:   pct,
          } satisfies DerivRow & { pct24h: number };
        })
      );
      setRows(results);
      setUpdatedAt(new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }));
      setLoading(false);
    };
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const totalOI  = rows.reduce((s, r) => s + r.oi, 0);
  const btcLong  = rows[0]?.longPct ?? 50;

  return (
    <Section
      icon={<Activity className="h-4 w-4 text-accent-cyan" />}
      title="Деривативы - открытый интерес и лонг/шорт"
      badge={<span className="rounded border border-success/40 bg-success/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-success">LIVE</span>}
      sub={updatedAt ? `Bybit · обновлено ${updatedAt}` : "Bybit · загрузка…"}
    >
      {loading ? <Skeleton rows={5} /> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              { label:"Общий OI",      value: fmtB(totalOI),    color:"text-white"   },
              { label:"BTC лонг",      value:`${btcLong.toFixed(1)}%`, color:"text-success" },
              { label:"BTC шорт",      value:`${(100 - btcLong).toFixed(1)}%`, color:"text-danger" },
            ].map(s => (
              <div key={s.label} className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 text-center">
                <div className="text-[9px] uppercase tracking-wider text-white/25">{s.label}</div>
                <div className={`mt-1 font-mono text-[14px] font-bold tabular-nums ${s.color}`}>{s.value}</div>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <div className="grid grid-cols-[44px_1fr_80px_70px_70px] gap-2 px-2 text-[9px] uppercase tracking-wider text-text-muted">
              <span>Пара</span><span>Funding rate</span>
              <span className="text-right">OI (USDT)</span>
              <span className="text-right">24ч цена</span>
              <span className="text-right">Сигнал</span>
            </div>
            {rows.map(r => {
              const fr = r.fr;
              const frPct = fr * 100;
              const frCol = fr > 0.01 ? "text-danger" : fr > 0 ? "text-amber-400" : fr < -0.001 ? "text-success" : "text-text-muted";
              const signal = fr > 0.01 ? "Перегрев" : fr > 0.001 ? "Лонги" : fr < -0.001 ? "Шорты" : "Нейтр.";
              const signalCol = fr > 0.001 ? "text-danger" : fr < -0.001 ? "text-success" : "text-text-muted";
              const pct = r.pct24h ?? 0;
              return (
                <div key={r.sym} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                  <div className="grid grid-cols-[44px_1fr_80px_70px_70px] items-center gap-2">
                    <span className="font-bold text-[13px] text-white">{r.sym}</span>
                    <div>
                      <div className={`font-mono text-[14px] font-bold ${frCol}`}>
                        {fr >= 0 ? "+" : ""}{frPct.toFixed(4)}%
                      </div>
                      <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-white/[0.06]">
                        <div className="h-full rounded-full transition-all"
                          style={{ width:`${Math.min(100, Math.abs(frPct) / 0.05 * 100)}%`,
                            backgroundColor: fr > 0 ? "#f6465d" : "#0ecb81", opacity: 0.6 }} />
                      </div>
                    </div>
                    <div className="text-right font-mono text-[11px] text-white">
                      {r.oi > 0 ? fmtB(r.oi) : "—"}
                    </div>
                    <div className={`text-right font-mono text-[11px] ${pct >= 0 ? "text-success" : "text-danger"}`}>
                      {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
                    </div>
                    <div className={`text-right text-[11px] font-semibold ${signalCol}`}>{signal}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[9px] text-white/20">
            Данные WEEX · Funding {">"} 0% = лонги переплачивают (перегрев рынка)
          </p>
        </>
      )}
    </Section>
  );
}

// ── Onchain / Global Market Section (реальные данные) ────────────────────────

interface GlobalData {
  fearGreed:   { value: number; label: string };
  btcDom:      number;
  ethDom:      number;
  stableDom:   number;
  totalMcap:   number;
  mcapChg24h:  number;
  vol24h:      number;
}

const FG_LABEL_RU: Record<string, string> = {
  "Extreme Fear": "Крайний страх",
  "Fear":         "Страх",
  "Neutral":      "Нейтрально",
  "Greed":        "Жадность",
  "Extreme Greed":"Крайняя жадность",
};

function OnchainSection() {
  const [data, setData]       = useState<GlobalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState("");

  useEffect(() => {
    const load = async () => {
      const [fgRes, cgRes] = await Promise.allSettled([
        fetch(ALT_ME_API).then(r => r.json()),
        fetch(`${COINGECKO_API}/global`).then(r => r.json()),
      ]);

      const fg = fgRes.status === "fulfilled" ? fgRes.value?.data?.[0] : null;
      const cg = cgRes.status === "fulfilled" ? cgRes.value?.data : null;

      if (!fg && !cg) return;

      const pct = cg?.market_cap_percentage ?? {};
      setData({
        fearGreed:  { value: fg ? parseInt(fg.value) : 50, label: FG_LABEL_RU[fg?.value_classification ?? ""] ?? fg?.value_classification ?? "--" },
        btcDom:     pct.btc  ?? 0,
        ethDom:     pct.eth  ?? 0,
        stableDom:  (pct.usdt ?? 0) + (pct.usdc ?? 0),
        totalMcap:  cg?.total_market_cap?.usd ?? 0,
        mcapChg24h: cg?.market_cap_change_percentage_24h_usd ?? 0,
        vol24h:     cg?.total_volume?.usd ?? 0,
      });
      setUpdatedAt(new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }));
      setLoading(false);
    };
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const d = data;
  const fgVal = d?.fearGreed.value ?? 0;
  const fgColor = fgVal >= 75 ? "#f6465d" : fgVal >= 55 ? "#f0b90b" : fgVal >= 45 ? "#9ca3af" : fgVal >= 25 ? "#0affe0" : "#0ecb81";
  const fgArc  = fgVal / 100;
  const altSeason = d ? Math.max(0, 100 - d.btcDom - d.ethDom) : 0;

  return (
    <Section
      icon={<Zap className="h-4 w-4 text-accent-cyan" />}
      title="Настроение и структура рынка"
      badge={<span className="rounded border border-success/40 bg-success/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-success">LIVE</span>}
      sub={updatedAt ? `Alternative.me · CoinGecko · ${updatedAt}` : "загрузка…"}
    >
      {loading || !d ? <Skeleton rows={4} /> : (
        <>
          {/* Fear & Greed + Dominance row */}
          <div className="mb-4 grid grid-cols-2 gap-3">
            {/* Fear & Greed */}
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3 text-center">
              <div className="text-[9px] uppercase tracking-wider text-white/25 mb-1">Fear & Greed Index</div>
              <svg viewBox="0 0 120 62" className="w-full max-w-[130px] mx-auto overflow-visible">
                {[
                  {from:0, to:0.25, col:"#0ecb81"}, {from:0.25, to:0.45, col:"#5ac87a"},
                  {from:0.45, to:0.55, col:"#9ca3af"}, {from:0.55, to:0.75, col:"#f0b90b"},
                  {from:0.75, to:1, col:"#f6465d"},
                ].map((z,i) => {
                  const r=46, cx=60, cy=56;
                  const a1=Math.PI-z.from*Math.PI, a2=Math.PI-z.to*Math.PI;
                  return <path key={i} fill="none" stroke={z.col} strokeWidth="8" opacity="0.22"
                    d={`M ${cx+r*Math.cos(a1)} ${cy-r*Math.sin(a1)} A ${r} ${r} 0 0 1 ${cx+r*Math.cos(a2)} ${cy-r*Math.sin(a2)}`}/>;
                })}
                <path d={`M ${60-46} 56 A 46 46 0 0 1 ${60+46} 56`} fill="none"
                  stroke={fgColor} strokeWidth="8" strokeLinecap="round" opacity="0.55"
                  strokeDasharray={`${fgArc*Math.PI*46} ${Math.PI*46}`}
                  style={{transition:"stroke-dasharray 0.8s ease"}}/>
                <text x="60" y="52" textAnchor="middle" fill="white" fontSize="19" fontWeight="bold" fontFamily="monospace">{fgVal}</text>
              </svg>
              <div className="text-[11px] font-bold" style={{color: fgColor}}>{d.fearGreed.label}</div>
            </div>

            {/* Dominance pie */}
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
              <div className="text-[9px] uppercase tracking-wider text-white/25 mb-3">Доминация</div>
              <div className="space-y-2">
                {[
                  { label:"BTC",    val:d.btcDom,    col:"#f0b90b" },
                  { label:"ETH",    val:d.ethDom,    col:"#627eea" },
                  { label:"Stable", val:d.stableDom, col:"#26a17b" },
                  { label:"Альты",  val:altSeason,   col:"#0affe0" },
                ].map(x => (
                  <div key={x.label}>
                    <div className="flex justify-between text-[9px] mb-0.5">
                      <span style={{color:x.col}}>{x.label}</span>
                      <span className="font-mono text-white">{x.val.toFixed(1)}%</span>
                    </div>
                    <div className="h-[4px] overflow-hidden rounded-full bg-white/[0.06]">
                      <div className="h-full rounded-full" style={{width:`${x.val}%`, backgroundColor:x.col, opacity:0.7,
                        transition:"width 0.8s ease"}}/>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Market cap stats */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              { label:"Капитализация",   value: d.totalMcap >= 1e12 ? `$${(d.totalMcap/1e12).toFixed(2)}T` : `$${(d.totalMcap/1e9).toFixed(0)}B`,
                sub:`${d.mcapChg24h >= 0 ? "+" : ""}${d.mcapChg24h.toFixed(2)}% 24ч`, pos:d.mcapChg24h >= 0 },
              { label:"Объём 24ч",       value: d.vol24h >= 1e12 ? `$${(d.vol24h/1e12).toFixed(2)}T` : `$${(d.vol24h/1e9).toFixed(0)}B`,
                sub:"суммарный", pos:true },
              { label:"Альт-сезон",      value:`${altSeason.toFixed(1)}%`,
                sub: altSeason > 40 ? "Сезон альтов" : altSeason > 25 ? "Смешанный" : "Доминация BTC",
                pos: altSeason > 30 },
            ].map(m => (
              <div key={m.label} className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-2.5">
                <div className="text-[9px] uppercase tracking-wider text-white/25">{m.label}</div>
                <div className="mt-1 font-mono text-[14px] font-bold text-white">{m.value}</div>
                <div className={`text-[9px] mt-0.5 ${m.pos ? "text-success" : "text-danger"}`}>{m.sub}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

// ── Funding Rates Heatmap (реальный бэкенд) ───────────────────────────────────

interface FrRow { sym: string; fr: number; pct24h: number; nextFunding: number; price: number; }

function FundingHeatmapSection() {
  const [rows, setRows]       = useState<FrRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState("");

  useEffect(() => {
    const load = async () => {
      // Один запрос к нашему бэкенду — он сам ходит в WEEX
      const res = await fetch(`${API_URL}/api/market/funding-rates`, SKIP)
        .then(r => r.json())
        .catch(() => null);

      const rateMap = new Map<string, Record<string, unknown>>(
        (res?.rates ?? []).map((r: Record<string, unknown>) => [r.symbol as string, r])
      );

      // Для 24ч цены берём ticker параллельно (уже есть кэш в бэкенде)
      const tickers = await Promise.all(
        FR_SYMS.map(sym =>
          fetch(`${API_URL}/api/market/ticker/${sym}`, SKIP)
            .then(r => r.ok ? r.json() : null).catch(() => null)
        )
      );

      const results = FR_SYMS.map((sym, i) => {
        const rate = rateMap.get(sym) ?? {};
        const tk   = tickers[i] ?? {};
        return {
          sym:         sym.replace("USDT", ""),
          fr:          parseFloat((rate.fundingRate as string) ?? "0"),
          pct24h:      parseFloat((tk.priceChangePercent as string) ?? "0"),
          nextFunding: parseInt((rate.nextFundingTime as string) ?? "0") || 0,
          price:       parseFloat((tk.lastPrice as string) ?? "0"),
        };
      });

      setRows(results);
      setUpdatedAt(new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }));
      setLoading(false);
    };
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  const avgFr   = rows.length ? rows.reduce((s, r) => s + r.fr, 0) / rows.length : 0;
  const bullish = rows.filter(r => r.fr < -0.0001).length;
  const bearish = rows.filter(r => r.fr >  0.0001).length;
  const maxAbsFr = Math.max(...rows.map(r => Math.abs(r.fr)), 0.0001);

  function frTheme(fr: number) {
    if (fr >  0.025) return { color: "#f6465d", glow: "rgba(246,70,93,0.35)",  bg: "rgba(246,70,93,0.10)",  border: "rgba(246,70,93,0.28)",  label: "ПЕРЕГРЕВ" };
    if (fr >  0.010) return { color: "#f59e0b", glow: "rgba(245,158,11,0.30)", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.22)", label: "ЛОНГИ" };
    if (fr >  0.0001)return { color: "#9ca3af", glow: "transparent",           bg: "rgba(255,255,255,0.03)",border: "rgba(255,255,255,0.08)", label: "НЕЙТР." };
    if (fr > -0.0001)return { color: "#9ca3af", glow: "transparent",           bg: "rgba(255,255,255,0.03)",border: "rgba(255,255,255,0.08)", label: "НЕЙТР." };
    if (fr > -0.010) return { color: "#0ecb81", glow: "rgba(14,203,129,0.30)", bg: "rgba(14,203,129,0.08)", border: "rgba(14,203,129,0.22)", label: "ШОРТЫ" };
    return              { color: "#0affe0", glow: "rgba(10,255,224,0.35)",  bg: "rgba(10,255,224,0.10)", border: "rgba(10,255,224,0.28)", label: "ДИСКОНТ" };
  }

  function fmtNextFunding(ts: number) {
    if (!ts) return "";
    const diff = ts - Date.now();
    if (diff <= 0) return "сейчас";
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    return h > 0 ? `${h}ч ${m}м` : `${m}м`;
  }

  return (
    <Section
      icon={<DollarSign className="h-4 w-4 text-accent-gold" />}
      title="Ставки финансирования (8ч)"
      badge={<span className="rounded border border-success/40 bg-success/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-success">LIVE</span>}
      sub={updatedAt ? `Bybit · обновлено ${updatedAt}` : "загрузка…"}
    >
      {loading ? <Skeleton rows={4} /> : (
        <>
          {/* Summary */}
          <div className="mb-5 grid grid-cols-3 gap-3">
            {[
              { label:"Средний FR",   value:`${avgFr >= 0 ? "+" : ""}${(avgFr * 100).toFixed(4)}%`, color: avgFr > 0.0001 ? "#f59e0b" : avgFr < -0.0001 ? "#0ecb81" : "#9ca3af" },
              { label:"Бычий FR",    value:`${bullish} из ${rows.length}`,  color:"#0ecb81" },
              { label:"Медвежий FR", value:`${bearish} из ${rows.length}`,  color:"#f6465d" },
            ].map(s => (
              <div key={s.label} className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-3 text-center">
                <div className="text-[9px] uppercase tracking-wider text-white/25 mb-1">{s.label}</div>
                <div className="font-mono text-[15px] font-bold" style={{color: s.color}}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Heatmap grid */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {rows.map(r => {
              const th = frTheme(r.fr);
              const barW = Math.min(100, Math.abs(r.fr) / maxAbsFr * 100);
              const next = fmtNextFunding(r.nextFunding);
              return (
                <div key={r.sym} className="relative overflow-hidden rounded-2xl p-3"
                  style={{ background: th.bg, border: `1px solid ${th.border}` }}>

                  {/* Glow accent line top */}
                  <div className="absolute inset-x-0 top-0 h-[2px] rounded-t-2xl"
                    style={{ background: th.color, opacity: 0.6 }} />

                  {/* Symbol */}
                  <div className="text-[11px] font-bold text-white/70 mb-2">{r.sym}</div>

                  {/* Funding rate — main number */}
                  <div className="font-mono text-[18px] font-extrabold leading-none tabular-nums"
                    style={{ color: th.color, textShadow: `0 0 14px ${th.glow}` }}>
                    {r.fr >= 0 ? "+" : ""}{(r.fr * 100).toFixed(4)}%
                  </div>

                  {/* Magnitude bar */}
                  <div className="mt-2 h-[3px] rounded-full bg-white/[0.06]">
                    <div className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${barW}%`, backgroundColor: th.color, opacity: 0.7,
                        boxShadow: `0 0 6px ${th.glow}` }} />
                  </div>

                  {/* 24h + label */}
                  <div className="mt-2 flex items-center justify-between">
                    <span className={`font-mono text-[10px] ${r.pct24h >= 0 ? "text-success" : "text-danger"}`}>
                      {r.pct24h >= 0 ? "+" : ""}{r.pct24h.toFixed(2)}%
                    </span>
                    <span className="text-[8px] font-bold uppercase tracking-wider"
                      style={{ color: th.color, opacity: 0.75 }}>{th.label}</span>
                  </div>

                  {/* Next funding countdown */}
                  {next && (
                    <div className="mt-1.5 text-[8px] text-white/20">через {next}</div>
                  )}
                </div>
              );
            })}
          </div>

          <p className="mt-3 text-[9px] text-white/20">
            FR {"<"} 0% = шорты переплачивают лонгам (бычий сигнал) · FR {">"} 0.01% = перегрев, рынок переплачивает за лонги
          </p>
        </>
      )}
    </Section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SmartMoneyPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-[18px] font-bold text-white">
          <Building2 className="h-5 w-5 text-accent-gold" />
          Smart Money
        </h1>
        <p className="mt-0.5 text-[11px] text-text-muted">
          CFTC COT · Деривативы · Ончейн · Макро · Bitcoin ETF · Потоки капитала
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <CotSection />
        <MacroSection />
      </div>

      <DerivativesSection />

      <div className="grid gap-5 xl:grid-cols-2">
        <OnchainSection />
        <FundingHeatmapSection />
      </div>

      <EtfSection />
    </div>
  );
}

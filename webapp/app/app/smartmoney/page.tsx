"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import {
  Building2, TrendingUp, TrendingDown, Minus,
  AlertTriangle, ChevronDown, ChevronUp,
  BarChart3, DollarSign, Activity, Zap, ArrowDownToLine, ArrowUpFromLine,
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

// ── Derivatives demo data ─────────────────────────────────────────────────────

const DEMO_DERIV = [
  { sym:"BTC",  oi:38_420_000_000, oiChg:+2.4, longPct:52.1, shortPct:47.9, liqLong:124_800_000, liqShort:67_300_000, fr:0.0082 },
  { sym:"ETH",  oi:14_870_000_000, oiChg:-1.1, longPct:49.3, shortPct:50.7, liqLong:38_200_000,  liqShort:21_100_000, fr:0.0031 },
  { sym:"SOL",  oi:3_210_000_000,  oiChg:+5.8, longPct:54.7, shortPct:45.3, liqLong:18_900_000,  liqShort:7_400_000,  fr:0.0114 },
  { sym:"XRP",  oi:2_640_000_000,  oiChg:+0.9, longPct:50.8, shortPct:49.2, liqLong:9_200_000,   liqShort:4_800_000,  fr:0.0044 },
  { sym:"BNB",  oi:1_180_000_000,  oiChg:-0.6, longPct:48.2, shortPct:51.8, liqLong:4_100_000,   liqShort:3_600_000,  fr:-0.0018 },
];

const DEMO_ONCHAIN = {
  fearGreed:      { value: 68, label: "Жадность" },
  btcExchReserve: { value: 2_310_000, chg: -18_400, chgPct: -0.79 },
  activeAddr:     { value: 842_000,   chg: +21_000, chgPct: +2.56 },
  whales24h:      { value: 143,       chg: +12 },
  mvrvZ:          { value: 1.84,      zone: "neutral" as "neutral" | "hot" | "cold" },
  netflow24h:     { value: -24_700,   note: "outflow" as "outflow" | "inflow" },
};

const DEMO_ETF_FLOWS = [
  { date:"11 июн", net:+312.4 },
  { date:"12 июн", net:+187.1 },
  { date:"13 июн", net:-42.8  },
  { date:"16 июн", net:+521.3 },
  { date:"17 июн", net:+408.7 },
  { date:"18 июн", net:+294.2 },
];

// ── Derivatives Section ───────────────────────────────────────────────────────

function DerivativesSection() {
  const totalOI   = DEMO_DERIV.reduce((s, r) => s + r.oi, 0);
  const totalLiq  = DEMO_DERIV.reduce((s, r) => s + r.liqLong + r.liqShort, 0);

  function fmtB(n: number) {
    if (n >= 1e9) return `$${(n/1e9).toFixed(1)}B`;
    if (n >= 1e6) return `$${(n/1e6).toFixed(0)}M`;
    return `$${n}`;
  }

  return (
    <Section
      icon={<Activity className="h-4 w-4 text-accent-cyan" />}
      title="Деривативы - открытый интерес и ликвидации"
      badge={<DemoBadge />}
      sub="Binance · Bybit · OKX"
    >
      {/* Summary strip */}
      <div className="mb-4 grid grid-cols-3 gap-2">
        {[
          { label: "Общий OI", value: fmtB(totalOI), color: "text-white" },
          { label: "Ликвид. 24ч", value: fmtB(totalLiq), color: "text-danger" },
          { label: "Доминация лонг", value: `${DEMO_DERIV[0].longPct}%`, color: "text-success" },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 text-center">
            <div className="text-[9px] uppercase tracking-wider text-white/25">{s.label}</div>
            <div className={`mt-1 font-mono text-[14px] font-bold tabular-nums ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Per-asset rows */}
      <div className="space-y-1.5">
        <div className="grid grid-cols-[48px_1fr_80px_60px_80px_64px] gap-2 px-2 text-[9px] uppercase tracking-wider text-text-muted">
          <span>Пара</span><span>Лонг/Шорт</span><span className="text-right">OI</span>
          <span className="text-right">OI 24ч</span><span className="text-right">Ликвид.</span>
          <span className="text-right">Funding</span>
        </div>
        {DEMO_DERIV.map(r => {
          const liqTotal = r.liqLong + r.liqShort;
          const liqLongPct = liqTotal > 0 ? (r.liqLong / liqTotal * 100) : 50;
          return (
            <div key={r.sym} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
              <div className="grid grid-cols-[48px_1fr_80px_60px_80px_64px] items-center gap-2">
                <span className="font-bold text-[12px] text-white">{r.sym}</span>

                {/* Long/Short bar */}
                <div>
                  <div className="flex h-[6px] overflow-hidden rounded-full">
                    <div className="bg-success/70" style={{width:`${r.longPct}%`}} />
                    <div className="bg-danger/70"  style={{width:`${r.shortPct}%`}} />
                  </div>
                  <div className="mt-1 flex justify-between text-[8px]">
                    <span className="text-success">{r.longPct}%</span>
                    <span className="text-danger">{r.shortPct}%</span>
                  </div>
                </div>

                <div className="text-right font-mono text-[11px] text-white">{fmtB(r.oi)}</div>

                <div className={`text-right font-mono text-[11px] ${r.oiChg >= 0 ? "text-success" : "text-danger"}`}>
                  {r.oiChg >= 0 ? "+" : ""}{r.oiChg.toFixed(1)}%
                </div>

                {/* Liquidations mini-bar */}
                <div className="text-right">
                  <div className="font-mono text-[10px] text-white">{fmtB(liqTotal)}</div>
                  <div className="mt-1 flex h-[4px] overflow-hidden rounded-full">
                    <div className="bg-success/60" style={{width:`${100 - liqLongPct}%`}} />
                    <div className="bg-danger/60"  style={{width:`${liqLongPct}%`}} />
                  </div>
                </div>

                <div className={`text-right font-mono text-[11px] ${r.fr >= 0 ? "text-danger" : "text-success"}`}>
                  {r.fr >= 0 ? "+" : ""}{(r.fr * 100).toFixed(4)}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[9px] text-white/20">Funding: положительный = лонги переплачивают (медвежий сигнал)</p>
    </Section>
  );
}

// ── On-chain Section ──────────────────────────────────────────────────────────

function OnchainSection() {
  const d = DEMO_ONCHAIN;

  const fgColor = d.fearGreed.value >= 75 ? "text-danger"
    : d.fearGreed.value >= 55 ? "text-accent-gold"
    : d.fearGreed.value >= 45 ? "text-white/60"
    : d.fearGreed.value >= 25 ? "text-accent-cyan"
    : "text-success";

  const fgArc = d.fearGreed.value / 100;

  const mvrvColor = d.mvrvZ.zone === "hot" ? "text-danger"
    : d.mvrvZ.zone === "cold" ? "text-success"
    : "text-accent-gold";

  return (
    <Section
      icon={<Zap className="h-4 w-4 text-accent-cyan" />}
      title="Ончейн метрики Bitcoin"
      badge={<DemoBadge />}
      sub="Glassnode · CryptoQuant"
    >
      {/* Fear & Greed + MVRV-Z row */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        {/* Fear & Greed gauge */}
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3 text-center">
          <div className="text-[9px] uppercase tracking-wider text-white/25 mb-2">Fear & Greed Index</div>
          <svg viewBox="0 0 120 60" className="w-full max-w-[120px] mx-auto overflow-visible">
            {[
              {from:0, to:0.25, col:"#0ecb81"}, {from:0.25, to:0.45, col:"#5ac87a"},
              {from:0.45, to:0.55, col:"#9ca3af"}, {from:0.55, to:0.75, col:"#f59e0b"},
              {from:0.75, to:1, col:"#f6465d"},
            ].map((z,i) => {
              const a1 = Math.PI - z.from*Math.PI, a2 = Math.PI - z.to*Math.PI;
              const r=48, cx=60, cy=56;
              return <path key={i} d={`M ${cx+r*Math.cos(a1)} ${cy-r*Math.sin(a1)} A ${r} ${r} 0 0 1 ${cx+r*Math.cos(a2)} ${cy-r*Math.sin(a2)}`} fill="none" stroke={z.col} strokeWidth="8" opacity="0.25" />;
            })}
            {/* Active arc */}
            <path d={`M ${60-48} 56 A 48 48 0 0 1 ${60+48} 56`} fill="none" stroke={fgColor.replace("text-","")==="accent-gold"?"#f0b90b":fgColor.replace("text-","")==="accent-cyan"?"#0affe0":"#888"} strokeWidth="8" strokeDasharray={`${fgArc*Math.PI*48} ${Math.PI*48}`} strokeLinecap="round" opacity="0.5"/>
            <text x="60" y="52" textAnchor="middle" fill="white" fontSize="18" fontWeight="bold" fontFamily="monospace">{d.fearGreed.value}</text>
          </svg>
          <div className={`text-[11px] font-bold mt-1 ${fgColor}`}>{d.fearGreed.label}</div>
        </div>

        {/* MVRV-Z */}
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
          <div className="text-[9px] uppercase tracking-wider text-white/25 mb-3">MVRV-Z Score</div>
          <div className={`font-mono text-[28px] font-bold text-center ${mvrvColor}`}>{d.mvrvZ.value}</div>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="bg-success/60" style={{width:"25%"}} />
            <div className="bg-success/30" style={{width:"20%"}} />
            <div className="bg-white/20"   style={{width:"10%"}} />
            <div className="bg-danger/30"  style={{width:"25%"}} />
            <div className="bg-danger/60"  style={{width:"20%"}} />
          </div>
          <div className="mt-1 flex justify-between text-[8px] text-white/25">
            <span>Дно (-7)</span><span>Нейтр.</span><span>Пик (+7)</span>
          </div>
          <div className="mt-2 text-center text-[10px] text-white/40">
            {d.mvrvZ.zone === "hot" ? "Перегрев - осторожно" : d.mvrvZ.zone === "cold" ? "Зона накопления" : "Нейтральная зона"}
          </div>
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          {
            label: "BTC на биржах", icon: <ArrowDownToLine className="h-3 w-3"/>,
            value: `${(d.btcExchReserve.value/1000).toFixed(0)}K BTC`,
            sub: `${d.btcExchReserve.chg > 0 ? "+" : ""}${(d.btcExchReserve.chg/1000).toFixed(1)}K за 24ч`,
            positive: d.btcExchReserve.chg < 0,
          },
          {
            label: "Активные адреса", icon: <Activity className="h-3 w-3"/>,
            value: `${(d.activeAddr.value/1000).toFixed(0)}K`,
            sub: `${d.activeAddr.chg > 0 ? "+" : ""}${(d.activeAddr.chg/1000).toFixed(0)}K за 24ч`,
            positive: d.activeAddr.chg > 0,
          },
          {
            label: "Whale сделки", icon: <Zap className="h-3 w-3"/>,
            value: String(d.whales24h.value),
            sub: `${d.whales24h.chg > 0 ? "+" : ""}${d.whales24h.chg} vs вчера`,
            positive: d.whales24h.chg > 0,
          },
          {
            label: "Нетто отток", icon: <ArrowUpFromLine className="h-3 w-3"/>,
            value: `${d.netflow24h.value > 0 ? "+" : ""}${(d.netflow24h.value/1000).toFixed(1)}K`,
            sub: d.netflow24h.note === "outflow" ? "Выход с бирж" : "Вход на биржи",
            positive: d.netflow24h.note === "outflow",
          },
        ].map(m => (
          <div key={m.label} className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-2.5">
            <div className="flex items-center gap-1.5 text-white/30">{m.icon}<span className="text-[9px] uppercase tracking-wider">{m.label}</span></div>
            <div className="mt-1.5 font-mono text-[15px] font-bold text-white">{m.value}</div>
            <div className={`text-[9px] mt-0.5 ${m.positive ? "text-success" : "text-danger"}`}>{m.sub}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[9px] text-white/20">BTC на биржах: снижение = накопление (бычий сигнал) · Whale: транзакции {">"}$1M</p>
    </Section>
  );
}

// ── ETF Flows Section ─────────────────────────────────────────────────────────

function EtfFlowsSection() {
  const flows = DEMO_ETF_FLOWS;
  const maxAbs = Math.max(...flows.map(f => Math.abs(f.net)));
  const total7d = flows.reduce((s, f) => s + f.net, 0);
  const inDays  = flows.filter(f => f.net > 0).length;

  return (
    <Section
      icon={<DollarSign className="h-4 w-4 text-accent-gold" />}
      title="Ежедневные потоки Bitcoin ETF"
      badge={<DemoBadge />}
      sub="Bloomberg · CoinShares"
    >
      {/* Summary */}
      <div className="mb-4 grid grid-cols-3 gap-2">
        {[
          { label:"Итого 6 дней", value:`${total7d >= 0 ? "+" : ""}$${total7d.toFixed(0)}M`, color: total7d >= 0 ? "text-success" : "text-danger" },
          { label:"Дней притока",  value:`${inDays} / ${flows.length}`,    color: "text-white" },
          { label:"Крупнейший",    value:`+$${Math.max(...flows.map(f=>f.net)).toFixed(0)}M`, color:"text-success" },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 text-center">
            <div className="text-[9px] uppercase tracking-wider text-white/25">{s.label}</div>
            <div className={`mt-1 font-mono text-[13px] font-bold ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      <div className="space-y-2">
        {flows.map(f => {
          const pct = Math.abs(f.net) / maxAbs * 100;
          const pos = f.net >= 0;
          return (
            <div key={f.date} className="flex items-center gap-3">
              <span className="w-14 text-right text-[10px] text-white/40 shrink-0">{f.date}</span>
              <div className="flex flex-1 items-center gap-1.5">
                {pos ? (
                  <>
                    <div className="flex-1" />
                    <div className="h-5 rounded-r-md bg-success/40 border-l border-success/50"
                      style={{width:`${pct/2}%`, minWidth: 4}} />
                  </>
                ) : (
                  <>
                    <div className="h-5 rounded-l-md bg-danger/40 border-r border-danger/50 ml-auto"
                      style={{width:`${pct/2}%`, minWidth: 4}} />
                    <div className="flex-1" />
                  </>
                )}
              </div>
              <span className={`w-16 text-[11px] font-mono font-bold shrink-0 ${pos ? "text-success" : "text-danger"}`}>
                {pos ? "+" : ""}{f.net.toFixed(0)}M
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[9px] text-white/20">Нетто приток/отток во все спотовые Bitcoin ETF США · млн $</p>
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
        <EtfFlowsSection />
      </div>

      <EtfSection />
    </div>
  );
}

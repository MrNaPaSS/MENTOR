"use client";

import { useEffect, useRef, useState } from "react";
import { API_URL, GlobalMarket, TrendingCoin, OnChainStats, ForexRates } from "@/lib/api";
import {
  Building2, TrendingUp, TrendingDown, Minus,
  AlertTriangle, BarChart3, DollarSign, Activity, Zap,
  ChevronUp, ChevronDown, Globe, Flame, Boxes, Banknote,
} from "lucide-react";

// ── Embedded CSS ──────────────────────────────────────────────────────────────

const ANIM_CSS = `
  @keyframes fadeInUp {
    from { opacity:0; transform:translateY(20px); }
    to   { opacity:1; transform:translateY(0);    }
  }
  @keyframes fadeIn {
    from { opacity:0; } to { opacity:1; }
  }
  @keyframes scaleInX {
    from { transform:scaleX(0); }
    to   { transform:scaleX(1); }
  }
  @keyframes glowPulse {
    0%,100% { box-shadow:0 0 8px var(--glow,transparent); }
    50%      { box-shadow:0 0 20px var(--glow,transparent); }
  }
  @keyframes shimmer {
    0%   { background-position:200% 0; }
    100% { background-position:-200% 0; }
  }
  @keyframes countFlash {
    0%   { opacity:0.3; }
    50%  { opacity:1; }
    100% { opacity:0.3; }
  }
  .sm-fade-up   { animation: fadeInUp 0.5s ease both; }
  .sm-fade      { animation: fadeIn   0.4s ease both; }
  .sm-bar       { transform-origin:left; animation:scaleInX 0.9s cubic-bezier(0.4,0,0.2,1) both; }
  .sm-glow      { animation: glowPulse 2.5s ease-in-out infinite; }
  .sm-shimmer   { background:linear-gradient(90deg,transparent 0%,rgba(255,255,255,0.06) 50%,transparent 100%);
                  background-size:200% 100%; animation:shimmer 1.8s ease-in-out infinite; }
  .sm-hover     { transition:border-color 0.2s,background 0.2s,transform 0.15s; }
  .sm-hover:hover { transform:translateY(-1px); border-color:rgba(255,255,255,0.15) !important; }
`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface CotRow {
  date:string; oi:number;
  nc_long:number; nc_short:number; nc_net:number; nc_net_chg:number;
  nc_long_pct:number; nc_short_pct:number;
  c_long:number; c_short:number; c_net:number; c_net_chg:number;
  c_long_pct:number; c_short_pct:number;
  nr_long:number; nr_short:number; nr_net:number;
}
interface MacroItem { key:string; label:string; price:number; change:number; changePct:number; }
interface EtfItem   { name:string; ticker:string; btc:number; aum_usd?:number; price:number; change:number; changePct:number; sharePct:number; }
interface DerivRow  { sym:string; oi:number; oiChg:number; longPct:number; shortPct:number; fr:number; pct24h?:number; }
interface FrRow     { sym:string; fr:number; pct24h:number; nextFunding:number; price:number; }
interface GlobalData {
  fearGreed:{ value:number; label:string };
  btcDom:number; ethDom:number; stableDom:number;
  totalMcap:number; mcapChg24h:number; vol24h:number;
}

// ── Demo data ─────────────────────────────────────────────────────────────────

const DEMO_COT: Record<"BTC"|"ETH", CotRow[]> = {
  BTC:[
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
  ETH:[
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
  {key:"DXY",   label:"Индекс доллара",  price:99.21,  change:-0.44, changePct:-0.44},
  {key:"US10Y", label:"US 10Y Treasury", price:4.41,   change:0.03,  changePct:0.68},
  {key:"SPX",   label:"S&P 500",         price:5921.0, change:42.1,  changePct:0.72},
  {key:"GOLD",  label:"Золото XAU/USD",  price:3247.5, change:18.3,  changePct:0.57},
  {key:"OIL",   label:"Нефть WTI",       price:61.8,   change:-0.94, changePct:-1.50},
  {key:"VIX",   label:"VIX",             price:17.2,   change:-0.80, changePct:-4.44},
];

const DEMO_ETF = {
  total_btc:1_237_000,
  etfs:[
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

const SKIP = { headers:{ "ngrok-skip-browser-warning":"1" } };
const DERIV_SYMS = ["BTC","ETH","SOL","XRP","BNB"];
const FR_SYMS    = ["BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT","BNBUSDT","DOGEUSDT","ADAUSDT","AVAXUSDT","LINKUSDT","DOTUSDT"];
const ALT_ME_API = "https://api.alternative.me/fng/?limit=1";
const COINGECKO_API = "https://api.coingecko.com/api/v3";

function fmt(n:number, dec=0)  { return n.toLocaleString("en-US",{minimumFractionDigits:dec,maximumFractionDigits:dec}); }
function fmtK(n:number)         { return Math.abs(n)>=1000?(n/1000).toFixed(1)+"K":String(n); }
function fmtB(n:number)         { if(n>=1e9)return`$${(n/1e9).toFixed(1)}B`; if(n>=1e6)return`$${(n/1e6).toFixed(0)}M`; return`$${n.toFixed(0)}`; }
function signColor(n:number)    { return n>0?"text-success":n<0?"text-danger":"text-white/30"; }

async function fetchJson<T>(url:string, opts?:RequestInit): Promise<T|null> {
  try {
    const r = await fetch(url,{...opts,headers:{"ngrok-skip-browser-warning":"1",...(opts?.headers||{})}});
    if(!r.ok) return null;
    return r.json() as Promise<T>;
  } catch { return null; }
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

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

function DemoBadge() {
  return (
    <span className="rounded-md border border-accent-gold/40 bg-accent-gold/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-accent-gold">
      ДЕМО
    </span>
  );
}

function Skeleton({ rows=4 }:{ rows?:number }) {
  return (
    <div className="space-y-3">
      {Array.from({length:rows}).map((_,i)=>(
        <div key={i} className="sm-shimmer h-8 rounded-xl" style={{width:`${72+(i%3)*9}%`}} />
      ))}
    </div>
  );
}

function Section({icon,title,sub,badge,accent="cyan",delay=0,children}:{
  icon:React.ReactNode; title:string; sub?:string;
  badge?:React.ReactNode; accent?:"cyan"|"gold"|"green";
  delay?:number; children:React.ReactNode;
}) {
  const ac = accent==="gold"?"#f0b90b":accent==="green"?"#0ecb81":"#0affe0";
  return (
    <div className="sm-fade-up relative overflow-hidden rounded-2xl"
      style={{
        animationDelay:`${delay}s`,
        background:"linear-gradient(160deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.015) 100%)",
        border:"1px solid rgba(255,255,255,0.07)",
        boxShadow:`0 0 0 1px rgba(255,255,255,0.03) inset, 0 32px 64px -16px rgba(0,0,0,0.6), 0 0 60px -20px ${ac}22`,
      }}>
      {/* top accent glow */}
      <div className="absolute inset-x-0 top-0 h-[1px]"
        style={{background:`linear-gradient(90deg,transparent,${ac}70,transparent)`}} />
      {/* subtle corner glow */}
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full"
        style={{background:`radial-gradient(circle,${ac}12 0%,transparent 70%)`}} />

      <div className="flex items-center gap-3 border-b border-white/[0.05] px-5 py-3.5">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl"
          style={{background:`${ac}18`,border:`1px solid ${ac}35`,boxShadow:`0 0 12px ${ac}20`}}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[13px] font-semibold text-white">{title}</span>
          {sub && <span className="ml-3 text-[10px] text-white/25">{sub}</span>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">{badge}</div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// KPI card primitive
function KpiCard({label,value,sub,color,bg,border,delay=0}:{
  label:string; value:string; sub?:string;
  color:string; bg:string; border:string; delay?:number;
}) {
  return (
    <div className="sm-fade-up sm-hover rounded-2xl px-4 py-3.5"
      style={{animationDelay:`${delay}s`,background:bg,border:`1px solid ${border}`}}>
      <div className="mb-1 text-[9px] uppercase tracking-widest text-white/30">{label}</div>
      <div className="font-mono text-[22px] font-extrabold leading-none tabular-nums"
        style={{color,textShadow:`0 0 20px ${color}50`}}>
        {value}
      </div>
      {sub && <div className="mt-1.5 text-[10px] text-white/35">{sub}</div>}
    </div>
  );
}

// Animated bar
function AnimBar({pct,color,height=6,delay=0}:{pct:number;color:string;height?:number;delay?:number}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const el = ref.current; if(!el) return;
    el.style.width="0%";
    const id = setTimeout(()=>{ el.style.width=`${pct}%`; el.style.transition="width 0.9s cubic-bezier(0.4,0,0.2,1)"; },
      delay*1000+60);
    return ()=>clearTimeout(id);
  },[pct,delay]);
  return (
    <div className="overflow-hidden rounded-full bg-white/[0.05]" style={{height}}>
      <div ref={ref} className="h-full rounded-full" style={{backgroundColor:color,opacity:0.7}} />
    </div>
  );
}

// ── COT Section ───────────────────────────────────────────────────────────────

function CotSection() {
  const [asset,setAsset]   = useState<"BTC"|"ETH">("BTC");
  const [cot,setCot]       = useState<CotRow[]|null>(null);
  const [isDemo,setIsDemo] = useState(false);
  const [loading,setLoading] = useState(true);

  useEffect(()=>{
    let cancelled=false; setLoading(true);
    fetchJson<{cot:CotRow[];demo?:boolean}>(`${API_URL}/api/institutional/cot/${asset}`)
      .then(d=>{
        if(cancelled) return;
        if(d?.cot?.length){ setCot(d.cot); setIsDemo(!!d.demo); }
        else { setCot(DEMO_COT[asset]); setIsDemo(true); }
      })
      .finally(()=>{ if(!cancelled) setLoading(false); });
    return ()=>{ cancelled=true; };
  },[asset]);

  const cur  = cot?.[0] as CotRow;
  const prev = cot?.[1] as CotRow|undefined;
  const maxNet = cot ? Math.max(...cot.map(r=>Math.abs(r.nc_net)),1) : 1;

  return (
    <Section icon={<Building2 className="h-4 w-4 text-accent-gold"/>}
      title="COT — Позиции институционалов" accent="gold" delay={0}
      badge={isDemo ? <DemoBadge/> : undefined}
      sub={isDemo ? "CFTC · ориентировочные" : "CFTC CME · актуально"}>

      {/* Asset toggle */}
      <div className="mb-5 flex items-center gap-1.5">
        {(["BTC","ETH"] as const).map(a=>(
          <button key={a} onClick={()=>setAsset(a)}
            className="relative rounded-xl px-5 py-1.5 text-[12px] font-bold transition-all"
            style={{
              background: asset===a ? "rgba(240,185,11,0.14)" : "rgba(255,255,255,0.03)",
              color: asset===a ? "#f0b90b" : "rgba(255,255,255,0.35)",
              border: asset===a ? "1px solid rgba(240,185,11,0.3)" : "1px solid rgba(255,255,255,0.06)",
              boxShadow: asset===a ? "0 0 16px rgba(240,185,11,0.15)" : "none",
            }}>
            {a}
          </button>
        ))}
        {loading && <div className="ml-1 h-4 w-4 animate-spin rounded-full border border-accent-gold/20 border-t-accent-gold/80" />}
      </div>

      {!cot || loading ? <Skeleton rows={5}/> : <>

        {isDemo && (
          <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-accent-gold/20 bg-accent-gold/[0.05] px-4 py-2.5 text-[11px] text-accent-gold">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 opacity-70"/>
            CFTC API недоступен — ориентировочные данные на основе реальной структуры отчётов
          </div>
        )}

        <div className="space-y-5">

          {/* KPI row */}
          <div className="grid grid-cols-3 gap-3">
            <KpiCard label="Хедж-фонды нетто" value={`${cur.nc_net>0?"+":""}${fmtK(cur.nc_net)}`}
              sub={`${cur.nc_net_chg>0?"+":""}${fmtK(cur.nc_net_chg)} нед.`}
              color={cur.nc_net>0?"#0ecb81":"#f6465d"}
              bg={cur.nc_net>0?"rgba(14,203,129,0.07)":"rgba(246,70,93,0.07)"}
              border={cur.nc_net>0?"rgba(14,203,129,0.2)":"rgba(246,70,93,0.2)"} delay={0.05}/>
            <KpiCard label="Коммерческие нетто" value={`${cur.c_net>0?"+":""}${fmtK(cur.c_net)}`}
              sub={`${cur.c_net_chg>0?"+":""}${fmtK(cur.c_net_chg)} нед.`}
              color={cur.c_net>0?"#0ecb81":"#f6465d"}
              bg={cur.c_net>0?"rgba(14,203,129,0.07)":"rgba(246,70,93,0.07)"}
              border={cur.c_net>0?"rgba(14,203,129,0.2)":"rgba(246,70,93,0.2)"} delay={0.1}/>
            <KpiCard label="Открытый интерес" value={fmtK(cur.oi)}
              color="#ffffff" bg="rgba(255,255,255,0.04)" border="rgba(255,255,255,0.09)" delay={0.15}/>
          </div>

          {/* Position structure */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
            <div className="text-[9px] uppercase tracking-widest text-white/25 mb-1">Структура позиций (% от ОИ)</div>

            {[
              {label:"Lev. Money (хедж-фонды)", long:cur.nc_long_pct, short:cur.nc_short_pct, lc:"#0ecb81", sc:"#f6465d"},
              {label:"Asset Manager (институт.)", long:cur.c_long_pct,  short:cur.c_short_pct,  lc:"#22c55e", sc:"#ef4444"},
            ].map((row,ri)=>(
              <div key={ri}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] text-white/40">{row.label}</span>
                  <div className="flex gap-3 text-[10px] font-mono">
                    <span style={{color:row.lc}}>L {row.long.toFixed(1)}%</span>
                    <span style={{color:row.sc}}>S {row.short.toFixed(1)}%</span>
                  </div>
                </div>
                <div className="flex h-2 overflow-hidden rounded-full bg-white/[0.05]">
                  <div className="h-full rounded-l-full transition-all duration-700"
                    style={{width:`${row.long}%`,background:`linear-gradient(90deg,${row.lc}50,${row.lc}90)`}} />
                  <div className="mx-[1px] h-full w-[2px] flex-shrink-0 bg-white/20 rounded-full" />
                  <div className="h-full rounded-r-full transition-all duration-700"
                    style={{width:`${row.short}%`,background:`linear-gradient(90deg,${row.sc}90,${row.sc}50)`}} />
                </div>
              </div>
            ))}
          </div>

          {/* History mini-chart */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[9px] uppercase tracking-widest text-white/25">
                Нетто позиция хедж-фондов — {cot.length} недель
              </div>
              <div className="flex items-center gap-3 text-[8px] text-white/20">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-success/50"/>бычий</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-danger/50"/>медвежий</span>
              </div>
            </div>
            <div className="flex items-end gap-1.5 rounded-xl bg-white/[0.02] px-3 pb-2 pt-3" style={{height:80}}>
              {[...cot].reverse().map((row,i)=>{
                const h = Math.max((Math.abs(row.nc_net)/maxNet)*62,4);
                const color = row.nc_net>=0 ? "#0ecb81" : "#f6465d";
                return (
                  <div key={i} title={`${row.date}: ${row.nc_net>0?"+":""}${fmt(row.nc_net)}`}
                    className="group relative flex flex-1 flex-col items-center justify-end cursor-default" style={{height:68}}>
                    <div className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 text-[8px] text-white opacity-0 transition-opacity group-hover:opacity-100 z-10">
                      {fmtK(row.nc_net)}
                    </div>
                    <div className="w-full rounded-t-sm transition-all duration-200 group-hover:opacity-100"
                      style={{height:`${h}px`,background:color,opacity:0.6,
                        boxShadow:`0 0 6px ${color}50`}} />
                  </div>
                );
              })}
            </div>
            <div className="mt-1.5 flex justify-between text-[8px] text-white/15">
              <span>← старше</span><span>новее →</span>
            </div>
          </div>

          {/* Insight box */}
          <div className="rounded-xl border border-accent-gold/15 bg-accent-gold/[0.04] p-3.5 text-[10px] leading-relaxed text-white/35">
            <span className="font-semibold text-accent-gold">Leveraged Money нетто &gt; 0</span> — хедж-фонды в лонге, бычий сигнал.{" "}
            <span className="font-semibold text-accent-gold">Asset Manager</span> — институциональные, часто контртрендовые.
            {prev && (<>{" "}Нед. изм.: <span className={signColor(cur.nc_net-prev.nc_net)}>{cur.nc_net>=prev.nc_net?"▲":"▼"} {Math.abs(cur.nc_net-prev.nc_net).toLocaleString()}</span>.</>)}
            {" "}<span className="text-white/20">CFTC публикует каждую пятницу — данные за предыдущий вторник.</span>
          </div>

        </div>
      </>}
    </Section>
  );
}

// ── Macro Section ─────────────────────────────────────────────────────────────

const MACRO_META: Record<string,{context:string;icon:string}> = {
  DXY:  {context:"Сильный $ давит крипто",   icon:"💵"},
  US10Y:{context:"Рост = риск-офф",          icon:"📈"},
  SPX:  {context:"Корреляция с крипто ~0.6", icon:"📊"},
  GOLD: {context:"Хедж от инфляции",         icon:"🥇"},
  OIL:  {context:"Proxy на спрос",           icon:"🛢"},
  VIX:  {context:">25 страх · <15 жадность", icon:"⚡"},
};

function MacroSection() {
  const [items,setItems]   = useState<MacroItem[]|null>(null);
  const [isDemo,setIsDemo] = useState(false);

  useEffect(()=>{
    fetchJson<{indicators:Record<string,MacroItem>;demo?:boolean}>(`${API_URL}/api/institutional/macro`)
      .then(d=>{
        if(d?.indicators){
          const list=Object.values(d.indicators);
          if(list.some(v=>v.price>0)){ setItems(list); setIsDemo(!!d.demo); }
          else { setItems(DEMO_MACRO); setIsDemo(true); }
        } else { setItems(DEMO_MACRO); setIsDemo(true); }
      });
  },[]);

  return (
    <Section icon={<BarChart3 className="h-4 w-4 text-accent-cyan"/>}
      title="Макро индикаторы" accent="cyan" delay={0.05}
      badge={isDemo ? <DemoBadge/> : undefined}
      sub={isDemo ? "Yahoo Finance · ориентировочные" : "Yahoo Finance · live"}>

      {!items ? <Skeleton rows={3}/> : <>

        {isDemo && (
          <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-accent-gold/20 bg-accent-gold/[0.05] px-4 py-2.5 text-[11px] text-accent-gold">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 opacity-70"/>
            Yahoo Finance недоступен — ориентировочные данные
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((item,i)=>{
            const pos = item.changePct>=0;
            const dec = item.key==="US10Y"||item.key==="VIX" ? 2 : item.price>1000 ? 1 : 2;
            const color = pos ? "#0ecb81" : "#f6465d";
            const meta  = MACRO_META[item.key]??{context:"",icon:"•"};
            return (
              <div key={item.key}
                className="sm-fade-up sm-hover group relative overflow-hidden rounded-2xl p-4 cursor-default"
                style={{
                  animationDelay:`${i*0.04}s`,
                  background: pos ? "rgba(14,203,129,0.04)" : "rgba(246,70,93,0.04)",
                  border: `1px solid ${pos?"rgba(14,203,129,0.12)":"rgba(246,70,93,0.12)"}`,
                }}>
                {/* dim corner bg */}
                <div className="pointer-events-none absolute right-2 bottom-2 text-[28px] opacity-[0.06] select-none">{meta.icon}</div>

                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[8px] font-bold uppercase tracking-widest text-white/25">{item.label}</span>
                  <span className="font-mono text-[9px] font-bold" style={{color:"rgba(255,255,255,0.2)"}}>{item.key}</span>
                </div>

                <div className="font-mono text-[20px] font-extrabold leading-none text-white">
                  {fmt(item.price,dec)}
                </div>

                <div className="mt-2 flex items-center gap-1.5">
                  <div className="flex h-4 w-4 items-center justify-center rounded-md"
                    style={{background:`${color}20`,border:`1px solid ${color}40`}}>
                    {pos
                      ? <ChevronUp className="h-2.5 w-2.5" style={{color}}/>
                      : <ChevronDown className="h-2.5 w-2.5" style={{color}}/>}
                  </div>
                  <span className="font-mono text-[11px] font-semibold" style={{color}}>
                    {pos?"+":""}{item.changePct.toFixed(2)}%
                  </span>
                </div>

                <div className="mt-2 text-[9px] text-white/20">{meta.context}</div>
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
  const [data,setData]         = useState<typeof DEMO_ETF|null>(null);
  const [isDemo,setIsDemo]     = useState(false);
  const [btcPrice,setBtcPrice] = useState(0);

  useEffect(()=>{
    fetchJson<{etfs:EtfItem[];total_btc:number;btc_price?:number}>(`${API_URL}/api/institutional/etf-flows`)
      .then(d=>{
        if(d?.etfs?.length){ setData(d); if(d.btc_price) setBtcPrice(d.btc_price); setIsDemo(!d.etfs.some(e=>e.btc>0)); }
        else { setData(DEMO_ETF); setIsDemo(true); }
      });
  },[]);

  const topEtf = data?.etfs[0];

  return (
    <Section icon={<DollarSign className="h-4 w-4 text-success"/>}
      title="Bitcoin Spot ETF — Институциональные холдинги" accent="green" delay={0.3}
      badge={isDemo ? <DemoBadge/> : <LiveBadge/>}
      sub={isDemo ? "оценочные данные" : "Nasdaq · CoinGecko · live"}>

      {!data ? <Skeleton rows={5}/> : <div className="space-y-4">

        {/* Banner */}
        <div className="relative overflow-hidden rounded-2xl border border-accent-gold/20 p-5"
          style={{background:"linear-gradient(135deg,rgba(240,185,11,0.08),rgba(240,185,11,0.03))"}}>
          <div className="pointer-events-none absolute inset-0"
            style={{background:"radial-gradient(ellipse at 80% 50%,rgba(240,185,11,0.06),transparent 70%)"}} />
          <div className="relative flex flex-wrap items-center gap-6">
            <div>
              <div className="text-[9px] uppercase tracking-widest text-white/25 mb-1">Всего BTC в ETF</div>
              <div className="font-mono text-[32px] font-black leading-none text-accent-gold">
                ~{(data.total_btc/1000).toFixed(0)}<span className="text-[16px] font-semibold ml-1">K BTC</span>
              </div>
              <div className="mt-1 text-[10px] text-white/25">
                {((data.total_btc/21_000_000)*100).toFixed(2)}% от максимальной эмиссии
              </div>
            </div>
            <div className="h-12 w-px bg-white/[0.07]"/>
            <div>
              <div className="text-[9px] uppercase tracking-widest text-white/25 mb-1">Фондов</div>
              <div className="font-mono text-[28px] font-black leading-none text-white">{data.etfs.length}</div>
            </div>
            {btcPrice>0 && <>
              <div className="h-12 w-px bg-white/[0.07]"/>
              <div>
                <div className="text-[9px] uppercase tracking-widest text-white/25 mb-1">BTC/USD</div>
                <div className="font-mono text-[24px] font-black leading-none text-accent-cyan">${btcPrice.toLocaleString("en-US")}</div>
              </div>
            </>}
            {topEtf && <>
              <div className="h-12 w-px bg-white/[0.07]"/>
              <div>
                <div className="text-[9px] uppercase tracking-widest text-white/25 mb-1">Лидер</div>
                <div className="font-mono text-[18px] font-black leading-none text-white">{topEtf.ticker}</div>
                <div className="text-[9px] text-white/25">{topEtf.sharePct}% доли</div>
              </div>
            </>}
          </div>
        </div>

        {/* ETF list */}
        <div className="space-y-2">
          {/* header */}
          <div className="grid px-3 text-[8px] uppercase tracking-widest text-white/20"
            style={{gridTemplateColumns:"28px 1fr 70px 60px 55px 80px"}}>
            <span>#</span><span>Фонд</span>
            <span className="text-right">BTC</span>
            <span className="text-right">AUM</span>
            <span className="text-right">Доля</span>
            <span className="text-right">Цена ETF</span>
          </div>

          {data.etfs.map((etf,i)=>{
            const pos = etf.changePct>=0;
            return (
              <div key={i} className="sm-fade-up sm-hover group relative overflow-hidden rounded-xl p-3"
                style={{
                  animationDelay:`${i*0.04+0.1}s`,
                  background:"rgba(255,255,255,0.025)",
                  border:"1px solid rgba(255,255,255,0.06)",
                }}>
                {/* share bar background */}
                <div className="absolute inset-y-0 left-0 rounded-l-xl transition-all duration-700"
                  style={{width:`${etf.sharePct}%`,background:"rgba(14,203,129,0.04)",maxWidth:"100%"}} />

                <div className="relative grid items-center gap-2"
                  style={{gridTemplateColumns:"28px 1fr 70px 60px 55px 80px"}}>
                  <div className="text-[11px] font-bold text-white/20">{i+1}</div>

                  <div>
                    <div className="text-[12px] font-bold text-white">{etf.ticker}</div>
                    <div className="text-[9px] text-white/30 truncate">{etf.name}</div>
                  </div>

                  <div className="text-right font-mono text-[11px] text-white/70">
                    {etf.btc>0 ? `${(etf.btc/1000).toFixed(0)}K` : "—"}
                  </div>
                  <div className="text-right font-mono text-[10px] text-white/35">
                    {etf.aum_usd&&etf.aum_usd>0 ? `$${(etf.aum_usd/1e9).toFixed(1)}B` : "—"}
                  </div>
                  <div className="text-right font-mono text-[12px] font-bold text-success">
                    {etf.sharePct}%
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[11px] text-white">{etf.price>0?`$${etf.price}`:"—"}</div>
                    {etf.price>0 && (
                      <div className="font-mono text-[9px]" style={{color:pos?"#0ecb81":"#f6465d"}}>
                        {pos?"+":""}{etf.changePct.toFixed(2)}%
                      </div>
                    )}
                  </div>
                </div>

                {/* animated share bar */}
                <div className="mt-2.5">
                  <AnimBar pct={etf.sharePct} color="#0ecb81" height={3} delay={i*0.05+0.1}/>
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-[9px] text-white/15">AUM и BTC холдинги — Nasdaq API. Цены ETF — Yahoo Finance. BTC/USD — CoinGecko.</p>
      </div>}
    </Section>
  );
}

// ── Derivatives Section ───────────────────────────────────────────────────────

function DerivativesSection() {
  const [rows,setRows]         = useState<DerivRow[]>([]);
  const [loading,setLoading]   = useState(true);
  const [updatedAt,setUpdatedAt] = useState("");

  useEffect(()=>{
    const load = async()=>{
      const results = await Promise.all(
        DERIV_SYMS.map(async sym=>{
          const ticker = sym+"USDT";
          const [derivRes,tkRes] = await Promise.allSettled([
            fetch(`${API_URL}/api/market/derivatives/${ticker}`,SKIP).then(r=>r.json()),
            fetch(`${API_URL}/api/market/ticker/${ticker}`,SKIP).then(r=>r.json()),
          ]);
          const d  = derivRes.status==="fulfilled"?derivRes.value:null;
          const tk = tkRes.status==="fulfilled"?tkRes.value:null;
          return {
            sym, oi:parseFloat(d?.openInterestUsd??"0"), oiChg:0,
            longPct:50, shortPct:50,
            fr:parseFloat(d?.fundingRate??tk?.fundingRate??"0"),
            pct24h:parseFloat(d?.priceChangePct??tk?.priceChangePercent??"0"),
          } satisfies DerivRow & {pct24h:number};
        })
      );
      setRows(results);
      setUpdatedAt(new Date().toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"}));
      setLoading(false);
    };
    load(); const t=setInterval(load,30_000); return ()=>clearInterval(t);
  },[]);

  const totalOI = rows.reduce((s,r)=>s+r.oi,0);
  const maxOI   = Math.max(...rows.map(r=>r.oi),1);

  return (
    <Section icon={<Activity className="h-4 w-4 text-accent-cyan"/>}
      title="Деривативы — открытый интерес" accent="cyan" delay={0.2}
      badge={<LiveBadge/>}
      sub={updatedAt ? `WEEX · ${updatedAt}` : "загрузка…"}>

      {loading ? <Skeleton rows={5}/> : <>

        {/* KPI row */}
        <div className="mb-5 grid grid-cols-3 gap-3">
          <KpiCard label="Суммарный OI" value={fmtB(totalOI)} color="#ffffff"
            bg="rgba(255,255,255,0.04)" border="rgba(255,255,255,0.09)" delay={0}/>
          <KpiCard label="Монет отслеживается" value={String(rows.length)}
            color="#0affe0" bg="rgba(10,255,224,0.06)" border="rgba(10,255,224,0.15)" delay={0.05}/>
          <KpiCard
            label="Топ по OI"
            value={rows[0]?.sym??"—"}
            sub={rows[0]?.oi>0 ? fmtB(rows[0].oi) : undefined}
            color="#f0b90b" bg="rgba(240,185,11,0.07)" border="rgba(240,185,11,0.18)" delay={0.1}/>
        </div>

        {/* Rows */}
        <div className="space-y-2">
          <div className="grid px-3 text-[8px] uppercase tracking-widest text-white/20"
            style={{gridTemplateColumns:"48px 1fr 90px 80px 80px"}}>
            <span>Пара</span><span>OI (доля)</span>
            <span className="text-right">OI</span>
            <span className="text-right">Funding 8ч</span>
            <span className="text-right">24ч</span>
          </div>

          {rows.map((r,i)=>{
            const fr = r.fr; const frPct = fr*100;
            const frColor = fr>0.01?"#f6465d":fr>0?"#f59e0b":fr<-0.001?"#0ecb81":"#6b7280";
            const pct = (r as DerivRow & {pct24h?:number}).pct24h??0;
            const oiPct = r.oi/maxOI*100;

            return (
              <div key={r.sym} className="sm-fade-up sm-hover group rounded-2xl p-3.5"
                style={{
                  animationDelay:`${i*0.05}s`,
                  background:"rgba(255,255,255,0.025)",
                  border:"1px solid rgba(255,255,255,0.06)",
                }}>
                <div className="grid items-center gap-3" style={{gridTemplateColumns:"48px 1fr 90px 80px 80px"}}>

                  <div className="font-bold text-[14px] text-white">{r.sym}</div>

                  <div>
                    <AnimBar pct={oiPct} color="#0affe0" height={5} delay={i*0.04}/>
                    <div className="mt-1 text-[8px] text-white/20">{oiPct.toFixed(0)}% от макс.</div>
                  </div>

                  <div className="text-right font-mono text-[12px] text-white/70">
                    {r.oi>0 ? fmtB(r.oi) : "—"}
                  </div>

                  <div className="text-right">
                    <div className="font-mono text-[12px] font-bold" style={{color:frColor}}>
                      {fr>=0?"+":""}{frPct.toFixed(4)}%
                    </div>
                    <div className="mt-0.5 text-[8px] font-semibold text-white/25">
                      {fr>0.01?"ПЕРЕГРЕВ":fr>0.001?"ЛОНГИ":fr<-0.001?"ШОРТЫ":"НЕЙТР."}
                    </div>
                  </div>

                  <div className={`text-right font-mono text-[12px] font-bold ${pct>=0?"text-success":"text-danger"}`}>
                    {pct>=0?"+":""}{pct.toFixed(2)}%
                  </div>

                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-3 text-[8.5px] text-white/15">
          Funding {">"} 0% — лонги переплачивают (перегрев) · Funding {"<"} 0% — шорты платят лонгам (бычий сигнал)
        </p>
      </>}
    </Section>
  );
}

// ── Onchain / Global Market Section ──────────────────────────────────────────

const FG_LABEL_RU: Record<string,string> = {
  "Extreme Fear":"Крайний страх","Fear":"Страх","Neutral":"Нейтрально",
  "Greed":"Жадность","Extreme Greed":"Крайняя жадность",
};

function FearGaugeSmall({val,color}:{val:number;color:string}) {
  const r=44, cx=62, cy=56;
  const arc = val/100;
  const circ = Math.PI*r;
  return (
    <svg viewBox="0 0 124 62" className="w-full overflow-visible">
      <path d={`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}`}
        fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="10" strokeLinecap="butt"/>
      {[{from:0,to:.25,c:"#0ecb81"},{from:.25,to:.45,c:"#5ac87a"},{from:.45,to:.55,c:"#9ca3af"},{from:.55,to:.75,c:"#f0b90b"},{from:.75,to:1,c:"#f6465d"}]
        .map((z,i)=>{
          const a1=Math.PI-z.from*Math.PI, a2=Math.PI-z.to*Math.PI;
          const x1=cx+r*Math.cos(a1),y1=cy-r*Math.sin(a1),x2=cx+r*Math.cos(a2),y2=cy-r*Math.sin(a2);
          return <path key={i} fill="none" stroke={z.c} strokeWidth="10" opacity="0.3"
            d={`M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`}/>;
        })}
      <path d={`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}`}
        fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" opacity="0.7"
        strokeDasharray={`${arc*circ} ${circ}`}
        style={{transition:"stroke-dasharray 0.9s ease"}}/>
      {(()=>{
        const a=Math.PI-arc*Math.PI;
        const nx=cx+(r-14)*Math.cos(a), ny=cy-(r-14)*Math.sin(a);
        const pa=a+Math.PI/2;
        return <polygon points={`${nx},${ny} ${cx+4*Math.cos(pa)},${cy-4*Math.sin(pa)} ${cx-4*Math.cos(pa)},${cy+4*Math.sin(pa)}`}
          fill={color} style={{transition:"all 0.9s ease"}}/>;
      })()}
      <circle cx={cx} cy={cy} r="4" fill={color}/>
      <text x={cx} y={cy-16} textAnchor="middle" fill="white" fontSize="18" fontWeight="900" fontFamily="monospace">{val}</text>
    </svg>
  );
}

function OnchainSection() {
  const [data,setData]       = useState<GlobalData|null>(null);
  const [loading,setLoading] = useState(true);
  const [updatedAt,setUpdatedAt] = useState("");

  useEffect(()=>{
    const load = async()=>{
      const [fgRes,cgRes] = await Promise.allSettled([
        fetch(ALT_ME_API).then(r=>r.json()),
        fetch(`${COINGECKO_API}/global`).then(r=>r.json()),
      ]);
      const fg = fgRes.status==="fulfilled"?fgRes.value?.data?.[0]:null;
      const cg = cgRes.status==="fulfilled"?cgRes.value?.data:null;
      if(!fg&&!cg) return;
      const pct = cg?.market_cap_percentage??{};
      setData({
        fearGreed:{value:fg?parseInt(fg.value):50, label:FG_LABEL_RU[fg?.value_classification??""]??fg?.value_classification??"—"},
        btcDom:pct.btc??0, ethDom:pct.eth??0, stableDom:(pct.usdt??0)+(pct.usdc??0),
        totalMcap:cg?.total_market_cap?.usd??0,
        mcapChg24h:cg?.market_cap_change_percentage_24h_usd??0,
        vol24h:cg?.total_volume?.usd??0,
      });
      setUpdatedAt(new Date().toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"}));
      setLoading(false);
    };
    load(); const t=setInterval(load,60_000); return ()=>clearInterval(t);
  },[]);

  const d = data;
  const fgVal   = d?.fearGreed.value??0;
  const fgColor = fgVal>=75?"#f6465d":fgVal>=55?"#f0b90b":fgVal>=45?"#9ca3af":fgVal>=25?"#0affe0":"#0ecb81";
  const altSeason = d ? Math.max(0,100-d.btcDom-d.ethDom) : 0;

  return (
    <Section icon={<Zap className="h-4 w-4 text-accent-cyan"/>}
      title="Настроение и структура рынка" accent="cyan" delay={0.1}
      badge={<LiveBadge/>}
      sub={updatedAt ? `Alternative.me · CoinGecko · ${updatedAt}` : "загрузка…"}>

      {loading||!d ? <Skeleton rows={4}/> : <>

        <div className="mb-4 grid grid-cols-2 gap-3">

          {/* Fear & Greed card */}
          <div className="sm-hover rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="mb-1 text-[9px] uppercase tracking-widest text-white/25">Fear & Greed Index</div>
            <FearGaugeSmall val={fgVal} color={fgColor}/>
            <div className="mt-1 text-center">
              <span className="text-[13px] font-bold" style={{color:fgColor}}>
                {d.fearGreed.label}
              </span>
            </div>
          </div>

          {/* Dominance card */}
          <div className="sm-hover rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="mb-3 text-[9px] uppercase tracking-widest text-white/25">Доминация крипторынка</div>
            <div className="space-y-3">
              {[
                {label:"BTC",    val:d.btcDom,    col:"#f0b90b"},
                {label:"ETH",    val:d.ethDom,    col:"#627eea"},
                {label:"Stable", val:d.stableDom, col:"#26a17b"},
                {label:"Альты",  val:altSeason,   col:"#0affe0"},
              ].map((x,i)=>(
                <div key={x.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-semibold" style={{color:x.col}}>{x.label}</span>
                    <span className="font-mono text-[11px] font-bold text-white">{x.val.toFixed(1)}%</span>
                  </div>
                  <AnimBar pct={x.val} color={x.col} height={5} delay={i*0.08}/>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            {label:"Капитализация",
              value: d.totalMcap>=1e12?`$${(d.totalMcap/1e12).toFixed(2)}T`:`$${(d.totalMcap/1e9).toFixed(0)}B`,
              sub:`${d.mcapChg24h>=0?"+":""}${d.mcapChg24h.toFixed(2)}% 24ч`,
              color:d.mcapChg24h>=0?"#0ecb81":"#f6465d"},
            {label:"Объём 24ч",
              value: d.vol24h>=1e12?`$${(d.vol24h/1e12).toFixed(2)}T`:`$${(d.vol24h/1e9).toFixed(0)}B`,
              sub:"суммарный",color:"#9ca3af"},
            {label:"Альт-сезон",
              value:`${altSeason.toFixed(1)}%`,
              sub:altSeason>40?"Сезон альтов":altSeason>25?"Смешанный":"Доминация BTC",
              color:altSeason>30?"#0affe0":"#f0b90b"},
          ].map((m,i)=>(
            <div key={m.label} className="sm-fade-up sm-hover rounded-2xl p-3.5"
              style={{
                animationDelay:`${i*0.05+0.1}s`,
                background:`${m.color}09`,
                border:`1px solid ${m.color}20`,
              }}>
              <div className="mb-1 text-[8.5px] uppercase tracking-widest text-white/25">{m.label}</div>
              <div className="font-mono text-[15px] font-extrabold leading-none" style={{color:m.color}}>{m.value}</div>
              <div className="mt-1 text-[9px] text-white/30">{m.sub}</div>
            </div>
          ))}
        </div>

      </>}
    </Section>
  );
}

// ── Funding Rates Heatmap ─────────────────────────────────────────────────────

function FundingHeatmapSection() {
  const [rows,setRows]         = useState<FrRow[]>([]);
  const [loading,setLoading]   = useState(true);
  const [updatedAt,setUpdatedAt] = useState("");

  useEffect(()=>{
    const load = async()=>{
      const res = await fetch(`${API_URL}/api/market/funding-rates`,SKIP).then(r=>r.json()).catch(()=>null);
      const rateMap = new Map<string,Record<string,unknown>>(
        (res?.rates??[]).map((r:Record<string,unknown>)=>[r.symbol as string,r])
      );
      const tickers = await Promise.all(
        FR_SYMS.map(sym=>
          fetch(`${API_URL}/api/market/ticker/${sym}`,SKIP).then(r=>r.ok?r.json():null).catch(()=>null)
        )
      );
      setRows(FR_SYMS.map((sym,i)=>{
        const rate = rateMap.get(sym)??{};
        const tk   = tickers[i]??{};
        return {
          sym:sym.replace("USDT",""),
          fr:parseFloat((rate.fundingRate as string)??"0"),
          pct24h:parseFloat((tk.priceChangePercent as string)??"0"),
          nextFunding:parseInt((rate.nextFundingTime as string)??"0")||0,
          price:parseFloat((tk.lastPrice as string)??"0"),
        };
      }));
      setUpdatedAt(new Date().toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"}));
      setLoading(false);
    };
    load(); const t=setInterval(load,15_000); return ()=>clearInterval(t);
  },[]);

  const avgFr   = rows.length ? rows.reduce((s,r)=>s+r.fr,0)/rows.length : 0;
  // шорты платят = fr < 0 (лонги получают — бычий сигнал)
  // лонги платят = fr > 0 (шорты получают — медвежий сигнал)
  const bullish  = rows.filter(r=>r.fr<-0.000001).length;
  const bearish  = rows.filter(r=>r.fr>0.000001).length;
  const maxAbsFr = Math.max(...rows.map(r=>Math.abs(r.fr)),0.000001);

  function frTheme(fr:number) {
    // Пороги в decimal: 0.0003 = 0.03% per 8h (~33% APR) — перегрев
    if(fr>0.0003)  return {color:"#f6465d",glow:"rgba(246,70,93,0.4)",  bg:"rgba(246,70,93,0.10)", border:"rgba(246,70,93,0.30)", label:"ПЕРЕГРЕВ",pulse:true};
    if(fr>0.0001)  return {color:"#f59e0b",glow:"rgba(245,158,11,0.35)",bg:"rgba(245,158,11,0.08)",border:"rgba(245,158,11,0.22)",label:"ЛОНГИ",   pulse:false};
    if(fr>0.000001)return {color:"#9ca3af",glow:"transparent",          bg:"rgba(255,255,255,0.03)",border:"rgba(255,255,255,0.07)",label:"НЕЙТР.", pulse:false};
    if(fr>-0.000001)return{color:"#9ca3af",glow:"transparent",          bg:"rgba(255,255,255,0.03)",border:"rgba(255,255,255,0.07)",label:"НЕЙТР.", pulse:false};
    if(fr>-0.0001) return {color:"#0ecb81",glow:"rgba(14,203,129,0.35)",bg:"rgba(14,203,129,0.08)",border:"rgba(14,203,129,0.22)",label:"ШОРТЫ",   pulse:false};
    return               {color:"#0affe0",glow:"rgba(10,255,224,0.40)", bg:"rgba(10,255,224,0.10)",border:"rgba(10,255,224,0.30)",label:"ДИСКОНТ",pulse:true};
  }

  function fmtNext(ts:number) {
    if(!ts) return ""; const diff=ts-Date.now(); if(diff<=0) return "сейчас";
    const h=Math.floor(diff/3_600_000), m=Math.floor((diff%3_600_000)/60_000);
    return h>0?`${h}ч ${m}м`:`${m}м`;
  }

  return (
    <Section icon={<DollarSign className="h-4 w-4 text-accent-gold"/>}
      title="Ставки финансирования (8ч)" accent="gold" delay={0.15}
      badge={<LiveBadge/>}
      sub={updatedAt ? `WEEX · ${updatedAt}` : "загрузка…"}>

      {loading ? <Skeleton rows={4}/> : <>

        {/* Summary KPIs */}
        <div className="mb-5 grid grid-cols-3 gap-3">
          {[
            {label:"Средний FR",
              value:`${avgFr>=0?"+":""}${(avgFr*100).toFixed(4)}%`,
              color:avgFr>0.000001?"#f59e0b":avgFr<-0.000001?"#0ecb81":"#9ca3af",
              bg:avgFr>0.000001?"rgba(245,158,11,0.07)":avgFr<-0.000001?"rgba(14,203,129,0.07)":"rgba(255,255,255,0.03)",
              border:avgFr>0.000001?"rgba(245,158,11,0.2)":avgFr<-0.000001?"rgba(14,203,129,0.2)":"rgba(255,255,255,0.07)"},
            {label:"Шорты платят", value:`${bullish} из ${rows.length}`,
              color:"#0ecb81", bg:"rgba(14,203,129,0.07)", border:"rgba(14,203,129,0.2)"},
            {label:"Лонги платят", value:`${bearish} из ${rows.length}`,
              color:"#f6465d", bg:"rgba(246,70,93,0.07)", border:"rgba(246,70,93,0.2)"},
          ].map((s,i)=>(
            <div key={s.label} className="sm-fade-up rounded-2xl px-4 py-3.5 text-center"
              style={{animationDelay:`${i*0.05}s`,background:s.bg,border:`1px solid ${s.border}`}}>
              <div className="mb-1 text-[9px] uppercase tracking-widest text-white/25">{s.label}</div>
              <div className="font-mono text-[16px] font-extrabold" style={{color:s.color}}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Heatmap grid */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {rows.map((r,i)=>{
            const th = frTheme(r.fr);
            const barW = Math.min(100, Math.abs(r.fr)/maxAbsFr*100);
            const next = fmtNext(r.nextFunding);

            return (
              <div key={r.sym}
                className={`sm-fade-up sm-hover relative overflow-hidden rounded-2xl p-3.5 ${th.pulse?"sm-glow":""}`}
                style={{
                  animationDelay:`${i*0.04+0.05}s`,
                  background:th.bg,
                  border:`1px solid ${th.border}`,
                  ["--glow" as string]: th.glow,
                }}>

                {/* Top accent */}
                <div className="absolute inset-x-0 top-0 h-[2px] rounded-t-2xl"
                  style={{background:`linear-gradient(90deg,transparent,${th.color},transparent)`,opacity:0.8}}/>

                {/* Symbol */}
                <div className="mb-2.5 flex items-center justify-between">
                  <span className="text-[12px] font-black text-white/80">{r.sym}</span>
                  <span className="text-[7px] font-bold uppercase tracking-wider"
                    style={{color:th.color,opacity:0.8}}>{th.label}</span>
                </div>

                {/* FR value */}
                <div className="font-mono text-[19px] font-extrabold leading-none tabular-nums"
                  style={{color:th.color, textShadow:`0 0 20px ${th.glow}`}}>
                  {r.fr>=0?"+":""}{(r.fr*100).toFixed(4)}%
                </div>

                {/* Magnitude bar */}
                <div className="mt-2.5">
                  <AnimBar pct={barW} color={th.color} height={3} delay={i*0.04+0.05}/>
                </div>

                {/* 24h + next */}
                <div className="mt-2.5 flex items-center justify-between">
                  <span className="font-mono text-[10px] font-semibold"
                    style={{color:r.pct24h>=0?"#0ecb81":"#f6465d"}}>
                    {r.pct24h>=0?"+":""}{r.pct24h.toFixed(2)}%
                  </span>
                  {next && <span className="text-[8px] text-white/20">через {next}</span>}
                </div>

              </div>
            );
          })}
        </div>

        <p className="mt-3 text-[8.5px] text-white/15">
          FR {"<"} 0% — шорты платят лонгам (бычий) · FR {">"} 0.01% — лонги перегреты
        </p>

      </>}
    </Section>
  );
}

// ── Global Market Section (CoinGecko via бэкенд) ──────────────────────────────

function fmtMoney(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toFixed(0)}`;
}

function GlobalMarketSection() {
  const [g, setG] = useState<GlobalMarket | null>(null);

  useEffect(() => {
    const load = () => fetchJson<GlobalMarket>(`${API_URL}/api/market/global`).then(d => { if (d) setG(d); });
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const pos = (g?.market_cap_change_24h ?? 0) >= 0;

  return (
    <Section icon={<Globe className="h-4 w-4 text-accent-cyan" />}
      title="Глобальный рынок" accent="cyan" delay={0.05}
      badge={<LiveBadge />} sub="CoinGecko · вся крипта">
      {!g ? <Skeleton rows={2} /> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard label="Капитализация" value={fmtMoney(g.total_market_cap_usd)}
            sub={g.active_cryptos ? `${fmt(g.active_cryptos)} монет` : undefined}
            color="#ffffff" bg="rgba(255,255,255,0.04)" border="rgba(255,255,255,0.09)" delay={0} />
          <KpiCard label="BTC доминация" value={`${g.btc_dominance.toFixed(1)}%`}
            color="#f0b90b" bg="rgba(240,185,11,0.07)" border="rgba(240,185,11,0.18)" delay={0.05} />
          <KpiCard label="Объём 24ч" value={fmtMoney(g.total_volume_usd)}
            color="#0affe0" bg="rgba(10,255,224,0.06)" border="rgba(10,255,224,0.15)" delay={0.1} />
          <KpiCard label="Капа 24ч" value={`${pos ? "+" : ""}${g.market_cap_change_24h.toFixed(2)}%`}
            color={pos ? "#0ecb81" : "#f6465d"}
            bg={pos ? "rgba(14,203,129,0.07)" : "rgba(246,70,93,0.07)"}
            border={pos ? "rgba(14,203,129,0.2)" : "rgba(246,70,93,0.2)"} delay={0.15} />
        </div>
      )}
    </Section>
  );
}

// ── Trending Coins Section (CoinGecko) ────────────────────────────────────────

function TrendingSection() {
  const [coins, setCoins] = useState<TrendingCoin[] | null>(null);

  useEffect(() => {
    const load = () => fetchJson<{ coins: TrendingCoin[] }>(`${API_URL}/api/market/trending`)
      .then(d => { if (d?.coins) setCoins(d.coins); });
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, []);

  const rankStyle = (i: number) =>
    i === 0 ? { color: "#f0b90b", bg: "rgba(240,185,11,0.15)", bd: "rgba(240,185,11,0.4)" }
    : i === 1 ? { color: "#cbd5e1", bg: "rgba(203,213,225,0.12)", bd: "rgba(203,213,225,0.3)" }
    : i === 2 ? { color: "#d8895a", bg: "rgba(216,137,90,0.12)", bd: "rgba(216,137,90,0.3)" }
    : { color: "rgba(255,255,255,0.35)", bg: "rgba(255,255,255,0.04)", bd: "rgba(255,255,255,0.08)" };

  return (
    <Section icon={<Flame className="h-4 w-4 text-accent-gold" />}
      title="Трендовые монеты" accent="gold" delay={0.1}
      badge={<LiveBadge />} sub="CoinGecko · поиск за 24ч">
      {!coins ? <Skeleton rows={6} /> : (
        <div className="space-y-1.5">
          {coins.slice(0, 8).map((c, i) => {
            const rs = rankStyle(i);
            return (
              <div key={c.id} className="sm-fade-up sm-hover flex items-center gap-3 rounded-xl px-3 py-2.5"
                style={{ animationDelay: `${i * 0.04}s`, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg font-mono text-[11px] font-black"
                  style={{ color: rs.color, background: rs.bg, border: `1px solid ${rs.bd}` }}>
                  {i + 1}
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.thumb} alt={c.symbol} className="h-6 w-6 flex-shrink-0 rounded-full ring-1 ring-white/10" />
                <span className="font-bold text-[13px] text-white">{c.symbol}</span>
                <span className="truncate text-[11px] text-white/30">{c.name}</span>
                {c.rank != null && (
                  <span className="ml-auto flex-shrink-0 rounded-md bg-white/[0.05] px-2 py-0.5 font-mono text-[9px] font-semibold text-white/40">
                    #{c.rank}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ── Bitcoin Network / On-chain Section (mempool.space + blockchain.info) ───────

function BtcNetworkSection() {
  const [d, setD] = useState<OnChainStats | null>(null);

  useEffect(() => {
    const load = () => fetchJson<OnChainStats>(`${API_URL}/api/market/onchain`).then(x => { if (x) setD(x); });
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const diffPos = (d?.difficulty_change_pct ?? 0) >= 0;

  const feeTiers = d ? [
    { label: "Срочно", value: d.fees.fastest, color: "#f6465d" },
    { label: "30 мин", value: d.fees.half_hour, color: "#f0b90b" },
    { label: "1 час", value: d.fees.hour, color: "#0affe0" },
    { label: "Эконом", value: d.fees.economy, color: "#0ecb81" },
  ] : [];

  return (
    <Section icon={<Boxes className="h-4 w-4 text-accent-gold" />}
      title="Сеть Bitcoin" accent="gold" delay={0.15}
      badge={<LiveBadge />} sub="mempool.space · blockchain.info">
      {!d ? <Skeleton rows={4} /> : (
        <div className="space-y-4">
          {/* Комиссии по приоритету */}
          <div>
            <div className="mb-2 text-[9px] uppercase tracking-widest text-white/25">Комиссия сети (sat/vB)</div>
            <div className="grid grid-cols-4 gap-2">
              {feeTiers.map((f, i) => (
                <div key={f.label} className="sm-fade-up rounded-xl px-2 py-2.5 text-center"
                  style={{ animationDelay: `${i * 0.04}s`, background: `${f.color}0d`, border: `1px solid ${f.color}25` }}>
                  <div className="font-mono text-[18px] font-extrabold leading-none" style={{ color: f.color, textShadow: `0 0 16px ${f.color}40` }}>
                    {f.value}
                  </div>
                  <div className="mt-1.5 text-[8px] uppercase tracking-wider text-white/30">{f.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* KPI */}
          <div className="grid grid-cols-3 gap-3">
            <KpiCard label="Хешрейт" value={`${d.hash_rate_ehs.toFixed(0)}`} sub="EH/s"
              color="#0affe0" bg="rgba(10,255,224,0.06)" border="rgba(10,255,224,0.15)" delay={0.05} />
            <KpiCard label="Транзакций 24ч" value={fmtB(d.tx_count_24h).replace("$", "")}
              color="#ffffff" bg="rgba(255,255,255,0.04)" border="rgba(255,255,255,0.09)" delay={0.1} />
            <KpiCard label="Сложность" value={`${diffPos ? "+" : ""}${d.difficulty_change_pct.toFixed(2)}%`}
              sub={`ретаргет ${d.retarget_progress_pct.toFixed(0)}%`}
              color={diffPos ? "#0ecb81" : "#f6465d"}
              bg={diffPos ? "rgba(14,203,129,0.07)" : "rgba(246,70,93,0.07)"}
              border={diffPos ? "rgba(14,203,129,0.2)" : "rgba(246,70,93,0.2)"} delay={0.15} />
          </div>

          <p className="text-[9px] text-white/15">
            Низкая комиссия = свободная сеть · рост сложности = приток майнеров (бычий сигнал для безопасности сети).
          </p>
        </div>
      )}
    </Section>
  );
}

// ── Forex Section (Frankfurter) ───────────────────────────────────────────────

const FOREX_META: Record<string, { flag: string; name: string }> = {
  EUR: { flag: "🇪🇺", name: "Евро" },
  GBP: { flag: "🇬🇧", name: "Фунт стерлингов" },
  JPY: { flag: "🇯🇵", name: "Иена" },
  CHF: { flag: "🇨🇭", name: "Швейцарский франк" },
  CAD: { flag: "🇨🇦", name: "Канадский доллар" },
  AUD: { flag: "🇦🇺", name: "Австралийский доллар" },
};

function ForexSection() {
  const [fx, setFx] = useState<ForexRates | null>(null);

  useEffect(() => {
    const load = () => fetchJson<ForexRates>(`${API_URL}/api/market/forex`).then(d => { if (d) setFx(d); });
    load();
    const t = setInterval(load, 600_000);
    return () => clearInterval(t);
  }, []);

  return (
    <Section icon={<Banknote className="h-4 w-4 text-accent-cyan" />}
      title="Форекс" accent="cyan" delay={0.2}
      badge={fx ? <span className="rounded-md border border-white/[0.08] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-white/40">{fx.date}</span> : undefined}
      sub="Frankfurter · базовая USD">
      {!fx ? <Skeleton rows={4} /> : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Object.entries(fx.rates).map(([cur, rate], i) => {
            const meta = FOREX_META[cur] ?? { flag: "💱", name: cur };
            return (
              <div key={cur} className="sm-fade-up sm-hover flex items-center gap-3 rounded-xl px-3.5 py-3"
                style={{ animationDelay: `${i * 0.04}s`, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <span className="text-[22px] leading-none">{meta.flag}</span>
                <div className="min-w-0">
                  <div className="font-bold text-[13px] text-white">{fx.base}/{cur}</div>
                  <div className="truncate text-[10px] text-white/30">{meta.name}</div>
                </div>
                <span className="ml-auto font-mono text-[16px] font-extrabold tabular-nums text-accent-cyan"
                  style={{ textShadow: "0 0 16px rgba(10,255,224,0.25)" }}>
                  {rate.toFixed(4)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SmartMoneyPage() {
  return (
    <>
      <style>{ANIM_CSS}</style>
      <div className="space-y-5">

        {/* Page header */}
        <div className="sm-fade relative overflow-hidden rounded-2xl border border-white/[0.06] px-6 py-5"
          style={{background:"linear-gradient(135deg,rgba(240,185,11,0.08),rgba(10,255,224,0.04),rgba(14,203,129,0.05))"}}>
          <div className="pointer-events-none absolute inset-0"
            style={{background:"radial-gradient(ellipse at 10% 50%,rgba(240,185,11,0.06),transparent 60%)"}}/>
          <div className="relative flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl flex-shrink-0"
              style={{background:"rgba(240,185,11,0.12)",border:"1px solid rgba(240,185,11,0.3)",boxShadow:"0 0 24px rgba(240,185,11,0.15)"}}>
              <Building2 className="h-5 w-5 text-accent-gold"/>
            </div>
            <div>
              <h1 className="text-[20px] font-black text-white tracking-tight">Smart Money</h1>
              <p className="mt-0.5 text-[11px] text-white/30 tracking-wide">
                CFTC COT · Деривативы · Ончейн · Макро · Bitcoin ETF · Потоки капитала
              </p>
            </div>
            <div className="ml-auto hidden sm:flex items-center gap-2">
              {[
                {label:"COT", color:"#f0b90b"},
                {label:"Макро", color:"#0affe0"},
                {label:"ETF", color:"#0ecb81"},
                {label:"Funding", color:"#f0b90b"},
              ].map(t=>(
                <span key={t.label} className="rounded-lg px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider"
                  style={{color:t.color,background:`${t.color}12`,border:`1px solid ${t.color}25`}}>
                  {t.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Глобальный рынок */}
        <GlobalMarketSection/>

        {/* Grid: Трендовые монеты + Сеть Bitcoin */}
        <div className="grid gap-5 xl:grid-cols-2">
          <TrendingSection/>
          <BtcNetworkSection/>
        </div>

        {/* Форекс — full width */}
        <ForexSection/>

        {/* Grid: COT + Ставки и финансирование */}
        <div className="grid gap-5 xl:grid-cols-2">
          <CotSection/>
          <FundingHeatmapSection/>
        </div>

        {/* Derivatives — full width */}
        <DerivativesSection/>

        {/* Grid: Onchain + Макро индикаторы */}
        <div className="grid gap-5 xl:grid-cols-2">
          <OnchainSection/>
          <MacroSection/>
        </div>

        {/* ETF — full width */}
        <EtfSection/>

      </div>
    </>
  );
}

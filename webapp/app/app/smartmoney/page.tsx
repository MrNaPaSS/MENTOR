"use client";

import { useT } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { API_URL } from "@/lib/api";
import { openMarketSection } from "@/lib/marketSection";
import { useTerminalTheme } from "@/lib/terminalTheme";
import {
  Activity, AlertTriangle, BarChart3, Building2,
  ChevronDown, ChevronUp, DollarSign,
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
  .sm-shimmer   { background:linear-gradient(90deg,transparent 0%,var(--pane-hover) 50%,transparent 100%);
                  background-size:200% 100%; animation:shimmer 1.8s ease-in-out infinite; }
  .sm-hover     { transition:border-color 0.2s,background 0.2s,transform 0.15s; }
  .sm-hover:hover { transform:translateY(-1px); border-color:var(--pane-border) !important; }
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
  {key:"DXY",   label:"DXY",             price:99.21,  change:-0.44, changePct:-0.44},
  {key:"US10Y", label:"US 10Y Treasury", price:4.41,   change:0.03,  changePct:0.68},
  {key:"SPX",   label:"S&P 500",         price:5921.0, change:42.1,  changePct:0.72},
  {key:"GOLD",  label:"XAU/USD",         price:3247.5, change:18.3,  changePct:0.57},
  {key:"OIL",   label:"WTI",             price:61.8,   change:-0.94, changePct:-1.50},
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
const FR_SYMS    = ["BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT","BNBUSDT","DOGEUSDT","ADAUSDT","AVAXUSDT","LINKUSDT","DOTUSDT","LTCUSDT","TRXUSDT","TONUSDT","SUIUSDT","NEARUSDT"];
const ALT_ME_API = "https://api.alternative.me/fng/?limit=1";
const COINGECKO_API = "https://api.coingecko.com/api/v3";

function fmt(n:number, dec=0)  { return n.toLocaleString("en-US",{minimumFractionDigits:dec,maximumFractionDigits:dec}); }
function fmtK(n:number)         { return Math.abs(n)>=1000?(n/1000).toFixed(1)+"K":String(n); }
function fmtB(n:number)         { if(n>=1e9)return`$${(n/1e9).toFixed(1)}B`; if(n>=1e6)return`$${(n/1e6).toFixed(0)}M`; return`$${n.toFixed(0)}`; }
function signColor(n:number)    { return n>0?"text-[var(--pane-up)]":n<0?"text-[var(--pane-down)]":"text-[var(--pane-muted)]"; }

async function fetchJson<T>(url:string, opts?:RequestInit): Promise<T|null> {
  try {
    const r = await fetch(url,{...opts,headers:{"ngrok-skip-browser-warning":"1",...(opts?.headers||{})}});
    if(!r.ok) return null;
    return r.json() as Promise<T>;
  } catch { return null; }
}

// ── Общие части ──────────────────────────────────────────────────────────────
//
// Раздел живёт вкладкой «Рынка», а значит обязан выглядеть его частью: та же
// рамка, та же шапка, те же подписи прописными. Своя рамка со свечением по
// краю у него была - и рядом с панелями терминала читалась вставкой из другой
// программы.

/** Данные приходят с сервера и обновляются сами. */
function LiveBadge() {
  const t = useT();
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded border border-[var(--pane-border)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
      style={{ color: "var(--pane-up)" }}
      title={t.smart.liveTitle}
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: "var(--pane-up)" }} />
      Live
    </span>
  );
}

/**
 * Источник не ответил, и на экране - образец.
 *
 * Метка кричащая намеренно. Цифры под ней выдуманы, и спутать их с настоящими
 * значит принять решение по числу, которого не было: на этих показателях
 * строят взгляд на неделю вперёд.
 */
function DemoBadge() {
  const t = useT();
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
      style={{
        color: "var(--pane-gold)",
        background: "var(--pane-gold-soft)",
        border: "1px solid var(--pane-gold)",
      }}
      title={t.smart.demoTitle}
    >
      {t.smart.demoBadge}
    </span>
  );
}

function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-6 animate-pulse rounded bg-[var(--pane-border)]"
          style={{ width: `${72 + (i % 3) * 9}%`, animationDelay: `${i * 120}ms` }}
        />
      ))}
    </div>
  );
}

/** Панель раздела: та же рамка, что у всех показателей «Рынка». */
function Section({
  icon,
  title,
  sub,
  badge,
  accent = "cyan",
  delay = 0,
  className = "",
  children,
}: {
  icon: React.ReactNode;
  title: string;
  sub?: string;
  badge?: React.ReactNode;
  accent?: "cyan" | "gold" | "green";
  delay?: number;
  /** Место панели в колонке: например, растянуться на её остаток. */
  className?: string;
  children: React.ReactNode;
}) {
  const ac =
    accent === "gold"
      ? "var(--pane-gold)"
      : accent === "green"
        ? "var(--pane-up)"
        : "var(--pane-accent)";
  return (
    <section
      className={`sm-fade-up flex flex-col overflow-hidden rounded-lg border border-[var(--pane-border)] bg-[var(--pane-bg)] ${className}`}
      style={{ animationDelay: `${delay}s` }}
    >
      <header className="flex items-center gap-2.5 border-b border-[var(--pane-border)] px-3 py-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded" style={{ color: ac }}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <span className="text-[12px] font-semibold text-[var(--pane-text)]">{title}</span>
          {sub && (
            <span className="ml-2 text-[10px] text-[var(--pane-muted)]">{sub}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">{badge}</div>
      </header>
      <div className="flex-1 p-3">{children}</div>
    </section>
  );
}

/** Крупное число с подписью: показатель, который читают первым. */
function KpiCard({
  label,
  value,
  sub,
  color,
  bg,
  border,
  delay = 0,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
  bg: string;
  border: string;
  delay?: number;
}) {
  return (
    <div
      className="sm-fade-up rounded border border-[var(--pane-border)] bg-[var(--pane-deep)] px-3 py-2"
      style={{ animationDelay: `${delay}s`, background: bg, borderColor: border }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--pane-muted)]">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[19px] font-bold leading-none tabular-nums" style={{ color }}>
        {value}
      </div>
      {sub && <div className="mt-1 text-[10px] text-[var(--pane-muted)]">{sub}</div>}
    </div>
  );
}

/** Полоса-доля. Растёт после появления: так видно, что число живое. */
function AnimBar({
  pct,
  color,
  height = 4,
  delay = 0,
}: {
  pct: number;
  color: string;
  height?: number;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.width = "0%";
    const id = setTimeout(
      () => {
        el.style.width = `${pct}%`;
        el.style.transition = "width 0.9s cubic-bezier(0.4,0,0.2,1)";
      },
      delay * 1000 + 60,
    );
    return () => clearTimeout(id);
  }, [pct, delay]);
  return (
    <div className="overflow-hidden rounded-full bg-[var(--pane-border)]" style={{ height }}>
      <div ref={ref} className="h-full rounded-full" style={{ backgroundColor: color }} />
    </div>
  );
}

// ── COT Section ───────────────────────────────────────────────────────────────

function CotSection() {
  const t = useT();
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
    <Section icon={<Building2 className="h-4 w-4 text-[var(--pane-gold)]"/>}
      title={t.smart.cot.title} accent="gold" delay={0}
      badge={isDemo ? <DemoBadge/> : undefined}
      sub={isDemo ? t.smart.cot.subDemo : t.smart.cot.subLive}>

      {/* Asset toggle */}
      <div className="mb-5 flex items-center gap-1.5">
        {(["BTC","ETH"] as const).map(a=>(
          <button key={a} onClick={()=>setAsset(a)}
            className="relative rounded px-5 py-1.5 text-[12px] font-bold transition-all"
            style={{
              background: asset===a ? "var(--pane-gold-soft)" : "var(--pane-hover)",
              color: asset===a ? "var(--pane-gold)" : "var(--pane-muted)",
              border: asset===a ? "1px solid var(--pane-gold)" : "1px solid var(--pane-hover)",
              boxShadow: "none",
            }}>
            {a}
          </button>
        ))}
        {loading && <div className="ml-1 h-4 w-4 animate-spin rounded-full border border-[var(--pane-border)] border-t-[var(--pane-gold)]" />}
      </div>

      {!cot || loading ? <Skeleton rows={5}/> : <>

        {isDemo && (
          <div className="mb-4 flex items-center gap-2.5 rounded border border-[var(--pane-gold-soft)] bg-[var(--pane-deep)] px-4 py-2.5 text-[11px] text-[var(--pane-gold)]">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 opacity-70"/>
            {t.smart.cot.demoWarning}
          </div>
        )}

        <div className="space-y-5">

          {/* KPI row */}
          <div className="grid grid-cols-3 gap-3">
            <KpiCard label={t.smart.cot.hedgeFundsNet} value={`${cur.nc_net>0?"+":""}${fmtK(cur.nc_net)}`}
              sub={`${cur.nc_net_chg>0?"+":""}${fmtK(cur.nc_net_chg)} ${t.smart.cot.weekShort}`}
              color={cur.nc_net>0?"var(--pane-up)":"var(--pane-down)"}
              bg={cur.nc_net>0?"var(--pane-up-faint)":"var(--pane-down-faint)"}
              border={cur.nc_net>0?"var(--pane-up-soft)":"var(--pane-down-soft)"} delay={0.05}/>
            <KpiCard label={t.smart.cot.hedgersNet} value={`${cur.c_net>0?"+":""}${fmtK(cur.c_net)}`}
              sub={`${cur.c_net_chg>0?"+":""}${fmtK(cur.c_net_chg)} ${t.smart.cot.weekShort}`}
              color={cur.c_net>0?"var(--pane-up)":"var(--pane-down)"}
              bg={cur.c_net>0?"var(--pane-up-faint)":"var(--pane-down-faint)"}
              border={cur.c_net>0?"var(--pane-up-soft)":"var(--pane-down-soft)"} delay={0.1}/>
            <KpiCard label={t.smart.cot.openInterest} value={fmtK(cur.oi)}
              color="var(--pane-text)" bg="var(--pane-hover)" border="var(--pane-hover)" delay={0.15}/>
          </div>

          {/* Position structure */}
          <div className="rounded-lg border border-[var(--pane-border)] bg-[var(--pane-deep)] p-4 space-y-3">
            <div className="text-[9px] uppercase tracking-widest text-[var(--pane-muted)] mb-1">{t.smart.cot.structure}</div>

            {[
              {label:t.smart.cot.levMoney, long:cur.nc_long_pct, short:cur.nc_short_pct, lc:"var(--pane-up)", sc:"var(--pane-down)"},
              {label:t.smart.cot.assetManager, long:cur.c_long_pct,  short:cur.c_short_pct,  lc:"var(--pane-up)", sc:"var(--pane-down)"},
            ].map((row,ri)=>(
              <div key={ri}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] text-[var(--pane-muted)]">{row.label}</span>
                  <div className="flex gap-3 text-[10px] font-mono">
                    <span style={{color:row.lc}}>L {row.long.toFixed(1)}%</span>
                    <span style={{color:row.sc}}>S {row.short.toFixed(1)}%</span>
                  </div>
                </div>
                <div className="flex h-2 overflow-hidden rounded-full bg-[var(--pane-deep)]">
                  <div className="h-full rounded-l-full transition-all duration-700"
                    style={{width:`${row.long}%`,background:`linear-gradient(90deg,${row.lc}50,${row.lc}90)`}} />
                  <div className="mx-[1px] h-full w-[2px] flex-shrink-0 bg-[var(--pane-deep)] rounded-full" />
                  <div className="h-full rounded-r-full transition-all duration-700"
                    style={{width:`${row.short}%`,background:`linear-gradient(90deg,${row.sc}90,${row.sc}50)`}} />
                </div>
              </div>
            ))}
          </div>

          {/* History mini-chart */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[9px] uppercase tracking-widest text-[var(--pane-muted)]">
                {t.smart.cot.historyTitle(cot.length)}
              </div>
              <div className="flex items-center gap-3 text-[8px] text-[var(--pane-muted)]">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{background:"var(--pane-up)"}}/>{t.smart.cot.bullish}</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{background:"var(--pane-down)"}}/>{t.smart.cot.bearish}</span>
              </div>
            </div>
            <div className="flex items-end gap-1.5 rounded bg-[var(--pane-deep)] px-3 pb-2 pt-3" style={{height:80}}>
              {[...cot].reverse().map((row,i)=>{
                const h = Math.max((Math.abs(row.nc_net)/maxNet)*62,4);
                const color = row.nc_net>=0 ? "var(--pane-up)" : "var(--pane-down)";
                return (
                  <div key={i} title={`${row.date}: ${row.nc_net>0?"+":""}${fmt(row.nc_net)}`}
                    className="group relative flex flex-1 flex-col items-center justify-end cursor-default" style={{height:68}}>
                    <div className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-bg-deep/80 px-1.5 py-0.5 text-[8px] text-[var(--pane-text)] opacity-0 transition-opacity group-hover:opacity-100 z-10">
                      {fmtK(row.nc_net)}
                    </div>
                    <div className="w-full rounded-t-sm transition-all duration-200 group-hover:opacity-100"
                      style={{height:`${h}px`,background:color,opacity:0.6,
                        boxShadow:`0 0 6px ${color}50`}} />
                  </div>
                );
              })}
            </div>
            <div className="mt-1.5 flex justify-between text-[8px] text-[color:color-mix(in_srgb,var(--pane-text)_15%,transparent)]">
              <span>{t.smart.cot.older}</span><span>{t.smart.cot.newer}</span>
            </div>
          </div>

          {/* Insight box */}
          <div className="rounded border border-[var(--pane-gold-soft)] bg-[var(--pane-deep)] p-3.5 text-[10px] leading-relaxed text-[var(--pane-muted)]">
            <span className="font-semibold text-[var(--pane-gold)]">{t.smart.cot.insightBold}</span>{t.smart.cot.insightRest}
            <span className="font-semibold text-[var(--pane-gold)]">{t.smart.cot.hedgersBold}</span>{t.smart.cot.hedgersRest}
            {prev && (<>{" "}{t.smart.cot.weekChange} <span className={signColor(cur.nc_net-prev.nc_net)}>{cur.nc_net>=prev.nc_net?"▲":"▼"} {Math.abs(cur.nc_net-prev.nc_net).toLocaleString()}</span>.</>)}
            {" "}<span className="text-[var(--pane-muted)]">{t.smart.cot.reportDelay}</span>
          </div>

        </div>
      </>}
    </Section>
  );
}

// ── Macro Section ─────────────────────────────────────────────────────────────

/** Картинка у показателя. Подпись и пояснение переводятся - они в словаре. */
const MACRO_ICONS: Record<string, string> = {
  DXY: "💵", US10Y: "📈", SPX: "📊", GOLD: "🥇", OIL: "🛢", VIX: "⚡",
};

function MacroSection({ className = "" }: { className?: string }) {
  const t = useT();
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
    <Section icon={<BarChart3 className="h-4 w-4 text-[var(--pane-accent)]"/>}
      title={t.smart.macro.title} accent="cyan" delay={0.05} className={className}
      badge={isDemo ? <DemoBadge/> : undefined}
      sub={isDemo ? t.smart.sourceSilent : t.smart.macro.sub}>

      {!items ? <Skeleton rows={3}/> : <>

        {isDemo && (
          <div className="mb-4 flex items-center gap-2.5 rounded border border-[var(--pane-gold-soft)] bg-[var(--pane-deep)] px-4 py-2.5 text-[11px] text-[var(--pane-gold)]">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 opacity-70"/>
            {t.smart.macro.demoWarning}
          </div>
        )}

        {/* Карточки тянутся на всю высоту панели: она растянута до низа
            соседней, и без этого под ними оставалось бы пустое поле. */}
        <div className="grid h-full auto-rows-fr grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((item,i)=>{
            const pos = item.changePct>=0;
            const dec = item.key==="US10Y"||item.key==="VIX" ? 2 : item.price>1000 ? 1 : 2;
            const color = pos ? "var(--pane-up)" : "var(--pane-down)";
            const labels = t.smart.macro.labels as Record<string, string>;
            const contexts = t.smart.macro.context as Record<string, string>;
            const icon = MACRO_ICONS[item.key] ?? "•";
            return (
              <div key={item.key}
                className="sm-fade-up sm-hover group relative overflow-hidden rounded-lg p-4 cursor-default"
                style={{
                  animationDelay:`${i*0.04}s`,
                  background: pos ? "var(--pane-up-faint)" : "var(--pane-down-faint)",
                  border: `1px solid ${pos?"var(--pane-up-soft)":"var(--pane-down-soft)"}`,
                }}>
                {/* dim corner bg */}
                <div className="pointer-events-none absolute right-2 bottom-2 text-[28px] opacity-[0.06] select-none">{icon}</div>

                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[8px] font-bold uppercase tracking-widest text-[var(--pane-muted)]">{labels[item.key] ?? item.label}</span>
                  <span className="font-mono text-[9px] font-bold" style={{color:"var(--pane-muted)"}}>{item.key}</span>
                </div>

                <div className="font-mono text-[20px] font-extrabold leading-none text-[var(--pane-text)]">
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

                <div className="mt-2 text-[9px] text-[var(--pane-muted)]">{contexts[item.key] ?? ""}</div>
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
  const t = useT();
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
    <Section icon={<DollarSign className="h-4 w-4 text-[var(--pane-up)]"/>}
      title={t.smart.etf.title} accent="green" delay={0.3}
      badge={isDemo ? <DemoBadge/> : <LiveBadge/>}
      sub={isDemo ? t.smart.sourceSilent : t.smart.etf.sub}>

      {!data ? <Skeleton rows={5}/> : <div className="space-y-4">

        {/* Banner */}
        <div className="relative overflow-hidden rounded-lg border border-[var(--pane-gold-soft)] p-5"
          style={{background:"linear-gradient(135deg,var(--pane-accent-faint),var(--pane-accent-faint))"}}>
          <div className="pointer-events-none absolute inset-0"
            style={{background:"radial-gradient(ellipse at 80% 50%,var(--pane-accent-faint),transparent 70%)"}} />
          <div className="relative flex flex-wrap items-center gap-6">
            <div>
              <div className="text-[9px] uppercase tracking-widest text-[var(--pane-muted)] mb-1">{t.smart.etf.totalBtc}</div>
              <div className="font-mono text-[32px] font-black leading-none text-[var(--pane-gold)]">
                ~{(data.total_btc/1000).toFixed(0)}<span className="text-[16px] font-semibold ml-1">K BTC</span>
              </div>
              <div className="mt-1 text-[10px] text-[var(--pane-muted)]">
                {t.smart.etf.ofMaxSupply(((data.total_btc/21_000_000)*100).toFixed(2))}
              </div>
            </div>
            <div className="h-12 w-px bg-[var(--pane-deep)]"/>
            <div>
              <div className="text-[9px] uppercase tracking-widest text-[var(--pane-muted)] mb-1">{t.smart.etf.funds}</div>
              <div className="font-mono text-[28px] font-black leading-none text-[var(--pane-text)]">{data.etfs.length}</div>
            </div>
            {btcPrice>0 && <>
              <div className="h-12 w-px bg-[var(--pane-deep)]"/>
              <div>
                <div className="text-[9px] uppercase tracking-widest text-[var(--pane-muted)] mb-1">BTC/USD</div>
                <div className="font-mono text-[24px] font-black leading-none text-[var(--pane-accent)]">${btcPrice.toLocaleString("en-US")}</div>
              </div>
            </>}
            {topEtf && <>
              <div className="h-12 w-px bg-[var(--pane-deep)]"/>
              <div>
                <div className="text-[9px] uppercase tracking-widest text-[var(--pane-muted)] mb-1">{t.smart.etf.leader}</div>
                <div className="font-mono text-[18px] font-black leading-none text-[var(--pane-text)]">{topEtf.ticker}</div>
                <div className="text-[9px] text-[var(--pane-muted)]">{t.smart.etf.sharePct(topEtf.sharePct)}</div>
              </div>
            </>}
          </div>
        </div>

        {/* ETF list */}
        <div className="space-y-2">
          {/* header */}
          <div className="grid px-3 text-[8px] uppercase tracking-widest text-[var(--pane-muted)]"
            style={{gridTemplateColumns:"28px 1fr 70px 60px 55px 80px"}}>
            <span>#</span><span>{t.smart.etf.colFund}</span>
            <span className="text-right">BTC</span>
            <span className="text-right">{t.smart.etf.colAssets}</span>
            <span className="text-right">{t.smart.etf.colShare}</span>
            <span className="text-right">{t.smart.etf.colUnit}</span>
          </div>

          {data.etfs.map((etf,i)=>{
            const pos = etf.changePct>=0;
            return (
              <div key={i} className="sm-fade-up sm-hover group relative overflow-hidden rounded p-3"
                style={{
                  animationDelay:`${i*0.04+0.1}s`,
                  background:"rgba(255,255,255,0.025)",
                  border:"1px solid var(--pane-hover)",
                }}>
                {/* share bar background */}
                <div className="absolute inset-y-0 left-0 rounded-l-xl transition-all duration-700"
                  style={{width:`${etf.sharePct}%`,background:"var(--pane-up-faint)",maxWidth:"100%"}} />

                <div className="relative grid items-center gap-2"
                  style={{gridTemplateColumns:"28px 1fr 70px 60px 55px 80px"}}>
                  <div className="text-[11px] font-bold text-[var(--pane-muted)]">{i+1}</div>

                  <div>
                    <div className="text-[12px] font-bold text-[var(--pane-text)]">{etf.ticker}</div>
                    <div className="text-[9px] text-[var(--pane-muted)] truncate">{etf.name}</div>
                  </div>

                  <div className="text-right font-mono text-[11px] text-[var(--pane-text-2)]">
                    {etf.btc>0 ? `${(etf.btc/1000).toFixed(0)}K` : "-"}
                  </div>
                  <div className="text-right font-mono text-[10px] text-[var(--pane-muted)]">
                    {etf.aum_usd&&etf.aum_usd>0 ? `$${(etf.aum_usd/1e9).toFixed(1)}B` : "-"}
                  </div>
                  <div className="text-right font-mono text-[12px] font-bold text-[var(--pane-up)]">
                    {etf.sharePct}%
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[11px] text-[var(--pane-text)]">{etf.price>0?`$${etf.price}`:"-"}</div>
                    {etf.price>0 && (
                      <div className="font-mono text-[9px]" style={{color:pos?"var(--pane-up)":"var(--pane-down)"}}>
                        {pos?"+":""}{etf.changePct.toFixed(2)}%
                      </div>
                    )}
                  </div>
                </div>

                {/* animated share bar */}
                <div className="mt-2.5">
                  <AnimBar pct={etf.sharePct} color="var(--pane-up)" height={3} delay={i*0.05+0.1}/>
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-[9px] text-[color:color-mix(in_srgb,var(--pane-text)_15%,transparent)]">{t.smart.etf.sources}</p>
      </div>}
    </Section>
  );
}

// ── Derivatives Section ───────────────────────────────────────────────────────

function DerivativesSection() {
  const t = useT();
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
    load(); const timer=setInterval(load,30_000); return ()=>clearInterval(timer);
  },[]);

  const totalOI = rows.reduce((s,r)=>s+r.oi,0);
  const maxOI   = Math.max(...rows.map(r=>r.oi),1);

  return (
    <Section icon={<Activity className="h-4 w-4 text-[var(--pane-accent)]"/>}
      title={t.smart.oi.title} accent="cyan" delay={0.2}
      badge={<LiveBadge/>}
      sub={updatedAt ? t.smart.oi.subLive(updatedAt) : t.smart.oi.subAsking}>

      {loading ? <Skeleton rows={5}/> : <>

        {/* KPI row */}
        <div className="mb-5 grid grid-cols-3 gap-3">
          <KpiCard label={t.smart.oi.totalOi} value={fmtB(totalOI)} color="var(--pane-text)"
            bg="var(--pane-hover)" border="var(--pane-hover)" delay={0}/>
          <KpiCard label={t.smart.oi.coinsListed} value={String(rows.length)}
            color="var(--pane-accent)" bg="var(--pane-accent-faint)" border="var(--pane-accent-soft)" delay={0.05}/>
          <KpiCard
            label={t.smart.oi.biggest}
            value={rows[0]?.sym??"-"}
            sub={rows[0]?.oi>0 ? fmtB(rows[0].oi) : undefined}
            color="var(--pane-gold)" bg="var(--pane-accent-faint)" border="var(--pane-gold-soft)" delay={0.1}/>
        </div>

        {/* Rows */}
        <div className="space-y-2">
          <div className="grid px-3 text-[8px] uppercase tracking-widest text-[var(--pane-muted)]"
            style={{gridTemplateColumns:"48px 1fr 90px 80px 80px"}}>
            <span>{t.smart.oi.colPair}</span><span>{t.smart.oi.colShare}</span>
            <span className="text-right">OI</span>
            <span className="text-right">{t.smart.oi.colFunding}</span>
            <span className="text-right">{t.smart.oi.col24h}</span>
          </div>

          {rows.map((r,i)=>{
            const fr = r.fr; const frPct = fr*100;
            const frColor = fr>0.01?"var(--pane-down)":fr>0?"var(--pane-gold)":fr<-0.001?"var(--pane-up)":"var(--pane-muted)";
            const pct = (r as DerivRow & {pct24h?:number}).pct24h??0;
            const oiPct = r.oi/maxOI*100;

            return (
              <div key={r.sym} className="sm-fade-up sm-hover group rounded-lg p-3.5"
                style={{
                  animationDelay:`${i*0.05}s`,
                  background:"rgba(255,255,255,0.025)",
                  border:"1px solid var(--pane-hover)",
                }}>
                <div className="grid items-center gap-3" style={{gridTemplateColumns:"48px 1fr 90px 80px 80px"}}>

                  <div className="font-bold text-[14px] text-[var(--pane-text)]">{r.sym}</div>

                  <div>
                    <AnimBar pct={oiPct} color="var(--pane-accent)" height={5} delay={i*0.04}/>
                    <div className="mt-1 text-[8px] text-[var(--pane-muted)]">{t.smart.oi.ofMax(oiPct.toFixed(0))}</div>
                  </div>

                  <div className="text-right font-mono text-[12px] text-[var(--pane-text-2)]">
                    {r.oi>0 ? fmtB(r.oi) : "-"}
                  </div>

                  <div className="text-right">
                    <div className="font-mono text-[12px] font-bold" style={{color:frColor}}>
                      {fr>=0?"+":""}{frPct.toFixed(4)}%
                    </div>
                    <div className="mt-0.5 text-[8px] font-semibold text-[var(--pane-muted)]">
                      {fr>0.01?t.smart.oi.overheated:fr>0.001?t.smart.oi.longs:fr<-0.001?t.smart.oi.shorts:t.smart.oi.neutral}
                    </div>
                  </div>

                  <div className={`text-right font-mono text-[12px] font-bold ${pct>=0?"text-[var(--pane-up)]":"text-[var(--pane-down)]"}`}>
                    {pct>=0?"+":""}{pct.toFixed(2)}%
                  </div>

                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-3 text-[8.5px] text-[color:color-mix(in_srgb,var(--pane-text)_15%,transparent)]">
          {t.smart.oi.footnote}
        </p>
      </>}
    </Section>
  );
}

// ── Баннер ────────────────────────────────────────────────────────────────────

/**
 * Баннер раздела. Кнопка «Открыть карты» нарисована на самой картинке,
 * поэтому нажимается весь баннер: искать на нём настоящую кнопку незачем.
 */
function SmartBanner() {
  const t = useT();
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => openMarketSection("maps", router.push)}
      className="group block overflow-hidden rounded-xl border border-[var(--pane-border)] transition-[transform,box-shadow] duration-200 ease-out hover:shadow-[0_8px_28px_-10px_rgba(240,185,11,0.55)] active:scale-[0.99]"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/art/market/smart-money.webp"
        alt={t.market.promo.smartAlt}
        className="block w-full transition-transform duration-300 ease-out group-hover:scale-[1.01]"
      />
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SmartMoneyPage() {
  const t = useT();
  const pane = useTerminalTheme() === "light" ? "pane-light" : "pane-dark";

  return (
    <>
      <style>{ANIM_CSS}</style>
      {/* Класс темы и здесь: раздел открывается и сам по себе, не только
          вкладкой «Рынка», и без него панели остались бы без палитры. */}
      <div className={`${pane} space-y-3`}>
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-[15px] font-semibold uppercase tracking-[0.16em] text-[var(--pane-text)]">
            {t.smart.title}
          </h1>
          <p className="truncate text-[11px] text-[var(--pane-muted)]">
            {t.smart.subtitle}
          </p>
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          <CotSection />
          {/* Правый столбец ровняется по левому: макро занимает остаток
              высоты, баннер стоит у нижнего края. Иначе под баннером
              оставалось пустое место до низа секции. */}
          <div className="flex flex-col gap-3">
            <MacroSection className="flex-1" />
            <SmartBanner />
          </div>
        </div>

        <DerivativesSection />

        <EtfSection />
      </div>
    </>
  );
}

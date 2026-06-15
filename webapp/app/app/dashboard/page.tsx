"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { api, Profile, AnalyticsMe } from "@/lib/api";
import { getAccessToken, logout } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { fmtUsd, modeLabel } from "@/lib/format";
import StatCard from "@/components/ui/StatCard";
import FearGreed from "@/components/market/FearGreed";
import { Wallet, TrendingUp, Radio, BarChart3, RefreshCw } from "lucide-react";

const TradingChart = dynamic(() => import("@/components/market/TradingChart"), { ssr: false });
const OrderBook = dynamic(() => import("@/components/market/OrderBook"), { ssr: false });

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"];

export default function Dashboard() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSym, setActiveSym] = useState("BTCUSDT");
  const [refreshing, setRefreshing] = useState(false);

  async function loadData() {
    const token = getAccessToken();
    if (!token) return;
    try {
      const [p, a] = await Promise.all([
        api.profile(token), api.analyticsMe(token),
      ]);
      setProfile(p); setAnalytics(a);
    } catch (err: any) {
      if (err.message?.includes("401") || err.message?.includes("Unauthorized") || err.message?.includes("токен")) {
        logout();
        router.replace("/login");
      }
    }
    finally { setLoading(false); }
  }

  async function refreshBalance() {
    const token = getAccessToken();
    if (!token || refreshing) return;
    setRefreshing(true);
    try {
      const p = await api.refreshBalance(token);
      setProfile(p);
    } catch { } finally { setRefreshing(false); }
  }

  useEffect(() => { loadData(); }, []);

  const balance = parseFloat(profile?.balance_usdt || "0");

  return (
    <div className="space-y-6">
      {/* Баланс + режим */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="eyebrow mb-1">{modeLabel(profile?.mode || "moderate")}</div>
          <div className="flex items-end gap-3">
            <span className="font-mono text-4xl font-extrabold tabular text-white">
              {loading ? "—" : `$${balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            </span>
            <span className="mb-1 text-lg text-text-muted">USDT</span>
            {profile?.balance_source === "affiliate_api" && (
              <span className="mb-1 flex items-center gap-1 text-xs text-success">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                WEEX Live
              </span>
            )}
          </div>
        </div>
        <button onClick={refreshBalance} disabled={refreshing}
          className="btn-outline gap-1.5 py-2 text-xs">
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Обновить баланс
        </button>
      </div>

      {/* KPI */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard icon={Wallet} label="Баланс USDT" accent="cyan" loading={loading}
            value={fmtUsd(profile?.balance_usdt)} hint={profile?.balance_source === "affiliate_api" ? "• WEEX live" : "• вручную"} />
          <StatCard icon={Radio} label="Получено всего" accent="gold" loading={loading}
            value={analytics?.signals_received ?? 0} />
          <StatCard icon={TrendingUp} label="Доставлено" accent="success" loading={loading}
            value={analytics?.sent ?? 0} />
          <StatCard icon={BarChart3} label="Ошибок" accent="cyan" loading={loading}
            value={analytics?.failed ?? 0} />
        </div>

        {/* Главный блок: TV-график + стакан */}
        <div className="grid gap-4 xl:grid-cols-[1fr_280px]">
          <div className="card overflow-hidden p-0">
            {/* Переключатели пары */}
            <div className="flex items-center gap-1 border-b border-border p-3">
              {SYMBOLS.map((sym) => (
                <button key={sym} onClick={() => setActiveSym(sym)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    activeSym === sym ? "bg-accent-cyan/15 text-accent-cyan" : "text-text-muted hover:text-white"
                  }`}>
                  {sym.replace("USDT", "")}
                </button>
              ))}
              <span className="ml-auto text-[10px] text-text-muted">TradingView</span>
            </div>
            <TradingChart symbol={activeSym} height={590} showToolbar={false} />
          </div>

          {/* Стакан — без скролла, по высоте равен чарту */}
          <div className="card overflow-hidden p-0">
            <div className="border-b border-border p-3">
              <h3 className="text-sm font-semibold text-white">Стакан цен</h3>
              <p className="text-[10px] text-text-muted">{activeSym} · обновление 1с</p>
            </div>
            {/* rows=12: 32 + 12×22 + 30 + 12×22 = 590px ≈ чарт 590px */}
            <OrderBook symbol={activeSym} rows={12} />
          </div>
        </div>

        {/* Рыночные индикаторы */}
        <div className="grid gap-4 md:grid-cols-2">
          <FearGreed />

          {/* Funding Rates */}
          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-white">Ставки финансирования</h3>
            <FundingRatesWidget />
          </div>
        </div>
    </div>
  );
}


// Встроенный компонент фандинг-рейтов
function FundingRatesWidget() {
  const [rates, setRates] = useState<any[]>([]);
  const FALLBACK = [
    { symbol: "BTCUSDT", rate: "0.0100" },
    { symbol: "ETHUSDT", rate: "-0.0050" },
    { symbol: "SOLUSDT", rate: "0.0320" },
    { symbol: "XRPUSDT", rate: "0.0150" },
    { symbol: "BNBUSDT", rate: "-0.0080" },
  ];

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/market/funding-rates`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.rates?.length) setRates(d.rates.slice(0, 8)); else setRates(FALLBACK); })
      .catch(() => setRates(FALLBACK));
  }, []);

  const list = rates.length ? rates : FALLBACK;

  return (
    <div className="space-y-1.5">
      {list.slice(0, 6).map((r: any, i) => {
        const sym = r.symbol || r.pair || `Pair ${i}`;
        const rate = parseFloat(r.fundingRate || r.rate || r.fr || "0");
        const pos = rate >= 0;
        return (
          <div key={i} className="flex items-center justify-between rounded-lg px-2 py-1 hover:bg-white/5">
            <span className="text-xs font-medium text-text-secondary">{sym.replace("USDT", "")}/USDT</span>
            <span className={`font-mono text-xs font-semibold ${pos ? "text-danger" : "text-success"}`}>
              {pos ? "▲" : "▼"} {(Math.abs(rate) * 100).toFixed(4)}%
            </span>
          </div>
        );
      })}
      <p className="text-[9px] text-text-muted">+: лонги платят шортам</p>
    </div>
  );
}

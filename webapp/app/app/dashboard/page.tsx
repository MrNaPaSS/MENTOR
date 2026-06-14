"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Wallet, Radio, CheckCircle2, TrendingUp, ArrowRight } from "lucide-react";
import { api, Profile, AnalyticsMe, SignalOut } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { fmtUsd, modeLabel, isLong } from "@/lib/format";
import StatCard from "@/components/ui/StatCard";
import PageHeader from "@/components/ui/PageHeader";

export default function Dashboard() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsMe | null>(null);
  const [signals, setSignals] = useState<SignalOut[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    Promise.all([api.profile(token), api.analyticsMe(token), api.activeSignals()])
      .then(([p, a, s]) => {
        setProfile(p);
        setAnalytics(a);
        setSignals(s);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={modeLabel(profile?.mode || "moderate")}
        title={`Привет${profile?.username ? `, ${profile.username}` : ""}! 👋`}
        subtitle="Твой обзор: баланс, активные позиции и статистика."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Wallet} label="Баланс USDT" accent="cyan" loading={loading}
          value={fmtUsd(profile?.balance_usdt)} hint={profile ? `источник: ${profile.balance_source === "affiliate_api" ? "WEEX" : "вручную"}` : undefined} />
        <StatCard icon={Radio} label="Получено" accent="gold" loading={loading}
          value={analytics?.signals_received ?? 0} />
        <StatCard icon={CheckCircle2} label="Доставлено" accent="success" loading={loading}
          value={analytics?.sent ?? 0} />
        <StatCard icon={TrendingUp} label="Активных" accent="cyan" loading={loading}
          value={signals.length} />
      </div>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Активные позиции</h2>
          <Link href="/app/signals" className="flex items-center gap-1 text-sm text-accent-cyan transition hover:gap-2">
            Все сигналы <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card"><div className="skeleton h-12 w-full" /></div>
            ))}
          </div>
        ) : signals.length === 0 ? (
          <div className="card grid place-items-center py-12 text-center text-text-muted">
            <Radio className="mb-2 h-8 w-8 opacity-40" />
            Активных сигналов нет — как появятся, увидишь здесь.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {signals.map((s) => (
              <Link
                key={s.id}
                href={`/app/signals/${s.id}`}
                className="group relative overflow-hidden rounded-2xl border border-border bg-bg-card/80 p-4 shadow-card backdrop-blur-sm transition hover:border-accent-cyan/40"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className={`badge-${isLong(s.direction) ? "success" : "danger"}`}>{s.direction}</span>
                    <span className="text-lg font-bold text-white">{s.symbol}</span>
                    <span className="text-sm text-text-muted">x{s.leverage}</span>
                  </div>
                  <ArrowRight className="h-4 w-4 text-text-muted transition group-hover:translate-x-0.5 group-hover:text-accent-cyan" />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-xs text-text-secondary">
                  <span>вход {fmtUsd(s.entry_price, 4)}</span>
                  <span className="text-danger">стоп {fmtUsd(s.stop_loss, 4)}</span>
                  <span className="text-success">TP1 {fmtUsd(s.tp1, 4)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

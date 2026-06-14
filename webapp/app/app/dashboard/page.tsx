"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Wallet, Radio, CheckCircle2, TrendingUp, ArrowRight } from "lucide-react";
import { api, Profile, AnalyticsMe, SignalOut } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { fmtUsd, modeLabel, isLong } from "@/lib/format";

export default function Dashboard() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsMe | null>(null);
  const [signals, setSignals] = useState<SignalOut[]>([]);
  const [loaded, setLoaded] = useState(false);

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
      .finally(() => setLoaded(true));
  }, []);

  const kpis = [
    { icon: Wallet, label: "Баланс USDT", value: fmtUsd(profile?.balance_usdt) },
    { icon: Radio, label: "Сигналов получено", value: analytics ? String(analytics.signals_received) : "—" },
    { icon: CheckCircle2, label: "Доставлено", value: analytics ? String(analytics.sent) : "—" },
    { icon: TrendingUp, label: "Активных сейчас", value: String(signals.length) },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-h2 text-white">
          Привет{profile?.username ? `, ${profile.username}` : ""}! 👋
        </h1>
        <p className="mt-1 text-text-secondary">
          Режим: <span className="text-accent-cyan">{modeLabel(profile?.mode || "moderate")}</span>
        </p>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-muted">{k.label}</span>
                <Icon className="h-4 w-4 text-accent-cyan" />
              </div>
              <div className="mt-3 font-mono text-2xl font-bold text-white tabular">
                {loaded ? k.value : <span className="skeleton inline-block h-7 w-20 align-middle" />}
              </div>
            </div>
          );
        })}
      </div>

      {/* Активные сигналы */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Активные позиции</h2>
          <Link href="/app/signals" className="flex items-center gap-1 text-sm text-accent-cyan">
            Все сигналы <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {!loaded ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card"><div className="skeleton h-6 w-full" /></div>
            ))}
          </div>
        ) : signals.length === 0 ? (
          <div className="card text-center text-text-muted">Активных сигналов нет.</div>
        ) : (
          <div className="space-y-2">
            {signals.map((s) => (
              <Link
                key={s.id}
                href={`/app/signals/${s.id}`}
                className="card flex items-center justify-between transition hover:border-accent-cyan/40"
              >
                <div className="flex items-center gap-3">
                  <span className={`badge-${isLong(s.direction) ? "success" : "danger"}`}>
                    {s.direction}
                  </span>
                  <div>
                    <div className="font-semibold text-white">{s.symbol}</div>
                    <div className="text-xs text-text-muted">x{s.leverage} · {s.margin_type}</div>
                  </div>
                </div>
                <div className="text-right font-mono text-sm">
                  <div className="text-white">{fmtUsd(s.entry_price, 4)}$</div>
                  <div className="text-text-muted">стоп {fmtUsd(s.stop_loss, 4)}$</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

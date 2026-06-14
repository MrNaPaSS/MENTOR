"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, Profile, AnalyticsMe, SignalOut } from "@/lib/api";
import { getAccessToken, logout } from "@/lib/auth";

export default function Dashboard() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsMe | null>(null);
  const [signals, setSignals] = useState<SignalOut[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    Promise.all([api.profile(token), api.analyticsMe(token), api.activeSignals()])
      .then(([p, a, s]) => {
        setProfile(p);
        setAnalytics(a);
        setSignals(s);
      })
      .catch((e) => setError(e.message));
  }, [router]);

  function doLogout() {
    logout();
    router.push("/");
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="flex items-center justify-between">
        <Link href="/" className="text-2xl font-extrabold">
          ⚡ <span className="text-accent-cyan">NMNH</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/app/signals" className="btn-outline">
            Сигналы
          </Link>
          <button className="btn-outline" onClick={doLogout}>
            Выйти
          </button>
        </div>
      </header>

      <h1 className="mt-8 text-3xl font-bold">
        Привет{profile?.username ? `, ${profile.username}` : ""}! 👋
      </h1>
      {profile && (
        <p className="mt-1 text-text-secondary">
          Режим:{" "}
          <span className="text-accent-cyan">
            {profile.mode === "turbo" ? "⚡ ТУРБО" : "📊 УМЕРЕННЫЙ"}
          </span>
        </p>
      )}

      {error && <p className="mt-4 text-danger">⚠️ {error}</p>}

      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label="Баланс USDT" value={profile?.balance_usdt ? Number(profile.balance_usdt).toLocaleString("en-US") : "—"} />
        <Kpi label="Сигналов получено" value={analytics ? String(analytics.signals_received) : "—"} />
        <Kpi label="Доставлено" value={analytics ? String(analytics.sent) : "—"} />
        <Kpi label="Активных сейчас" value={String(signals.length)} />
      </div>

      <section className="mt-10">
        <h2 className="mb-3 text-xl font-semibold">Активные сигналы</h2>
        {signals.length === 0 ? (
          <p className="text-text-muted">Активных сигналов нет.</p>
        ) : (
          <div className="space-y-2">
            {signals.map((s) => (
              <div key={s.id} className="card flex items-center justify-between">
                <div className="font-semibold">
                  {s.symbol}{" "}
                  <span className={s.direction === "LONG" ? "text-success" : "text-danger"}>
                    {s.direction}
                  </span>{" "}
                  <span className="text-text-muted">x{s.leverage}</span>
                </div>
                <div className="font-mono text-sm text-text-secondary">
                  вход {s.entry_price}$ · стоп {s.stop_loss ?? "—"}$
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="font-mono text-2xl font-bold text-accent-cyan">{value}</div>
      <div className="mt-1 text-sm text-text-secondary">{label}</div>
    </div>
  );
}

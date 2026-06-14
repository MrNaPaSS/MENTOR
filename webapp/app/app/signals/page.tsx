"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, SignalOut } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";

export default function SignalsFeed() {
  const router = useRouter();
  const [signals, setSignals] = useState<SignalOut[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login");
      return;
    }
    api.signals().then(setSignals).catch((e) => setError(e.message));
  }, [router]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="flex items-center justify-between">
        <Link href="/app/dashboard" className="text-2xl font-extrabold">
          ⚡ <span className="text-accent-cyan">NMNH</span>
        </Link>
        <Link href="/app/dashboard" className="btn-outline">
          ← Дашборд
        </Link>
      </header>

      <h1 className="mt-8 text-3xl font-bold">Лента сигналов</h1>
      {error && <p className="mt-4 text-danger">⚠️ {error}</p>}

      <div className="mt-6 space-y-3">
        {signals.length === 0 && <p className="text-text-muted">Сигналов пока нет.</p>}
        {signals.map((s) => (
          <div key={s.id} className="card">
            <div className="flex items-center justify-between">
              <div className="text-lg font-bold">
                {s.symbol}{" "}
                <span className={s.direction === "LONG" ? "text-success" : "text-danger"}>
                  {s.direction}
                </span>{" "}
                <span className="text-text-muted">x{s.leverage}</span>
              </div>
              <span
                className={`rounded px-2 py-0.5 text-xs ${
                  s.status === "active" ? "bg-success/20 text-success" : "bg-bg-panel text-text-muted"
                }`}
              >
                {s.status === "active" ? "🟢 АКТИВЕН" : "⚫ ЗАКРЫТ"}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-sm text-text-secondary md:grid-cols-4">
              <span>Вход: {s.entry_price}$</span>
              <span>Стоп: {s.stop_loss ?? "—"}$</span>
              <span>TP1: {s.tp1 ?? "—"}$</span>
              <span>TP3: {s.tp3 ?? "—"}$</span>
            </div>
            <a
              href={`https://www.weex.com/ru/futures/${s.symbol}`}
              className="btn-primary mt-3 inline-block text-sm"
            >
              🚀 Войти в сделку
            </a>
          </div>
        ))}
      </div>
    </main>
  );
}

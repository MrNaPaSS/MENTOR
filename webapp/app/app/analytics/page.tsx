"use client";

import { useEffect, useState } from "react";
import { Radio, CheckCircle2, SkipForward, XCircle } from "lucide-react";
import { api, AnalyticsMe } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";

export default function AnalyticsPage() {
  const [a, setA] = useState<AnalyticsMe | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    api.analyticsMe(token).then(setA).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  const total = a?.signals_received || 0;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

  const kpis = [
    { icon: Radio, label: "Получено сигналов", value: a?.signals_received ?? 0, tone: "text-accent-cyan" },
    { icon: CheckCircle2, label: "Доставлено", value: a?.sent ?? 0, tone: "text-success" },
    { icon: SkipForward, label: "Пропущено (мал баланс)", value: a?.skipped ?? 0, tone: "text-accent-gold" },
    { icon: XCircle, label: "Ошибки доставки", value: a?.failed ?? 0, tone: "text-danger" },
  ];

  return (
    <div className="space-y-8">
      <h1 className="text-h2 text-white">Аналитика</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-muted">{k.label}</span>
                <Icon className={`h-4 w-4 ${k.tone}`} />
              </div>
              <div className={`mt-3 font-mono text-3xl font-bold tabular ${k.tone}`}>
                {loaded ? k.value : <span className="skeleton inline-block h-8 w-14 align-middle" />}
              </div>
            </div>
          );
        })}
      </div>

      {/* Распределение доставок */}
      <section className="card">
        <h2 className="mb-4 text-lg font-semibold text-white">Распределение доставок</h2>
        {total === 0 ? (
          <p className="text-text-muted">Пока нет данных — сигналы ещё не приходили.</p>
        ) : (
          <>
            <div className="flex h-3 overflow-hidden rounded-full bg-bg-panel">
              <div className="bg-success" style={{ width: `${pct(a!.sent)}%` }} />
              <div className="bg-accent-gold" style={{ width: `${pct(a!.skipped)}%` }} />
              <div className="bg-danger" style={{ width: `${pct(a!.failed)}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-text-secondary">
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-success align-middle" />Доставлено {pct(a!.sent)}%</span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-accent-gold align-middle" />Пропущено {pct(a!.skipped)}%</span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-danger align-middle" />Ошибки {pct(a!.failed)}%</span>
            </div>
          </>
        )}
      </section>

      <p className="text-xs text-text-muted">
        Полный PnL и история сделок появятся после подключения данных WEEX (гибридный источник, A-14).
      </p>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Radio, CheckCircle2, SkipForward, XCircle } from "lucide-react";
import { api, AnalyticsMe } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import StatCard from "@/components/ui/StatCard";
import PageHeader from "@/components/ui/PageHeader";

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

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Аналитика" title="Твоя статистика" subtitle="Доставки сигналов и эффективность." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Radio} label="Получено" accent="cyan" loading={!loaded} value={a?.signals_received ?? 0} />
        <StatCard icon={CheckCircle2} label="Доставлено" accent="success" loading={!loaded} value={a?.sent ?? 0} />
        <StatCard icon={SkipForward} label="Пропущено" accent="gold" loading={!loaded} value={a?.skipped ?? 0} hint="мал баланс" />
        <StatCard icon={XCircle} label="Ошибки" accent="danger" loading={!loaded} value={a?.failed ?? 0} />
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

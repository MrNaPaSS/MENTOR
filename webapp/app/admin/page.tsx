"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, UserCheck, Radio, Activity, PlusCircle, Wallet, BarChart3, Coins } from "lucide-react";
import { api, PublicStats, StudentOut, AffiliateOverview, ReferralRow, CommissionPoint } from "@/lib/api";
import { useMentorToken } from "@/components/admin/AdminShell";
import StatCard from "@/components/ui/StatCard";
import PageHeader from "@/components/ui/PageHeader";
import { CommissionChart, VolumeDonut } from "@/components/admin/AffiliateCharts";
import { fmtUsd } from "@/lib/format";

const PERIODS = [7, 30, 90] as const;

export default function AdminDashboard() {
  const token = useMentorToken();
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [students, setStudents] = useState<StudentOut[]>([]);
  const [aff, setAff] = useState<AffiliateOverview | null>(null);
  const [refs, setRefs] = useState<ReferralRow[]>([]);
  const [series, setSeries] = useState<CommissionPoint[]>([]);
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([api.publicStats(), api.students(token)])
      .then(([s, st]) => {
        setStats(s);
        setStudents(st);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [token]);

  useEffect(() => {
    Promise.all([
      api.affiliateOverview(token, days),
      api.affiliateReferrals(token, days),
      api.affiliateCommissionSeries(token, Math.min(days, 30)),
    ])
      .then(([o, r, s]) => {
        setAff(o);
        setRefs(r);
        setSeries(s);
      })
      .catch(() => {
        setAff(null);
        setRefs([]);
        setSeries([]);
      });
  }, [token, days]);

  const active = students.filter((s) => s.is_active && s.is_approved).length;
  const pending = students.filter((s) => !s.is_approved).length;
  const totalVolume = aff ? Number(aff.total_spot_volume) + Number(aff.total_futures_volume) : 0;

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Панель ментора"
        title="Дашборд"
        subtitle="Сводка по ученикам, сигналам и партнёрской программе WEEX."
        action={
          <Link href="/admin/signal/new" className="btn-primary">
            <PlusCircle className="h-4 w-4" /> Новый сигнал
          </Link>
        }
      />

      {/* Платформа */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Users} label="Активных учеников" accent="cyan" loading={!loaded} value={active} />
        <StatCard icon={UserCheck} label="Ожидают" accent="gold" loading={!loaded} value={pending} hint="подтверждения" />
        <StatCard icon={Radio} label="Сигналов всего" accent="success" loading={!loaded} value={stats?.total_signals ?? 0} />
        <StatCard icon={Activity} label="Активных" accent="cyan" loading={!loaded} value={stats?.active_signals ?? 0} />
      </div>

      {/* Партнёрская статистика WEEX */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Партнёрская программа WEEX</h2>
          <div className="flex gap-1 rounded-lg border border-border bg-bg-panel p-1">
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setDays(p)}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                  days === p ? "bg-accent-cyan/15 text-accent-cyan" : "text-text-muted hover:text-white"
                }`}
              >
                {p}д
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard icon={Users} label="Рефералов" accent="cyan" loading={!aff} value={aff?.referrals ?? 0} />
          <StatCard icon={Wallet} label="Депозиты" accent="success" loading={!aff} value={`${fmtUsd(aff?.total_deposit)}$`} />
          <StatCard icon={BarChart3} label="Объём торгов" accent="gold" loading={!aff} value={`${fmtUsd(totalVolume)}$`} />
          <StatCard icon={Coins} label="Комиссия" accent="gold" loading={!aff} value={`${fmtUsd(aff?.total_commission)}$`} />
        </div>

        {/* Графики */}
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card lg:col-span-2">
            <h3 className="mb-3 font-semibold text-white">Комиссия по дням</h3>
            {series.length === 0 ? (
              <div className="grid h-64 place-items-center text-sm text-text-muted">Нет данных</div>
            ) : (
              <CommissionChart data={series} />
            )}
          </div>
          <div className="card">
            <h3 className="mb-3 font-semibold text-white">Объём: спот / фьючерсы</h3>
            <VolumeDonut
              spot={aff ? Number(aff.total_spot_volume) : 0}
              futures={aff ? Number(aff.total_futures_volume) : 0}
            />
            <div className="mt-2 flex justify-center gap-4 text-xs">
              <span className="flex items-center gap-1.5 text-text-secondary">
                <span className="h-2 w-2 rounded-full bg-accent-cyan" /> Фьючерсы
              </span>
              <span className="flex items-center gap-1.5 text-text-secondary">
                <span className="h-2 w-2 rounded-full bg-accent-gold" /> Спот
              </span>
            </div>
          </div>
        </div>

        {/* Топ рефералов */}
        <div className="card overflow-x-auto">
          <h3 className="mb-3 font-semibold text-white">Топ рефералов по объёму</h3>
          {refs.length === 0 ? (
            <p className="text-sm text-text-muted">Нет данных WEEX (на моках — после dev-входа; на проде — по ключу).</p>
          ) : (
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-text-muted">
                <tr>
                  <th className="py-2">UID</th>
                  <th className="text-center">KYC</th>
                  <th className="text-right">Депозит</th>
                  <th className="text-right">Спот</th>
                  <th className="text-right">Фьючерсы</th>
                  <th className="text-right">Комиссия</th>
                </tr>
              </thead>
              <tbody>
                {refs.slice(0, 10).map((r) => (
                  <tr key={r.uid} className="border-t border-border/60">
                    <td className="py-2.5 font-mono text-white">{r.uid}</td>
                    <td className="text-center">
                      <span className={`badge-${r.kyc ? "success" : "muted"}`}>{r.kyc ? "✓" : "—"}</span>
                    </td>
                    <td className="text-right font-mono">{fmtUsd(r.deposit)}$</td>
                    <td className="text-right font-mono text-text-secondary">{fmtUsd(r.spot_volume)}$</td>
                    <td className="text-right font-mono text-text-secondary">{fmtUsd(r.futures_volume)}$</td>
                    <td className="text-right font-mono text-success">{fmtUsd(r.commission)}$</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <Link href="/admin/students" className="card transition hover:border-accent-cyan/40">
          <h3 className="font-semibold text-white">Ученики</h3>
          <p className="mt-1 text-sm text-text-muted">Управление, подтверждение заявок, режимы и баланс.</p>
        </Link>
        <Link href="/admin/signals" className="card transition hover:border-accent-cyan/40">
          <h3 className="font-semibold text-white">Сигналы</h3>
          <p className="mt-1 text-sm text-text-muted">История сигналов и закрытие активных.</p>
        </Link>
      </div>
    </div>
  );
}

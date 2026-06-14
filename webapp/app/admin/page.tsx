"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, Radio, Activity, PlusCircle } from "lucide-react";
import { api, PublicStats, StudentOut } from "@/lib/api";
import { useMentorToken } from "@/components/admin/AdminShell";

export default function AdminDashboard() {
  const token = useMentorToken();
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [students, setStudents] = useState<StudentOut[]>([]);
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

  const active = students.filter((s) => s.is_active && s.is_approved).length;
  const pending = students.filter((s) => !s.is_approved).length;

  const kpis = [
    { icon: Users, label: "Активных учеников", value: active },
    { icon: Users, label: "Ожидают подтверждения", value: pending },
    { icon: Radio, label: "Сигналов всего", value: stats?.total_signals ?? 0 },
    { icon: Activity, label: "Активных сигналов", value: stats?.active_signals ?? 0 },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-h2 text-white">Дашборд</h1>
        <Link href="/admin/signal/new" className="btn-primary">
          <PlusCircle className="h-4 w-4" /> Новый сигнал
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k, i) => {
          const Icon = k.icon;
          return (
            <div key={i} className="card">
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-muted">{k.label}</span>
                <Icon className="h-4 w-4 text-accent-cyan" />
              </div>
              <div className="mt-3 font-mono text-3xl font-bold text-white tabular">
                {loaded ? k.value : <span className="skeleton inline-block h-8 w-12 align-middle" />}
              </div>
            </div>
          );
        })}
      </div>

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

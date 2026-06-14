"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, UserCheck, Radio, Activity, PlusCircle } from "lucide-react";
import { api, PublicStats, StudentOut } from "@/lib/api";
import { useMentorToken } from "@/components/admin/AdminShell";
import StatCard from "@/components/ui/StatCard";
import PageHeader from "@/components/ui/PageHeader";

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

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Панель ментора"
        title="Дашборд"
        subtitle="Сводка по ученикам и сигналам."
        action={
          <Link href="/admin/signal/new" className="btn-primary">
            <PlusCircle className="h-4 w-4" /> Новый сигнал
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Users} label="Активных учеников" accent="cyan" loading={!loaded} value={active} />
        <StatCard icon={UserCheck} label="Ожидают" accent="gold" loading={!loaded} value={pending} hint="подтверждения" />
        <StatCard icon={Radio} label="Сигналов всего" accent="success" loading={!loaded} value={stats?.total_signals ?? 0} />
        <StatCard icon={Activity} label="Активных" accent="cyan" loading={!loaded} value={stats?.active_signals ?? 0} />
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

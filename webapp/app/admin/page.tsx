"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { 
  Users, 
  UserCheck, 
  Radio, 
  Activity, 
  PlusCircle, 
  Wallet, 
  BarChart3, 
  Coins, 
  Search, 
  ArrowUpDown, 
  Download, 
  ExternalLink,
  ChevronRight,
  TrendingUp,
  Percent,
  CheckCircle2,
  XCircle,
  HelpCircle
} from "lucide-react";
import { api, PublicStats, StudentOut, AffiliateOverview, ReferralRow, MentorBalance } from "@/lib/api";
import { useMentorToken } from "@/components/admin/AdminShell";
import { fmtUsd } from "@/lib/format";

const PERIODS = [7, 30, 90] as const;
type SortField = "uid" | "kyc" | "deposit" | "balance" | "spot_volume" | "futures_volume" | "commission";
type SortOrder = "asc" | "desc";

export default function AdminDashboard() {
  const token = useMentorToken();
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [students, setStudents] = useState<StudentOut[]>([]);
  const [aff, setAff] = useState<AffiliateOverview | null>(null);
  const [refs, setRefs] = useState<ReferralRow[]>([]);
  const [mentorBal, setMentorBal] = useState<MentorBalance | null>(null);
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [loaded, setLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("futures_volume");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  // Загрузка основной платформы + баланс ментора
  useEffect(() => {
    Promise.all([api.publicStats(), api.students(token), api.affiliateMentorBalance(token)])
      .then(([s, st, mb]) => {
        setStats(s);
        setStudents(st);
        setMentorBal(mb);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [token]);

  // Загрузка партнерской статистики WEEX — сброс при смене периода
  useEffect(() => {
    setAff(null);
    setRefs([]);
    Promise.all([api.affiliateOverview(token, days), api.affiliateReferrals(token, days)])
      .then(([o, r]) => {
        setAff(o);
        setRefs(r);
      })
      .catch(() => {
        setAff(null);
        setRefs([]);
      });
  }, [token, days]);

  const activeStudentsCount = useMemo(() => students.filter((s) => s.is_active && s.is_approved).length, [students]);
  const pendingStudentsCount = useMemo(() => students.filter((s) => !s.is_approved).length, [students]);
  const totalVolume = useMemo(() => aff ? Number(aff.total_spot_volume) + Number(aff.total_futures_volume) : 0, [aff]);

  // Сортировка и фильтрация рефералов
  const filteredAndSortedRefs = useMemo(() => {
    let result = [...refs];

    // Поиск
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((r) => r.uid.toLowerCase().includes(q));
    }

    // Сортировка
    result.sort((a, b) => {
      let valA: any = a[sortField];
      let valB: any = b[sortField];

      // Приведение к числам для сравнения объемов
      if (["deposit", "balance", "spot_volume", "futures_volume", "commission"].includes(sortField)) {
        valA = Number(valA || 0);
        valB = Number(valB || 0);
      }

      if (sortField === "kyc") {
        valA = a.kyc ? 1 : 0;
        valB = b.kyc ? 1 : 0;
      }

      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });

    return result;
  }, [refs, searchQuery, sortField, sortOrder]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  // Экспорт в CSV
  const exportToCSV = () => {
    if (refs.length === 0) return;
    const headers = ["UID", "KYC", "Deposit (USDT)", "Balance (USDT)", "Spot Volume (USDT)", "Futures Volume (USDT)", "Commission (USDT)"];
    const rows = refs.map(r => [
      r.uid,
      r.kyc ? "Yes" : "No",
      r.deposit,
      r.balance,
      r.spot_volume,
      r.futures_volume,
      r.commission
    ]);

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `weex_referrals_${days}d.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Расчет метрик по рынкам для SVG графиков
  const spotShare = useMemo(() => {
    if (!aff || totalVolume === 0) return 15; // default mock share
    return Math.max(5, Math.min(95, (Number(aff.total_spot_volume) / totalVolume) * 100));
  }, [aff, totalVolume]);

  const futuresShare = useMemo(() => 100 - spotShare, [spotShare]);

  // Сгенерируем псевдо-динамику за период для SVG Area Chart
  const svgChartPoints = useMemo(() => {
    if (refs.length === 0) return "";

    const sorted = [...refs].sort((a, b) => Number(a.futures_volume) - Number(b.futures_volume));
    const count = sorted.length;

    // Сначала считаем итоговый максимум (вынесено за цикл!)
    const totalMaxVolume = sorted.reduce((acc, r) => acc + Number(r.futures_volume || 0), 0);
    const maxVolume = totalMaxVolume > 0 ? totalMaxVolume : 1;

    const points: string[] = [];
    let cumulativeVolume = 0;

    sorted.forEach((r, idx) => {
      cumulativeVolume += Number(r.futures_volume || 0);
      const x = 40 + (idx / Math.max(1, count - 1)) * 520;
      const y = 160 - (cumulativeVolume / maxVolume) * 110;
      points.push(`${x},${y}`);
    });

    return points.join(" ");
  }, [refs]);

  return (
    <div className="space-y-8 pb-10">
      
      {/* Приветственный Баннер Ментора */}
      <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-r from-[#0d1020] via-[#121836] to-[#0c0d1b] p-6 md:p-8 shadow-[0_8px_32px_0_rgba(0,0,0,0.5)]">
        <div className="absolute right-0 top-0 -mr-16 -mt-16 h-64 w-64 rounded-full bg-accent-cyan/10 blur-3xl pointer-events-none" />
        <div className="absolute left-1/3 bottom-0 -mb-20 h-48 w-48 rounded-full bg-accent-gold/5 blur-3xl pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-3">
              <span className="px-2.5 py-1 text-[10px] font-semibold tracking-wider text-accent-cyan uppercase bg-accent-cyan/10 rounded-full border border-accent-cyan/20">
                NMNH CORE
              </span>
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
                </span>
                <span className="text-[11px] font-semibold text-success uppercase tracking-wider">WEEX API ACTIVE</span>
              </div>
            </div>
            <h1 className="mt-3 text-2xl font-bold tracking-tight text-white md:text-3xl">Панель управления Ментора</h1>
            <p className="mt-1.5 text-sm text-text-muted max-w-xl">
              Управление потоком учеников, мониторинг торговых объемов вашей реферальной сети WEEX и публикация торговых сигналов NMNH.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/admin/signal/new" className="flex items-center gap-2 px-4 py-2.5 bg-accent-cyan hover:bg-accent-cyan/90 text-bg font-bold rounded-xl transition-all shadow-[0_0_15px_rgba(0,242,254,0.3)] hover:scale-[1.02]">
              <PlusCircle className="h-4 w-4 stroke-[2.5]" />
              Создать сигнал
            </Link>
            <button 
              onClick={exportToCSV}
              disabled={refs.length === 0}
              className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-white font-semibold rounded-xl border border-white/10 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="h-4 w-4" />
              Экспорт CSV
            </button>
          </div>
        </div>
      </div>

      {/* Метрики Платформы (NMNH) */}
      <section className="space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-text-muted flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-accent-cyan" />
          Метрики платформы NMNH
        </h2>
        
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          
          {/* Активные ученики */}
          <div className="relative group overflow-hidden rounded-2xl border border-white/5 bg-bg-card/40 p-5 backdrop-blur-sm transition-all duration-300 hover:border-white/10 hover:bg-bg-card/60">
            <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-accent-cyan/35 to-transparent" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">Активных учеников</span>
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent-cyan/10 text-accent-cyan ring-1 ring-accent-cyan/25">
                <Users className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="font-mono text-3xl font-bold text-white">
                {!loaded ? "—" : activeStudentsCount}
              </span>
              <span className="text-[10px] text-text-muted">в системе</span>
            </div>
            {/* Декоративный микро-график */}
            <div className="mt-3 h-1 w-full bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-accent-cyan rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (activeStudentsCount / Math.max(1, students.length)) * 100)}%` }} />
            </div>
          </div>

          {/* Заявки на подтверждение */}
          <Link href="/admin/students" className="relative group overflow-hidden rounded-2xl border border-white/5 bg-bg-card/40 p-5 backdrop-blur-sm transition-all duration-300 hover:border-accent-gold/30 hover:bg-bg-card/60 block">
            <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-accent-gold/35 to-transparent" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">Ожидают аппрува</span>
              <span className={`grid h-8 w-8 place-items-center rounded-xl ring-1 ${pendingStudentsCount > 0 ? "bg-accent-gold/15 text-accent-gold ring-accent-gold/30 animate-pulse" : "bg-white/5 text-text-muted ring-white/5"}`}>
                <UserCheck className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className={`font-mono text-3xl font-bold ${pendingStudentsCount > 0 ? "text-accent-gold" : "text-white"}`}>
                {!loaded ? "—" : pendingStudentsCount}
              </span>
              <span className="text-[10px] text-text-muted">заявок</span>
            </div>
            <div className="mt-3 flex items-center gap-1 text-[11px] text-accent-gold/90 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
              <span>Перейти к верификации</span>
              <ChevronRight className="h-3 w-3" />
            </div>
          </Link>

          {/* Сигналов всего */}
          <div className="relative group overflow-hidden rounded-2xl border border-white/5 bg-bg-card/40 p-5 backdrop-blur-sm transition-all duration-300 hover:border-white/10 hover:bg-bg-card/60">
            <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-success/35 to-transparent" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">Опубликовано сигналов</span>
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-success/10 text-success ring-1 ring-success/25">
                <Radio className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="font-mono text-3xl font-bold text-success">
                {!loaded ? "—" : stats?.total_signals ?? 0}
              </span>
              <span className="text-[10px] text-text-muted">всего</span>
            </div>
            <div className="mt-3 text-[11px] text-text-muted flex items-center gap-1">
              <span>Винрейт по сигналам:</span>
              <span className="font-bold text-success font-mono">{stats?.winrate ? `${stats.winrate}%` : "—"}</span>
            </div>
          </div>

          {/* Активных сигналов сейчас */}
          <Link href="/admin/signals" className="relative group overflow-hidden rounded-2xl border border-white/5 bg-bg-card/40 p-5 backdrop-blur-sm transition-all duration-300 hover:border-accent-cyan/30 hover:bg-bg-card/60 block">
            <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-accent-cyan/35 to-transparent" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">Активных сигналов</span>
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent-cyan/10 text-accent-cyan ring-1 ring-accent-cyan/25">
                <Activity className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="font-mono text-3xl font-bold text-white">
                {!loaded ? "—" : stats?.active_signals ?? 0}
              </span>
              <span className="text-[10px] text-text-muted">в рынке</span>
            </div>
            <div className="mt-3 flex items-center gap-1 text-[11px] text-accent-cyan/90 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
              <span>Смотреть активные</span>
              <ChevronRight className="h-3 w-3" />
            </div>
          </Link>

        </div>
      </section>

      {/* Партнёрская Статистика WEEX */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-text-muted flex items-center gap-2">
            <Coins className="h-4 w-4 text-accent-gold" />
            Аналитика WEEX Affiliate
          </h2>
          
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted font-medium">Период выборки:</span>
            <div className="flex gap-1 rounded-xl border border-white/5 bg-bg-card/60 p-1 backdrop-blur-sm">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  onClick={() => setDays(p)}
                  className={`rounded-lg px-3 py-1 text-xs font-bold transition-all ${
                    days === p 
                      ? "bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/20" 
                      : "text-text-muted hover:text-white border border-transparent"
                  }`}
                >
                  {p} дней
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">

          {/* Рефералов всего */}
          <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-bg-card/40 p-5 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">Рефералов в сети</span>
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent-cyan/10 text-accent-cyan ring-1 ring-accent-cyan/25">
                <Users className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-4 font-mono text-3xl font-bold text-white">
              {!aff ? <span className="skeleton inline-block h-8 w-16" /> : aff.referrals}
            </div>
            <div className="mt-2 text-[10px] text-text-muted">с регистрациями за {days}д</div>
          </div>

          {/* Активных трейдеров */}
          <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-bg-card/40 p-5 backdrop-blur-sm">
            <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-accent-cyan/30 to-transparent" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">Торговали</span>
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent-cyan/10 text-accent-cyan ring-1 ring-accent-cyan/25">
                <Activity className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-4 font-mono text-3xl font-bold text-accent-cyan">
              {!aff ? <span className="skeleton inline-block h-8 w-12" /> : aff.active_traders}
            </div>
            <div className="mt-2 text-[10px] text-text-muted">
              {aff ? `из ${aff.referrals} — ${aff.referrals > 0 ? Math.round(aff.active_traders / aff.referrals * 100) : 0}% активных` : "загрузка..."}
            </div>
          </div>

          {/* Пополнили счёт */}
          <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-bg-card/40 p-5 backdrop-blur-sm">
            <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-success/30 to-transparent" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">Пополнили счёт</span>
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-success/10 text-success ring-1 ring-success/25">
                <Wallet className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-4 font-mono text-3xl font-bold text-success">
              {!aff ? <span className="skeleton inline-block h-8 w-12" /> : aff.with_deposit}
            </div>
            <div className="mt-2 text-[10px] text-text-muted">
              {aff ? `из ${aff.referrals} рефералов` : "загрузка..."}
            </div>
          </div>

          {/* Мой баланс WEEX */}
          <div className="relative overflow-hidden rounded-2xl border border-accent-gold/20 bg-gradient-to-br from-accent-gold/5 to-transparent p-5 backdrop-blur-sm">
            <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-accent-gold/50 to-transparent" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-accent-gold/70">Мой баланс WEEX</span>
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent-gold/15 text-accent-gold ring-1 ring-accent-gold/30">
                <Coins className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-4 font-mono text-2xl font-bold text-accent-gold md:text-3xl">
              {!mentorBal ? <span className="skeleton inline-block h-8 w-24" /> : `$${fmtUsd(mentorBal.total_usdt)}`}
            </div>
            <div className="mt-2 text-[10px] text-text-muted">фьючерсы + спот + доступно</div>
          </div>

        </div>

        {/* Финансовые метрики сети */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">

          {/* Депозиты сети */}
          <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-bg-card/40 p-5 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">Депозиты сети</span>
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-success/10 text-success ring-1 ring-success/25">
                <TrendingUp className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-4 font-mono text-2xl font-bold text-success md:text-3xl">
              {!aff ? <span className="skeleton inline-block h-8 w-24" /> : `$${fmtUsd(aff.total_deposit)}`}
            </div>
            <div className="mt-2 text-[10px] text-text-muted">зачислено рефералами за {days}д</div>
          </div>

          {/* Торговый Объем */}
          <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-bg-card/40 p-5 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">Торговый объём</span>
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent-gold/10 text-accent-gold ring-1 ring-accent-gold/25">
                <BarChart3 className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-4 font-mono text-2xl font-bold text-accent-gold md:text-3xl">
              {!aff ? <span className="skeleton inline-block h-8 w-28" /> : `$${fmtUsd(totalVolume)}`}
            </div>
            <div className="mt-2 text-[10px] text-text-muted">фьючерсы + спот за {days}д</div>
          </div>

          {/* Вывод средств */}
          <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-bg-card/40 p-5 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">Выведено средств</span>
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-danger/10 text-danger ring-1 ring-danger/25">
                <Percent className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-4 font-mono text-2xl font-bold text-danger md:text-3xl">
              {!aff ? <span className="skeleton inline-block h-8 w-24" /> : `$${fmtUsd(aff.total_withdrawal)}`}
            </div>
            <div className="mt-2 text-[10px] text-text-muted">выводы рефералами за {days}д</div>
          </div>

          {/* Ваш Доход (Rebate) */}
          <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-bg-card/40 p-5 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">Ваш Доход (Rebate)</span>
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent-gold/15 text-accent-gold ring-1 ring-accent-gold/30">
                <Coins className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-4 font-mono text-2xl font-bold text-accent-gold md:text-3xl">
              {!aff ? <span className="skeleton inline-block h-8 w-24" /> : `$${fmtUsd(aff.total_commission)}`}
            </div>
            <div className="mt-2 text-[10px] text-text-muted">начислено по сетке ребейтов</div>
          </div>

        </div>


        {/* Премиум Аналитические Графики (SVG) */}
        <div className="grid gap-6 md:grid-cols-3">
          
          {/* Распределение Спот vs Фьючерсы */}
          <div className="md:col-span-1 rounded-2xl border border-white/5 bg-bg-card/30 p-5 backdrop-blur-sm space-y-4">
            <h3 className="text-sm font-semibold text-white">Доли рынков рефералов</h3>
            
            {/* SVG Donut Chart */}
            <div className="flex justify-center py-4">
              <svg width="140" height="140" viewBox="0 0 40 40" className="transform -rotate-90">
                {/* Подложка */}
                <circle cx="20" cy="20" r="15.915" fill="transparent" stroke="rgba(255,255,255,0.03)" strokeWidth="4" />
                
                {/* Спот (Cyan) */}
                <circle 
                  cx="20" cy="20" r="15.915" 
                  fill="transparent" 
                  stroke="#00f2fe" 
                  strokeWidth="4" 
                  strokeDasharray={`${spotShare} ${100 - spotShare}`} 
                  strokeDashoffset="0"
                />
                
                {/* Фьючерсы (Gold) */}
                <circle 
                  cx="20" cy="20" r="15.915" 
                  fill="transparent" 
                  stroke="#ffd700" 
                  strokeWidth="4" 
                  strokeDasharray={`${futuresShare} ${100 - futuresShare}`} 
                  strokeDashoffset={`-${spotShare}`}
                />
              </svg>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="border-l-2 border-accent-cyan pl-2">
                <p className="text-text-muted">Спот объём</p>
                <p className="font-mono text-sm font-bold text-white mt-0.5">
                  {aff ? `$${fmtUsd(aff.total_spot_volume)}` : "0.00"}
                </p>
                <p className="text-[10px] text-accent-cyan mt-0.5">{spotShare.toFixed(1)}% доля</p>
              </div>
              <div className="border-l-2 border-accent-gold pl-2">
                <p className="text-text-muted">Фьючерсы объём</p>
                <p className="font-mono text-sm font-bold text-white mt-0.5">
                  {aff ? `$${fmtUsd(aff.total_futures_volume)}` : "0.00"}
                </p>
                <p className="text-[10px] text-accent-gold mt-0.5">{futuresShare.toFixed(1)}% доля</p>
              </div>
            </div>
          </div>

          {/* График Динамики Сети (SVG Area Chart) */}
          <div className="md:col-span-2 rounded-2xl border border-white/5 bg-bg-card/30 p-5 backdrop-blur-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Рост торговой активности сети</h3>
              <span className="text-[10px] font-semibold text-text-muted uppercase">Накопительный итог</span>
            </div>

            {/* SVG Area Chart */}
            <div className="relative h-44 w-full">
              {refs.length === 0 ? (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-text-muted">
                  Недостаточно рефералов для построения тренда
                </div>
              ) : (
                <svg className="w-full h-full" viewBox="0 0 600 200" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#00f2fe" stopOpacity="0.25"/>
                      <stop offset="100%" stopColor="#00f2fe" stopOpacity="0.0"/>
                    </linearGradient>
                  </defs>
                  
                  {/* Сетка */}
                  <line x1="40" y1="40" x2="560" y2="40" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                  <line x1="40" y1="100" x2="560" y2="100" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                  <line x1="40" y1="160" x2="560" y2="160" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                  
                  {/* Заполненная область */}
                  {svgChartPoints && (
                    <polygon 
                      points={`40,160 ${svgChartPoints} 560,160`} 
                      fill="url(#chartGrad)" 
                    />
                  )}
                  
                  {/* Линия тренда */}
                  {svgChartPoints && (
                    <polyline 
                      points={svgChartPoints} 
                      fill="none" 
                      stroke="#00f2fe" 
                      strokeWidth="2.5" 
                      strokeLinecap="round"
                    />
                  )}
                </svg>
              )}
            </div>
            <div className="flex justify-between text-[10px] text-text-muted px-2">
              <span>Начало периода ({days}д назад)</span>
              <span>Текущий день</span>
            </div>
          </div>

        </div>

        {/* Интерактивная Таблица Рефералов */}
        <div className="rounded-2xl border border-white/5 bg-bg-card/40 p-5 backdrop-blur-sm space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-white">Список рефералов вашей сети</h3>
              <p className="text-xs text-text-muted mt-0.5">Детальная статистика по каждому трейдеру.</p>
            </div>
            
            {/* Поиск и Фильтрация */}
            <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
                <input 
                  type="text" 
                  placeholder="Поиск по UID..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-xs text-white bg-bg-panel/60 border border-white/5 rounded-xl focus:border-accent-cyan/40 focus:outline-none placeholder:text-text-muted"
                />
              </div>
            </div>
          </div>

          {/* Таблица */}
          <div className="overflow-x-auto rounded-xl border border-white/5">
            {filteredAndSortedRefs.length === 0 ? (
              <div className="py-12 text-center text-xs text-text-muted">
                {searchQuery ? "Рефералы с таким UID не найдены" : "Нет данных от WEEX API за этот период"}
              </div>
            ) : (
              <table className="w-full min-w-[720px] text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-white/[0.02] border-b border-white/5">
                    
                    {/* UID */}
                    <th 
                      onClick={() => handleSort("uid")}
                      className="py-3.5 px-4 font-semibold text-text-muted uppercase tracking-wider cursor-pointer hover:text-white transition"
                    >
                      <div className="flex items-center gap-1">
                        UID
                        <ArrowUpDown className="h-3 w-3" />
                      </div>
                    </th>

                    {/* KYC */}
                    <th 
                      onClick={() => handleSort("kyc")}
                      className="py-3.5 px-3 font-semibold text-text-muted uppercase tracking-wider cursor-pointer hover:text-white transition text-center"
                    >
                      <div className="flex items-center justify-center gap-1">
                        KYC
                        <ArrowUpDown className="h-3 w-3" />
                      </div>
                    </th>

                    {/* Депозит */}
                    <th 
                      onClick={() => handleSort("deposit")}
                      className="py-3.5 px-3 font-semibold text-text-muted uppercase tracking-wider cursor-pointer hover:text-white transition text-right"
                    >
                      <div className="flex items-center justify-end gap-1">
                        Депозит
                        <ArrowUpDown className="h-3 w-3" />
                      </div>
                    </th>

                    {/* Баланс */}
                    <th 
                      onClick={() => handleSort("balance")}
                      className="py-3.5 px-3 font-semibold text-text-muted uppercase tracking-wider cursor-pointer hover:text-white transition text-right bg-accent-gold/[0.02]"
                    >
                      <div className="flex items-center justify-end gap-1">
                        Баланс
                        <ArrowUpDown className="h-3 w-3" />
                      </div>
                    </th>

                    {/* Спот объем */}
                    <th 
                      onClick={() => handleSort("spot_volume")}
                      className="py-3.5 px-3 font-semibold text-text-muted uppercase tracking-wider cursor-pointer hover:text-white transition text-right"
                    >
                      <div className="flex items-center justify-end gap-1">
                        Спот объём
                        <ArrowUpDown className="h-3 w-3" />
                      </div>
                    </th>

                    {/* Фьючерсы объем */}
                    <th 
                      onClick={() => handleSort("futures_volume")}
                      className="py-3.5 px-3 font-semibold text-text-muted uppercase tracking-wider cursor-pointer hover:text-white transition text-right"
                    >
                      <div className="flex items-center justify-end gap-1">
                        Фьючерсы объём
                        <ArrowUpDown className="h-3 w-3" />
                      </div>
                    </th>

                    {/* Начисленный ребейт */}
                    <th 
                      onClick={() => handleSort("commission")}
                      className="py-3.5 px-4 font-semibold text-text-muted uppercase tracking-wider cursor-pointer hover:text-white transition text-right"
                    >
                      <div className="flex items-center justify-end gap-1">
                        Комиссия
                        <ArrowUpDown className="h-3 w-3" />
                      </div>
                    </th>

                    {/* Пополнение */}
                    <th className="py-3.5 px-3 font-semibold text-text-muted uppercase tracking-wider text-center">
                      Пополнение
                    </th>

                    {/* Торговал */}
                    <th className="py-3.5 px-3 font-semibold text-text-muted uppercase tracking-wider text-center">
                      Торговал
                    </th>

                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 bg-white/[0.01]">
                  {filteredAndSortedRefs.map((r) => {
                    const totalRefVolume = Number(r.spot_volume) + Number(r.futures_volume);
                    // Доля реферала от общего объема сети
                    const volumeShare = totalVolume > 0 ? (totalRefVolume / totalVolume) * 100 : 0;

                    return (
                      <tr 
                        key={r.uid} 
                        className="hover:bg-white/[0.03] transition duration-150 group"
                      >
                        {/* UID */}
                        <td className="py-3 px-4 font-mono font-medium text-white flex items-center gap-1.5">
                          <span>{r.uid}</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
                            {volumeShare > 10 ? "VIP 🔥" : "активный"}
                          </span>
                        </td>

                        {/* KYC статус */}
                        <td className="py-3 px-3 text-center">
                          <div className="flex justify-center">
                            {r.kyc ? (
                              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-success/10 text-success border border-success/20">
                                <CheckCircle2 className="h-3 w-3" /> Да
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/5 text-text-muted border border-white/5">
                                <XCircle className="h-3 w-3" /> Нет
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Депозит */}
                        <td className="py-3 px-3 text-right font-mono font-semibold text-white">
                          ${fmtUsd(r.deposit)}
                        </td>

                        {/* Баланс */}
                        <td className="py-3 px-3 text-right font-mono font-semibold text-accent-gold bg-accent-gold/[0.01]">
                          ${fmtUsd(r.balance)}
                        </td>

                        {/* Спот */}
                        <td className="py-3 px-3 text-right font-mono text-text-secondary">
                          ${fmtUsd(r.spot_volume)}
                        </td>

                        {/* Фьючерсы */}
                        <td className="py-3 px-3 text-right font-mono text-text-secondary group-hover:text-accent-cyan transition-colors">
                          ${fmtUsd(r.futures_volume)}
                        </td>

                        {/* Комиссия */}
                        <td className="py-3 px-4 text-right font-mono font-semibold text-success bg-success/[0.01]">
                          ${fmtUsd(r.commission)}
                        </td>

                        {/* Пополнение */}
                        <td className="py-3 px-3 text-center">
                          {r.has_deposit ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-success/10 text-success border border-success/20">
                              <CheckCircle2 className="h-3 w-3" /> Да
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/5 text-text-muted border border-white/5">
                              <XCircle className="h-3 w-3" /> Нет
                            </span>
                          )}
                        </td>

                        {/* Торговал */}
                        <td className="py-3 px-3 text-center">
                          {r.has_traded ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20">
                              <Activity className="h-3 w-3" /> Да
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/5 text-text-muted border border-white/5">
                              Нет
                            </span>
                          )}
                        </td>

                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="flex justify-between items-center text-[10px] text-text-muted px-1">
            <span>Показано {filteredAndSortedRefs.length} из {refs.length} рефералов</span>
            {filteredAndSortedRefs.length > 0 && (
              <span className="flex items-center gap-1">
                * Сортировка по полю: <strong className="text-white">{sortField} ({sortOrder})</strong>
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Быстрые Действия Ментора */}
      <section className="space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-text-muted flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-accent-cyan" />
          Разделы управления
        </h2>
        
        <div className="grid gap-4 md:grid-cols-2">
          
          <Link 
            href="/admin/students" 
            className="group relative overflow-hidden rounded-2xl border border-white/5 bg-bg-card/30 p-5 backdrop-blur-sm transition-all duration-300 hover:border-accent-cyan/30 hover:bg-bg-card/50 block"
          >
            <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-accent-cyan/25 to-transparent" />
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-semibold text-white group-hover:text-accent-cyan transition">Картотека учеников</h3>
                <p className="mt-1 text-xs text-text-muted leading-relaxed">
                  Управление профилями, подтверждение заявок, выбор тарифов и балансов учащихся.
                </p>
              </div>
              <ChevronRight className="h-5 w-5 text-text-muted group-hover:translate-x-1 group-hover:text-accent-cyan transition-all" />
            </div>
            
            {pendingStudentsCount > 0 && (
              <div className="mt-4 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-accent-gold/15 text-accent-gold border border-accent-gold/25 animate-pulse">
                <UserCheck className="h-3 w-3" />
                <span>{pendingStudentsCount} ожидают подтверждения</span>
              </div>
            )}
          </Link>

          <Link 
            href="/admin/signals" 
            className="group relative overflow-hidden rounded-2xl border border-white/5 bg-bg-card/30 p-5 backdrop-blur-sm transition-all duration-300 hover:border-accent-cyan/30 hover:bg-bg-card/50 block"
          >
            <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-accent-cyan/25 to-transparent" />
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-semibold text-white group-hover:text-accent-cyan transition">Торговые сигналы</h3>
                <p className="mt-1 text-xs text-text-muted leading-relaxed">
                  История отправленных торговых сигналов, закрытие текущих сделок в рынке и статистика винрейта.
                </p>
              </div>
              <ChevronRight className="h-5 w-5 text-text-muted group-hover:translate-x-1 group-hover:text-accent-cyan transition-all" />
            </div>
            
            {stats?.active_signals && stats.active_signals > 0 ? (
              <div className="mt-4 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/25">
                <Activity className="h-3 w-3" />
                <span>{stats.active_signals} сигналов сейчас в рынке</span>
              </div>
            ) : null}
          </Link>

        </div>
      </section>

    </div>
  );
}

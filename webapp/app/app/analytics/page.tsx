"use client";
// v7
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, AnalyticsMe, CalendarDay, DepositRecord, TradeSummary } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { Trophy, Flame, Target, Star, CheckCircle2, Lock, Zap, TrendingUp, Gift, Calendar, ArrowLeftRight, ArrowRight, BarChart2, ArrowDownCircle, Coins } from "lucide-react";

interface Goal {
  id: string;
  label: string;
  icon: typeof Trophy;
  target: number;
  current: number;
  unit: string;
  reward: string;
  color: string;
  unlocked: boolean;
}

interface Achievement {
  id: string;
  title: string;
  desc: string;
  icon: typeof Trophy;
  earned: boolean;
  rarity: "common" | "rare" | "epic" | "legendary";
  date?: string;
}

const RARITY_STYLES = {
  common: { border: "border-white/20", glow: "", badge: "bg-white/10 text-white", label: "Обычная" },
  rare: { border: "border-blue-400/40", glow: "shadow-[0_0_12px_rgba(96,165,250,0.2)]", badge: "bg-blue-400/20 text-blue-400", label: "Редкая" },
  epic: { border: "border-purple-400/40", glow: "shadow-[0_0_12px_rgba(167,139,250,0.25)]", badge: "bg-purple-400/20 text-purple-400", label: "Эпическая" },
  legendary: { border: "border-accent-gold/40", glow: "shadow-[0_0_16px_rgba(255,215,0,0.25)]", badge: "bg-accent-gold/20 text-accent-gold", label: "Легендарная" },
};

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS_RU = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];

// ─── Ячейка дня ─────────────────────────────────────────────────────────────
function DayCell({ day, onClick, active, isToday }: {
  day: CalendarDay | null;
  onClick?: () => void;
  active: boolean;
  isToday?: boolean;
}) {
  if (!day) return <div style={{ aspectRatio: "1" }} />;

  const pnl = day.pnl_pct;
  const isEstimated = day.estimated === true;
  const isPos = pnl !== null && !isEstimated && pnl > 0;
  const isNeg = pnl !== null && !isEstimated && pnl < 0;
  const hasReal = pnl !== null && !isEstimated;
  const hasTrades = (day.trade_volume ?? 0) > 0;
  const hasDeposit = day.has_deposit === true;
  const goalMet = day.signals > 0 && isPos;

  const intensity = hasReal ? Math.min(Math.abs(pnl!) / 6, 1) : 0;
  let bg = "transparent";
  if (isEstimated) {
    bg = "rgba(255,255,255,0.018)";
  } else if (isPos) {
    bg = `linear-gradient(145deg, rgba(0,212,160,${0.06 + intensity * 0.22}) 0%, rgba(0,212,160,${0.10 + intensity * 0.32}) 100%)`;
  } else if (isNeg) {
    bg = `linear-gradient(145deg, rgba(255,71,87,${0.05 + intensity * 0.18}) 0%, rgba(255,71,87,${0.09 + intensity * 0.28}) 100%)`;
  } else if (hasReal) {
    bg = "rgba(255,255,255,0.04)";
  } else if (hasDeposit) {
    bg = "rgba(10,255,224,0.05)";
  }

  const dayNum = parseInt(day.date.slice(8), 10);

  const borderCls = active
    ? "border-accent-cyan shadow-[0_0_14px_rgba(10,255,224,0.25)]"
    : isToday
    ? "border-white/25"
    : goalMet
    ? "border-success/25"
    : isPos
    ? "border-success/12"
    : isNeg
    ? "border-danger/12"
    : hasDeposit
    ? "border-accent-cyan/20"
    : "border-white/[0.05]";

  return (
    <button
      onClick={onClick}
      style={{ aspectRatio: "1", background: bg }}
      className={`group relative flex flex-col rounded-xl border transition-all duration-150 hover:scale-[1.06] hover:z-10 hover:border-white/20 ${borderCls} p-1.5`}
      title={[
        day.date,
        hasDeposit ? "Депозит" : "",
        hasTrades ? `Объём $${(day.trade_volume ?? 0).toLocaleString("ru", { maximumFractionDigits: 0 })}` : "",
        hasReal ? `PnL ${pnl!.toFixed(2)}%` : "",
      ].filter(Boolean).join(" · ")}
    >
      {/* Число месяца */}
      <span className={`text-[10px] font-bold leading-none ${isToday ? "text-accent-cyan" : isEstimated ? "text-white/20" : "text-white/45"}`}>
        {dayNum}
      </span>

      {/* PnL по центру */}
      <div className="flex flex-1 items-center justify-center">
        {hasReal && pnl !== 0 ? (
          <span
            className="text-[11px] font-extrabold leading-none tracking-tight"
            style={{ color: isPos ? "#00D4A0" : "#FF4757" }}
          >
            {isPos ? "+" : ""}{Math.abs(pnl!) >= 10 ? pnl!.toFixed(0) : pnl!.toFixed(1)}%
          </span>
        ) : hasReal && pnl === 0 ? (
          <span className="text-[9px] font-semibold text-white/18">0%</span>
        ) : null}
      </div>

      {/* Точки событий */}
      {(day.signals > 0 || hasTrades || hasDeposit) && (
        <div className="flex justify-center gap-[3px]">
          {day.signals > 0 && <span className="h-[5px] w-[5px] rounded-full bg-accent-cyan" />}
          {hasTrades && <span className="h-[5px] w-[5px] rounded-full bg-accent-gold" />}
          {hasDeposit && <span className="h-[5px] w-[5px] rounded-full bg-success" />}
        </div>
      )}

      {/* Значок выполненной цели */}
      {goalMet && (
        <span className="absolute -right-[3px] -top-[3px] flex h-3.5 w-3.5 items-center justify-center rounded-full bg-success shadow-[0_0_6px_rgba(0,212,160,0.5)] text-[7px] font-bold text-black">✓</span>
      )}

      {/* Кольцо "сегодня" */}
      {isToday && (
        <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-accent-cyan/40" />
      )}
    </button>
  );
}

// ─── Круговой прогресс ──────────────────────────────────────────────────────
function CircleProgress({ pct, color, size = 80, children }: { pct: number; color: string; size?: number; children?: React.ReactNode }) {
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(pct, 100) / 100) * circ;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={6} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={6}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const today = new Date();
  const [analytics, setAnalytics] = useState<AnalyticsMe | null>(null);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<CalendarDay | null>(null);
  const [calData, setCalData] = useState<CalendarDay[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [recentDeposits, setRecentDeposits] = useState<DepositRecord[]>([]);
  const [tradeSummary, setTradeSummary] = useState<TradeSummary | null>(null);
  const [currentBalance, setCurrentBalance] = useState<number | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    api.analyticsMe(token).then(setAnalytics).catch(() => {});
    api.profile(token).then(p => {
      if (p.balance_usdt) setCurrentBalance(parseFloat(p.balance_usdt));
    }).catch(() => {});
    api.tradesMe(token, 90).then(r => {
      setRecentDeposits((r.deposits || []).slice(0, 5));
      setTradeSummary(r.summary);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    setLoaded(false);
    api.analyticsCalendar(token, year, month)
      .then((r) => setCalData(r.days))
      .catch(() => setCalData([]))
      .finally(() => setLoaded(true));
  }, [year, month]);

  // Сетка
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const cells: (CalendarDay | null)[] = [
    ...Array(startOffset).fill(null),
    ...calData,
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  // Статистика месяца (на реальных данных)
  const profitDays = calData.filter(d => d.pnl_pct !== null && d.pnl_pct > 0).length;
  const lossDays = calData.filter(d => d.pnl_pct !== null && d.pnl_pct < 0).length;
  const activeDays = calData.filter(d => d.signals > 0).length;
  const goalDays = calData.filter(d => d.signals > 0 && d.pnl_pct !== null && d.pnl_pct > 0).length;

  const streak = (() => {
    let s = 0;
    for (let i = calData.length - 1; i >= 0; i--) {
      const d = calData[i];
      if (d.signals > 0 && d.pnl_pct !== null && d.pnl_pct > 0) s++;
      else break;
    }
    return s;
  })();
  const validPnl = calData.filter(d => d.pnl_pct !== null);
  const avgProfit = validPnl.length
    ? validPnl.reduce((a, d) => a + (d.pnl_pct ?? 0), 0) / validPnl.length
    : 0;
  const hotDays = calData.filter(d => d.pnl_pct !== null && d.pnl_pct > 3).length;
  const totalDays = calData.length;

  // Цели
  const goals: Goal[] = [
    {
      id: "days", label: "Дни с целью", icon: Calendar, target: 20, current: goalDays,
      unit: "дней", reward: "🏅 Стабильный трейдер", color: "#0AFFE0", unlocked: goalDays >= 20,
    },
    {
      id: "streak", label: "Лучший стрик", icon: Flame, target: 7, current: streak,
      unit: "дней подряд", reward: "🔥 Огонь", color: "#FF6B35", unlocked: streak >= 7,
    },
    {
      id: "signals", label: "Сигналов получено", icon: Zap, target: 30, current: analytics?.signals_received ?? 0,
      unit: "сигналов", reward: "⚡ Активный участник", color: "#FFD700", unlocked: (analytics?.signals_received ?? 0) >= 30,
    },
    {
      id: "profit", label: "Профитных дней", icon: TrendingUp, target: 15, current: profitDays,
      unit: "дней в плюс", reward: "📈 Бычий режим", color: "#00D4A0", unlocked: profitDays >= 15,
    },
  ];

  const achievements: Achievement[] = [
    {
      id: "first_signal", title: "Первый сигнал", desc: "Получи первый торговый сигнал", icon: Zap,
      earned: (analytics?.signals_received ?? 0) > 0, rarity: "common",
    },
    {
      id: "week_streak", title: "Недельный стрик", desc: "7 дней подряд в плюс", icon: Flame,
      earned: streak >= 7, rarity: "rare",
    },
    {
      id: "hot_day", title: "Горячий день", desc: "Получи 3%+ прибыли за день", icon: Star,
      earned: hotDays > 0, rarity: "rare",
    },
    {
      id: "20_days", title: "Железная воля", desc: "20 дней в месяц с выполненной целью", icon: Trophy,
      earned: goalDays >= 20, rarity: "epic",
    },
    {
      id: "consistent", title: "Стабильность", desc: "Получи 30+ сигналов за всё время", icon: Target,
      earned: (analytics?.signals_received ?? 0) >= 30, rarity: "epic",
    },
    {
      id: "legend", title: "Легенда", desc: "Выполни все 4 цели месяца", icon: Gift,
      earned: goals.every(g => g.unlocked), rarity: "legendary",
    },
  ];

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1);
    setSelectedDay(null);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1);
    setSelectedDay(null);
  }

  const todayStr = today.toISOString().slice(0, 10);
  const noData = loaded && validPnl.length === 0 && activeDays === 0;

  // Лучший/худший день месяца
  const realDays = calData.filter(d => d.pnl_pct !== null && !d.estimated);
  const bestDay = realDays.reduce<CalendarDay | null>((a, b) => (b.pnl_pct! > (a?.pnl_pct ?? -Infinity) ? b : a), null);
  const worstDay = realDays.reduce<CalendarDay | null>((a, b) => (b.pnl_pct! < (a?.pnl_pct ?? Infinity) ? b : a), null);
  const totalPnl = realDays.reduce((s, d) => s + (d.pnl_pct ?? 0), 0);
  const tradingDays = calData.filter(d => (d.trade_volume ?? 0) > 0).length;

  return (
    <div className="space-y-6">
      {/* Заголовок */}
      <div>
        <h1 className="text-2xl font-extrabold text-white">Аналитика & Прогресс</h1>
        <p className="text-sm text-text-muted">Реальные данные на основе снимков баланса и активности по сигналам</p>
      </div>

      {/* WEEX торговая активность */}
      {tradeSummary && (
        <div className="card space-y-3">
          <div className="flex items-center gap-2">
            <BarChart2 className="h-4 w-4 text-accent-cyan" />
            <h2 className="text-base font-bold text-white">Активность на WEEX</h2>
            <span className="ml-auto text-[10px] text-text-muted">за 90 дней</span>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {/* Net PnL */}
            {currentBalance !== null && tradeSummary.deposit_total > 0 && (() => {
              const pnl = currentBalance - tradeSummary.deposit_total;
              const pnlPct = (pnl / tradeSummary.deposit_total) * 100;
              const isPos = pnl >= 0;
              return (
                <div className={`rounded-xl px-4 py-3 border ${isPos ? "bg-success/5 border-success/20" : "bg-danger/5 border-danger/20"}`}>
                  <p className={`font-mono text-lg font-extrabold ${isPos ? "text-success" : "text-danger"}`}>
                    {isPos ? "+" : ""}{pnl.toLocaleString("ru", { maximumFractionDigits: 2 })} USDT
                  </p>
                  <p className={`text-[10px] font-bold mt-0.5 ${isPos ? "text-success" : "text-danger"}`}>
                    {isPos ? "+" : ""}{pnlPct.toFixed(2)}%
                  </p>
                  <p className="text-[11px] text-text-muted flex items-center gap-1 mt-1">
                    <TrendingUp className="h-3 w-3" /> Итог. P&L
                  </p>
                </div>
              );
            })()}
            <div className="rounded-xl bg-accent-cyan/5 border border-accent-cyan/10 px-4 py-3">
              <p className="font-mono text-lg font-extrabold text-white">
                ${tradeSummary.futures_volume.toLocaleString("ru", { maximumFractionDigits: 0 })}
              </p>
              <p className="text-[11px] text-text-muted flex items-center gap-1">
                <TrendingUp className="h-3 w-3 text-accent-cyan" /> Фьючерсы
              </p>
            </div>
            <div className="rounded-xl bg-success/5 border border-success/10 px-4 py-3">
              <p className="font-mono text-lg font-extrabold text-success">
                ${tradeSummary.deposit_total.toLocaleString("ru", { maximumFractionDigits: 0 })}
              </p>
              <p className="text-[11px] text-text-muted flex items-center gap-1">
                <ArrowDownCircle className="h-3 w-3 text-success" /> Депозиты
              </p>
            </div>
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-4 py-3">
              <p className="font-mono text-lg font-extrabold text-accent-gold">
                {(tradeSummary.deposit_total > 0
                  ? ((tradeSummary.total_volume / tradeSummary.deposit_total) * 100)
                  : 0).toLocaleString("ru", { maximumFractionDigits: 0 })}x
              </p>
              <p className="text-[11px] text-text-muted flex items-center gap-1">
                <Coins className="h-3 w-3 text-accent-gold" /> Оборот vs депозит
              </p>
            </div>
          </div>
        </div>
      )}

      {/* KPI */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <div className="card flex flex-col items-center gap-2 py-5">
          <CircleProgress pct={(goalDays / 20) * 100} color="#0AFFE0" size={72}>
            <span className="font-mono text-lg font-bold text-white">{goalDays}</span>
          </CircleProgress>
          <span className="text-xs text-text-muted">Дней с целью</span>
          <span className="text-[10px] text-accent-cyan">цель: 20</span>
        </div>
        <div className="card flex flex-col items-center gap-2 py-5">
          <CircleProgress pct={(streak / 7) * 100} color="#FF6B35" size={72}>
            <Flame className="h-5 w-5 text-orange-400" />
            <span className="font-mono text-sm font-bold text-white">{streak}</span>
          </CircleProgress>
          <span className="text-xs text-text-muted">Стрик (дней)</span>
          <span className="text-[10px] text-orange-400">цель: 7</span>
        </div>
        <div className="card flex flex-col items-center gap-2 py-5">
          <CircleProgress pct={Math.min(Math.abs(avgProfit) / 5 * 100, 100)} color={avgProfit >= 0 ? "#00D4A0" : "#FF4757"} size={72}>
            <span className={`font-mono text-sm font-bold ${avgProfit >= 0 ? "text-success" : "text-danger"}`}>
              {avgProfit >= 0 ? "+" : ""}{avgProfit.toFixed(2)}%
            </span>
          </CircleProgress>
          <span className="text-xs text-text-muted">Ср. доходность/день</span>
          <span className="text-[10px] text-text-muted">за {validPnl.length} дней</span>
        </div>
        <div className="card flex flex-col items-center gap-2 py-5">
          <CircleProgress pct={(hotDays / 5) * 100} color="#FFD700" size={72}>
            <span className="text-xl">🔥</span>
            <span className="font-mono text-sm font-bold text-white">{hotDays}</span>
          </CircleProgress>
          <span className="text-xs text-text-muted">Горячих дней</span>
          <span className="text-[10px] text-accent-gold">+3% за день</span>
        </div>
      </div>

      {/* Основной блок */}
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        {/* ── Календарь ── */}
        <div className="overflow-hidden rounded-2xl border border-border bg-bg-card">

          {/* Шапка */}
          <div
            className="border-b border-white/[0.06] px-5 pt-5 pb-4"
            style={{ background: "linear-gradient(135deg, rgba(10,255,224,0.04) 0%, transparent 55%)" }}
          >
            <div className="flex items-center justify-between">
              <button
                onClick={prevMonth}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 text-lg text-text-muted transition hover:border-white/20 hover:text-white"
              >‹</button>
              <div className="text-center">
                <h2 className="text-xl font-extrabold tracking-tight text-white">
                  {MONTHS_RU[month]} <span className="text-text-muted font-medium">{year}</span>
                </h2>
              </div>
              <button
                onClick={nextMonth}
                disabled={year === today.getFullYear() && month === today.getMonth()}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 text-lg text-text-muted transition hover:border-white/20 hover:text-white disabled:opacity-25"
              >›</button>
            </div>

            {/* Статспиллы */}
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <span className="flex items-center gap-1 rounded-full bg-success/10 px-3 py-1 text-[11px] font-semibold text-success">
                ↑ {profitDays} в плюс
              </span>
              <span className="flex items-center gap-1 rounded-full bg-danger/10 px-3 py-1 text-[11px] font-semibold text-danger">
                ↓ {lossDays} в минус
              </span>
              {tradingDays > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-accent-gold/10 px-3 py-1 text-[11px] font-semibold text-accent-gold">
                  ↕ {tradingDays} сделок
                </span>
              )}
              {activeDays > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-accent-cyan/10 px-3 py-1 text-[11px] font-semibold text-accent-cyan">
                  ⚡ {activeDays} сигналов
                </span>
              )}
            </div>

            {/* Мини-полоса прогресса профит/лосс */}
            {(profitDays + lossDays) > 0 && (
              <div className="mt-3 overflow-hidden rounded-full bg-white/[0.05]" style={{ height: 4 }}>
                <div className="flex h-full">
                  <div className="bg-success/60 transition-all duration-700" style={{ width: `${(profitDays / (profitDays + lossDays)) * 100}%` }} />
                  <div className="bg-danger/50 transition-all duration-700" style={{ width: `${(lossDays / (profitDays + lossDays)) * 100}%` }} />
                </div>
              </div>
            )}
          </div>

          {/* Тело календаря */}
          <div className="p-4">
            {/* Дни недели */}
            <div className="mb-2 grid grid-cols-7 gap-1.5">
              {WEEKDAYS.map(d => (
                <div key={d} className="py-1 text-center text-[10px] font-bold uppercase tracking-widest text-white/20">{d}</div>
              ))}
            </div>

            {/* Ячейки */}
            <div className="grid grid-cols-7 gap-1.5">
              {cells.map((day, i) => (
                <DayCell
                  key={i}
                  day={day}
                  active={selectedDay?.date === day?.date}
                  isToday={day?.date === todayStr}
                  onClick={() => day && setSelectedDay(day)}
                />
              ))}
            </div>

            {/* Легенда */}
            <div className="mt-4 flex flex-wrap justify-center gap-4 text-[10px] text-white/30">
              <span className="flex items-center gap-1.5"><span className="h-[5px] w-[5px] rounded-full bg-accent-cyan" />Сигнал</span>
              <span className="flex items-center gap-1.5"><span className="h-[5px] w-[5px] rounded-full bg-accent-gold" />Сделка</span>
              <span className="flex items-center gap-1.5"><span className="h-[5px] w-[5px] rounded-full bg-success" />Депозит</span>
              <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded-full bg-success text-[7px] font-bold text-black flex items-center justify-center">✓</span>Цель</span>
            </div>
          </div>

          {/* Детальная карточка выбранного дня */}
          {selectedDay && (
            <div className="border-t border-white/[0.06] px-5 py-4" style={{ background: "rgba(255,255,255,0.015)" }}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white">
                    {new Date(selectedDay.date + "T12:00:00").toLocaleDateString("ru", { weekday: "long", day: "numeric", month: "long" })}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedDay.balance !== null && (
                      <span className="rounded-lg bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold text-white">
                        💰 ${selectedDay.balance.toLocaleString("ru", { maximumFractionDigits: 2 })}
                      </span>
                    )}
                    {selectedDay.signals > 0 && (
                      <span className="rounded-lg bg-accent-cyan/10 px-2.5 py-1 text-[11px] font-semibold text-accent-cyan">
                        ⚡ {selectedDay.signals} сигналов
                      </span>
                    )}
                    {(selectedDay.trade_volume ?? 0) > 0 && (
                      <span className="rounded-lg bg-accent-gold/10 px-2.5 py-1 text-[11px] font-semibold text-accent-gold">
                        ↕ ${(selectedDay.trade_volume ?? 0).toLocaleString("ru", { maximumFractionDigits: 0 })} объём
                      </span>
                    )}
                    {selectedDay.has_deposit && (
                      <span className="rounded-lg bg-success/10 px-2.5 py-1 text-[11px] font-semibold text-success">
                        +$ Пополнение
                      </span>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {selectedDay.pnl_pct !== null && !selectedDay.estimated ? (
                    <>
                      <p className={`font-mono text-2xl font-extrabold ${selectedDay.pnl_pct > 0 ? "text-success" : selectedDay.pnl_pct < 0 ? "text-danger" : "text-white/40"}`}>
                        {selectedDay.pnl_pct > 0 ? "+" : ""}{selectedDay.pnl_pct.toFixed(2)}%
                      </p>
                      {selectedDay.signals > 0 && selectedDay.pnl_pct > 0 && (
                        <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold text-success">✓ Цель</span>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-white/20">Нет снимка</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Итоги месяца */}
          {realDays.length >= 2 && (
            <div className="border-t border-white/[0.06] px-5 py-3">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className={`font-mono text-base font-extrabold ${totalPnl >= 0 ? "text-success" : "text-danger"}`}>
                    {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(1)}%
                  </p>
                  <p className="text-[10px] text-white/30">итог месяца</p>
                </div>
                <div>
                  <p className="font-mono text-base font-extrabold text-success">
                    {bestDay ? `+${bestDay.pnl_pct!.toFixed(1)}%` : "—"}
                  </p>
                  <p className="text-[10px] text-white/30">лучший день</p>
                </div>
                <div>
                  <p className="font-mono text-base font-extrabold text-danger">
                    {worstDay && worstDay.pnl_pct! < 0 ? `${worstDay.pnl_pct!.toFixed(1)}%` : "—"}
                  </p>
                  <p className="text-[10px] text-white/30">худший день</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Цели */}
        <div className="space-y-4">
          <div className="card space-y-4">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-accent-cyan" />
              <h2 className="text-base font-bold text-white">Цели месяца</h2>
            </div>

            {goals.map((goal) => {
              const Icon = goal.icon;
              const pct = Math.min((goal.current / goal.target) * 100, 100);
              return (
                <div key={goal.id} className={`rounded-xl border p-3 transition ${goal.unlocked ? "border-success/30 bg-success/5" : "border-border bg-bg-panel/40"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4" style={{ color: goal.color }} />
                      <span className="text-xs font-semibold text-white">{goal.label}</span>
                    </div>
                    {goal.unlocked ? (
                      <CheckCircle2 className="h-4 w-4 text-success" />
                    ) : (
                      <span className="font-mono text-[11px] text-text-muted">
                        {goal.current}/{goal.target} {goal.unit}
                      </span>
                    )}
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-bg-deep">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${pct}%`, backgroundColor: goal.color }}
                    />
                  </div>
                  <p className={`mt-1.5 text-[10px] ${goal.unlocked ? "text-success" : "text-text-muted"}`}>
                    {goal.unlocked ? "✅ Получено: " : "🎁 Награда: "}{goal.reward}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="card space-y-3">
            <div className="flex items-center gap-2">
              <Star className="h-4 w-4 text-accent-gold" />
              <h2 className="text-base font-bold text-white">Уровень трейдера</h2>
            </div>
            {(() => {
              const xp = goalDays * 20 + streak * 30 + hotDays * 50 + (analytics?.sent ?? 0) * 5;
              const level = Math.floor(xp / 200) + 1;
              const xpInLevel = xp % 200;
              return (
                <>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-2xl font-extrabold text-accent-gold">Ур. {level}</span>
                    <span className="font-mono text-sm text-text-muted">{xp} XP</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-bg-deep">
                    <div
                      className="h-full rounded-full bg-accent-gold transition-all duration-700"
                      style={{ width: `${(xpInLevel / 200) * 100}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-text-muted">
                    {200 - xpInLevel} XP до уровня {level + 1}
                  </p>
                  <div className="grid grid-cols-2 gap-1.5 text-[10px] text-text-muted">
                    <span>📅 Дни с целью: +{goalDays * 20} XP</span>
                    <span>🔥 Стрик: +{streak * 30} XP</span>
                    <span>🔥 Горячие дни: +{hotDays * 50} XP</span>
                    <span>⚡ Доставлено: +{(analytics?.sent ?? 0) * 5} XP</span>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Последние депозиты */}
      {recentDeposits.length > 0 && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4 text-accent-cyan" />
              <h2 className="text-base font-bold text-white">Последние пополнения</h2>
            </div>
            <Link
              href="/app/trades"
              className="flex items-center gap-1 text-xs font-semibold text-accent-cyan hover:text-white"
            >
              Вся активность <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-white/[0.06] text-xs text-text-muted">
                <tr className="text-left">
                  <th className="pb-2 font-medium">Дата</th>
                  <th className="pb-2 font-medium">Монета</th>
                  <th className="pb-2 text-right font-medium">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {recentDeposits.map((d, i) => (
                  <tr key={i} className="border-b border-white/[0.04]">
                    <td className="py-2.5 text-xs text-text-secondary">
                      {d.date_iso ? new Date(d.date_iso).toLocaleString("ru", {
                        day: "numeric", month: "short", year: "numeric",
                      }) : "—"}
                    </td>
                    <td className="py-2.5">
                      <span className="rounded-md bg-success/15 px-1.5 py-0.5 text-[10px] font-bold text-success">
                        {d.coin}
                      </span>
                    </td>
                    <td className="py-2.5 text-right font-mono text-sm font-bold text-white">
                      +{d.amount.toLocaleString("ru", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Достижения */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-accent-gold" />
            <h2 className="text-base font-bold text-white">Достижения</h2>
          </div>
          <span className="badge-gold">{achievements.filter(a => a.earned).length}/{achievements.length}</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {achievements.map((ach) => {
            const Icon = ach.icon;
            const r = RARITY_STYLES[ach.rarity];
            return (
              <div
                key={ach.id}
                className={`relative overflow-hidden rounded-xl border p-4 transition ${r.border} ${r.glow} ${!ach.earned ? "opacity-50 grayscale" : ""}`}
                style={{ background: ach.earned ? "rgba(255,255,255,0.03)" : "transparent" }}
              >
                <div className="flex items-start gap-3">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${r.border}`}>
                    {ach.earned ? (
                      <Icon className="h-5 w-5 text-white" />
                    ) : (
                      <Lock className="h-4 w-4 text-text-muted" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-white">{ach.title}</h3>
                      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${r.badge}`}>
                        {r.label}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-text-muted">{ach.desc}</p>
                  </div>
                </div>
                {ach.earned && (
                  <div className="absolute right-0 top-0 h-12 w-12 overflow-hidden">
                    <div className="absolute right-0 top-0 h-12 w-12 -translate-y-6 translate-x-6 rotate-45 bg-success/20" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { api, AnalyticsMe } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { Trophy, Flame, Target, Star, CheckCircle2, Lock, Zap, TrendingUp, Gift, Calendar } from "lucide-react";

// ─── Типы ──────────────────────────────────────────────────────────────────
interface DayData {
  date: string;           // "2026-06-15"
  signals: number;
  profit: number;        // % условный
  goalMet: boolean;
  bonus?: string;        // название бонуса если выполнено
}

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

// ─── Демо-генератор данных ──────────────────────────────────────────────────
function generateCalendarData(year: number, month: number): DayData[] {
  const days: DayData[] = [];
  const today = new Date();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    if (date > today) break;

    const signals = Math.floor(Math.random() * 5);
    const profit = (Math.random() - 0.35) * 8;
    const goalMet = signals >= 2 && profit > 0;

    days.push({
      date: date.toISOString().split("T")[0],
      signals,
      profit,
      goalMet,
      bonus: goalMet && profit > 3 ? "🔥 Горячий день" : undefined,
    });
  }
  return days;
}

const RARITY_STYLES = {
  common: { border: "border-white/20", glow: "", badge: "bg-white/10 text-white", label: "Обычная" },
  rare: { border: "border-blue-400/40", glow: "shadow-[0_0_12px_rgba(96,165,250,0.2)]", badge: "bg-blue-400/20 text-blue-400", label: "Редкая" },
  epic: { border: "border-purple-400/40", glow: "shadow-[0_0_12px_rgba(167,139,250,0.25)]", badge: "bg-purple-400/20 text-purple-400", label: "Эпическая" },
  legendary: { border: "border-accent-gold/40", glow: "shadow-[0_0_16px_rgba(255,215,0,0.25)]", badge: "bg-accent-gold/20 text-accent-gold", label: "Легендарная" },
};

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS_RU = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];

// ─── Компонент: ячейка дня ──────────────────────────────────────────────────
function DayCell({ day, onClick, active }: { day: DayData | null; onClick?: () => void; active: boolean }) {
  if (!day) return <div className="aspect-square" />;

  const profit = day.profit;
  const isPositive = profit > 0;
  const intensity = Math.min(Math.abs(profit) / 8, 1);

  const bg = isPositive
    ? `rgba(0,212,160,${0.08 + intensity * 0.35})`
    : `rgba(255,71,87,${0.06 + intensity * 0.30})`;

  const d = new Date(day.date).getDate();

  return (
    <button
      onClick={onClick}
      className={`relative flex aspect-square flex-col items-center justify-center rounded-lg border transition-all hover:scale-105 ${
        active ? "border-accent-cyan ring-1 ring-accent-cyan/40" : "border-transparent hover:border-white/20"
      } ${day.goalMet ? "ring-1 ring-success/30" : ""}`}
      style={{ background: bg }}
      title={`${day.date}: ${day.signals} сигналов, ${profit.toFixed(1)}%`}
    >
      <span className="text-[11px] font-semibold text-white/70">{d}</span>
      {day.signals > 0 && (
        <span className="text-[8px] font-bold" style={{ color: isPositive ? "#00D4A0" : "#FF4757" }}>
          {isPositive ? "+" : ""}{profit.toFixed(1)}%
        </span>
      )}
      {day.goalMet && (
        <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-success text-[7px] text-white">✓</span>
      )}
      {day.bonus && (
        <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[8px]">🔥</span>
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
  const [selectedDay, setSelectedDay] = useState<DayData | null>(null);
  const [calData, setCalData] = useState<DayData[]>([]);

  useEffect(() => {
    const token = getAccessToken();
    if (token) {
      api.analyticsMe(token).then(setAnalytics).catch(() => {});
    }
    setCalData(generateCalendarData(year, month));
  }, [year, month]);

  // Построение сетки
  const firstDay = new Date(year, month, 1);
  // Сдвиг: 0=Вс в JS, нам нужен 1=Пн
  const startOffset = (firstDay.getDay() + 6) % 7;
  const cells: (DayData | null)[] = [
    ...Array(startOffset).fill(null),
    ...calData,
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  // Статистика месяца
  const totalDays = calData.length;
  const goalDays = calData.filter(d => d.goalMet).length;
  const streak = (() => {
    let s = 0;
    for (let i = calData.length - 1; i >= 0; i--) {
      if (calData[i].goalMet) s++;
      else break;
    }
    return s;
  })();
  const avgProfit = calData.length
    ? calData.reduce((a, d) => a + d.profit, 0) / calData.length
    : 0;
  const bonusDays = calData.filter(d => d.bonus).length;

  // Цели месяца
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
      id: "profit", label: "Профитных дней", icon: TrendingUp, target: 15, current: calData.filter(d => d.profit > 0).length,
      unit: "дней в плюс", reward: "📈 Бычий режим", color: "#00D4A0", unlocked: calData.filter(d => d.profit > 0).length >= 15,
    },
  ];

  // Достижения
  const achievements: Achievement[] = [
    {
      id: "first_signal", title: "Первый сигнал", desc: "Получи первый торговый сигнал", icon: Zap,
      earned: (analytics?.signals_received ?? 0) > 0, rarity: "common", date: "2026-06-01",
    },
    {
      id: "week_streak", title: "Недельный стрик", desc: "7 дней подряд выполняй дневную цель", icon: Flame,
      earned: streak >= 7, rarity: "rare",
    },
    {
      id: "hot_day", title: "Горячий день", desc: "Получи бонус 🔥 за отличный день", icon: Star,
      earned: bonusDays > 0, rarity: "rare", date: bonusDays > 0 ? calData.find(d => d.bonus)?.date : undefined,
    },
    {
      id: "20_days", title: "Железная воля", desc: "20 дней в месяц с выполненной целью", icon: Trophy,
      earned: goalDays >= 20, rarity: "epic",
    },
    {
      id: "consistent", title: "Стабильность", desc: "Получи 30+ сигналов за месяц", icon: Target,
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

  return (
    <div className="space-y-6">
      {/* Заголовок */}
      <div>
        <h1 className="text-2xl font-extrabold text-white">Аналитика & Прогресс</h1>
        <p className="text-sm text-text-muted">Трекер целей, календарь активности и система достижений</p>
      </div>

      {/* KPI — стрик + процент целей */}
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
              {avgProfit >= 0 ? "+" : ""}{avgProfit.toFixed(1)}%
            </span>
          </CircleProgress>
          <span className="text-xs text-text-muted">Ср. доходность/день</span>
          <span className="text-[10px] text-text-muted">за {totalDays} дней</span>
        </div>
        <div className="card flex flex-col items-center gap-2 py-5">
          <CircleProgress pct={(bonusDays / 5) * 100} color="#FFD700" size={72}>
            <span className="text-xl">🔥</span>
            <span className="font-mono text-sm font-bold text-white">{bonusDays}</span>
          </CircleProgress>
          <span className="text-xs text-text-muted">Горячих дней</span>
          <span className="text-[10px] text-accent-gold">+{bonusDays * 50} XP</span>
        </div>
      </div>

      {/* Основной блок: Календарь + Цели */}
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        {/* Календарь */}
        <div className="card space-y-4">
          {/* Навигация */}
          <div className="flex items-center justify-between">
            <button onClick={prevMonth} className="btn-outline px-3 py-1.5 text-xs">←</button>
            <div className="text-center">
              <h2 className="text-lg font-bold text-white">{MONTHS_RU[month]} {year}</h2>
              <p className="text-xs text-text-muted">
                {goalDays} из {totalDays} дней — цели выполнены
              </p>
            </div>
            <button
              onClick={nextMonth}
              disabled={year === today.getFullYear() && month === today.getMonth()}
              className="btn-outline px-3 py-1.5 text-xs disabled:opacity-30"
            >→</button>
          </div>

          {/* Легенда */}
          <div className="flex flex-wrap gap-3 text-[10px] text-text-muted">
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-success/40" />Профит</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-danger/40" />Убыток</span>
            <span className="flex items-center gap-1"><span className="relative h-2.5 w-2.5 rounded-sm bg-success/30 ring-1 ring-success/50" />Цель ✓</span>
            <span className="flex items-center gap-1">🔥 Горячий день</span>
          </div>

          {/* Дни недели */}
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map(d => (
              <div key={d} className="text-center text-[10px] font-semibold text-text-muted py-1">{d}</div>
            ))}
          </div>

          {/* Сетка */}
          <div className="grid grid-cols-7 gap-1.5">
            {cells.map((day, i) => (
              <DayCell
                key={i}
                day={day}
                active={selectedDay?.date === day?.date}
                onClick={() => day && setSelectedDay(day)}
              />
            ))}
          </div>

          {/* Детали выбранного дня */}
          {selectedDay && (
            <div className="mt-2 rounded-xl border border-border bg-bg-panel/60 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-bold text-white">
                    {new Date(selectedDay.date).toLocaleDateString("ru", { day: "numeric", month: "long", year: "numeric" })}
                  </p>
                  <p className="text-xs text-text-muted">{selectedDay.signals} сигналов</p>
                </div>
                <div className="text-right">
                  <p className={`font-mono text-lg font-extrabold ${selectedDay.profit >= 0 ? "text-success" : "text-danger"}`}>
                    {selectedDay.profit >= 0 ? "+" : ""}{selectedDay.profit.toFixed(2)}%
                  </p>
                  {selectedDay.goalMet && (
                    <span className="badge-success text-[10px]">✓ Цель выполнена</span>
                  )}
                </div>
              </div>
              {selectedDay.bonus && (
                <div className="mt-2 flex items-center gap-2 rounded-lg bg-accent-gold/10 px-3 py-2">
                  <span className="text-base">🔥</span>
                  <span className="text-xs font-semibold text-accent-gold">{selectedDay.bonus} — +50 XP</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Цели месяца */}
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
                  {/* Прогресс-бар */}
                  <div className="h-1.5 overflow-hidden rounded-full bg-bg-deep">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${pct}%`, backgroundColor: goal.color }}
                    />
                  </div>
                  {/* Награда */}
                  <p className={`mt-1.5 text-[10px] ${goal.unlocked ? "text-success" : "text-text-muted"}`}>
                    {goal.unlocked ? "✅ Получено: " : "🎁 Награда: "}{goal.reward}
                  </p>
                </div>
              );
            })}
          </div>

          {/* XP прогресс */}
          <div className="card space-y-3">
            <div className="flex items-center gap-2">
              <Star className="h-4 w-4 text-accent-gold" />
              <h2 className="text-base font-bold text-white">Уровень трейдера</h2>
            </div>
            {(() => {
              const xp = goalDays * 20 + streak * 30 + bonusDays * 50 + (analytics?.sent ?? 0) * 5;
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
                    <span>🔥 Горячие дни: +{bonusDays * 50} XP</span>
                    <span>⚡ Доставлено: +{(analytics?.sent ?? 0) * 5} XP</span>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </div>

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
                    {ach.earned && ach.date && (
                      <p className="mt-1 text-[10px] text-success">
                        ✓ Получено {new Date(ach.date).toLocaleDateString("ru")}
                      </p>
                    )}
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

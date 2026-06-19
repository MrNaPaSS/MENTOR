"use client";
// v8
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, AnalyticsMe, CalendarDay, DepositRecord, TradeSummary } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { Trophy, Flame, Target, Star, CheckCircle2, Lock, Zap, TrendingUp, Gift, Calendar, ArrowRight, BarChart2, ArrowDownCircle, Coins, CalendarDays, Wallet, Sparkles } from "lucide-react";

// Форматирование с точкой как разделителем тысяч: 23384 → "23.384"
function fmtDot(n: number, dec = 0): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// Объём коротко: 1_234_567 → "1.23M"
function fmtVolShort(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2).replace(".", ",") + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(".", ",") + "K";
  return fmtDot(n, 0);
}

// Вехи объёма для наград
const VOLUME_MILESTONES = [
  { vol: 50_000,     label: "50K",  emoji: "🥉", title: "Старт",          reward: "common"    as const },
  { vol: 100_000,    label: "100K", emoji: "🥈", title: "Набираю обороты", reward: "rare"      as const },
  { vol: 500_000,    label: "500K", emoji: "🥇", title: "Серьёзный",       reward: "epic"      as const },
  { vol: 1_000_000,  label: "1M",   emoji: "💎", title: "Миллионер",       reward: "legendary" as const },
  { vol: 5_000_000,  label: "5M",   emoji: "👑", title: "Легенда NMNH",    reward: "legendary" as const },
  { vol: 10_000_000, label: "10M",  emoji: "🚀", title: "К звёздам",       reward: "legendary" as const },
  { vol: 25_000_000, label: "25M",  emoji: "⚡", title: "Элита",           reward: "legendary" as const },
];

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

type AchCategory = "all" | "volume" | "discipline" | "performance" | "deposit" | "special";

interface Achievement {
  id: string;
  title: string;
  desc: string;
  icon: typeof Trophy;
  earned: boolean;
  rarity: "common" | "rare" | "epic" | "legendary";
  date?: string;
  category: Exclude<AchCategory, "all">;
  xp: number;
}

const RARITY_STYLES = {
  common: { border: "border-white/20", glow: "", badge: "bg-white/10 text-white", label: "Обычная" },
  rare: { border: "border-blue-400/40", glow: "shadow-[0_0_12px_rgba(96,165,250,0.2)]", badge: "bg-blue-400/20 text-blue-400", label: "Редкая" },
  epic: { border: "border-purple-400/40", glow: "shadow-[0_0_12px_rgba(167,139,250,0.25)]", badge: "bg-purple-400/20 text-purple-400", label: "Эпическая" },
  legendary: { border: "border-accent-gold/40", glow: "shadow-[0_0_16px_rgba(255,215,0,0.25)]", badge: "bg-accent-gold/20 text-accent-gold", label: "Легендарная" },
};

// Progressive XP levels: L2=200, L3=600, L4=1400, L5=3000, L6=6200...
function xpToLevel(level: number): number {
  if (level <= 1) return 0;
  return 200 * (Math.pow(2, level - 1) - 1);
}
function getXpLevel(totalXp: number) {
  let lvl = 1;
  while (xpToLevel(lvl + 1) <= totalXp) lvl++;
  return { level: lvl, xpInLevel: totalXp - xpToLevel(lvl), xpNeeded: xpToLevel(lvl + 1) - xpToLevel(lvl) };
}

const ACH_CATEGORIES: { id: AchCategory; label: string; icon: React.ElementType }[] = [
  { id: "all",         label: "Все",        icon: Trophy        },
  { id: "volume",      label: "Объём",      icon: BarChart2     },
  { id: "discipline",  label: "Дисциплина", icon: CalendarDays  },
  { id: "performance", label: "Результаты", icon: TrendingUp    },
  { id: "deposit",     label: "Депозиты",   icon: Wallet        },
  { id: "special",     label: "Особые",     icon: Sparkles      },
];

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
  let bg = "rgba(255,255,255,0.015)";
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
    ? "border-white/25 shadow-[0_0_8px_rgba(255,255,255,0.06)]"
    : goalMet
    ? "border-success/30 shadow-[0_0_8px_rgba(0,212,160,0.12)]"
    : isPos
    ? "border-success/20"
    : isNeg
    ? "border-danger/20"
    : hasDeposit
    ? "border-accent-cyan/25"
    : day.signals > 0
    ? "border-accent-cyan/10"
    : "border-white/[0.04]";

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

      {/* Центр ячейки: PnL если есть, иначе объём/сигналы */}
      <div className="flex flex-1 flex-col items-center justify-center gap-[2px]">
        {hasReal && pnl !== 0 ? (
          <span className="text-[11px] font-extrabold leading-none tracking-tight"
            style={{ color: isPos ? "#00D4A0" : "#FF4757" }}>
            {isPos ? "+" : ""}{Math.abs(pnl!) >= 10 ? pnl!.toFixed(0) : pnl!.toFixed(1)}%
          </span>
        ) : hasReal && pnl === 0 ? (
          <span className="text-[9px] font-semibold text-white/18">0%</span>
        ) : null}
        {/* Объём — показывается всегда когда есть */}
        {hasTrades && (
          <span className="text-[8px] font-bold tabular-nums text-accent-gold/70 leading-none">
            {fmtVolShort(day.trade_volume ?? 0)}
          </span>
        )}
        {/* Сигналы без объёма */}
        {!hasTrades && !hasReal && day.signals > 0 && (
          <span className="text-[8px] font-semibold text-accent-cyan/50 leading-none">
            ⚡{day.signals}
          </span>
        )}
        {/* Депозит без торговли */}
        {!hasTrades && !hasReal && hasDeposit && (
          <span className="text-[8px] font-semibold text-success/60 leading-none">+$</span>
        )}
      </div>

      {/* Точки событий */}
      {(day.signals > 0 || hasTrades || hasDeposit) && (
        <div className="flex justify-center gap-[3px] mt-[2px]">
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
  const [achCategory, setAchCategory] = useState<AchCategory>("all");

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

  // Статистика месяца
  const profitDays   = calData.filter(d => d.pnl_pct !== null && !d.estimated && d.pnl_pct > 0).length;
  const lossDays     = calData.filter(d => d.pnl_pct !== null && !d.estimated && d.pnl_pct < 0).length;
  const activeDays   = calData.filter(d => d.signals > 0).length;                        // дни с сигналами
  const tradingDays  = calData.filter(d => (d.trade_volume ?? 0) > 0).length;            // дни с торговлей
  const monthVolume  = calData.reduce((s, d) => s + (d.trade_volume ?? 0), 0);           // объём за месяц
  const totalVolume  = tradeSummary?.total_volume ?? 0;
  const goalDays     = calData.filter(d => d.signals > 0 && d.pnl_pct !== null && d.pnl_pct > 0).length;

  // Стрик: последовательные дни С ТОРГОВЛЕЙ (не требует PnL снимков)
  const activityStreak = (() => {
    let s = 0;
    for (let i = calData.length - 1; i >= 0; i--) {
      if ((calData[i].trade_volume ?? 0) > 0 || calData[i].signals > 0) s++;
      else break;
    }
    return s;
  })();

  const validPnl  = calData.filter(d => d.pnl_pct !== null && !d.estimated);
  const avgProfit = validPnl.length
    ? validPnl.reduce((a, d) => a + (d.pnl_pct ?? 0), 0) / validPnl.length : 0;
  const hotDays     = calData.filter(d => d.pnl_pct !== null && d.pnl_pct > 3).length;
  const superHotDay = calData.some(d => d.pnl_pct !== null && d.pnl_pct >= 5);
  const epicDay     = calData.some(d => d.pnl_pct !== null && d.pnl_pct >= 10);
  const depositTotal = recentDeposits.reduce((s, d) => s + d.amount, 0);

  // Цели месяца — работают даже без PnL снимков
  const effectiveTradeDays = tradingDays > 0 ? tradingDays : activeDays;
  const goals: Goal[] = [
    {
      id: "volume", label: "Объём за месяц", icon: BarChart2, target: 250_000,
      current: Math.round(monthVolume > 0 ? monthVolume : totalVolume / 3),
      unit: "USDT", reward: "💹 Активный трейдер",
      color: "#0AFFE0", unlocked: (monthVolume > 0 ? monthVolume : totalVolume / 3) >= 250_000,
    },
    {
      id: "trading_days", label: "Дней торговали", icon: Calendar, target: 15,
      current: effectiveTradeDays,
      unit: "дней", reward: "📅 Дисциплина",
      color: "#FF6B35", unlocked: effectiveTradeDays >= 15,
    },
    {
      id: "profit", label: "Прибыльных дней", icon: TrendingUp, target: 5,
      current: profitDays,
      unit: "дней в плюс", reward: "📈 Бычий режим",
      color: "#00D4A0", unlocked: profitDays >= 5,
    },
    {
      id: "streak", label: "Стрик активности", icon: Flame, target: 7,
      current: activityStreak,
      unit: "дней подряд", reward: "🔥 На волне",
      color: "#f97316", unlocked: activityStreak >= 7,
    },
    {
      id: "hot_day", label: "Горячий день", icon: Star, target: 1,
      current: hotDays,
      unit: "дней 3%+", reward: "🌟 День охотника",
      color: "#eab308", unlocked: hotDays >= 1,
    },
    {
      id: "month_profit", label: "Месяц в плюс", icon: TrendingUp, target: 1,
      current: avgProfit > 0 ? 1 : 0,
      unit: "", reward: "📈 Победный месяц",
      color: "#22c55e", unlocked: avgProfit > 0 && validPnl.length >= 5,
    },
  ];

  const { level: xpLevel } = getXpLevel(
    Math.floor(totalVolume / 50_000) * 25 +
    activityStreak * 30 + goalDays * 20 + hotDays * 50 + profitDays * 15 + effectiveTradeDays * 10
  );

  const achievements: Achievement[] = [
    // ── Объём ────────────────────────────────────────────────────────────
    { id: "vol_10k",  title: "Первые 10K",    desc: "Суммарный объём 10 000 USDT",    icon: BarChart2,  earned: totalVolume >= 10_000,    rarity: "common",    category: "volume",      xp: 10  },
    { id: "vol_50k",  title: "Старт",         desc: "Суммарный объём 50 000 USDT",    icon: BarChart2,  earned: totalVolume >= 50_000,    rarity: "common",    category: "volume",      xp: 25  },
    { id: "vol_100k", title: "Набираю обороты",desc: "Суммарный объём 100 000 USDT",  icon: BarChart2,  earned: totalVolume >= 100_000,   rarity: "rare",      category: "volume",      xp: 50  },
    { id: "vol_500k", title: "Серьёзный",     desc: "Суммарный объём 500 000 USDT",   icon: BarChart2,  earned: totalVolume >= 500_000,   rarity: "rare",      category: "volume",      xp: 100 },
    { id: "vol_1m",   title: "Миллионер",     desc: "Суммарный объём 1 000 000 USDT", icon: Trophy,     earned: totalVolume >= 1_000_000,  rarity: "epic",      category: "volume",      xp: 200 },
    { id: "vol_5m",   title: "Легенда NMNH",  desc: "Суммарный объём 5 000 000 USDT", icon: Trophy,     earned: totalVolume >= 5_000_000,  rarity: "epic",      category: "volume",      xp: 400 },
    { id: "vol_10m",  title: "К звёздам",     desc: "Суммарный объём 10 000 000 USDT",icon: Star,       earned: totalVolume >= 10_000_000, rarity: "legendary", category: "volume",      xp: 750 },
    { id: "vol_25m",  title: "Элита",         desc: "Суммарный объём 25 000 000 USDT",icon: Star,       earned: totalVolume >= 25_000_000, rarity: "legendary", category: "volume",      xp: 1500 },
    // ── Дисциплина ───────────────────────────────────────────────────────
    { id: "first_trade",  title: "Первый шаг",      desc: "Первый торговый день",             icon: Calendar, earned: effectiveTradeDays >= 1,  rarity: "common",    category: "discipline", xp: 10  },
    { id: "streak_3",     title: "Трёхдневка",      desc: "3 дня активности подряд",           icon: Flame,    earned: activityStreak >= 3,      rarity: "common",    category: "discipline", xp: 20  },
    { id: "streak_7",     title: "Недельный стрик", desc: "7 дней активности подряд",          icon: Flame,    earned: activityStreak >= 7,      rarity: "rare",      category: "discipline", xp: 60  },
    { id: "streak_14",    title: "Двухнедельник",   desc: "14 дней активности подряд",         icon: Flame,    earned: activityStreak >= 14,     rarity: "epic",      category: "discipline", xp: 150 },
    { id: "streak_30",    title: "Железный трейдер",desc: "30 дней активности подряд",         icon: Trophy,   earned: activityStreak >= 30,     rarity: "legendary", category: "discipline", xp: 500 },
    { id: "days_15",      title: "Полмесяца",       desc: "15 торговых дней в месяце",         icon: Calendar, earned: effectiveTradeDays >= 15, rarity: "rare",      category: "discipline", xp: 75  },
    { id: "days_20",      title: "Настоящий трейдер",desc: "20 торговых дней в месяце",        icon: Calendar, earned: effectiveTradeDays >= 20, rarity: "epic",      category: "discipline", xp: 150 },
    { id: "days_25",      title: "Профессионал",    desc: "25 торговых дней в месяце",         icon: Trophy,   earned: effectiveTradeDays >= 25, rarity: "legendary", category: "discipline", xp: 300 },
    // ── Результаты ───────────────────────────────────────────────────────
    { id: "first_profit", title: "Первый плюс",    desc: "Первый прибыльный день",            icon: TrendingUp, earned: profitDays >= 1,            rarity: "common",    category: "performance", xp: 15  },
    { id: "profit_5",     title: "5 побед",         desc: "5 прибыльных дней в месяце",       icon: TrendingUp, earned: profitDays >= 5,            rarity: "rare",      category: "performance", xp: 60  },
    { id: "profit_10",    title: "10 побед",        desc: "10 прибыльных дней в месяце",      icon: TrendingUp, earned: profitDays >= 10,           rarity: "epic",      category: "performance", xp: 200 },
    { id: "hot_day_3",    title: "Горячий день",    desc: "День с прибылью 3%+",              icon: Star,       earned: hotDays >= 1,               rarity: "rare",      category: "performance", xp: 50  },
    { id: "hot_day_5",    title: "Раскалённый день",desc: "День с прибылью 5%+",              icon: Star,       earned: superHotDay,                rarity: "epic",      category: "performance", xp: 100 },
    { id: "hot_day_10",   title: "Снайпер",         desc: "День с прибылью 10%+",             icon: Zap,        earned: epicDay,                    rarity: "legendary", category: "performance", xp: 300 },
    { id: "month_plus",   title: "Месяц в плюс",   desc: "Средний PnL месяца положительный", icon: TrendingUp, earned: avgProfit > 0 && validPnl.length >= 5, rarity: "epic", category: "performance", xp: 150 },
    { id: "goal_days_10", title: "Ударник",         desc: "10 дней с выполненными целями",    icon: Target,     earned: goalDays >= 10,             rarity: "epic",      category: "performance", xp: 175 },
    // ── Депозиты ─────────────────────────────────────────────────────────
    { id: "dep_first",  title: "Первый депозит",  desc: "Первое пополнение счёта",           icon: ArrowDownCircle, earned: recentDeposits.length > 0,    rarity: "common",    category: "deposit", xp: 10  },
    { id: "dep_500",    title: "Инвестор",        desc: "Пополнения от 500 USDT",            icon: Coins,          earned: depositTotal >= 500,          rarity: "rare",      category: "deposit", xp: 40  },
    { id: "dep_1k",     title: "Серьёзный капитал",desc: "Пополнения от 1 000 USDT",         icon: Coins,          earned: depositTotal >= 1_000,        rarity: "rare",      category: "deposit", xp: 80  },
    { id: "dep_5k",     title: "Фонд менеджер",   desc: "Пополнения от 5 000 USDT",         icon: Coins,          earned: depositTotal >= 5_000,        rarity: "epic",      category: "deposit", xp: 200 },
    { id: "dep_10k",    title: "Кит",             desc: "Пополнения от 10 000 USDT",        icon: Trophy,         earned: depositTotal >= 10_000,       rarity: "legendary", category: "deposit", xp: 500 },
    { id: "dep_3plus",  title: "Регулярный",      desc: "3 и более пополнений",             icon: ArrowDownCircle, earned: recentDeposits.length >= 3,  rarity: "rare",      category: "deposit", xp: 50  },
    // ── Особые ───────────────────────────────────────────────────────────
    { id: "joined",       title: "Добро пожаловать",desc: "Вступил в сообщество NMNH",        icon: Gift,   earned: true,                       rarity: "common",    category: "special", xp: 5   },
    { id: "level_5",      title: "Уровень 5",      desc: "Достигни уровня трейдера 5",       icon: Star,   earned: xpLevel >= 5,               rarity: "rare",      category: "special", xp: 0   },
    { id: "level_10",     title: "Уровень 10",     desc: "Достигни уровня трейдера 10",      icon: Trophy, earned: xpLevel >= 10,              rarity: "epic",      category: "special", xp: 0   },
    { id: "level_20",     title: "Уровень 20",     desc: "Достигни уровня трейдера 20",      icon: Trophy, earned: xpLevel >= 20,              rarity: "legendary", category: "special", xp: 0   },
    { id: "all_goals",    title: "Перфекционист",  desc: "Выполни все цели месяца",          icon: Target, earned: goals.every(g => g.unlocked), rarity: "epic",     category: "special", xp: 250 },
    { id: "vol_250k_mo",  title: "Месячный рекорд",desc: "Объём за месяц 250K USDT",        icon: BarChart2, earned: (monthVolume > 0 ? monthVolume : 0) >= 250_000, rarity: "epic", category: "special", xp: 200 },
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

  return (
    <div className="space-y-6">
      {/* Заголовок */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Аналитика <span className="text-accent-cyan">&</span> Прогресс</h1>
          <p className="text-sm text-text-muted mt-0.5">Реальные данные на основе снимков баланса и активности по сигналам</p>
        </div>
        {tradeSummary && (
          <div className="hidden md:flex items-center gap-3 rounded-xl border border-accent-gold/20 bg-accent-gold/5 px-4 py-2">
            <span className="text-lg">🏆</span>
            <div>
              <p className="font-mono text-xs text-white/40 leading-none">Всего объёма</p>
              <p className="font-mono text-base font-extrabold text-accent-gold leading-tight">${fmtDot(Math.round(totalVolume))}</p>
            </div>
          </div>
        )}
      </div>


      {/* KPI */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        {/* Объём месяца */}
        <div className="card flex flex-col items-center gap-2 py-5">
          <CircleProgress pct={Math.min(((monthVolume > 0 ? monthVolume : totalVolume / 3) / 250_000) * 100, 100)} color="#0AFFE0" size={72}>
            <span className="font-mono text-[11px] font-bold text-white leading-tight text-center">
              {fmtVolShort(monthVolume > 0 ? monthVolume : totalVolume / 3)}
            </span>
          </CircleProgress>
          <span className="text-xs text-text-muted">Объём месяца</span>
          <span className="text-[10px] text-accent-cyan">цель: 250K</span>
        </div>
        {/* Стрик активности */}
        <div className="card flex flex-col items-center gap-2 py-5">
          <CircleProgress pct={(activityStreak / 7) * 100} color="#FF6B35" size={72}>
            <Flame className="h-5 w-5 text-orange-400" />
            <span className="font-mono text-sm font-bold text-white">{activityStreak}</span>
          </CircleProgress>
          <span className="text-xs text-text-muted">Стрик активности</span>
          <span className="text-[10px] text-orange-400">цель: 7 дней</span>
        </div>
        {/* Ср. доходность */}
        <div className="card flex flex-col items-center gap-2 py-5">
          <CircleProgress pct={Math.min(Math.abs(avgProfit) / 5 * 100, 100)} color={avgProfit >= 0 ? "#00D4A0" : "#FF4757"} size={72}>
            <span className={`font-mono text-sm font-bold ${avgProfit >= 0 ? "text-success" : "text-danger"}`}>
              {avgProfit >= 0 ? "+" : ""}{avgProfit.toFixed(2)}%
            </span>
          </CircleProgress>
          <span className="text-xs text-text-muted">Ср. доходность/день</span>
          <span className="text-[10px] text-text-muted">за {validPnl.length} дней</span>
        </div>
        {/* Дней торговали */}
        <div className="card flex flex-col items-center gap-2 py-5">
          <CircleProgress pct={Math.min(((tradingDays > 0 ? tradingDays : activeDays) / 15) * 100, 100)} color="#FFD700" size={72}>
            <Calendar className="h-4 w-4 text-accent-gold" />
            <span className="font-mono text-sm font-bold text-white">{tradingDays > 0 ? tradingDays : activeDays}</span>
          </CircleProgress>
          <span className="text-xs text-text-muted">Дней торговали</span>
          <span className="text-[10px] text-accent-gold">цель: 15 дней</span>
        </div>
      </div>

      {/* Вехи объёма — горизонтальный трек */}
      {tradeSummary && (() => {
        const nextIdx = VOLUME_MILESTONES.findIndex(m => totalVolume < m.vol);
        const nextM   = nextIdx >= 0 ? VOLUME_MILESTONES[nextIdx] : null;
        const prevM   = nextIdx > 0  ? VOLUME_MILESTONES[nextIdx - 1] : nextIdx === -1 ? VOLUME_MILESTONES[VOLUME_MILESTONES.length - 1] : null;
        const trackPct = nextM && prevM
          ? Math.min(((totalVolume - prevM.vol) / (nextM.vol - prevM.vol)) * 100, 100)
          : nextIdx === -1 ? 100 : Math.min((totalVolume / VOLUME_MILESTONES[0].vol) * 100, 100);

        return (
          <div className="overflow-hidden rounded-2xl border border-white/[0.07]"
            style={{ background: "linear-gradient(135deg, rgba(255,215,0,0.04) 0%, rgba(0,0,0,0) 60%)" }}>
            {/* Шапка */}
            <div className="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-white/[0.05]">
              <BarChart2 className="h-4 w-4 text-accent-gold" />
              <div>
                <h2 className="text-sm font-bold text-white leading-none">Путь трейдера</h2>
                <p className="text-[10px] text-white/30 mt-0.5">Суммарный объём на WEEX</p>
              </div>
              <div className="ml-auto text-right">
                <span className="font-mono text-base font-extrabold text-accent-gold">${fmtDot(Math.round(totalVolume))}</span>
                <span className="text-[10px] text-white/30 ml-1">USDT</span>
              </div>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Линия прогресса между вехами */}
              {nextM && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-white/30">{prevM ? prevM.label : "0"}</span>
                    <span className="text-white/50">до <span className="text-accent-gold font-bold">{nextM.label}</span> осталось <span className="font-mono">${fmtDot(Math.round(nextM.vol - totalVolume))}</span></span>
                    <span className="text-accent-gold font-bold">{nextM.label}</span>
                  </div>
                  <div className="relative h-2 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="h-full rounded-full transition-all duration-1000"
                      style={{ width: `${trackPct}%`, background: "linear-gradient(90deg, #f59e0b, #fde68a)" }} />
                  </div>
                  <p className="text-[10px] text-white/25 text-right">{trackPct.toFixed(1)}% до следующей вехи</p>
                </div>
              )}

              {/* Точки вех */}
              <div className="flex items-end gap-2 overflow-x-auto pb-1">
                {VOLUME_MILESTONES.map((m, i) => {
                  const reached = totalVolume >= m.vol;
                  const isCurrent = nextIdx === i;
                  return (
                    <div key={m.label} className="flex-1 min-w-[60px] flex flex-col items-center gap-1.5">
                      {/* Индикатор */}
                      <div className={`relative flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all ${
                        reached
                          ? "border-accent-gold bg-accent-gold/15 shadow-[0_0_16px_rgba(251,191,36,0.4)]"
                          : isCurrent
                          ? "border-white/30 bg-white/[0.04]"
                          : "border-white/10 bg-white/[0.02]"
                      }`}>
                        <span className={`text-lg leading-none ${reached ? "" : "opacity-25"}`}>{m.emoji}</span>
                        {reached && (
                          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-accent-gold text-[7px] font-black text-black">✓</span>
                        )}
                      </div>
                      <span className={`font-mono text-[10px] font-bold ${reached ? "text-accent-gold" : isCurrent ? "text-white/50" : "text-white/20"}`}>{m.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

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
                        💰 ${fmtDot(selectedDay.balance, 2)}
                      </span>
                    )}
                    {selectedDay.signals > 0 && (
                      <span className="rounded-lg bg-accent-cyan/10 px-2.5 py-1 text-[11px] font-semibold text-accent-cyan">
                        ⚡ {selectedDay.signals} сигналов
                      </span>
                    )}
                    {(selectedDay.trade_volume ?? 0) > 0 && (
                      <span className="rounded-lg bg-accent-gold/10 px-2.5 py-1 text-[11px] font-semibold text-accent-gold">
                        ↕ ${fmtDot(selectedDay.trade_volume ?? 0)} объём
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
          <div className="card space-y-3">
            <div className="flex items-center gap-2">
              <Star className="h-4 w-4 text-accent-gold" />
              <h2 className="text-base font-bold text-white">Уровень трейдера</h2>
            </div>
            {(() => {
            const volXp      = Math.floor(totalVolume / 50_000) * 25;
            const streakXp   = activityStreak * 30;
            const goalXp     = goalDays * 20;
            const hotXp      = hotDays * 50;
            const profitXp   = profitDays * 15;
            const tradeDayXp = effectiveTradeDays * 10;
            const xp = volXp + streakXp + goalXp + hotXp + profitXp + tradeDayXp;
            const { level, xpInLevel, xpNeeded } = getXpLevel(xp);
            const pct = (xpInLevel / xpNeeded) * 100;
            const levelTitles: Record<number, string> = {
              1: "Новичок", 2: "Начинающий", 3: "Трейдер", 4: "Уверенный",
              5: "Опытный", 7: "Профи", 10: "Эксперт", 15: "Мастер", 20: "Легенда",
            };
            const levelTitle = Object.entries(levelTitles).reverse().find(([l]) => level >= +l)?.[1] ?? "Новичок";
            return (
              <>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-[10px] text-white/30 leading-none mb-1">{levelTitle}</p>
                    <span className="font-mono text-3xl font-extrabold text-accent-gold leading-none">Ур. {level}</span>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-sm font-bold text-white">{xp.toLocaleString("ru")} XP</span>
                    <p className="text-[10px] text-white/30">{xpInLevel}/{xpNeeded} до ур. {level + 1}</p>
                  </div>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-bg-deep">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${pct}%`, background: "linear-gradient(90deg, #f59e0b, #fde68a)" }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-1 text-[10px] text-white/30 pt-1">
                  <span>📊 Объём: +{volXp} XP</span>
                  <span>🔥 Стрик: +{streakXp} XP</span>
                  <span>🌟 Горячие дни: +{hotXp} XP</span>
                  <span>📈 Прибыль: +{profitXp} XP</span>
                  <span>📅 Дни: +{tradeDayXp} XP</span>
                  <span>🎯 Цели: +{goalXp} XP</span>
                </div>
              </>
            );
          })()}
          </div>

          <div className="card space-y-4">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-accent-cyan" />
              <h2 className="text-base font-bold text-white">Цели месяца</h2>
            </div>

            {goals.map((goal) => {
              const Icon = goal.icon;
              const pct = Math.min((goal.current / goal.target) * 100, 100);
              return (
                <div key={goal.id} className={`rounded-xl border px-3 py-2.5 transition ${goal.unlocked ? "border-success/25 bg-success/[0.04]" : "border-white/[0.06] bg-white/[0.02]"}`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: goal.color }} />
                    <span className="text-[11px] font-semibold text-white flex-1 min-w-0 truncate">{goal.label}</span>
                    {goal.unlocked
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                      : <span className="font-mono text-[10px] text-white/30 shrink-0">{goal.current}/{goal.target}</span>
                    }
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-bg-deep">
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: goal.color }} />
                  </div>
                  {goal.unlocked && (
                    <p className="mt-1 text-[9px] text-success/70 truncate">{goal.reward}</p>
                  )}
                </div>
              );
            })}
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
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-accent-gold font-bold">{achievements.filter(a => a.earned).length}/{achievements.length}</span>
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-bg-deep">
              <div className="h-full rounded-full bg-accent-gold transition-all duration-700"
                style={{ width: `${(achievements.filter(a => a.earned).length / achievements.length) * 100}%` }} />
            </div>
          </div>
        </div>

        {/* Категории */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
          {ACH_CATEGORIES.map(cat => {
            const count = cat.id === "all" ? achievements.filter(a => a.earned).length : achievements.filter(a => a.category === cat.id && a.earned).length;
            const total = cat.id === "all" ? achievements.length : achievements.filter(a => a.category === cat.id).length;
            return (
              <button key={cat.id} onClick={() => setAchCategory(cat.id)}
                className={`shrink-0 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${achCategory === cat.id ? "border-accent-gold/50 bg-accent-gold/10 text-accent-gold" : "border-white/[0.07] bg-white/[0.02] text-white/40 hover:text-white/70"}`}>
                <cat.icon className="h-3 w-3 shrink-0" />
                <span>{cat.label}</span>
                <span className={`font-mono text-[9px] ${achCategory === cat.id ? "text-accent-gold/60" : "text-white/20"}`}>{count}/{total}</span>
              </button>
            );
          })}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {achievements.filter(a => achCategory === "all" || a.category === achCategory).map((ach) => {
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

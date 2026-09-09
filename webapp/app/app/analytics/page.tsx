"use client";
// v8
import { intlLocale, useIntlLocale, useLocale, useT, type Dict } from "@/lib/i18n";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, AnalyticsMe, CalendarDay, DepositRecord, TradeSummary, CoinsBalance } from "@/lib/api";
import { loadDay, type JournalTrade } from "@/lib/journal";
import PnlCard from "@/components/scalping/PnlCard";
// Цены показываем тем же форматом, что и на самой карточке: цена выхода -
// средняя по частям закрытия, и без округления она приезжает с десятком
// знаков после точки.
import { price as fmtPrice, type CardData } from "@/lib/pnl/card";
import { cardFromPeriod, cardFromTrade } from "@/lib/pnl/data";
import { periodOf, type Span } from "@/lib/pnl/period";
import { CHIP, CHIP_OFF, CHIP_ON, PaneHead, PaneScope } from "@/components/app/Pane";
import { getAccessToken } from "@/lib/auth";
import { COINS_EVENT } from "@/lib/useCoins";
import { Trophy, Flame, Target, Star, CheckCircle2, Lock, Zap, TrendingUp, Gift, Calendar, ArrowRight, BarChart2, ArrowDownCircle, Coins, CalendarDays, Wallet, Sparkles, Share2 } from "lucide-react";

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
  { vol: 50_000,     label: "50K",  emoji: "🥉", key: "m50k"  as const, reward: "common"    as const },
  { vol: 100_000,    label: "100K", emoji: "🥈", key: "m100k" as const, reward: "rare"      as const },
  { vol: 500_000,    label: "500K", emoji: "🥇", key: "m500k" as const, reward: "epic"      as const },
  { vol: 1_000_000,  label: "1M",   emoji: "💎", key: "m1m"   as const, reward: "legendary" as const },
  { vol: 5_000_000,  label: "5M",   emoji: "👑", key: "m5m"   as const, reward: "legendary" as const },
  { vol: 10_000_000, label: "10M",  emoji: "🚀", key: "m10m"  as const, reward: "legendary" as const },
  { vol: 25_000_000, label: "25M",  emoji: "⚡", key: "m25m"  as const, reward: "legendary" as const },
];

interface Goal {
  /** Ключ подписи в словаре: название цели и награда переводятся. */
  id: keyof Dict["analytics"]["goals"] & string;
  icon: typeof Trophy;
  target: number;
  current: number;
  color: string;
  unlocked: boolean;
}

type AchCategory = "all" | "volume" | "discipline" | "performance" | "deposit" | "special";

interface Achievement {
  /** Ключ подписи в словаре: имя достижения и описание переводятся. */
  id: keyof Dict["analytics"]["achievements"]["items"];
  icon: typeof Trophy;
  earned: boolean;
  rarity: "common" | "rare" | "epic" | "legendary";
  date?: string;
  category: Exclude<AchCategory, "all">;
  xp: number;
}

const RARITY_STYLES = {
  common: { border: "border-[var(--pane-border)]", glow: "", badge: "bg-[var(--pane-hover)]/10 text-[var(--pane-text)]" },
  rare: { border: "border-blue-400/40", glow: "shadow-[0_0_12px_rgba(96,165,250,0.2)]", badge: "bg-blue-400/20 text-blue-400" },
  epic: { border: "border-purple-400/40", glow: "shadow-[0_0_12px_rgba(167,139,250,0.25)]", badge: "bg-purple-400/20 text-purple-400" },
  legendary: { border: "border-accent-gold/40", glow: "shadow-[0_0_16px_rgba(255,215,0,0.25)]", badge: "bg-[var(--pane-gold)]/20 text-[var(--pane-gold)]" },
};

const RARITY_COINS: Record<string, number> = {
  common: 10, rare: 25, epic: 50, legendary: 100,
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

/**
 * Оборот дня.
 *
 * Сперва цифра биржи, следом - журнал терминала. Биржа считает весь счёт, и её
 * число полнее; но добраться до него удаётся не всегда - партнёрская ручка
 * знает только тех, у кого заведён UID, а лента исполнений по ключам приходит
 * без диапазона дат. Пока её нет, показываем то, что провёл терминал: иначе
 * обнуляется всё, что на обороте стоит - дни торговли, стрик и объём месяца.
 */
function dayVolume(day: CalendarDay): number {
  return (day.trade_volume ?? 0) || (day.journal_volume ?? 0);
}

// Сроки, за которые собирается карточка. Порядок - от короткого к длинному:
// им же и пользуются, от «сегодня получилось» к «вот месяц».
const SPANS: Span[] = ["day", "week", "month"];

const ACH_CATEGORIES: { id: AchCategory; icon: React.ElementType }[] = [
  { id: "all",         icon: Trophy        },
  { id: "volume",      icon: BarChart2     },
  { id: "discipline",  icon: CalendarDays  },
  { id: "performance", icon: TrendingUp    },
  { id: "deposit",     icon: Wallet        },
  { id: "special",     icon: Sparkles      },
];

// ─── Ячейка дня ─────────────────────────────────────────────────────────────
function DayCell({ day, onClick, active, isToday }: {
  day: CalendarDay | null;
  onClick?: () => void;
  active: boolean;
  isToday?: boolean;
}) {
  const t = useT();
  const numbers = useIntlLocale();
  if (!day) return <div style={{ aspectRatio: "1" }} />;

  const pnl = day.pnl_pct;
  const isPos = pnl !== null && pnl > 0;
  const isNeg = pnl !== null && pnl < 0;
  const hasReal = pnl !== null;
  const hasTrades = dayVolume(day) > 0;
  const hasDeposit = day.has_deposit === true;
  const goalMet = day.signals > 0 && isPos;

  const intensity = hasReal ? Math.min(Math.abs(pnl!) / 6, 1) : 0;
  let bg = "rgba(255,255,255,0.015)";
  if (isPos) {
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
    ? "border-[var(--pane-border)] shadow-[0_0_8px_rgba(255,255,255,0.06)]"
    : goalMet
    ? "border-[var(--pane-up)]/30 shadow-[0_0_8px_rgba(0,212,160,0.12)]"
    : isPos
    ? "border-success/20"
    : isNeg
    ? "border-danger/20"
    : hasDeposit
    ? "border-[var(--pane-accent-soft)]"
    : day.signals > 0
    ? "border-accent-cyan/10"
    : "border-[var(--pane-border)]";

  return (
    <button
      onClick={onClick}
      style={{ aspectRatio: "1", background: bg }}
      className={`group relative flex flex-col rounded-lg border transition-transform duration-150 hover:scale-[1.06] hover:z-10 ${borderCls} p-1`}
      title={[
        day.date,
        hasDeposit ? t.analytics.calendar.deposit : "",
        hasTrades
          ? t.analytics.calendar.volume(
              dayVolume(day).toLocaleString(numbers, { maximumFractionDigits: 0 })
            )
          : "",
        hasReal ? `PnL ${pnl!.toFixed(2)}%` : "",
      ].filter(Boolean).join(" · ")}
    >
      {/* Число месяца */}
      <span className={`text-[10px] font-bold leading-none ${isToday ? "text-[var(--pane-accent)]" : "text-[var(--pane-text)]/45"}`}>
        {dayNum}
      </span>

      {/* Центр ячейки: PnL если есть, иначе объём/сигналы */}
      <div className="flex flex-1 flex-col items-center justify-center gap-[2px]">
        {hasReal && pnl !== 0 ? (
          <span className="text-[11px] font-extrabold leading-none tracking-tight"
            style={{ color: isPos ? "var(--c-up)" : "var(--c-down)" }}>
            {isPos ? "+" : ""}{Math.abs(pnl!) >= 10 ? pnl!.toFixed(0) : pnl!.toFixed(1)}%
          </span>
        ) : hasReal && pnl === 0 ? (
          <span className="text-[9px] font-semibold text-[var(--pane-text)]/18">0%</span>
        ) : null}
        {/* Объём — показывается всегда когда есть */}
        {hasTrades && (
          <span className="text-[8px] font-bold tabular-nums text-[var(--pane-gold)]/70 leading-none">
            {fmtVolShort(dayVolume(day))}
          </span>
        )}
        {/* Сигналы без объёма */}
        {!hasTrades && !hasReal && day.signals > 0 && (
          <span className="text-[8px] font-semibold text-[var(--pane-accent)]/50 leading-none">
            ⚡{day.signals}
          </span>
        )}
        {/* Депозит без торговли */}
        {!hasTrades && !hasReal && hasDeposit && (
          <span className="text-[8px] font-semibold text-[var(--pane-up)]/60 leading-none">+$</span>
        )}
      </div>

      {/* Точки событий */}
      {(day.signals > 0 || hasTrades || hasDeposit) && (
        <div className="flex justify-center gap-[3px] mt-[2px]">
          {day.signals > 0 && <span className="h-[5px] w-[5px] rounded-full bg-[var(--pane-accent)]" />}
          {hasTrades && <span className="h-[5px] w-[5px] rounded-full bg-[var(--pane-gold)]" />}
          {hasDeposit && <span className="h-[5px] w-[5px] rounded-full bg-[var(--pane-up)]" />}
        </div>
      )}

      {/* Значок выполненной цели */}
      {goalMet && (
        <span className="absolute -right-[3px] -top-[3px] flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--pane-up)] shadow-[0_0_6px_rgba(0,212,160,0.5)] text-[7px] font-bold text-black">✓</span>
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
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(128,128,128,0.25)" strokeWidth={6} />
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
  const t = useT();
  const locale = useLocale();
  const numbers = intlLocale(locale);
  const spanLabel: Record<Span, string> = {
    day: t.analytics.summary.spanDay,
    week: t.analytics.summary.spanWeek,
    month: t.analytics.summary.spanMonth,
  };
  const today = new Date();
  const [analytics, setAnalytics] = useState<AnalyticsMe | null>(null);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<CalendarDay | null>(null);
  const [calData, setCalData] = useState<CalendarDay[]>([]);
  const [loaded, setLoaded] = useState(false);
  // undefined - спрашиваем, null - спросить не вышло, [] - сделок в этот день
  // не было. Три разных случая, и путать их нельзя.
  const [dayTrades, setDayTrades] = useState<JournalTrade[] | null | undefined>(null);
  // Чья карточка открыта. Null - окна нет.
  // Карточкой делятся и одной сделкой, и итогом срока - окно одно, а
  // колонку для него собирают в lib/pnl/data.
  const [card, setCard] = useState<CardData | null>(null);
  /**
   * Что показываем: итоги или награды.
   *
   * Раздел был одной лентой в три экрана: показатели, вехи, календарь, разбор
   * дня, уровень, цели, достижения. Всё это разное - одно про торговлю, другое
   * про игру вокруг неё, - и листалось вперемешку. Две вкладки разводят их и
   * убирают из-под глаз то, чего сейчас не спрашивают.
   */
  const [tab, setTab] = useState<"results" | "rewards">("results");
  const [owner, setOwner] = useState<string | null>(null);
  const [recentDeposits, setRecentDeposits] = useState<DepositRecord[]>([]);
  const [tradeSummary, setTradeSummary] = useState<TradeSummary | null>(null);
  const [currentBalance, setCurrentBalance] = useState<number | null>(null);
  const [achCategory, setAchCategory] = useState<AchCategory>("all");
  const [coinsBalance, setCoinsBalance] = useState<number | null>(null);
  const [coinsSynced, setCoinsSynced] = useState(false);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    api.analyticsMe(token).then(setAnalytics).catch(() => {});
    api.profile(token).then(p => {
      if (p.balance_usdt) setCurrentBalance(parseFloat(p.balance_usdt));
      // Имя владельца - для подписи на карточке сделки: печать заверяет
      // чью-то сделку, а не ничью. Своя подпись важнее ника Telegram: её
      // ученик выбрал сам, а ник переписывается при каждом входе.
      setOwner(p.card_name || p.username || null);
    }).catch(() => {});
    api.tradesMe(token, 90).then(r => {
      setRecentDeposits((r.deposits || []).slice(0, 5));
      setTradeSummary(r.summary);
    }).catch(() => {});
    api.coins(token).then(c => setCoinsBalance(c.balance)).catch(() => {});
  }, []);

  // Sync монет когда все данные загружены (один раз за сессию)
  useEffect(() => {
    const token = getAccessToken();
    if (!token || coinsSynced || !tradeSummary || !loaded) return;

    const totalVol     = tradeSummary.total_volume ?? 0;
    const depTotal     = recentDeposits.reduce((s, d) => s + d.amount, 0);
    const vProfitDays  = calData.filter(d => d.pnl_pct !== null && d.pnl_pct > 0).length;
    const vHotDays     = calData.filter(d => d.pnl_pct !== null && d.pnl_pct > 3).length;
    const vTradingDays = calData.filter(d => dayVolume(d) > 0).length;
    const vEffTrade    = vTradingDays;
    const vGoalDays    = calData.filter(d => d.signals > 0 && d.pnl_pct !== null && d.pnl_pct > 0).length;
    const vMonthVol    = calData.reduce((s, d) => s + dayVolume(d), 0);
    const vStreak      = (() => {
      let s = 0;
      for (let i = calData.length - 1; i >= 0; i--) {
        if (dayVolume(calData[i]) > 0 || calData[i].signals > 0) s++;
        else break;
      }
      return s;
    })();
    const vValidPnl    = calData.filter(d => d.pnl_pct !== null);
    const vAvgProfit   = vValidPnl.length ? vValidPnl.reduce((a, d) => a + (d.pnl_pct ?? 0), 0) / vValidPnl.length : 0;
    const vSuperHot    = calData.some(d => d.pnl_pct !== null && d.pnl_pct >= 5);
    const vEpicDay     = calData.some(d => d.pnl_pct !== null && d.pnl_pct >= 10);

    const volXp      = Math.floor(totalVol / 50_000) * 25;
    const streakXp   = vStreak * 30;
    const goalXp     = vGoalDays * 20;
    const hotXp      = vHotDays * 50;
    const profitXp   = vProfitDays * 15;
    const tradeDayXp = vEffTrade * 10;
    const { level: currentLevel } = getXpLevel(volXp + streakXp + goalXp + hotXp + profitXp + tradeDayXp);

    const vAllGoalsUnlocked = (
      (vMonthVol > 0 ? vMonthVol : totalVol / 3) >= 250_000 &&
      vEffTrade >= 15 &&
      vProfitDays >= 5 &&
      vStreak >= 7 &&
      vHotDays >= 1 &&
      vAvgProfit > 0 && vValidPnl.length >= 5
    );

    const earned: string[] = [];
    if (totalVol >= 10_000)    earned.push("vol_10k");
    if (totalVol >= 50_000)    earned.push("vol_50k");
    if (totalVol >= 100_000)   earned.push("vol_100k");
    if (totalVol >= 500_000)   earned.push("vol_500k");
    if (totalVol >= 1_000_000) earned.push("vol_1m");
    if (totalVol >= 5_000_000) earned.push("vol_5m");
    if (totalVol >= 10_000_000) earned.push("vol_10m");
    if (totalVol >= 25_000_000) earned.push("vol_25m");
    if (vEffTrade >= 1)   earned.push("first_trade");
    if (vStreak >= 3)     earned.push("streak_3");
    if (vStreak >= 7)     earned.push("streak_7");
    if (vStreak >= 14)    earned.push("streak_14");
    if (vStreak >= 30)    earned.push("streak_30");
    if (vEffTrade >= 15)  earned.push("days_15");
    if (vEffTrade >= 20)  earned.push("days_20");
    if (vEffTrade >= 25)  earned.push("days_25");
    if (vProfitDays >= 1) earned.push("first_profit");
    if (vProfitDays >= 5) earned.push("profit_5");
    if (vProfitDays >= 10) earned.push("profit_10");
    if (vHotDays >= 1)    earned.push("hot_day_3");
    if (vSuperHot)        earned.push("hot_day_5");
    if (vEpicDay)         earned.push("hot_day_10");
    if (vAvgProfit > 0 && vValidPnl.length >= 5) earned.push("month_plus");
    if (vGoalDays >= 10)  earned.push("goal_days_10");
    if (recentDeposits.length > 0)   earned.push("dep_first");
    if (depTotal >= 500)  earned.push("dep_500");
    if (depTotal >= 1_000) earned.push("dep_1k");
    if (depTotal >= 5_000) earned.push("dep_5k");
    if (depTotal >= 10_000) earned.push("dep_10k");
    if (recentDeposits.length >= 3)  earned.push("dep_3plus");
    earned.push("joined");
    if (currentLevel >= 5)  earned.push("level_5");
    if (currentLevel >= 10) earned.push("level_10");
    if (currentLevel >= 20) earned.push("level_20");
    if (vAllGoalsUnlocked)  earned.push("all_goals");
    if (vMonthVol >= 250_000) earned.push("vol_250k_mo");

    const reachedMilestones = VOLUME_MILESTONES.filter(m => totalVol >= m.vol).map(m => m.label);

    setCoinsSynced(true);
    api.coinsSync(token, {
      earned_achievement_ids: earned,
      current_level: currentLevel,
      reached_volume_milestones: reachedMilestones,
    }).then(r => {
      setCoinsBalance(r.balance);
      window.dispatchEvent(new CustomEvent(COINS_EVENT, { detail: { balance: r.balance } }));
    }).catch(() => {});
  }, [tradeSummary, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Сделки выбранного дня. Спрашиваем только когда день выбрали: месяц целиком
  // это сотни строк, из которых смотрят одну клетку.
  useEffect(() => {
    if (!selectedDay) {
      setDayTrades(null);
      return;
    }
    let cancelled = false;
    setDayTrades(undefined);
    loadDay(selectedDay.date)
      .then((body) => {
        if (!cancelled) setDayTrades(body?.trades ?? []);
      })
      .catch(() => {
        // Журнал не ответил - показываем день без списка, а не пустой список:
        // «сделок нет» и «не спросили» это разные вещи.
        if (!cancelled) setDayTrades(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDay]);

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
  const profitDays   = calData.filter(d => d.pnl_pct !== null && d.pnl_pct > 0).length;
  const lossDays     = calData.filter(d => d.pnl_pct !== null && d.pnl_pct < 0).length;
  const activeDays   = calData.filter(d => d.signals > 0).length;                        // дни с сигналами
  const tradingDays  = calData.filter(d => dayVolume(d) > 0).length;                     // дни с торговлей
  const monthVolume  = calData.reduce((s, d) => s + dayVolume(d), 0);                    // объём за месяц
  const totalVolume  = tradeSummary?.total_volume ?? 0;
  const goalDays     = calData.filter(d => d.signals > 0 && d.pnl_pct !== null && d.pnl_pct > 0).length;

  // Стрик: последовательные дни С ТОРГОВЛЕЙ (не требует PnL снимков)
  const activityStreak = (() => {
    let s = 0;
    for (let i = calData.length - 1; i >= 0; i--) {
      if (dayVolume(calData[i]) > 0 || calData[i].signals > 0) s++;
      else break;
    }
    return s;
  })();

  const validPnl  = calData.filter(d => d.pnl_pct !== null);
  const avgProfit = validPnl.length
    ? validPnl.reduce((a, d) => a + (d.pnl_pct ?? 0), 0) / validPnl.length : 0;
  const hotDays     = calData.filter(d => d.pnl_pct !== null && d.pnl_pct > 3).length;
  const superHotDay = calData.some(d => d.pnl_pct !== null && d.pnl_pct >= 5);
  const epicDay     = calData.some(d => d.pnl_pct !== null && d.pnl_pct >= 10);
  // Сумма пополнений - из сводки биржи за весь срок. Список рядом обрезан до
  // пяти последних: он для показа, и достижение «Пополнения от 10 000» по нему
  // считало только пять верхних записей. Сводки нет - складываем что есть.
  const depositTotal =
    (tradeSummary?.deposit_total ?? 0) || recentDeposits.reduce((s, d) => s + d.amount, 0);

  // ── Месяц в цифрах ──
  //
  // Всё по журналу сделок, а не по снимкам баланса: журнал знает и объём, и
  // результат каждой закрытой сделки, а снимок - только то, чем день кончился.
  const monthTrades = calData.reduce((sum, d) => sum + (d.journal_trades ?? 0), 0);
  const monthPnl = calData.reduce((sum, d) => sum + (d.journal_pnl ?? 0), 0);
  const volumePerDay = tradingDays > 0 ? monthVolume / tradingDays : 0;

  // ── Счёт и издержки ──
  //
  // Цифры биржи за всё время: обороты по рынкам, комиссия и движение денег.
  // Комиссия в долях от оборота - то единственное, что делает её сравнимой:
  // сотня долларов на миллионе оборота и на десяти тысячах - разные истории.
  const withdrawTotal = tradeSummary?.withdrawal_total ?? 0;
  const commission = tradeSummary?.commission ?? 0;
  const commissionPct = totalVolume > 0 ? (commission / totalVolume) * 100 : 0;

  // Цели месяца — работают даже без PnL снимков
  // Торговый день - тот, в который торговали. Прежде, когда оборот стоял нулём
  // всегда, вместо него подставлялись дни с полученным сигналом: «Настоящий
  // трейдер, 20 торговых дней» выдавался за двадцать дней, в которые ученик
  // ничего не открыл. Оборот теперь считается по журналу, и подмена больше не
  // нужна - она только приписывала работу, которой не было.
  const effectiveTradeDays = tradingDays;
  const goals: Goal[] = [
    {
      id: "volume", icon: BarChart2, target: 250_000,
      current: Math.round(monthVolume > 0 ? monthVolume : totalVolume / 3),
      color: "var(--c-accent)", unlocked: (monthVolume > 0 ? monthVolume : totalVolume / 3) >= 250_000,
    },
    {
      id: "trading_days", icon: Calendar, target: 15,
      current: effectiveTradeDays,
      color: "var(--c-warn)", unlocked: effectiveTradeDays >= 15,
    },
    {
      id: "profit", icon: TrendingUp, target: 5,
      current: profitDays,
      color: "var(--c-up)", unlocked: profitDays >= 5,
    },
    {
      id: "streak", icon: Flame, target: 7,
      current: activityStreak,
      color: "var(--c-warn)", unlocked: activityStreak >= 7,
    },
    {
      id: "hot_day", icon: Star, target: 1,
      current: hotDays,
      color: "var(--c-gold)", unlocked: hotDays >= 1,
    },
    {
      id: "month_profit", icon: TrendingUp, target: 1,
      current: avgProfit > 0 ? 1 : 0,
      color: "var(--c-up)", unlocked: avgProfit > 0 && validPnl.length >= 5,
    },
  ];

  const { level: xpLevel } = getXpLevel(
    Math.floor(totalVolume / 50_000) * 25 +
    activityStreak * 30 + goalDays * 20 + hotDays * 50 + profitDays * 15 + effectiveTradeDays * 10
  );

  const achievements: Achievement[] = [
    // ── Объём ────────────────────────────────────────────────────────────
    { id: "vol_10k",    icon: BarChart2,  earned: totalVolume >= 10_000,    rarity: "common",    category: "volume",      xp: 10  },
    { id: "vol_50k",    icon: BarChart2,  earned: totalVolume >= 50_000,    rarity: "common",    category: "volume",      xp: 25  },
    { id: "vol_100k",  icon: BarChart2,  earned: totalVolume >= 100_000,   rarity: "rare",      category: "volume",      xp: 50  },
    { id: "vol_500k",   icon: BarChart2,  earned: totalVolume >= 500_000,   rarity: "rare",      category: "volume",      xp: 100 },
    { id: "vol_1m", icon: Trophy,     earned: totalVolume >= 1_000_000,  rarity: "epic",      category: "volume",      xp: 200 },
    { id: "vol_5m", icon: Trophy,     earned: totalVolume >= 5_000_000,  rarity: "epic",      category: "volume",      xp: 400 },
    { id: "vol_10m",icon: Star,       earned: totalVolume >= 10_000_000, rarity: "legendary", category: "volume",      xp: 750 },
    { id: "vol_25m",icon: Star,       earned: totalVolume >= 25_000_000, rarity: "legendary", category: "volume",      xp: 1500 },
    // ── Дисциплина ───────────────────────────────────────────────────────
    { id: "first_trade",             icon: Calendar, earned: effectiveTradeDays >= 1,  rarity: "common",    category: "discipline", xp: 10  },
    { id: "streak_3",           icon: Flame,    earned: activityStreak >= 3,      rarity: "common",    category: "discipline", xp: 20  },
    { id: "streak_7",          icon: Flame,    earned: activityStreak >= 7,      rarity: "rare",      category: "discipline", xp: 60  },
    { id: "streak_14",         icon: Flame,    earned: activityStreak >= 14,     rarity: "epic",      category: "discipline", xp: 150 },
    { id: "streak_30",         icon: Trophy,   earned: activityStreak >= 30,     rarity: "legendary", category: "discipline", xp: 500 },
    { id: "days_15",         icon: Calendar, earned: effectiveTradeDays >= 15, rarity: "rare",      category: "discipline", xp: 75  },
    { id: "days_20",        icon: Calendar, earned: effectiveTradeDays >= 20, rarity: "epic",      category: "discipline", xp: 150 },
    { id: "days_25",         icon: Trophy,   earned: effectiveTradeDays >= 25, rarity: "legendary", category: "discipline", xp: 300 },
    // ── Результаты ───────────────────────────────────────────────────────
    { id: "first_profit",            icon: TrendingUp, earned: profitDays >= 1,            rarity: "common",    category: "performance", xp: 15  },
    { id: "profit_5",       icon: TrendingUp, earned: profitDays >= 5,            rarity: "rare",      category: "performance", xp: 60  },
    { id: "profit_10",      icon: TrendingUp, earned: profitDays >= 10,           rarity: "epic",      category: "performance", xp: 200 },
    { id: "hot_day_3",              icon: Star,       earned: hotDays >= 1,               rarity: "rare",      category: "performance", xp: 50  },
    { id: "hot_day_5",              icon: Star,       earned: superHotDay,                rarity: "epic",      category: "performance", xp: 100 },
    { id: "hot_day_10",             icon: Zap,        earned: epicDay,                    rarity: "legendary", category: "performance", xp: 300 },
    { id: "month_plus", icon: TrendingUp, earned: avgProfit > 0 && validPnl.length >= 5, rarity: "epic", category: "performance", xp: 150 },
    { id: "goal_days_10",    icon: Target,     earned: goalDays >= 10,             rarity: "epic",      category: "performance", xp: 175 },
    // ── Депозиты ─────────────────────────────────────────────────────────
    { id: "dep_first",           icon: ArrowDownCircle, earned: recentDeposits.length > 0,    rarity: "common",    category: "deposit", xp: 10  },
    { id: "dep_500",            icon: Coins,          earned: depositTotal >= 500,          rarity: "rare",      category: "deposit", xp: 40  },
    { id: "dep_1k",         icon: Coins,          earned: depositTotal >= 1_000,        rarity: "rare",      category: "deposit", xp: 80  },
    { id: "dep_5k",         icon: Coins,          earned: depositTotal >= 5_000,        rarity: "epic",      category: "deposit", xp: 200 },
    { id: "dep_10k",        icon: Trophy,         earned: depositTotal >= 10_000,       rarity: "legendary", category: "deposit", xp: 500 },
    { id: "dep_3plus",             icon: ArrowDownCircle, earned: recentDeposits.length >= 3,  rarity: "rare",      category: "deposit", xp: 50  },
    // ── Особые ───────────────────────────────────────────────────────────
    { id: "joined",        icon: Gift,   earned: true,                       rarity: "common",    category: "special", xp: 5   },
    { id: "level_5",       icon: Star,   earned: xpLevel >= 5,               rarity: "rare",      category: "special", xp: 0   },
    { id: "level_10",      icon: Trophy, earned: xpLevel >= 10,              rarity: "epic",      category: "special", xp: 0   },
    { id: "level_20",      icon: Trophy, earned: xpLevel >= 20,              rarity: "legendary", category: "special", xp: 0   },
    { id: "all_goals",          icon: Target, earned: goals.every(g => g.unlocked), rarity: "epic",     category: "special", xp: 250 },
    { id: "vol_250k_mo",        icon: BarChart2, earned: (monthVolume > 0 ? monthVolume : 0) >= 250_000, rarity: "epic", category: "special", xp: 200 },
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
  const realDays = calData.filter(d => d.pnl_pct !== null);
  // Опорная дата сроков: выбранный день, а если не выбран - последний день
  // месяца, который вообще есть в календаре. Открытый месяц кончается сегодня,
  // так что для текущего это и будет сегодня.
  const anchor = selectedDay?.date ?? calData[calData.length - 1]?.date ?? "";
  const bestDay = realDays.reduce<CalendarDay | null>((a, b) => (b.pnl_pct! > (a?.pnl_pct ?? -Infinity) ? b : a), null);
  const worstDay = realDays.reduce<CalendarDay | null>((a, b) => (b.pnl_pct! < (a?.pnl_pct ?? Infinity) ? b : a), null);
  const totalPnl = realDays.reduce((s, d) => s + (d.pnl_pct ?? 0), 0);

  return (
    <PaneScope className="space-y-3">
      {/* Шапка раздела: название, строка о нём и оборот - всё одной строкой.
          Прежний заголовок в два сантиметра и подпись под ним занимали столько
          же места, сколько первая панель с данными. */}
      <PaneHead
        title={`${t.analytics.title} ${t.analytics.titleAnd} ${t.analytics.titleTail}`}
        hint={t.analytics.subtitle}
      >
        {(
          [
            ["results", t.analytics.tabs.results, BarChart2],
            ["rewards", t.analytics.tabs.rewards, Trophy],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 ${CHIP} ${tab === key ? CHIP_ON : CHIP_OFF}`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
        {tradeSummary && (
          <span className="flex items-baseline gap-1.5 rounded-lg border border-[var(--pane-gold-soft)] bg-[var(--pane-gold)]/10 px-2 py-1">
            <span className="text-[10px] uppercase tracking-wider text-[var(--pane-muted)]">
              {t.analytics.totalVolume}
            </span>
            <span className="font-mono text-[12px] font-bold tabular-nums text-[var(--pane-gold)]">
              ${fmtDot(Math.round(totalVolume))}
            </span>
          </span>
        )}
      </PaneHead>

      {/* Итоги: чем закончились дни и куда идёт оборот. */}
      {tab === "results" && (
        <>
        {/* Путь трейдера: одна дорожка с вехами оборота.
            Показываем и на нуле: путь с первой вехой впереди говорит, куда
            идти, а пустое место читается как поломка.

            Дорожкой, а не полосой с рядом кружков под ней. Полоса показывала
            путь до ближайшей вехи, кружки - все вехи разом, и связи между ними
            не было: заполненная наполовину полоса стояла над кружком, который
            ещё не взят. Теперь это одна линия, на которой видно и пройденное, и
            где стоишь, и что впереди. */}
        {loaded && (() => {
          const last = VOLUME_MILESTONES.length - 1;
          const nextIdx = VOLUME_MILESTONES.findIndex((m) => totalVolume < m.vol);
          const nextM = nextIdx >= 0 ? VOLUME_MILESTONES[nextIdx] : null;
          const prevM = nextIdx > 0 ? VOLUME_MILESTONES[nextIdx - 1] : null;

          // Между вехами линия заполняется по-своему: вехи стоят на равном
          // расстоянии, а расстояние между ними в деньгах разное - от полусотни
          // тысяч до пятнадцати миллионов. Считаем долю внутри своего отрезка.
          const from = prevM ? prevM.vol : 0;
          const to = nextM ? nextM.vol : VOLUME_MILESTONES[last].vol;
          const inLeg = to > from ? Math.min(1, Math.max(0, (totalVolume - from) / (to - from))) : 1;
          const done = nextIdx === -1 ? last : Math.max(0, nextIdx - 1);
          const at = nextIdx === -1 ? 1 : (done + inLeg) / last;

          return (
            <div className="overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)]">
              <div className="flex items-center gap-2 border-b border-[var(--pane-border)] px-3 pt-2.5 pb-2">
                <BarChart2 className="h-4 w-4 text-[var(--pane-gold)]" />
                <h2 className="text-[12px] font-semibold leading-none text-[var(--pane-text)]">
                  {t.analytics.path.title}
                </h2>
                <span className="text-[10px] text-[var(--pane-muted)]">
                  {t.analytics.path.subtitle}
                </span>
                <span className="ml-auto font-mono text-[13px] font-bold tabular-nums text-[var(--pane-gold)]">
                  ${fmtDot(Math.round(totalVolume))}
                </span>
              </div>

              <div className="px-3 py-3">
                {/* Сама дорожка. Точки стоят по краям своих долей, поэтому
                    первая прижата к левому краю, последняя к правому - линия
                    начинается и кончается вехой, а не воздухом. */}
                <div className="relative h-8">
                  <div className="absolute inset-x-0 top-1.5 h-[3px] rounded-full bg-[var(--pane-hover)]" />
                  <div
                    className="absolute left-0 top-1.5 h-[3px] rounded-full bg-[var(--pane-gold)] transition-[width] duration-700"
                    style={{ width: `${at * 100}%` }}
                  />
                  {VOLUME_MILESTONES.map((m, i) => {
                    const reached = totalVolume >= m.vol;
                    const target = nextIdx === i;
                    return (
                      <div
                        key={m.label}
                        className="absolute top-0 flex -translate-x-1/2 flex-col items-center gap-1"
                        style={{ left: `${(i / last) * 100}%` }}
                        title={t.analytics.milestones[m.key]}
                      >
                        <span
                          className={`h-3 w-3 rounded-full border-2 transition-colors duration-300 ${
                            reached
                              ? "border-[var(--pane-gold)] bg-[var(--pane-gold)]"
                              : target
                                ? "border-[var(--pane-gold)] bg-[var(--pane-bg)]"
                                : "border-[var(--pane-border)] bg-[var(--pane-bg)]"
                          }`}
                        />
                        <span
                          className={`font-mono text-[10px] font-bold ${
                            reached
                              ? "text-[var(--pane-gold)]"
                              : target
                                ? "text-[var(--pane-text-2)]"
                                : "text-[var(--pane-muted)]/50"
                          }`}
                        >
                          {m.label}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Что впереди - одной строкой под дорожкой. */}
                {nextM && (
                  <p className="mt-2 text-[11px] text-[var(--pane-text-2)]">
                    {t.analytics.path.toNext}{" "}
                    <span className="font-bold text-[var(--pane-gold)]">{nextM.label}</span>{" "}
                    {t.analytics.path.left}{" "}
                    <span className="font-mono tabular-nums text-[var(--pane-text)]">
                      ${fmtDot(Math.round(nextM.vol - totalVolume))}
                    </span>
                    <span className="text-[var(--pane-muted)]">
                      {" · "}
                      {t.analytics.path.pctToNext((inLeg * 100).toFixed(1))}
                    </span>
                  </p>
                )}
              </div>
            </div>
          );
        })()}


        {/* Таблица трейдеров пока скрыта.
            Сама она готова - и ручка, и вёрстка, - но объём в ней считается по
            дневным снимкам, а те у ученика с ключами набираются по ленте
            исполнений: у неё нет диапазона дат, и за месяц цифра выходит меньше
            настоящей. Показывать таблицу, по которой будут раздавать награды, с
            заведомо неполным оборотом нельзя. Вернуть её - убрать эту заглушку.
            <TradersTable /> */}

        {/* Календарь и цифры месяца - рядом: слева когда, справа сколько. */}
        <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
          {/* ── Календарь ── */}
          <div className="w-full overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)]">

            {/* Шапка */}
            <div
              className="border-b border-[var(--pane-border)] px-3 pt-3 pb-2"
              style={{ background: "linear-gradient(135deg, var(--pane-accent-faint) 0%, transparent 55%)" }}
            >
              <div className="flex items-center justify-between">
                <button
                  onClick={prevMonth}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--pane-border)] text-[13px] text-[var(--pane-muted)] transition-colors duration-150 hover:text-[var(--pane-text)]"
                >‹</button>
                <div className="text-center">
                  <h2 className="text-[13px] font-semibold text-[var(--pane-text)]">
                    {t.analytics.calendar.months[month]} <span className="text-[var(--pane-muted)] font-medium">{year}</span>
                  </h2>
                </div>
                <button
                  onClick={nextMonth}
                  disabled={year === today.getFullYear() && month === today.getMonth()}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--pane-border)] text-[13px] text-[var(--pane-muted)] transition-colors duration-150 hover:text-[var(--pane-text)] disabled:opacity-25"
                >›</button>
              </div>

              {/* Статспиллы */}
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <span className="flex items-center gap-1 rounded-full bg-[var(--pane-up)]/10 px-3 py-1 text-[11px] font-semibold text-[var(--pane-up)]">
                  {t.analytics.calendar.profitDays(profitDays)}
                </span>
                <span className="flex items-center gap-1 rounded-full bg-[var(--pane-down)]/10 px-3 py-1 text-[11px] font-semibold text-[var(--pane-down)]">
                  {t.analytics.calendar.lossDays(lossDays)}
                </span>
                {tradingDays > 0 && (
                  <span className="flex items-center gap-1 rounded-full bg-[var(--pane-gold)]/10 px-3 py-1 text-[11px] font-semibold text-[var(--pane-gold)]">
                    {t.analytics.calendar.tradeDays(tradingDays)}
                  </span>
                )}
                {activeDays > 0 && (
                  <span className="flex items-center gap-1 rounded-full bg-[var(--pane-accent-faint)] px-3 py-1 text-[11px] font-semibold text-[var(--pane-accent)]">
                    {t.analytics.calendar.signalDays(activeDays)}
                  </span>
                )}
              </div>

              {/* Мини-полоса прогресса профит/лосс */}
              {(profitDays + lossDays) > 0 && (
                <div className="mt-3 overflow-hidden rounded-full bg-[var(--pane-hover)]" style={{ height: 4 }}>
                  <div className="flex h-full">
                    <div className="bg-[var(--pane-up)]/60 transition-all duration-700" style={{ width: `${(profitDays / (profitDays + lossDays)) * 100}%` }} />
                    <div className="bg-[var(--pane-down)]/50 transition-all duration-700" style={{ width: `${(lossDays / (profitDays + lossDays)) * 100}%` }} />
                  </div>
                </div>
              )}
            </div>

            {/* Тело календаря */}
            <div className="p-4">
              {/* Дни недели */}
              <div className="mb-1.5 grid grid-cols-7 gap-1">
                {t.analytics.calendar.weekdays.map(d => (
                  <div key={d} className="py-1 text-center text-[10px] font-bold uppercase tracking-widest text-[var(--pane-text)]/20">{d}</div>
                ))}
              </div>

              {/* Ячейки */}
              <div className="grid grid-cols-7 gap-1">
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
              <div className="mt-4 flex flex-wrap justify-center gap-4 text-[10px] text-[var(--pane-text)]/30">
                <span className="flex items-center gap-1.5"><span className="h-[5px] w-[5px] rounded-full bg-[var(--pane-accent)]" />{t.analytics.calendar.legendSignal}</span>
                <span className="flex items-center gap-1.5"><span className="h-[5px] w-[5px] rounded-full bg-[var(--pane-gold)]" />{t.analytics.calendar.legendTrade}</span>
                <span className="flex items-center gap-1.5"><span className="h-[5px] w-[5px] rounded-full bg-[var(--pane-up)]" />{t.analytics.calendar.legendDeposit}</span>
                <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded-full bg-[var(--pane-up)] text-[7px] font-bold text-black flex items-center justify-center">✓</span>{t.analytics.calendar.legendGoal}</span>
              </div>
            </div>

            {/* Детальная карточка выбранного дня */}
            {selectedDay && (
              <div className="border-t border-[var(--pane-border)] px-3 py-3" style={{ background: "rgba(255,255,255,0.015)" }}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-[var(--pane-text)]">
                      {new Date(selectedDay.date + "T12:00:00").toLocaleDateString(numbers, { weekday: "long", day: "numeric", month: "long" })}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedDay.balance !== null && (
                        <span className="rounded-lg bg-[var(--pane-hover)] px-2.5 py-1 text-[11px] font-semibold text-[var(--pane-text)]">
                          💰 ${fmtDot(selectedDay.balance, 2)}
                        </span>
                      )}
                      {selectedDay.signals > 0 && (
                        <span className="rounded-lg bg-[var(--pane-accent-faint)] px-2.5 py-1 text-[11px] font-semibold text-[var(--pane-accent)]">
                          {t.analytics.calendar.daySignals(selectedDay.signals)}
                        </span>
                      )}
                      {dayVolume(selectedDay) > 0 && (
                        <span className="rounded-lg bg-[var(--pane-gold)]/10 px-2.5 py-1 text-[11px] font-semibold text-[var(--pane-gold)]">
                          {t.analytics.calendar.dayVolume(fmtDot(dayVolume(selectedDay)))}
                        </span>
                      )}
                      {selectedDay.has_deposit && (
                        <span className="rounded-lg bg-[var(--pane-up)]/10 px-2.5 py-1 text-[11px] font-semibold text-[var(--pane-up)]">
                          {t.analytics.calendar.dayDeposit}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {selectedDay.pnl_pct !== null ? (
                      <>
                        <p className={`font-mono text-2xl font-extrabold ${selectedDay.pnl_pct > 0 ? "text-[var(--pane-up)]" : selectedDay.pnl_pct < 0 ? "text-[var(--pane-down)]" : "text-[var(--pane-text)]/40"}`}>
                          {selectedDay.pnl_pct > 0 ? "+" : ""}{selectedDay.pnl_pct.toFixed(2)}%
                        </p>
                        {selectedDay.signals > 0 && selectedDay.pnl_pct > 0 && (
                          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-[var(--pane-up)]/15 px-2 py-0.5 text-[10px] font-bold text-[var(--pane-up)]">{t.analytics.calendar.dayGoal}</span>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-[var(--pane-text)]/20">{t.analytics.calendar.noSnapshot}</p>
                    )}
                  </div>
                </div>

                {/* Сделки этого дня.
                    Календарь отвечает на вопрос «сколько», а список под ним - на
                    вопрос «из чего»: одна клетка в плюс бывает и одной сделкой, и
                    десятью, и это разные дни работы. */}
                {dayTrades === undefined ? (
                  <div className="mt-3 space-y-1.5">
                    {[...Array(2)].map((_, i) => (
                      <div key={i} className="h-7 animate-pulse rounded-lg bg-[var(--pane-hover)]" />
                    ))}
                  </div>
                ) : dayTrades && dayTrades.length > 0 ? (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full whitespace-nowrap text-[11px]">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wider text-[var(--pane-text)]/30">
                          <th className="py-1 text-left font-medium">{t.analytics.trades.time}</th>
                          <th className="py-1 text-left font-medium">{t.analytics.trades.coin}</th>
                          <th className="py-1 text-right font-medium">{t.analytics.trades.entry}</th>
                          <th className="py-1 text-right font-medium">{t.analytics.trades.exit}</th>
                          <th className="py-1 text-right font-medium">{t.analytics.trades.result}</th>
                          <th className="py-1" />
                        </tr>
                      </thead>
                      <tbody className="font-mono tabular-nums">
                        {dayTrades.map((one) => (
                          <tr key={one.id} className="border-t border-[var(--pane-border)]/40">
                            <td className="py-1 text-[var(--pane-text)]/40">
                              {new Date(one.closed_at).toLocaleTimeString(numbers, {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </td>
                            <td className="py-1 font-sans font-semibold text-[var(--pane-text)]">
                              {one.symbol.replace(/USDT$/, "")}
                              <span
                                className={`ml-1.5 text-[10px] font-medium ${
                                  one.side === "long" ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"
                                }`}
                              >
                                {one.side === "long" ? t.analytics.trades.long : t.analytics.trades.short}
                              </span>
                            </td>
                            <td className="py-1 text-right text-[var(--pane-text-2)]">
                              {fmtPrice(one.entry)}
                            </td>
                            <td className="py-1 text-right text-[var(--pane-text-2)]">
                              {one.exit_price === null ? "-" : fmtPrice(one.exit_price)}
                            </td>
                            <td
                              className={`py-1 text-right font-semibold ${
                                one.pnl >= 0 ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"
                              }`}
                            >
                              {one.pnl >= 0 ? "+" : "-"}
                              {Math.abs(one.pnl).toFixed(2)} $
                              {one.fee > 0 && (
                                <span className="ml-1 text-[10px] font-normal text-[var(--pane-text)]/30">
                                  -{one.fee.toFixed(2)}
                                </span>
                              )}
                            </td>
                            {/* Карточка сделки - та же, что в журнале терминала.
                                Здесь она нужна не меньше: аналитику открывают,
                                чтобы посмотреть на свой день, и хорошим днём
                                делятся ровно оттуда, где его увидели. */}
                            <td className="py-1 pl-2 text-right">
                              <button
                                onClick={() => setCard(cardFromTrade(one, owner ?? undefined))}
                                title={t.analytics.trades.cardTitle}
                                className="text-[var(--pane-text)]/30 transition-colors duration-150 ease-out hover:text-[var(--pane-accent)]"
                              >
                                <Share2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : dayTrades && dayTrades.length === 0 ? (
                  <p className="mt-3 text-[11px] text-[var(--pane-text)]/30">
                    {t.analytics.trades.none}
                  </p>
                ) : null}
              </div>
            )}

            {/* Итоги месяца */}
            {realDays.length >= 2 && (
              <div className="border-t border-[var(--pane-border)] px-3 py-2.5">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className={`font-mono text-base font-extrabold ${totalPnl >= 0 ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"}`}>
                      {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(1)}%
                    </p>
                    <p className="text-[10px] text-[var(--pane-text)]/30">{t.analytics.summary.monthResult}</p>
                  </div>
                  <div>
                    <p className="font-mono text-base font-extrabold text-[var(--pane-up)]">
                      {bestDay ? `+${bestDay.pnl_pct!.toFixed(1)}%` : "-"}
                    </p>
                    <p className="text-[10px] text-[var(--pane-text)]/30">{t.analytics.summary.bestDay}</p>
                  </div>
                  <div>
                    <p className="font-mono text-base font-extrabold text-[var(--pane-down)]">
                      {worstDay && worstDay.pnl_pct! < 0 ? `${worstDay.pnl_pct!.toFixed(1)}%` : "-"}
                    </p>
                    <p className="text-[10px] text-[var(--pane-text)]/30">{t.analytics.summary.worstDay}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Карточка за срок.
                Сделкой делятся из строки журнала, а хорошим днём, неделей или
                месяцем делиться было нечем - приходилось слать пять карточек
                подряд. Опорная дата - выбранный день: неделя берётся та, что
                обведена в сетке над кнопками, а не последние семь суток. */}
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--pane-border)] px-3 py-2.5">
              <span className="text-[10px] uppercase tracking-wider text-[var(--pane-text)]/30">
                {t.analytics.summary.cardFor}
              </span>
              {SPANS.map((id) => {
                const ready = periodOf(calData, id, anchor);
                return (
                  <button
                    key={id}
                    disabled={!ready}
                    onClick={() => ready && setCard(cardFromPeriod(ready, owner ?? undefined))}
                    title={
                      ready
                        ? `${ready.title}: ${ready.roi >= 0 ? "+" : ""}${ready.roi.toFixed(2)}%`
                        : t.analytics.summary.nothingToShow
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--pane-border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--pane-text-2)] transition-colors duration-150 ease-out hover:border-[var(--pane-accent-soft)] hover:text-[var(--pane-accent)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-[var(--pane-border)] disabled:hover:text-[var(--pane-text-2)]"
                  >
                    <Share2 className="h-3 w-3" />
                    {spanLabel[id]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Две панели цифр рядом с календарём: календарь отвечает «когда»,
              они - «как и почём». Столбиком справа, а не полосой под ним:
              клетки месяца от лишней ширины растут, а цифры - нет. */}
          <div className="space-y-3">
          <div className="overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)]">
            <div className="flex items-baseline gap-2 border-b border-[var(--pane-border)] px-3 py-2">
              <h2 className="text-[12px] font-semibold text-[var(--pane-text)]">
                {t.analytics.month.title}
              </h2>
              <span className="text-[10px] text-[var(--pane-muted)]">{t.analytics.month.hint}</span>
            </div>
            {monthTrades > 0 || tradingDays > 0 ? (
              <dl className="divide-y divide-[var(--pane-border)]">
                <Metric label={t.analytics.month.trades} value={fmtDot(monthTrades)} />
                <Metric
                  label={t.analytics.month.profitDays}
                  value={`${profitDays}`}
                  note={t.analytics.month.ofTrading(tradingDays)}
                />
                <Metric
                  label={t.analytics.month.result}
                  value={`${monthPnl >= 0 ? "+" : ""}${monthPnl.toFixed(2)} $`}
                  tone={monthPnl >= 0 ? "up" : "down"}
                />
                <Metric
                  label={t.analytics.month.best}
                  value={bestDay ? `+${bestDay.pnl_pct!.toFixed(1)}%` : "-"}
                  tone={bestDay ? "up" : undefined}
                />
                <Metric
                  label={t.analytics.month.worst}
                  value={worstDay ? `${worstDay.pnl_pct!.toFixed(1)}%` : "-"}
                  tone={worstDay && (worstDay.pnl_pct ?? 0) < 0 ? "down" : undefined}
                />
                <Metric label={t.analytics.month.perDay} value={`$${fmtVolShort(volumePerDay)}`} />
              </dl>
            ) : (
              <p className="px-3 py-6 text-center text-[11px] text-[var(--pane-muted)]">
                {t.analytics.month.empty}
              </p>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)]">
            <div className="flex items-baseline gap-2 border-b border-[var(--pane-border)] px-3 py-2">
              <h2 className="text-[12px] font-semibold text-[var(--pane-text)]">
                {t.analytics.account.title}
              </h2>
              <span className="text-[10px] text-[var(--pane-muted)]">
                {t.analytics.account.hint}
              </span>
            </div>
            {tradeSummary ? (
              <dl className="divide-y divide-[var(--pane-border)]">
                <Metric
                  label={t.analytics.account.futures}
                  value={`$${fmtVolShort(tradeSummary.futures_volume)}`}
                />
                <Metric
                  label={t.analytics.account.spot}
                  value={`$${fmtVolShort(tradeSummary.spot_volume)}`}
                />
                <Metric
                  label={t.analytics.account.commission}
                  value={`$${fmtDot(Math.round(commission))}`}
                  note={commission > 0 ? t.analytics.account.ofVolume(commissionPct.toFixed(3)) : undefined}
                />
                <Metric
                  label={t.analytics.account.deposits}
                  value={`$${fmtDot(Math.round(depositTotal))}`}
                />
                <Metric
                  label={t.analytics.account.withdrawals}
                  value={`$${fmtDot(Math.round(withdrawTotal))}`}
                />
                <Metric
                  label={t.analytics.account.net}
                  value={`$${fmtDot(Math.round(depositTotal - withdrawTotal))}`}
                  tone={depositTotal - withdrawTotal >= 0 ? "up" : "down"}
                />
              </dl>
            ) : (
              <p className="px-3 py-6 text-center text-[11px] text-[var(--pane-muted)]">
                {t.analytics.account.empty}
              </p>
            )}
          </div>

          {/* Третья панель: что приходило в сигналах и как часто в них
              заходили. Первые две - про деньги, эта - про участие: сколько
              сигналов пришло, сколько взято, сколько прошло мимо. */}
          <div className="overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)]">
            <div className="flex items-baseline gap-2 border-b border-[var(--pane-border)] px-3 py-2">
              <h2 className="text-[12px] font-semibold text-[var(--pane-text)]">
                {t.analytics.flow.title}
              </h2>
              <span className="text-[10px] text-[var(--pane-muted)]">{t.analytics.flow.hint}</span>
            </div>
            {analytics && analytics.signals_received > 0 ? (
              <dl className="divide-y divide-[var(--pane-border)]">
                <Metric
                  label={t.analytics.flow.received}
                  value={fmtDot(analytics.signals_received)}
                />
                <Metric
                  label={t.analytics.flow.taken}
                  value={fmtDot(analytics.sent)}
                  tone={analytics.sent > 0 ? "up" : undefined}
                />
                <Metric label={t.analytics.flow.skipped} value={fmtDot(analytics.skipped)} />
                <Metric
                  label={t.analytics.flow.failed}
                  value={fmtDot(analytics.failed)}
                  tone={analytics.failed > 0 ? "down" : undefined}
                />
                <Metric
                  label={t.analytics.flow.activeDays}
                  value={String(activeDays)}
                  note={t.analytics.flow.goalDays + ": " + goalDays}
                />
              </dl>
            ) : (
              <p className="px-3 py-6 text-center text-[11px] text-[var(--pane-muted)]">
                {t.analytics.flow.empty}
              </p>
            )}
          </div>
          </div>
        </div>

        {/* Показатели месяца - одной строкой.
            Были четыре карточки с кольцами по семьдесят точек: они занимали
            высоту панели, а говорили по одному числу каждая. Теперь число,
            подпись и тонкая полоска до цели - полоска и есть то самое кольцо,
            только не отнимающее экран. */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi
            label={t.analytics.kpi.monthVolume}
            value={fmtVolShort(monthVolume > 0 ? monthVolume : totalVolume / 3)}
            note={t.analytics.kpi.monthVolumeGoal}
            pct={Math.min(((monthVolume > 0 ? monthVolume : totalVolume / 3) / 250_000) * 100, 100)}
            color="var(--pane-accent)"
          />
          <Kpi
            label={t.analytics.kpi.streak}
            value={String(activityStreak)}
            note={t.analytics.kpi.streakGoal}
            pct={Math.min((activityStreak / 7) * 100, 100)}
            color="var(--c-warn)"
            icon={<Flame className="h-3.5 w-3.5 text-orange-400" />}
          />
          <Kpi
            label={t.analytics.kpi.avgDaily}
            value={`${avgProfit >= 0 ? "+" : ""}${avgProfit.toFixed(2)}%`}
            note={t.analytics.kpi.overDays(validPnl.length)}
            pct={Math.min((Math.abs(avgProfit) / 5) * 100, 100)}
            color={avgProfit >= 0 ? "var(--pane-up)" : "var(--pane-down)"}
            tone={avgProfit >= 0 ? "up" : "down"}
          />
          <Kpi
            label={t.analytics.kpi.tradingDays}
            value={String(tradingDays)}
            note={t.analytics.kpi.tradingDaysGoal}
            pct={Math.min((tradingDays / 15) * 100, 100)}
            color="var(--pane-gold)"
            icon={<Calendar className="h-3.5 w-3.5 text-[var(--pane-gold)]" />}
          />
        </div>

        </>
      )}

      {/* Награды: уровень, цели и достижения - одной группой. */}
      {tab === "rewards" && (
        <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
          {/* Уровень и цели месяца - одним столбцом. */}
          <div className="space-y-3">
            {(() => {
              const volXp      = Math.floor(totalVolume / 50_000) * 25;
              const streakXp   = activityStreak * 30;
              const goalXp     = goalDays * 20;
              const hotXp      = hotDays * 50;
              const profitXp   = profitDays * 15;
              const tradeDayXp = effectiveTradeDays * 10;
              const xp = volXp + streakXp + goalXp + hotXp + profitXp + tradeDayXp;
              const { level, xpInLevel, xpNeeded } = getXpLevel(xp);
              const pct = Math.min(100, (xpInLevel / xpNeeded) * 100);
              const levelTitles = t.analytics.level.titles;
              const levelTitle = Object.entries(levelTitles).reverse().find(([l]) => level >= +l)?.[1] ?? levelTitles[1];
              const xpSources = t.analytics.level.sources;
              const breakdown = [
                { icon: BarChart2,    label: xpSources.volume,  val: volXp,      color: "text-[var(--pane-accent)]", bg: "bg-[var(--pane-accent-faint)]" },
                { icon: Flame,        label: xpSources.streak,  val: streakXp,   color: "text-orange-400",  bg: "bg-orange-400/10" },
                { icon: Zap,          label: xpSources.hotDays, val: hotXp,      color: "text-[var(--pane-gold)]", bg: "bg-[var(--pane-gold)]/10" },
                { icon: TrendingUp,   label: xpSources.profit,  val: profitXp,   color: "text-[var(--pane-up)]",     bg: "bg-[var(--pane-up)]/10" },
                { icon: CalendarDays, label: xpSources.days,    val: tradeDayXp, color: "text-blue-400",    bg: "bg-blue-400/10" },
                { icon: Target,       label: xpSources.goals,   val: goalXp,     color: "text-purple-400",  bg: "bg-purple-400/10" },
              ];
              return (
                <div className="relative overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] p-3">
                  {/* Заголовок */}
                  <div className="relative flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--pane-gold)]/15 text-[var(--pane-gold)]">
                        <Star className="h-4 w-4" />
                      </div>
                      <h2 className="text-[12px] font-semibold text-[var(--pane-text)]">{t.analytics.level.title}</h2>
                    </div>
                    {coinsBalance !== null && (
                      <div className="flex items-center gap-1.5 rounded-full border border-[var(--pane-gold-soft)] bg-[var(--pane-gold)]/10 px-2.5 py-1">
                        <Coins className="h-3.5 w-3.5 text-[var(--pane-gold)]" />
                        <span className="font-mono text-sm font-extrabold text-[var(--pane-gold)]">{coinsBalance.toLocaleString(numbers)}</span>
                        <span className="text-[9px] font-bold text-[var(--pane-gold)]/50">NMNH</span>
                      </div>
                    )}
                  </div>

                  {/* Уровень */}
                  <div className="relative mt-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-14 w-14 flex-col items-center justify-center rounded-xl border border-[var(--pane-gold-soft)] bg-[var(--pane-gold)]/12">
                        <span className="text-[8px] font-bold uppercase tracking-wider text-[var(--pane-gold)]/60 leading-none">{t.analytics.level.short}</span>
                        <span className="font-mono text-2xl font-black text-[var(--pane-gold)] leading-none">{level}</span>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-[var(--pane-text)]">{levelTitle}</p>
                        <p className="mt-0.5 text-[11px] text-[var(--pane-text)]/40">{t.analytics.level.toNext(Math.max(0, xpNeeded - xpInLevel).toLocaleString(numbers), level + 1)}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-mono text-2xl font-extrabold leading-none text-[var(--pane-text)]">{xp.toLocaleString(numbers)}</span>
                      <p className="mt-1 text-[9px] font-bold uppercase tracking-wider text-[var(--pane-text)]/30">{t.analytics.level.totalXp}</p>
                    </div>
                  </div>

                  {/* Прогресс */}
                  <div className="relative mt-4 h-2.5 overflow-hidden rounded-full bg-[var(--pane-hover)]">
                    <div
                      className="h-full rounded-full shadow-[0_0_10px_rgba(255,200,0,0.5)] transition-all duration-700"
                      style={{ width: `${pct}%`, background: "linear-gradient(90deg, var(--c-warn), var(--c-warn-soft))" }}
                    />
                  </div>
                  <p className="relative mt-1.5 text-right text-[10px] text-[var(--pane-text)]/30">{xpInLevel.toLocaleString(numbers)} / {xpNeeded.toLocaleString(numbers)} XP</p>

                  {/* Разбивка XP */}
                  <div className="relative mt-4 grid grid-cols-2 gap-2">
                    {breakdown.map(({ icon: Icon, label, val, color, bg }) => (
                      <div key={label} className="flex items-center gap-2 rounded-xl border border-[var(--pane-border)] bg-[var(--pane-hover)] px-2.5 py-2">
                        <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${bg} ${color}`}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <span className="flex-1 truncate text-[11px] text-[var(--pane-muted)]">{label}</span>
                        <span className={`font-mono text-[11px] font-bold ${val > 0 ? "text-[var(--pane-text)]" : "text-[var(--pane-text)]/25"}`}>+{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div className="rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-[var(--pane-accent)]" />
                <h2 className="text-[12px] font-semibold text-[var(--pane-text)]">{t.analytics.goalsTitle}</h2>
              </div>

              {goals.map((goal) => {
                const Icon = goal.icon;
                const pct = Math.min((goal.current / goal.target) * 100, 100);
                return (
                  <div key={goal.id} className={`rounded-xl border px-3 py-2.5 transition ${goal.unlocked ? "border-success/25 bg-[var(--pane-up)]/[0.04]" : "border-[var(--pane-border)] bg-[var(--pane-hover)]"}`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: goal.color }} />
                      <span className="text-[11px] font-semibold text-[var(--pane-text)] flex-1 min-w-0 truncate">{t.analytics.goals[goal.id].label}</span>
                      {goal.unlocked
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-[var(--pane-up)] shrink-0" />
                        : <span className="font-mono text-[10px] text-[var(--pane-text)]/30 shrink-0">{goal.current}/{goal.target}</span>
                      }
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-[var(--pane-bg)]">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: goal.color }} />
                    </div>
                    {goal.unlocked && (
                      <p className="mt-1 text-[9px] text-[var(--pane-up)]/70 truncate">{t.analytics.goals[goal.id].reward}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        {/* Достижения */}
        <div className="rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-[var(--pane-gold)]" />
              <h2 className="text-[12px] font-semibold text-[var(--pane-text)]">{t.analytics.achievements.title}</h2>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-[var(--pane-gold)] font-bold">{achievements.filter(a => a.earned).length}/{achievements.length}</span>
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--pane-bg)]">
                <div className="h-full rounded-full bg-[var(--pane-gold)] transition-all duration-700"
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
                  className={`shrink-0 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${achCategory === cat.id ? "border-accent-gold/50 bg-[var(--pane-gold)]/10 text-[var(--pane-gold)]" : "border-[var(--pane-border)] bg-[var(--pane-hover)] text-[var(--pane-text)]/40 hover:text-[var(--pane-text)]/70"}`}>
                  <cat.icon className="h-3 w-3 shrink-0" />
                  <span>{t.analytics.achievements.categories[cat.id]}</span>
                  <span className={`font-mono text-[9px] ${achCategory === cat.id ? "text-[var(--pane-gold)]/60" : "text-[var(--pane-text)]/20"}`}>{count}/{total}</span>
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
                        <Icon className="h-5 w-5 text-[var(--pane-text)]" />
                      ) : (
                        <Lock className="h-4 w-4 text-[var(--pane-muted)]" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-[var(--pane-text)]">{t.analytics.achievements.items[ach.id].title}</h3>
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${r.badge}`}>
                          {t.analytics.rarity[ach.rarity]}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-[var(--pane-muted)]">{t.analytics.achievements.items[ach.id].desc}</p>
                      <div className="mt-1.5 flex items-center gap-1">
                        <Coins className="h-3 w-3 text-[var(--pane-gold)]/70" />
                        <span className="font-mono text-[10px] font-bold text-[var(--pane-gold)]/80">
                          {ach.earned ? "" : "+"}{RARITY_COINS[ach.rarity]} NMNH
                        </span>
                      </div>
                    </div>
                  </div>
                  {ach.earned && (
                    <div className="absolute right-0 top-0 h-12 w-12 overflow-hidden">
                      <div className="absolute right-0 top-0 h-12 w-12 -translate-y-6 translate-x-6 rotate-45 bg-[var(--pane-up)]/20" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        </div>
      )}

      {/* Карточка сделки. Палитру панелей ей приносит общая обёртка страницы -
          своей больше не нужно. */}
      {card && <PnlCard data={card} onClose={() => setCard(null)} />}
    </PaneScope>
  );
}

/**
 * Строка цифры: подпись слева, значение справа.
 *
 * Одной строкой на всю ширину панели, а не карточкой: цифры читают колонкой
 * сверху вниз и сравнивают между собой, а карточки заставляют искать каждую
 * заново.
 */
function Metric({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  /** Пояснение под значением: от чего оно считается. */
  note?: string;
  tone?: "up" | "down";
}) {
  const color =
    tone === "up"
      ? "text-[var(--pane-up)]"
      : tone === "down"
        ? "text-[var(--pane-down)]"
        : "text-[var(--pane-text)]";
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2">
      <dt className="text-[11px] text-[var(--pane-text-2)]">{label}</dt>
      <dd className="text-right">
        <span className={`font-mono text-[12px] font-bold tabular-nums ${color}`}>{value}</span>
        {note && <span className="ml-1.5 text-[10px] text-[var(--pane-muted)]">{note}</span>}
      </dd>
    </div>
  );
}

/**
 * Показатель месяца: число, подпись и полоска до цели.
 *
 * Полоска вместо кольца. Кольцо в семьдесят точек занимало высоту целой
 * панели ради одного числа внутри себя, а сказать ему нужно ровно то же:
 * сколько набрано и сколько до цели.
 */
function Kpi({
  label,
  value,
  note,
  pct,
  color,
  icon,
  tone,
}: {
  label: string;
  value: string;
  /** Строка под подписью: цель или срок, за который считали. */
  note: string;
  pct: number;
  color: string;
  icon?: React.ReactNode;
  tone?: "up" | "down";
}) {
  const ink =
    tone === "up"
      ? "text-[var(--pane-up)]"
      : tone === "down"
        ? "text-[var(--pane-down)]"
        : "text-[var(--pane-text)]";
  return (
    <div className="rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] px-3 py-2">
      <div className="flex items-baseline gap-1.5">
        {icon}
        <span className={`font-mono text-[15px] font-bold tabular-nums ${ink}`}>{value}</span>
      </div>
      <div className="mt-0.5 truncate text-[11px] text-[var(--pane-text-2)]">{label}</div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--pane-hover)]">
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }}
        />
      </div>
      <div className="mt-1 truncate text-[10px] text-[var(--pane-muted)]">{note}</div>
    </div>
  );
}

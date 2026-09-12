"use client";
// v8
import { intlLocale, useIntlLocale, useLocale, useT } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { useTerminalTheme } from "@/lib/terminalTheme";
import Link from "next/link";
import { api, API_URL, AnalyticsMe, CalendarDay, DepositRecord, TradeSummary, CoinsBalance } from "@/lib/api";
import { loadDay, type JournalTrade } from "@/lib/journal";
import PnlCard from "@/components/scalping/PnlCard";
// Цены показываем тем же форматом, что и на самой карточке: цена выхода -
// средняя по частям закрытия, и без округления она приезжает с десятком
// знаков после точки.
import { price as fmtPrice, type CardData } from "@/lib/pnl/card";
import { cardFromPeriod, cardFromTrade } from "@/lib/pnl/data";
import { periodOf, type Span } from "@/lib/pnl/period";
import { PaneHead, PaneScope } from "@/components/app/Pane";
import { getAccessToken } from "@/lib/auth";
import { COINS_EVENT } from "@/lib/useCoins";
import CertificatesPanel from "@/components/cert/CertificatesPanel";
import Motto from "@/components/app/Motto";
import LevelPanel, { type XpPart } from "@/components/analytics/LevelPanel";
import GoalsPanel from "@/components/analytics/GoalsPanel";
import AchievementsPanel from "@/components/analytics/AchievementsPanel";
import type { Achievement, Goal } from "@/lib/analytics/rewards";
import { X, Trophy, Calendar, BarChart2, Share2 } from "lucide-react";

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

/**
 * Высота клетки календаря - от числа рядов в месяце.
 *
 * Не одно число на все случаи. Квадратные клетки растягивали полный месяц на
 * девять сотен точек, а жёсткие сорок восемь стягивали неполный: в начале
 * сентября рядов два, и панель наполовину стояла пустой при мелких клетках.
 *
 * Поэтому делим отведённую сетке высоту на ряды: два ряда - клетки крупные и
 * поле заполнено, шесть - клетки мельче, но всё те же три строки внутри
 * читаются. Границы держат обе крайности в разумном: ниже сорока четырёх
 * строки начинают наезжать, выше девяноста шести клетка превращается в плитку
 * с цифрой посередине пустоты.
 */
//
// Это нижняя граница ряда, а не его высота. Сверх неё ряды делят всё, что
// осталось в панели: колонка цифр справа выше календаря, и клетки с жёсткой
// высотой оставляли под кнопками карточки пустое поле. Теперь сетка
// растягивается до низа панели, а число здесь держит её на узком экране, где
// соседней колонки нет и растягиваться не до чего.
const GRID_H = 300;
const CELL_MIN = 44;
const CELL_MAX = 96;

function cellHeight(rows: number): number {
  if (rows <= 0) return CELL_MIN;
  return Math.round(Math.max(CELL_MIN, Math.min(CELL_MAX, GRID_H / rows)));
}

// ─── Ячейка дня ─────────────────────────────────────────────────────────────
function DayCell({ day, onClick, active, isToday, best }: {
  day: CalendarDay | null;
  onClick?: () => void;
  active: boolean;
  isToday?: boolean;
  /** Лучший день месяца: на нём стоит звезда. */
  best?: boolean;
}) {
  const t = useT();
  const numbers = useIntlLocale();
  // Звезда двух цветов: чёрная на белом листе, зелёная на тёмном. Один рисунок
  // на оба не годится - чёрная звезда на тёмной клетке пропадает.
  const paper = useTerminalTheme();
  // Высоту клетке задаёт ряд сетки: она заполняет его целиком.
  if (!day) return <div />;

  const pnl = day.pnl_pct;
  const isPos = pnl !== null && pnl > 0;
  const isNeg = pnl !== null && pnl < 0;
  const hasReal = pnl !== null;
  const hasTrades = dayVolume(day) > 0;
  const hasDeposit = day.has_deposit === true;
  const goalMet = day.signals > 0 && isPos;
  // Сколько сделок закрыто за день. Процент говорит, как сходили, а это -
  // сколько раз: +2% одной сделкой и +2% после двенадцати заходов означают
  // совершенно разные дни, и по одной клетке их было не различить.
  const dayTrades = day.journal_trades ?? 0;

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
    ? "border-[color:color-mix(in_srgb,var(--pane-up)_30%,transparent)] shadow-[0_0_8px_rgba(0,212,160,0.12)]"
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
      style={{ background: bg }}
      className={`group relative flex h-full min-h-0 flex-col rounded-lg border transition-transform duration-150 hover:scale-[1.06] hover:z-10 ${borderCls} p-1`}
      title={[
        day.date,
        hasDeposit ? t.analytics.calendar.deposit : "",
        hasTrades
          ? t.analytics.calendar.volume(
              dayVolume(day).toLocaleString(numbers, { maximumFractionDigits: 0 })
            )
          : "",
        hasReal ? `PnL ${pnl!.toFixed(2)}%` : "",
        dayTrades > 0 ? t.analytics.calendar.dayTrades(dayTrades) : "",
      ].filter(Boolean).join(" · ")}
    >
      {/* Число месяца */}
      <span className="flex items-baseline justify-between gap-1 leading-none">
        <span className={`text-[10px] font-bold ${isToday ? "text-[var(--pane-accent)]" : "text-[color:color-mix(in_srgb,var(--pane-text)_45%,transparent)]"}`}>
          {dayNum}
        </span>
        {dayTrades > 0 && (
          <span className="text-[8px] font-bold tabular-nums text-[color:color-mix(in_srgb,var(--pane-text)_35%,transparent)]">
            ×{dayTrades}
          </span>
        )}
      </span>

      {/* Центр ячейки: PnL если есть, иначе объём/сигналы */}
      <div className="flex flex-1 flex-col items-center justify-center gap-[2px]">
        {hasReal && pnl !== 0 ? (
          <span className="text-[11px] font-extrabold leading-none tracking-tight"
            style={{ color: isPos ? "var(--c-up)" : "var(--c-down)" }}>
            {isPos ? "+" : ""}{Math.abs(pnl!) >= 10 ? pnl!.toFixed(0) : pnl!.toFixed(1)}%
          </span>
        ) : hasReal && pnl === 0 ? (
          <span className="text-[9px] font-semibold text-[color:color-mix(in_srgb,var(--pane-text)_18%,transparent)]">0%</span>
        ) : null}
        {/* Объём — показывается всегда когда есть */}
        {hasTrades && (
          <span className="text-[8px] font-bold tabular-nums text-[color:color-mix(in_srgb,var(--pane-gold)_70%,transparent)] leading-none">
            {fmtVolShort(dayVolume(day))}
          </span>
        )}
        {/* Сигналы без объёма */}
        {!hasTrades && !hasReal && day.signals > 0 && (
          <span className="text-[8px] font-semibold text-[color:color-mix(in_srgb,var(--pane-accent)_50%,transparent)] leading-none">
            ⚡{day.signals}
          </span>
        )}
        {/* Депозит без торговли */}
        {!hasTrades && !hasReal && hasDeposit && (
          <span className="text-[8px] font-semibold text-[color:color-mix(in_srgb,var(--pane-up)_60%,transparent)] leading-none">+$</span>
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

      {/* Звезда лучшего дня месяца. Рисунком, а не значком из набора: это
          награда, и выглядеть она должна нарисованной от руки, как оттиск на
          карточке. Стоит на месте галочки цели - две отметки в одном углу
          спорили бы, а лучший день цель выполнил и так. */}
      {best && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={paper === "light" ? "/marks/star.png" : "/marks/star-green.png"}
          alt=""
          className="pointer-events-none absolute -right-1.5 -top-1.5 h-4 w-4"
        />
      )}

      {/* Значок выполненной цели */}
      {!best && goalMet && (
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
  const [coinsBalance, setCoinsBalance] = useState<number | null>(null);
  // Кто владелец: аватар и рамка - для панели уровня.
  const [me, setMe] = useState<{ avatar: string | null; frame: string | null; name: string } | null>(null);
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
      setMe({
        avatar: p.avatar_url ? `${API_URL}${p.avatar_url}` : null,
        frame: p.avatar_frame ?? null,
        name: p.card_name || p.username || "",
      });
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
      // Новые достижения встали в ожидание: пусть шапка перечитает монеты
      // целиком и скажет о наградах. Без новых хватит самого числа.
      window.dispatchEvent(new CustomEvent(COINS_EVENT, { detail: r.added > 0 ? {} : { balance: r.balance } }));
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
      id: "volume", target: 250_000,
      current: Math.round(monthVolume > 0 ? monthVolume : totalVolume / 3),
      color: "var(--c-accent)", unlocked: (monthVolume > 0 ? monthVolume : totalVolume / 3) >= 250_000,
    },
    {
      id: "trading_days", target: 15,
      current: effectiveTradeDays,
      color: "var(--c-warn)", unlocked: effectiveTradeDays >= 15,
    },
    {
      id: "profit", target: 5,
      current: profitDays,
      color: "var(--c-up)", unlocked: profitDays >= 5,
    },
    {
      id: "streak", target: 7,
      current: activityStreak,
      color: "var(--c-warn)", unlocked: activityStreak >= 7,
    },
    {
      id: "hot_day", target: 1,
      current: hotDays,
      color: "var(--c-gold)", unlocked: hotDays >= 1,
    },
    {
      id: "month_profit", target: 1,
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
    { id: "vol_10k",    earned: totalVolume >= 10_000,    rarity: "common",    category: "volume",      xp: 10  },
    { id: "vol_50k",    earned: totalVolume >= 50_000,    rarity: "common",    category: "volume",      xp: 25  },
    { id: "vol_100k",  earned: totalVolume >= 100_000,   rarity: "rare",      category: "volume",      xp: 50  },
    { id: "vol_500k",   earned: totalVolume >= 500_000,   rarity: "rare",      category: "volume",      xp: 100 },
    { id: "vol_1m", earned: totalVolume >= 1_000_000,  rarity: "epic",      category: "volume",      xp: 200 },
    { id: "vol_5m", earned: totalVolume >= 5_000_000,  rarity: "epic",      category: "volume",      xp: 400 },
    { id: "vol_10m",earned: totalVolume >= 10_000_000, rarity: "legendary", category: "volume",      xp: 750 },
    { id: "vol_25m",earned: totalVolume >= 25_000_000, rarity: "legendary", category: "volume",      xp: 1500 },
    // ── Дисциплина ───────────────────────────────────────────────────────
    { id: "first_trade",             earned: effectiveTradeDays >= 1,  rarity: "common",    category: "discipline", xp: 10  },
    { id: "streak_3",           earned: activityStreak >= 3,      rarity: "common",    category: "discipline", xp: 20  },
    { id: "streak_7",          earned: activityStreak >= 7,      rarity: "rare",      category: "discipline", xp: 60  },
    { id: "streak_14",         earned: activityStreak >= 14,     rarity: "epic",      category: "discipline", xp: 150 },
    { id: "streak_30",         earned: activityStreak >= 30,     rarity: "legendary", category: "discipline", xp: 500 },
    { id: "days_15",         earned: effectiveTradeDays >= 15, rarity: "rare",      category: "discipline", xp: 75  },
    { id: "days_20",        earned: effectiveTradeDays >= 20, rarity: "epic",      category: "discipline", xp: 150 },
    { id: "days_25",         earned: effectiveTradeDays >= 25, rarity: "legendary", category: "discipline", xp: 300 },
    // ── Результаты ───────────────────────────────────────────────────────
    { id: "first_profit",            earned: profitDays >= 1,            rarity: "common",    category: "performance", xp: 15  },
    { id: "profit_5",       earned: profitDays >= 5,            rarity: "rare",      category: "performance", xp: 60  },
    { id: "profit_10",      earned: profitDays >= 10,           rarity: "epic",      category: "performance", xp: 200 },
    { id: "hot_day_3",              earned: hotDays >= 1,               rarity: "rare",      category: "performance", xp: 50  },
    { id: "hot_day_5",              earned: superHotDay,                rarity: "epic",      category: "performance", xp: 100 },
    { id: "hot_day_10",             earned: epicDay,                    rarity: "legendary", category: "performance", xp: 300 },
    { id: "month_plus", earned: avgProfit > 0 && validPnl.length >= 5, rarity: "epic", category: "performance", xp: 150 },
    { id: "goal_days_10",    earned: goalDays >= 10,             rarity: "epic",      category: "performance", xp: 175 },
    // ── Депозиты ─────────────────────────────────────────────────────────
    { id: "dep_first",           earned: recentDeposits.length > 0,    rarity: "common",    category: "deposit", xp: 10  },
    { id: "dep_500",            earned: depositTotal >= 500,          rarity: "rare",      category: "deposit", xp: 40  },
    { id: "dep_1k",         earned: depositTotal >= 1_000,        rarity: "rare",      category: "deposit", xp: 80  },
    { id: "dep_5k",         earned: depositTotal >= 5_000,        rarity: "epic",      category: "deposit", xp: 200 },
    { id: "dep_10k",        earned: depositTotal >= 10_000,       rarity: "legendary", category: "deposit", xp: 500 },
    { id: "dep_3plus",             earned: recentDeposits.length >= 3,  rarity: "rare",      category: "deposit", xp: 50  },
    // ── Особые ───────────────────────────────────────────────────────────
    { id: "joined",        earned: true,                       rarity: "common",    category: "special", xp: 5   },
    { id: "level_5",       earned: xpLevel >= 5,               rarity: "rare",      category: "special", xp: 0   },
    { id: "level_10",      earned: xpLevel >= 10,              rarity: "epic",      category: "special", xp: 0   },
    { id: "level_20",      earned: xpLevel >= 20,              rarity: "legendary", category: "special", xp: 0   },
    { id: "all_goals",          earned: goals.every(g => g.unlocked), rarity: "epic",     category: "special", xp: 250 },
    { id: "vol_250k_mo",        earned: (monthVolume > 0 ? monthVolume : 0) >= 250_000, rarity: "epic", category: "special", xp: 200 },
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
      {/* Шапка раздела: название, строка о нём и вкладки сразу за ними - так
          же, как в маркете. Оборот отсюда ушёл в «Путь трейдера»: там он и так
          написан, и в шапке стоял вторым экземпляром. */}
      <PaneHead
        title={`${t.analytics.title} ${t.analytics.titleAnd} ${t.analytics.titleTail}`}
        hint={t.analytics.subtitle}
        hintBelow
        nav={
          <div className="flex gap-1.5">
            {(
              [
                ["results", t.analytics.tabs.results, BarChart2],
                ["rewards", t.analytics.tabs.rewards, Trophy],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors duration-150 ease-out ${
                  tab === key
                    ? "border-accent-gold/50 bg-accent-gold/10 text-[var(--pane-gold)]"
                    : "border-[var(--pane-border)] bg-[var(--pane-bg)] text-[var(--pane-muted)] hover:text-[var(--pane-text)]"
                }`}
              >
                <Icon className="h-3 w-3 shrink-0" />
                {label}
              </button>
            ))}
          </div>
        }
      />

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
              <div className="min-w-0">
              <div className="flex items-center gap-2 border-b border-[var(--pane-border)] px-3 pt-2.5 pb-2">
                <BarChart2 className="h-4 w-4 text-[var(--pane-gold)]" />
                <h2 className="text-[12px] font-semibold leading-none text-[var(--pane-text)]">
                  {t.analytics.path.title}
                </h2>
                <span className="text-[10px] text-[var(--pane-muted)]">
                  {t.analytics.path.subtitle}
                </span>
                <span className="ml-auto flex items-baseline gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-[var(--pane-muted)]">
                    {t.analytics.totalVolume}
                  </span>
                  <span className="font-mono text-[13px] font-bold tabular-nums text-[var(--pane-gold)]">
                    ${fmtDot(Math.round(totalVolume))}
                  </span>
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
                                : "text-[color:color-mix(in_srgb,var(--pane-muted)_50%,transparent)]"
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
        {/* Колонки кончаются на одной линии: календарь слева, цифры справа.
            Пока они висели каждая своей высоты, низ страницы выглядел
            обрезанным - одна панель кончалась, а вторая продолжалась в
            пустоту. */}
        <div className="grid gap-3 xl:grid-cols-2">
          {/* ── Календарь ── */}
          <div className="flex w-full flex-col overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)]">

            {/* Шапка */}
            {/* Название и итоги дней слева, бык с медведем и девиз справа.
                Картинка только на широком экране: на узком она отнимала бы
                место у итогов. */}
            <div
              className="flex items-center gap-3 border-b border-[var(--pane-border)] px-3 py-2.5"
              style={{ background: "linear-gradient(135deg, var(--pane-accent-faint) 0%, transparent 55%)" }}
            >
                <button
                  onClick={prevMonth}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--pane-border)] text-[13px] text-[var(--pane-muted)] transition-colors duration-150 hover:text-[var(--pane-text)]"
                >‹</button>
              <div className="min-w-0 flex-1">
                <h2 className="flex items-center gap-1.5 text-[14px] font-semibold text-[var(--pane-text)]">
                  <Calendar className="h-4 w-4 text-[var(--pane-muted)]" />
                  {t.analytics.calendar.months[month]} <span className="text-[var(--pane-muted)] font-medium">{year}</span>
                </h2>

              {/* Статспиллы */}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="flex items-center gap-1 rounded-full bg-[color:color-mix(in_srgb,var(--pane-up)_10%,transparent)] px-3 py-1 text-[11px] font-semibold text-[var(--pane-up)]">
                  {t.analytics.calendar.profitDays(profitDays)}
                </span>
                <span className="flex items-center gap-1 rounded-full bg-[color:color-mix(in_srgb,var(--pane-down)_10%,transparent)] px-3 py-1 text-[11px] font-semibold text-[var(--pane-down)]">
                  {t.analytics.calendar.lossDays(lossDays)}
                </span>
                {/* Сделки месяца - закрытые по журналу, а не дни с торговлей. */}
                {monthTrades > 0 && (
                  <span className="flex items-center gap-1 rounded-full bg-[color:color-mix(in_srgb,var(--pane-gold)_10%,transparent)] px-3 py-1 text-[11px] font-semibold text-[var(--pane-gold)]">
                    {t.analytics.calendar.monthTrades(monthTrades)}
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
                <div className="mt-2 overflow-hidden rounded-full bg-[var(--pane-hover)]" style={{ height: 4 }}>
                  <div className="flex h-full">
                    <div className="bg-[color:color-mix(in_srgb,var(--pane-up)_60%,transparent)] transition-all duration-700" style={{ width: `${(profitDays / (profitDays + lossDays)) * 100}%` }} />
                    <div className="bg-[color:color-mix(in_srgb,var(--pane-down)_50%,transparent)] transition-all duration-700" style={{ width: `${(lossDays / (profitDays + lossDays)) * 100}%` }} />
                  </div>
                </div>
              )}
              </div>

              <div className="-my-2.5 hidden shrink-0 items-center gap-3 self-stretch lg:flex">
                <Motto lines={t.analytics.mottos.calendar} className="hidden text-right 2xl:block" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/art/analytics/bull-bear.webp" alt="" className="art-glow pointer-events-none h-32 w-auto self-end" />
              </div>

                <button
                  onClick={nextMonth}
                  disabled={year === today.getFullYear() && month === today.getMonth()}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--pane-border)] text-[13px] text-[var(--pane-muted)] transition-colors duration-150 hover:text-[var(--pane-text)] disabled:opacity-25"
                >›</button>
            </div>

            {/* Тело календаря */}
            {/* Тело забирает всю свободную высоту панели, а внутри неё - сетка
                дней: итоги и кнопки карточки остаются прижатыми к низу. */}
            <div className="flex flex-1 flex-col p-4">
              {/* Дни недели */}
              <div className="mb-1.5 grid grid-cols-7 gap-1">
                {t.analytics.calendar.weekdays.map(d => (
                  <div key={d} className="py-1 text-center text-[10px] font-bold uppercase tracking-widest text-[color:color-mix(in_srgb,var(--pane-text)_20%,transparent)]">{d}</div>
                ))}
              </div>

              {/* Ячейки */}
              <div
                className="grid flex-1 grid-cols-7 gap-1"
                style={{
                  gridTemplateRows: `repeat(${Math.max(1, cells.length / 7)}, minmax(${cellHeight(cells.length / 7)}px, 1fr))`,
                }}
              >
                {cells.map((day, i) => (
                  <DayCell
                    key={i}
                    day={day}
                    active={selectedDay?.date === day?.date}
                    isToday={day?.date === todayStr}
                    best={Boolean(day && bestDay && day.date === bestDay.date && (bestDay.pnl_pct ?? 0) > 0)}
                    onClick={() => day && setSelectedDay(day)}
                  />
                ))}
              </div>

              {/* Легенда */}
              <div className="mt-4 flex flex-wrap justify-center gap-4 text-[10px] text-[color:color-mix(in_srgb,var(--pane-text)_30%,transparent)]">
                <span className="flex items-center gap-1.5"><span className="h-[5px] w-[5px] rounded-full bg-[var(--pane-accent)]" />{t.analytics.calendar.legendSignal}</span>
                <span className="flex items-center gap-1.5"><span className="h-[5px] w-[5px] rounded-full bg-[var(--pane-gold)]" />{t.analytics.calendar.legendTrade}</span>
                <span className="flex items-center gap-1.5"><span className="h-[5px] w-[5px] rounded-full bg-[var(--pane-up)]" />{t.analytics.calendar.legendDeposit}</span>
                <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded-full bg-[var(--pane-up)] text-[7px] font-bold text-black flex items-center justify-center">✓</span>{t.analytics.calendar.legendGoal}</span>
              </div>
            </div>


            {/* Итоги месяца */}
            {realDays.length >= 2 && (
              <div className="border-t border-[var(--pane-border)] px-3 py-2.5">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className={`font-mono text-base font-extrabold ${totalPnl >= 0 ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"}`}>
                      {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(1)}%
                    </p>
                    <p className="text-[10px] text-[color:color-mix(in_srgb,var(--pane-text)_30%,transparent)]">{t.analytics.summary.monthResult}</p>
                  </div>
                  <div>
                    <p className="font-mono text-base font-extrabold text-[var(--pane-up)]">
                      {bestDay ? `+${bestDay.pnl_pct!.toFixed(1)}%` : "-"}
                    </p>
                    <p className="text-[10px] text-[color:color-mix(in_srgb,var(--pane-text)_30%,transparent)]">{t.analytics.summary.bestDay}</p>
                  </div>
                  <div>
                    <p className="font-mono text-base font-extrabold text-[var(--pane-down)]">
                      {worstDay && worstDay.pnl_pct! < 0 ? `${worstDay.pnl_pct!.toFixed(1)}%` : "-"}
                    </p>
                    <p className="text-[10px] text-[color:color-mix(in_srgb,var(--pane-text)_30%,transparent)]">{t.analytics.summary.worstDay}</p>
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
              <span className="text-[10px] uppercase tracking-wider text-[color:color-mix(in_srgb,var(--pane-text)_30%,transparent)]">
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
              клетки месяца от лишней ширины растут, а цифры - нет.
              Колонка ростом с календарь: месяц в шесть рядов вытягивает
              календарь, и строки цифр расходятся следом - без пустого поля
              под панелями. */}
          <div className="flex flex-col gap-3">
          <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)]">
            <div className="flex items-baseline gap-2 border-b border-[var(--pane-border)] px-3 py-2">
              <h2 className="text-[12px] font-semibold text-[var(--pane-text)]">
                {t.analytics.month.title}
              </h2>
              <span className="text-[10px] text-[var(--pane-muted)]">{t.analytics.month.hint}</span>
            </div>
            <div className="flex flex-1">
            {/* Строки есть и в пустом месяце - прочерками: панель держит
                высоту, и колонка справа ровняется с календарём. */}
            <dl className="flex min-w-0 flex-1 flex-col divide-y divide-[var(--pane-border)]">
                <Metric label={t.analytics.month.trades} value={fmtDot(monthTrades)} />
                <Metric
                  label={t.analytics.month.profitDays}
                  value={`${profitDays}`}
                  note={t.analytics.month.ofTrading(tradingDays)}
                />
                <Metric
                  label={t.analytics.month.result}
                  value={monthTrades > 0 ? `${monthPnl >= 0 ? "+" : ""}${monthPnl.toFixed(2)} $` : "-"}
                  tone={monthTrades > 0 ? (monthPnl >= 0 ? "up" : "down") : undefined}
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
                <Metric label={t.analytics.month.perDay} value={volumePerDay > 0 ? `$${fmtVolShort(volumePerDay)}` : "-"} />
              </dl>
            <PanelArt src="/art/analytics/growth-bars.webp" motto={t.analytics.mottos.month} />
            </div>
          </div>

          <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)]">
            <div className="flex items-baseline gap-2 border-b border-[var(--pane-border)] px-3 py-2">
              <h2 className="text-[12px] font-semibold text-[var(--pane-text)]">
                {t.analytics.account.title}
              </h2>
              <span className="text-[10px] text-[var(--pane-muted)]">
                {t.analytics.account.hint}
              </span>
            </div>
            <div className="flex flex-1">
            <dl className="flex min-w-0 flex-1 flex-col divide-y divide-[var(--pane-border)]">
                <Metric
                  label={t.analytics.account.futures}
                  value={tradeSummary ? `$${fmtVolShort(tradeSummary.futures_volume)}` : "-"}
                />
                <Metric
                  label={t.analytics.account.spot}
                  value={tradeSummary ? `$${fmtVolShort(tradeSummary.spot_volume)}` : "-"}
                />
                <Metric
                  label={t.analytics.account.commission}
                  value={tradeSummary ? `$${fmtDot(Math.round(commission))}` : "-"}
                  note={commission > 0 ? t.analytics.account.ofVolume(commissionPct.toFixed(3)) : undefined}
                />
                <Metric
                  label={t.analytics.account.deposits}
                  value={tradeSummary ? `$${fmtDot(Math.round(depositTotal))}` : "-"}
                />
                <Metric
                  label={t.analytics.account.withdrawals}
                  value={tradeSummary ? `$${fmtDot(Math.round(withdrawTotal))}` : "-"}
                />
                <Metric
                  label={t.analytics.account.net}
                  value={tradeSummary ? `$${fmtDot(Math.round(depositTotal - withdrawTotal))}` : "-"}
                  tone={tradeSummary ? (depositTotal - withdrawTotal >= 0 ? "up" : "down") : undefined}
                />
              </dl>
            <PanelArt src="/art/analytics/coin-stacks.webp" motto={t.analytics.mottos.account} layout="top" />
            </div>
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
            pct={((monthVolume > 0 ? monthVolume : totalVolume / 3) / 250_000) * 100}
            color="var(--pane-accent)"
            art="/art/goals/volume.webp"
          />
          <Kpi
            label={t.analytics.kpi.streak}
            value={String(activityStreak)}
            note={t.analytics.kpi.streakGoal}
            pct={(activityStreak / 7) * 100}
            color="var(--c-warn)"
            art="/art/goals/streak.webp"
          />
          <Kpi
            label={t.analytics.kpi.avgDaily}
            value={`${avgProfit >= 0 ? "+" : ""}${avgProfit.toFixed(2)}%`}
            note={t.analytics.kpi.overDays(validPnl.length)}
            pct={(Math.abs(avgProfit) / 5) * 100}
            color={avgProfit >= 0 ? "var(--pane-up)" : "var(--pane-down)"}
            tone={avgProfit >= 0 ? "up" : "down"}
            art="/art/goals/profit.webp"
          />
          <Kpi
            label={t.analytics.kpi.tradingDays}
            value={String(tradingDays)}
            note={t.analytics.kpi.tradingDaysGoal}
            pct={(tradingDays / 15) * 100}
            color="var(--pane-gold)"
            art="/art/goals/trading_days.webp"
          />
        </div>

        </>
      )}

      {/* Награды: уровень, цели и достижения - одной группой.
          Два ровных ряда. Сверху - уровень и сертификаты, снизу - цели месяца
          и достижения. Коробки ряда одной высоты: края совпадают, и глаз не
          прыгает между столбцами разной длины. Достижения высотой в цели:
          собственной высоты у коробки нет, длинный список прокручивается. */}
      {tab === "rewards" && (() => {
        const parts: XpPart[] = [
          { key: "volume",  val: Math.floor(totalVolume / 50_000) * 25 },
          { key: "streak",  val: activityStreak * 30 },
          { key: "hotDays", val: hotDays * 50 },
          { key: "profit",  val: profitDays * 15 },
          { key: "days",    val: effectiveTradeDays * 10 },
          { key: "goals",   val: goalDays * 20 },
        ];
        const xp = parts.reduce((sum, p) => sum + p.val, 0);
        const { level, xpInLevel, xpNeeded } = getXpLevel(xp);
        return (
          <div className="space-y-3">
            <div className="grid gap-3 lg:grid-cols-2">
              <LevelPanel
                level={level}
                xp={xp}
                xpInLevel={xpInLevel}
                xpNeeded={xpNeeded}
                coins={coinsBalance}
                parts={parts}
                avatar={me?.avatar ?? null}
                frame={me?.frame ?? null}
                name={me?.name ?? ""}
              />
              <CertificatesPanel className="h-full" />
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <GoalsPanel goals={goals} />
              <AchievementsPanel achievements={achievements} className="lg:h-0 lg:min-h-full" />
            </div>
          </div>
        );
      })()}

      {/* День календаря - окном поверх интерфейса.
          Разбор дня жил полосой под календарём: открыв день, человек читал его
          где-то внизу страницы, а сам календарь при этом прыгал - панель
          вырастала на высоту таблицы сделок. Окно ничего не двигает и
          закрывается тем же нажатием мимо, что и остальные окна терминала. */}
      {selectedDay && (
        <div
          className="fixed inset-0 z-50 grid animate-fade-in place-items-center bg-black/60 p-4 motion-reduce:animate-none"
          onClick={() => setSelectedDay(null)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="max-h-[85vh] w-[760px] max-w-full animate-dialog-in overflow-y-auto rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] shadow-2xl motion-reduce:animate-none"
          >
            <div className="flex items-center justify-between gap-3 border-b border-[var(--pane-border)] px-4 py-2.5">
              <h2 className="text-[12px] font-semibold text-[var(--pane-text)]">
                {t.analytics.calendar.dayTitle}
              </h2>
              <div className="flex-1" />
              {/* Карточка этого дня - прямо из разбора. Кнопка под календарём
                  делает то же, но до неё надо закрыть окно, а смотрят день и
                  решают им поделиться именно здесь. */}
              {(() => {
                const ready = periodOf(calData, "day", selectedDay.date);
                return (
                  <button
                    disabled={!ready}
                    onClick={() => ready && setCard(cardFromPeriod(ready, owner ?? undefined))}
                    title={ready ? undefined : t.analytics.summary.nothingToShow}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--pane-border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--pane-text-2)] transition-colors duration-150 ease-out hover:border-[var(--pane-accent-soft)] hover:text-[var(--pane-accent)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-[var(--pane-border)] disabled:hover:text-[var(--pane-text-2)]"
                  >
                    <Share2 className="h-3 w-3" />
                    {t.analytics.calendar.dayCard}
                  </button>
                );
              })()}
              <button
                onClick={() => setSelectedDay(null)}
                className="text-[var(--pane-muted)] transition-colors duration-150 hover:text-[var(--pane-text)]"
                aria-label={t.common.close}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-4 py-3">
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
                      <span className="rounded-lg bg-[color:color-mix(in_srgb,var(--pane-gold)_10%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--pane-gold)]">
                        {t.analytics.calendar.dayVolume(fmtDot(dayVolume(selectedDay)))}
                      </span>
                    )}
                    {selectedDay.has_deposit && (
                      <span className="rounded-lg bg-[color:color-mix(in_srgb,var(--pane-up)_10%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--pane-up)]">
                        {t.analytics.calendar.dayDeposit}
                      </span>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {selectedDay.pnl_pct !== null ? (
                    <>
                      <p className={`font-mono text-2xl font-extrabold ${selectedDay.pnl_pct > 0 ? "text-[var(--pane-up)]" : selectedDay.pnl_pct < 0 ? "text-[var(--pane-down)]" : "text-[color:color-mix(in_srgb,var(--pane-text)_40%,transparent)]"}`}>
                        {selectedDay.pnl_pct > 0 ? "+" : ""}{selectedDay.pnl_pct.toFixed(2)}%
                      </p>
                      {selectedDay.signals > 0 && selectedDay.pnl_pct > 0 && (
                        <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-[color:color-mix(in_srgb,var(--pane-up)_15%,transparent)] px-2 py-0.5 text-[10px] font-bold text-[var(--pane-up)]">{t.analytics.calendar.dayGoal}</span>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-[color:color-mix(in_srgb,var(--pane-text)_20%,transparent)]">{t.analytics.calendar.noSnapshot}</p>
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
                      <tr className="text-[10px] uppercase tracking-wider text-[color:color-mix(in_srgb,var(--pane-text)_30%,transparent)]">
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
                        <tr key={one.id} className="border-t border-[color:color-mix(in_srgb,var(--pane-border)_40%,transparent)]">
                          <td className="py-1 text-[color:color-mix(in_srgb,var(--pane-text)_40%,transparent)]">
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
                              <span className="ml-1 text-[10px] font-normal text-[color:color-mix(in_srgb,var(--pane-text)_30%,transparent)]">
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
                              className="text-[color:color-mix(in_srgb,var(--pane-text)_30%,transparent)] transition-colors duration-150 ease-out hover:text-[var(--pane-accent)]"
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
                <p className="mt-3 text-[11px] text-[color:color-mix(in_srgb,var(--pane-text)_30%,transparent)]">
                  {t.analytics.trades.none}
                </p>
              ) : null}
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
    <div className="flex flex-1 items-center justify-between gap-3 px-3 py-2">
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
 * сколько набрано и сколько до цели. Процент справа в сотню не упирается:
 * перевыполненная цель так и видна - полоса полная, а число честное.
 */
function Kpi({
  label,
  value,
  note,
  pct,
  color,
  art,
  tone,
}: {
  label: string;
  value: string;
  /** Строка под подписью: цель или срок, за который считали. */
  note: string;
  pct: number;
  color: string;
  /** Объёмная картинка показателя - та же, что у одноимённой цели месяца. */
  art: string;
  tone?: "up" | "down";
}) {
  const ink =
    tone === "up"
      ? "text-[var(--pane-up)]"
      : tone === "down"
        ? "text-[var(--pane-down)]"
        : "text-[var(--pane-text)]";
  const share = Number.isFinite(pct) ? Math.max(0, pct) : 0;
  return (
    <div className="rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={art} alt="" className="h-10 w-10 shrink-0" />
        <div className="min-w-0">
          <span className={`font-mono text-[16px] font-bold leading-none tabular-nums ${ink}`}>{value}</span>
          <div className="mt-1 truncate text-[11px] text-[var(--pane-text-2)]">{label}</div>
        </div>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--pane-hover)]">
        <div
          className="h-full origin-left rounded-full transition-transform duration-700 ease-out"
          style={{ transform: `scaleX(${Math.min(100, share) / 100})`, background: color }}
        />
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2 text-[10px] text-[var(--pane-muted)]">
        <span className="truncate">{note}</span>
        <span className="shrink-0 font-mono tabular-nums">{Math.round(share)}%</span>
      </div>
    </div>
  );
}

/**
 * Картинка сбоку панели цифр и девиз при ней.
 *
 * «side» - девиз слева чуть выше середины, картинка справа: так у столбцов
 * месяца. «top» - монеты слева, девиз сверху справа над ними: широкий девиз
 * счёта посередине наезжал на монеты.
 *
 * Только с ширины планшета: на телефоне колонка цифр и так узкая, и картинка
 * отняла бы у неё половину.
 */
function PanelArt({
  src,
  motto,
  layout = "side",
}: {
  src: string;
  motto: readonly string[];
  layout?: "side" | "top";
}) {
  if (layout === "top") {
    return (
      <div className="relative hidden w-[44%] max-w-[360px] shrink-0 sm:block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {/* Монеты чуть меньше панели и стоят по её середине, девиз рядом с ними. */}
        <img
          src={src}
          alt=""
          className="art-glow pointer-events-none absolute left-2 top-1/2 h-[80%] w-[calc(100%-9rem)] -translate-y-1/2 object-contain object-center"
        />
        <Motto lines={motto} className="absolute right-3 top-[22%] text-right !tracking-[0.24em]" />
      </div>
    );
  }
  return (
    <div className="hidden w-[44%] max-w-[400px] shrink-0 items-center justify-center gap-0 px-3 sm:flex">
      {/* Девиз и картинка - одной группой по центру колонки: картинка стоит
          вплотную за текстом и не уезжает к краю панели; девиз чуть выше
          середины. */}
      <Motto lines={motto} className="relative z-10 shrink-0 -translate-y-5 translate-x-6 !tracking-[0.24em]" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className="art-glow pointer-events-none h-[86%] w-auto min-w-0 max-w-[60%] object-contain"
      />
    </div>
  );
}

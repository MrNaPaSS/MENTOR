"use client";

// Таблица трейдеров: кто сколько наторговал и с каким результатом.
//
// В неё попадают только те, кто торгует по своим ключам. У остальных объём
// известен со стороны, партнёрской ручкой, и приходит с задержкой - ставить их
// в один ряд с теми, чьи числа взяты у самой биржи, значит сравнивать
// несравнимое. А за места здесь однажды будут давать награды, и раздавать их
// по чужой оценке нельзя.
//
// Два порядка, а не два списка. Наторговать много и потерять - не заслуга, и
// обратное тоже верно: списки отвечают на разные вопросы, но строки в них одни
// и те же, и держать их порознь значит заставлять сверять глазами.

import { useT } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { Coins, Crown, TrendingUp } from "lucide-react";
import { api, type TraderRow } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";

type Sort = "volume" | "pnl";

/** За сколько дней считаем. Месяц: неделя коротка, квартал уже не про форму. */
const DAYS = 30;

/** Деньги коротко: в таблице важен порядок величины, а не копейки. */
function money(value: number): string {
  const sign = value < 0 ? "-" : "";
  const size = Math.abs(value);
  if (size >= 1_000_000) return `${sign}${(size / 1_000_000).toFixed(2)}M`;
  if (size >= 1_000) return `${sign}${(size / 1_000).toFixed(1)}K`;
  return `${sign}${size.toFixed(2)}`;
}

export default function TradersTable() {
  const t = useT();
  const [sort, setSort] = useState<Sort>("volume");
  const [rows, setRows] = useState<TraderRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!getAccessToken()) return;
    let cancelled = false;
    setFailed(false);
    api
      .traders(sort, DAYS)
      .then((list) => {
        if (!cancelled) setRows(list);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sort]);

  if (failed) return null;

  return (
    <section className="card overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">{t.tools.traders.title}</h3>
          <p className="text-[11px] text-text-muted">
            {t.tools.traders.subtitle}
          </p>
        </div>

        {/* Переключатель порядка, а не двух таблиц: строки те же, вопрос разный. */}
        <div className="flex gap-1 rounded-lg border border-border bg-bg-panel p-1">
          {(
            [
              ["volume", t.tools.traders.byVolume, <Coins key="v" className="h-3.5 w-3.5" />],
              ["pnl", t.tools.traders.byPnl, <TrendingUp key="p" className="h-3.5 w-3.5" />],
            ] as const
          ).map(([key, label, icon]) => (
            <button
              key={key}
              onClick={() => setSort(key)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition ${
                sort === key
                  ? "bg-accent-cyan/15 text-accent-cyan"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      </div>

      {rows === null ? (
        <div className="space-y-2 p-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-8 animate-pulse rounded-lg bg-bg-panel/60" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        // Пусто - это не сбой, а положение дел: ключи ещё никто не подключил.
        <p className="px-4 py-8 text-center text-sm text-text-muted">
          {t.tools.traders.empty}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-text-muted">
                <th className="px-4 py-2 text-left font-medium">#</th>
                <th className="px-4 py-2 text-left font-medium">{t.tools.traders.colTrader}</th>
                <th className="px-4 py-2 text-right font-medium">{t.tools.traders.colVolume}</th>
                <th className="px-4 py-2 text-right font-medium">{t.tools.traders.colPnl}</th>
                <th className="px-4 py-2 text-right font-medium">{t.tools.traders.colTrades}</th>
                <th className="px-4 py-2 text-right font-medium">{t.tools.traders.colAccuracy}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                // Первое место - короной. Тем же значком, что и самая крупная
                // плита в ленте: «первый среди прочих» в терминале выглядит
                // одинаково, где бы ни встретился.
                const first = row.rank === 1;
                const hit = row.trades > 0 ? Math.round((row.wins / row.trades) * 100) : null;
                return (
                  <tr
                    key={`${row.rank}-${row.username ?? ""}`}
                    className="border-t border-border/60 transition-colors hover:bg-bg-panel/40"
                  >
                    <td className="px-4 py-2 font-mono text-text-muted tabular-nums">
                      {first ? (
                        <Crown className="h-3.5 w-3.5 text-accent-gold" />
                      ) : (
                        row.rank
                      )}
                    </td>
                    <td className="px-4 py-2 font-semibold text-text-primary">
                      {row.username ?? t.tools.traders.noName}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-text-secondary tabular-nums">
                      ${money(row.volume)}
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-mono font-semibold tabular-nums ${
                        row.pnl >= 0 ? "text-success" : "text-danger"
                      }`}
                    >
                      {row.pnl >= 0 ? "+" : "-"}${money(Math.abs(row.pnl))}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-text-secondary tabular-nums">
                      {row.trades}
                    </td>
                    {/* Точность без сделок не считается: ноль из нуля - не ноль
                        процентов, а «нечего считать». */}
                    <td className="px-4 py-2 text-right font-mono text-text-secondary tabular-nums">
                      {hit === null ? "-" : `${hit}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

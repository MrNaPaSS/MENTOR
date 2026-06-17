"use client";

import { useEffect, useState } from "react";
import { api, TradeSummary, DepositRecord } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { TrendingUp, ArrowDownCircle, Coins, Activity, AlertCircle, Info } from "lucide-react";

const DAYS_OPTIONS = [
  { value: 7,  label: "7 дней" },
  { value: 30, label: "30 дней" },
  { value: 90, label: "90 дней" },
];

function fmt(n: number, digits = 2) {
  return n.toLocaleString("ru", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function TradesPage() {
  const [summary, setSummary] = useState<TradeSummary | null>(null);
  const [deposits, setDeposits] = useState<DepositRecord[]>([]);
  const [needsUid, setNeedsUid] = useState(false);
  const [days, setDays] = useState(30);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    setLoaded(false);
    api.tradesMe(token, days)
      .then(r => {
        setSummary(r.summary);
        setDeposits(r.deposits || []);
        setNeedsUid(r.needs_uid);
      })
      .catch(() => { setSummary(null); setDeposits([]); })
      .finally(() => setLoaded(true));
  }, [days]);

  if (needsUid) {
    return (
      <div className="card mt-8 flex flex-col items-center gap-3 py-12 text-center">
        <AlertCircle className="h-8 w-8 text-accent-gold" />
        <p className="text-sm font-semibold text-white">Не указан WEEX UID</p>
        <p className="max-w-md text-xs text-text-muted">
          Чтобы видеть активность, привяжи WEEX UID в профиле.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Заголовок + период */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white">Моя активность</h1>
          <p className="text-sm text-text-muted">Торговые объёмы и депозиты с WEEX за выбранный период</p>
        </div>
        <div className="flex gap-1">
          {DAYS_OPTIONS.map(o => (
            <button
              key={o.value}
              onClick={() => setDays(o.value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                days === o.value ? "bg-accent-cyan/15 text-accent-cyan" : "text-text-muted hover:text-white"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI объёмы */}
      {!loaded ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-24 rounded-xl" />)}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard icon={TrendingUp} label="Фьючерсы, USDT" value={`$${fmt(summary.futures_volume)}`} accent="cyan" />
          <KpiCard icon={Activity} label="Спот, USDT" value={`$${fmt(summary.spot_volume)}`} accent="gold" />
          <KpiCard icon={ArrowDownCircle} label="Депозиты, USDT" value={`$${fmt(summary.deposit_total)}`} accent="cyan" />
          <KpiCard icon={Coins} label="Выводы, USDT" value={`$${fmt(summary.withdrawal_total)}`} accent="gold" />
        </div>
      ) : (
        <div className="card flex items-center gap-3 py-6 text-text-muted">
          <Info className="h-5 w-5 shrink-0" />
          <p className="text-sm">Данные по торговым объёмам недоступны</p>
        </div>
      )}

      {/* Пояснение */}
      <div className="card flex items-start gap-3 border-white/10 bg-white/[0.02] py-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-cyan" />
        <p className="text-xs text-text-muted leading-relaxed">
          Объёмы торгов получены из партнёрского API WEEX. Индивидуальные сделки (по каждому ордеру)
          недоступны через этот API — здесь отображается агрегированная статистика за период.
        </p>
      </div>

      {/* Таблица депозитов */}
      <div className="card overflow-hidden p-0">
        <div className="border-b border-white/[0.06] px-5 py-4">
          <h2 className="text-base font-bold text-white">История пополнений</h2>
          <p className="text-xs text-text-muted">Депозиты, зафиксированные по данным WEEX</p>
        </div>

        {!loaded ? (
          <div className="p-6">
            {[...Array(3)].map((_, i) => <div key={i} className="skeleton mb-2 h-10 rounded-lg" />)}
          </div>
        ) : deposits.length === 0 ? (
          <div className="grid place-items-center py-14 text-center text-text-muted">
            <ArrowDownCircle className="mb-3 h-10 w-10 opacity-20" />
            <p className="font-medium">Депозитов нет</p>
            <p className="mt-1 text-sm opacity-60">За выбранный период пополнений не зафиксировано</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-white/[0.06] bg-bg-deep/50">
                <tr className="text-left text-xs text-text-muted">
                  <th className="px-5 py-3 font-medium">Дата</th>
                  <th className="px-5 py-3 font-medium">Монета</th>
                  <th className="px-5 py-3 text-right font-medium">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {deposits.map((d, i) => (
                  <tr key={i} className="border-b border-white/[0.04] transition hover:bg-white/[0.02]">
                    <td className="px-5 py-3 text-text-secondary">{fmtDate(d.date_iso)}</td>
                    <td className="px-5 py-3">
                      <span className="rounded-md bg-success/15 px-1.5 py-0.5 text-[10px] font-bold text-success">
                        {d.coin}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right font-mono font-bold text-white">
                      +{fmt(d.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-white/[0.06] bg-bg-deep/30">
                <tr>
                  <td colSpan={2} className="px-5 py-3 text-xs font-semibold text-text-muted">Итого</td>
                  <td className="px-5 py-3 text-right font-mono text-sm font-bold text-accent-cyan">
                    ${fmt(deposits.reduce((s, d) => s + d.amount, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, accent }: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
  accent: "cyan" | "gold";
}) {
  const colors = accent === "cyan"
    ? { bg: "bg-accent-cyan/10", text: "text-accent-cyan" }
    : { bg: "bg-accent-gold/10", text: "text-accent-gold" };
  return (
    <div className="card flex items-center gap-3 py-4">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${colors.bg} ${colors.text}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="font-mono text-lg font-extrabold text-white truncate">{value}</p>
        <p className="text-[11px] text-text-muted">{label}</p>
      </div>
    </div>
  );
}

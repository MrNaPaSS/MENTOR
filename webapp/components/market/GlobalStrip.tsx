"use client";

// Строка состояния рынка: то, с чего начинают день.
//
// Стоит над всем разделом и отвечает на один вопрос - «что вообще происходит».
// Пять чисел, дальше начинаются подробности. Порядок не случаен: сначала
// размер рынка, потом его движение, потом кто в нём главный.
//
// Отдельная строка, а не панель среди панелей: у терминала есть шапка, и
// раздел рынка обязан начинаться так же, иначе он выглядит другим приложением.

import { useEffect, useState } from "react";
import { api, type GlobalMarket } from "@/lib/api";
import { money } from "@/lib/scalping";
import { LiveBadge, PaneLabel } from "./Pane";

function Cell({
  label,
  value,
  tone = "plain",
  hint,
}: {
  label: string;
  value: string;
  tone?: "plain" | "up" | "down" | "gold";
  hint?: string;
}) {
  const color = {
    plain: "text-[var(--pane-text)]",
    up: "text-[var(--pane-up)]",
    down: "text-[var(--pane-down)]",
    gold: "text-[var(--pane-gold)]",
  }[tone];
  return (
    <div className="min-w-0 px-3 py-2" title={hint}>
      <PaneLabel>{label}</PaneLabel>
      <div className={`truncate font-mono text-[15px] font-semibold tabular-nums ${color}`}>
        {value}
      </div>
    </div>
  );
}

export default function GlobalStrip() {
  const [data, setData] = useState<GlobalMarket | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let dropped = false;
    // Раз в минуту: сервер и сам держит ответ минуту в кэше, чаще спрашивать
    // значит получать ту же строку и греть сеть.
    function load() {
      api
        .marketGlobal()
        .then((r) => {
          if (dropped) return;
          setData(r);
          setFailed(false);
        })
        .catch(() => {
          if (!dropped) setFailed(true);
        });
    }
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      dropped = true;
      clearInterval(timer);
    };
  }, []);

  const change = data?.market_cap_change_24h ?? 0;

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--pane-border)] bg-[var(--pane-bg)]">
      <div className="flex items-center justify-between border-b border-[var(--pane-border)] px-3 py-1.5">
        <span className="text-[11px] font-semibold text-[var(--pane-text)]">Рынок целиком</span>
        <LiveBadge live={!!data && !failed} label={data ? "1 мин" : "Нет данных"} />
      </div>

      {data ? (
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--pane-border)] sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
          <Cell
            label="Капитализация"
            value={`$${money(data.total_market_cap_usd)}`}
            hint="Стоимость всех монет вместе"
          />
          <Cell
            label="Объём 24ч"
            value={`$${money(data.total_volume_usd)}`}
            hint="Сколько наторговали за сутки"
          />
          <Cell
            label="Изменение 24ч"
            value={`${change > 0 ? "+" : ""}${change.toFixed(2)}%`}
            tone={change > 0 ? "up" : change < 0 ? "down" : "plain"}
            hint="Насколько выросла или упала капитализация за сутки"
          />
          <Cell
            label="Доминация BTC"
            value={`${data.btc_dominance.toFixed(1)}%`}
            tone="gold"
            hint="Доля биткоина в капитализации рынка"
          />
          <Cell
            label="Монет в обращении"
            value={data.active_cryptos.toLocaleString("ru-RU")}
            hint="Сколько монет учитывает источник"
          />
        </div>
      ) : (
        <div className="px-3 py-4 text-[11px] text-[var(--pane-muted)]">
          {failed ? "Источник не ответил" : "Спрашиваем источник..."}
        </div>
      )}
    </div>
  );
}

"use client";

// Сеть биткоина изнутри: комиссии, мощность, пересчёт сложности.
//
// Единственный показатель раздела, который смотрит не на цену, а на сеть под
// ней. Комиссия говорит, насколько сеть занята прямо сейчас; сложность - что
// думают о ближайших неделях те, кто вкладывает в железо.
//
// Комиссии показаны все четыре, а не одна «средняя»: между «в следующий блок»
// и «когда-нибудь сегодня» разница бывает десятикратной, и именно она и есть
// новость. Средняя из них не значила бы ничего.

import { useEffect, useState } from "react";
import { api, type OnChainStats } from "@/lib/api";
import Pane, { PaneBar, PaneLabel, type PaneState } from "./Pane";

/** Порог, выше которого комиссия считается высокой. Сатоши за виртуальный байт. */
const BUSY_FEE = 60;

function Fee({ label, value, hint }: { label: string; value: number; hint: string }) {
  const hot = value >= BUSY_FEE;
  return (
    <div title={hint}>
      <PaneLabel>{label}</PaneLabel>
      <div
        className="font-mono text-[15px] font-semibold tabular-nums"
        style={{ color: hot ? "var(--pane-down)" : "var(--pane-text)" }}
      >
        {value}
      </div>
      <div className="mt-1">
        <PaneBar fill={value / (BUSY_FEE * 2)} tone={hot ? "down" : "accent"} />
      </div>
    </div>
  );
}

export default function OnChainPane({ className = "" }: { className?: string }) {
  const [data, setData] = useState<OnChainStats | null>(null);
  const [state, setState] = useState<PaneState>("loading");

  useEffect(() => {
    let dropped = false;
    api
      .marketOnchain()
      .then((r) => {
        if (dropped) return;
        setData(r);
        setState(r ? "ready" : "error");
      })
      .catch(() => {
        if (!dropped) setState("error");
      });
    return () => {
      dropped = true;
    };
  }, []);

  const diff = data?.difficulty_change_pct ?? 0;

  return (
    <Pane
      title="Сеть биткоина"
      hint="Комиссии в сатоши за виртуальный байт"
      state={state}
      emptyNote="Узел сети не ответил"
      className={className}
    >
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-2">
            <Fee label="Срочно" value={data.fees.fastest} hint="Попасть в ближайший блок" />
            <Fee label="Полчаса" value={data.fees.half_hour} hint="Подтверждение примерно за полчаса" />
            <Fee label="Час" value={data.fees.hour} hint="Подтверждение примерно за час" />
            <Fee label="Не срочно" value={data.fees.economy} hint="Когда время не важно" />
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-[var(--pane-border)] pt-3">
            <div>
              <PaneLabel>Мощность сети</PaneLabel>
              <div className="font-mono text-[15px] font-semibold tabular-nums text-[var(--pane-text)]">
                {data.hash_rate_ehs.toLocaleString("ru-RU")}
                <span className="ml-1 text-[11px] font-normal text-[var(--pane-muted)]">EH/s</span>
              </div>
            </div>
            <div>
              <PaneLabel>Переводов за сутки</PaneLabel>
              <div className="font-mono text-[15px] font-semibold tabular-nums text-[var(--pane-text)]">
                {data.tx_count_24h.toLocaleString("ru-RU")}
              </div>
            </div>
          </div>

          <div className="border-t border-[var(--pane-border)] pt-3">
            <div className="flex items-baseline justify-between">
              <PaneLabel>Пересчёт сложности</PaneLabel>
              <span
                className="font-mono text-[12px] font-semibold tabular-nums"
                style={{
                  color: diff > 0 ? "var(--pane-up)" : diff < 0 ? "var(--pane-down)" : "var(--pane-muted)",
                }}
                title="Насколько изменится сложность добычи в конце периода"
              >
                {diff > 0 ? "+" : ""}
                {diff.toFixed(2)}%
              </span>
            </div>
            <div className="mt-2">
              <PaneBar fill={data.retarget_progress_pct / 100} tone="gold" />
            </div>
            <div className="mt-1 text-right text-[10px] text-[var(--pane-muted)]">
              период пройден на {data.retarget_progress_pct.toFixed(1)}%
            </div>
          </div>
        </div>
      )}
    </Pane>
  );
}

"use client";

// Доллар против остальных валют.
//
// Крипта торгуется за доллар, поэтому половина её движений - это движения
// самого доллара. Когда он крепнет ко всему миру разом, падение биткоина в
// долларах ещё не значит, что биткоин подешевел.
//
// Курсы дневные, а не биржевые: источник публикует их раз в сутки по итогам
// европейской сессии. Внутри дня они не меняются, и делать вид, что меняются,
// - обманывать. Поэтому рядом стоит дата, к которой курс относится.

import { useEffect, useState } from "react";
import { api, type ForexRates } from "@/lib/api";
import Pane, { PaneLabel, type PaneState } from "./Pane";

/** Валюты в том порядке, в каком на них смотрят: сперва евро, дальше по весу. */
const ORDER = ["EUR", "GBP", "JPY", "CHF", "CAD", "AUD"] as const;

const NAMES: Record<string, string> = {
  EUR: "Евро",
  GBP: "Фунт",
  JPY: "Иена",
  CHF: "Франк",
  CAD: "Канадский доллар",
  AUD: "Австралийский доллар",
};

/** Курс: у иены он в сотнях, у остальных около единицы - знаков нужно разное. */
function rate(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return value >= 100 ? value.toFixed(2) : value.toFixed(4);
}

export default function ForexPane({ className = "" }: { className?: string }) {
  const [data, setData] = useState<ForexRates | null>(null);
  const [state, setState] = useState<PaneState>("loading");

  useEffect(() => {
    let dropped = false;
    api
      .marketForex()
      .then((r) => {
        if (dropped) return;
        setData(r);
        setState(r?.rates ? "ready" : "error");
      })
      .catch(() => {
        if (!dropped) setState("error");
      });
    return () => {
      dropped = true;
    };
  }, []);

  const day = data?.date
    ? new Date(data.date).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })
    : null;

  return (
    <Pane
      title="Доллар к валютам"
      hint={day ? `Курс на ${day}, обновляется раз в сутки` : "Курс обновляется раз в сутки"}
      state={state}
      emptyNote="Курсы недоступны"
      className={className}
    >
      {data && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {ORDER.filter((code) => code in (data.rates ?? {})).map((code) => (
            <div
              key={code}
              className="flex items-baseline justify-between gap-2 border-b border-[var(--pane-border)] pb-1"
              title={`1 доллар = ${rate(data.rates[code])} ${NAMES[code] ?? code}`}
            >
              <span className="font-mono text-[12px] font-semibold text-[var(--pane-text)]">
                {code}
              </span>
              <span className="font-mono text-[12px] tabular-nums text-[var(--pane-text-2)]">
                {rate(data.rates[code])}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 text-right">
        <PaneLabel>за один доллар</PaneLabel>
      </div>
    </Pane>
  );
}

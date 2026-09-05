"use client";

// Скринер и стакан для скальпинга.
//
// Экран рабочий, а не настроечный: слева список монет с метриками, справа
// стакан выбранной. Настроек ровно две — шаг ценовой шкалы и глубина, — и обе
// живут в углу стакана. Прошлая версия раздела начиналась с семи переключателей
// и шести захардкоженных пар, и пользоваться этим было нельзя.

import { useState } from "react";
import { Wifi, WifiOff } from "lucide-react";
import ScreenerTable from "@/components/scalping/ScreenerTable";
import DomTrader from "@/components/scalping/DomTrader";
import { base, useScalpingFeed, SORT_LABELS, type SortKey } from "@/lib/scalping";

// Укрупнение ценовой шкалы. На BTC шаг биржи — десять центов, и без укрупнения
// сорок строк стакана укладываются в четыре доллара.
const STEPS = [
  { agg: 1, label: "×1" },
  { agg: 5, label: "×5" },
  { agg: 10, label: "×10" },
  { agg: 25, label: "×25" },
];

const DEPTHS = [30, 60, 100];

export default function ScalpingPage() {
  const [symbol, setSymbol] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("walls");
  const [agg, setAgg] = useState(10);
  const [rows, setRows] = useState(60);

  const { screener, dom, connected } = useScalpingFeed({ symbol, rows, agg, sort });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Скальпинг</h1>
          <p className="text-sm text-text-muted">
            Крупные заявки в стаканах топовых монет — обновление живьём
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
            connected
              ? "border-success/40 bg-success/10 text-success"
              : "border-danger/40 bg-danger/10 text-danger"
          }`}
        >
          {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {connected ? "поток биржи" : "нет связи"}
        </span>
      </header>

      <div className="space-y-4">
        <section className="rounded-xl border border-border bg-bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <span className="text-xs text-text-muted">Сортировка:</span>
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <button
                key={key}
                onClick={() => setSort(key)}
                className={`rounded px-2 py-1 text-xs transition-colors ${
                  sort === key
                    ? "bg-accent-cyan/15 text-accent-cyan"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {SORT_LABELS[key]}
              </button>
            ))}
          </div>

          <ScreenerTable
            rows={screener}
            selected={symbol}
            sort={sort}
            onSort={setSort}
            onSelect={setSymbol}
          />
        </section>

        <section className="rounded-xl border border-border bg-bg-card">
          {symbol ? (
            <>
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="font-semibold text-text-primary">{base(symbol)}</span>
                <div className="flex items-center gap-1">
                  {STEPS.map((step) => (
                    <button
                      key={step.agg}
                      onClick={() => setAgg(step.agg)}
                      title="Шаг ценовой шкалы"
                      className={`rounded px-1.5 py-0.5 text-[11px] ${
                        agg === step.agg
                          ? "bg-accent-cyan/15 text-accent-cyan"
                          : "text-text-muted hover:text-text-primary"
                      }`}
                    >
                      {step.label}
                    </button>
                  ))}
                  <span className="mx-1 h-3 w-px bg-border" />
                  {DEPTHS.map((depth) => (
                    <button
                      key={depth}
                      onClick={() => setRows(depth)}
                      title="Глубина стакана, строк"
                      className={`rounded px-1.5 py-0.5 text-[11px] ${
                        rows === depth
                          ? "bg-accent-cyan/15 text-accent-cyan"
                          : "text-text-muted hover:text-text-primary"
                      }`}
                    >
                      {depth}
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-[560px]">
                {dom ? (
                  <DomTrader frame={dom} />
                ) : (
                  <p className="grid h-full place-items-center text-sm text-text-muted">
                    Собираем стакан {base(symbol)}…
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="grid h-[640px] place-items-center px-6 text-center text-sm text-text-muted">
              Выберите монету в списке — здесь появится её стакан с заявками
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

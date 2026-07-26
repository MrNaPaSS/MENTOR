"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Pause, Play, Layers } from "lucide-react";
import { api, type DomSnapshot } from "@/lib/api";
import DomTrader, { fmtPrice, fmtVol } from "@/components/scalping/DomTrader";
import Tape from "@/components/scalping/Tape";
import PressureBar from "@/components/scalping/PressureBar";
import { addTrades, emptyState, type ClusterState } from "@/lib/clusters";

const PAIRS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT"];

// Частоты опроса. Ниже 500 мс смысла нет: WEEX отдаёт снимок стакана,
// а не поток изменений — чаще придут те же самые данные.
const SPEEDS = [
  { ms: 500, label: "0.5с" },
  { ms: 1000, label: "1с" },
  { ms: 2000, label: "2с" },
];

const DEPTHS = [30, 60, 90];

// Укрупнение ценовой сетки биржи. ×1 — шаг биржи как есть.
const AGGS = [1, 5, 10, 20];

// Порог имбаланса — из настроек Tiger.Trade заказчика (BidAskImbalanceRatio).
const IMBALANCES = [140, 200, 300];

// Ширина одного столбца истории.
const BUCKETS = [
  { ms: 60_000, label: "1м" },
  { ms: 300_000, label: "5м" },
  { ms: 900_000, label: "15м" },
];

const MAX_BUCKETS = 12;

export default function ScalpingPage() {
  const [symbol, setSymbol] = useState(PAIRS[0]);
  const [speed, setSpeed] = useState(SPEEDS[1].ms);
  const [rows, setRows] = useState(60);
  const [agg, setAgg] = useState(10);
  const [source, setSource] = useState<"binance" | "weex">("binance");
  const [imbalance, setImbalance] = useState(300);
  const [bucketMs, setBucketMs] = useState(BUCKETS[1].ms);
  const [notional, setNotional] = useState(true);
  const [live, setLive] = useState(true);

  const [snap, setSnap] = useState<DomSnapshot | null>(null);
  const [clusters, setClusters] = useState<ClusterState>(emptyState);
  const [error, setError] = useState<string | null>(null);

  // Не даём догоняющим ответам перезаписать более свежие: при смене пары
  // ответ по старому символу может прийти позже — его нужно отбросить.
  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;

  const load = useCallback(async () => {
    try {
      const data = await api.scalpingDom(symbolRef.current, { rows, agg, imbalance, source });
      if (data.symbol !== symbolRef.current) return;
      setSnap(data);
      setClusters((prev) =>
        addTrades(prev, data.trades, {
          bucketMs,
          tick: data.tick,
          maxBuckets: MAX_BUCKETS,
        }),
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Стакан недоступен");
    }
  }, [rows, agg, imbalance, bucketMs, source]);

  // Смена пары или шага сетки обнуляет историю: кластеры привязаны к ценам,
  // при другом шаге они встанут не напротив своих уровней.
  useEffect(() => {
    setClusters(emptyState());
    setSnap(null);
  }, [symbol, agg, bucketMs, source]);

  useEffect(() => {
    if (!live) return;
    load();
    const id = setInterval(load, speed);
    return () => clearInterval(id);
  }, [live, speed, load, symbol]);

  const tape = snap?.tape;
  const mult = notional && snap ? snap.mid : 1;

  return (
    <div className="space-y-3">
      {/* ── Панель управления ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto flex items-center gap-2">
          <Layers className="h-4 w-4 text-accent-cyan" />
          <h1 className="text-lg font-semibold text-text-primary">Скальпинг</h1>
        </div>

        <div className="flex rounded-lg border border-border/60 bg-bg-panel p-0.5">
          {PAIRS.map((p) => (
            <button
              key={p}
              onClick={() => setSymbol(p)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                symbol === p
                  ? "bg-accent-cyan/15 text-accent-cyan"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {p.replace("USDT", "")}
            </button>
          ))}
        </div>

        <button
          onClick={() => setLive((v) => !v)}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition ${
            live
              ? "border-success/40 bg-success/10 text-success"
              : "border-border/60 bg-bg-panel text-text-muted"
          }`}
          aria-label={live ? "Остановить поток" : "Запустить поток"}
        >
          {live ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          {live ? "Пауза" : "Пуск"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px]">
        <Selector label="Частота" options={SPEEDS.map((s) => ({ value: s.ms, label: s.label }))} value={speed} onChange={setSpeed} />
        <Selector label="Глубина" options={DEPTHS.map((d) => ({ value: d, label: String(d) }))} value={rows} onChange={setRows} />
        <Selector label="Шаг" options={AGGS.map((a) => ({ value: a, label: `×${a}` }))} value={agg} onChange={setAgg} />
        <Selector label="Столбец" options={BUCKETS.map((b) => ({ value: b.ms, label: b.label }))} value={bucketMs} onChange={setBucketMs} />
        <Selector label="Имбаланс" options={IMBALANCES.map((i) => ({ value: i, label: `${i}%` }))} value={imbalance} onChange={setImbalance} />
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Стакан</span>
          <div className="flex rounded-lg border border-border/60 bg-bg-panel p-0.5">
            {(["binance", "weex"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSource(s)}
                className={`rounded-md px-2 py-0.5 transition ${
                  source === s
                    ? "bg-white/[0.06] text-text-primary"
                    : "text-text-muted hover:text-text-secondary"
                }`}
              >
                {s === "binance" ? "Binance" : "WEEX"}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() => setNotional((v) => !v)}
          className="rounded-lg border border-border/60 bg-bg-panel px-2 py-1 text-text-muted transition hover:text-text-secondary"
        >
          {notional ? "$" : symbol.replace("USDT", "")}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
          {error}
        </div>
      )}

      {/* ── Сводка ────────────────────────────────────────────────────── */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Цена"
          value={snap ? fmtPrice(snap.mid, snap.tick) : "—"}
          sub={snap ? `спред ${snap.spread_bp.toFixed(1)} б.п. · шаг ${fmtPrice(snap.tick, snap.tick)}` : ""}
        />
        <Stat
          label="Дельта ленты"
          value={tape ? (tape.delta >= 0 ? "+" : "-") + fmtVol(Math.abs(tape.delta) * mult) : "—"}
          tone={tape ? (tape.delta >= 0 ? "up" : "down") : undefined}
          sub={tape ? `${fmtVol(tape.buy_volume * mult)} / ${fmtVol(tape.sell_volume * mult)}` : ""}
        />
        <Stat
          label="Объём стакана"
          value={snap ? fmtVol((snap.bid_volume + snap.ask_volume) * mult) : "—"}
          sub={
            snap
              ? `${snap.source}: ${snap.depth_available.bids}/${snap.depth_available.asks} уровней`
              : ""
          }
        />
        <Stat
          label="Плиты"
          value={snap ? String(snap.bid_walls.length + snap.ask_walls.length) : "—"}
          sub={snap ? `${snap.bid_walls.length} снизу / ${snap.ask_walls.length} сверху` : ""}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <PressureBar
          label="Перевес стакана"
          ratio={snap?.book_ratio ?? 0.5}
          left={snap ? fmtVol(snap.bid_volume * mult) : "—"}
          right={snap ? fmtVol(snap.ask_volume * mult) : "—"}
          hint="лимитные заявки"
        />
        <PressureBar
          label="Давление по ленте"
          ratio={tape?.buy_ratio ?? 0.5}
          left={tape ? fmtVol(tape.buy_volume * mult) : "—"}
          right={tape ? fmtVol(tape.sell_volume * mult) : "—"}
          hint="рыночные сделки"
        />
      </div>

      {/* ── Стакан с историей кластеров ───────────────────────────────── */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
        <DomTrader data={snap} buckets={clusters.buckets} notional={notional} />
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-muted">
            <Activity className="h-3 w-3" />
            Лента сделок
          </div>
          <Tape trades={snap?.trades ?? []} tick={snap?.tick ?? 0.01} />
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-text-muted">
        Колонки слева — объём прошедших сделок по ценам, столбец на каждый интервал.
        История копится с момента открытия страницы: биржа отдаёт только последние
        сделки, готового «объёма по ценам за прошлые часы» у неё нет. Оранжевым
        выделены крупнейшие кластеры, золотой ценой — плиты в стакане, жирным —
        уровни с имбалансом от {imbalance}%.
      </p>
    </div>
  );
}

function Selector<T extends number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-text-muted">{label}</span>
      <div className="flex rounded-lg border border-border/60 bg-bg-panel p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`rounded-md px-2 py-0.5 transition ${
              value === o.value
                ? "bg-white/[0.06] text-text-primary"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down";
}) {
  const color =
    tone === "up" ? "text-success" : tone === "down" ? "text-danger" : "text-text-primary";
  return (
    <div className="rounded-xl border border-border/60 bg-bg-panel p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`mt-1 font-mono text-base tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 font-mono text-[10px] text-text-muted">{sub}</div>}
    </div>
  );
}

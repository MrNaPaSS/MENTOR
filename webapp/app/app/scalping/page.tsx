"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Pause, Play, Layers } from "lucide-react";
import { api, type DomSnapshot } from "@/lib/api";
import DomLadder, { fmtPrice, fmtSize } from "@/components/scalping/DomLadder";
import Tape from "@/components/scalping/Tape";
import LiquidityHeatmap from "@/components/scalping/LiquidityHeatmap";
import PressureBar from "@/components/scalping/PressureBar";

const PAIRS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT"];

// Частоты опроса. Ниже 500 мс смысла нет: WEEX отдаёт снимок стакана,
// а не поток изменений — чаще придут те же самые данные.
const SPEEDS = [
  { ms: 500, label: "0.5с" },
  { ms: 1000, label: "1с" },
  { ms: 2000, label: "2с" },
];

const DEPTHS = [15, 30, 45];

// Порог имбаланса — из настроек Tiger.Trade заказчика (BidAskImbalanceRatio).
const IMBALANCES = [140, 200, 300];

const HISTORY_LEN = 120;

export default function ScalpingPage() {
  const [symbol, setSymbol] = useState(PAIRS[0]);
  const [speed, setSpeed] = useState(SPEEDS[1].ms);
  const [rows, setRows] = useState(30);
  const [imbalance, setImbalance] = useState(300);
  const [live, setLive] = useState(true);

  const [snap, setSnap] = useState<DomSnapshot | null>(null);
  const [history, setHistory] = useState<DomSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Не даём догоняющим ответам перезаписать более свежие: при смене пары
  // ответ по старому символу может прийти позже — его нужно отбросить.
  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;

  const load = useCallback(async () => {
    try {
      const data = await api.scalpingDom(symbolRef.current, { rows, imbalance });
      if (data.symbol !== symbolRef.current) return;
      setSnap(data);
      setHistory((prev) => [...prev, data].slice(-HISTORY_LEN));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Стакан недоступен");
    }
  }, [rows, imbalance]);

  // Смена пары обнуляет карту ликвидности — иначе на ней смешаются два
  // разных ценовых диапазона и шкала схлопнется.
  useEffect(() => {
    setHistory([]);
    setSnap(null);
  }, [symbol]);

  useEffect(() => {
    if (!live) return;
    load();
    const id = setInterval(load, speed);
    return () => clearInterval(id);
  }, [live, speed, load, symbol]);

  const tape = snap?.tape;

  return (
    <div className="space-y-4">
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

      <div className="flex flex-wrap gap-2 text-[11px]">
        <Selector label="Частота" options={SPEEDS.map((s) => ({ value: s.ms, label: s.label }))} value={speed} onChange={setSpeed} />
        <Selector label="Глубина" options={DEPTHS.map((d) => ({ value: d, label: String(d) }))} value={rows} onChange={setRows} />
        <Selector label="Имбаланс" options={IMBALANCES.map((i) => ({ value: i, label: `${i}%` }))} value={imbalance} onChange={setImbalance} />
      </div>

      {error && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
          {error}
        </div>
      )}

      {/* ── Сводка ────────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Цена"
          value={snap ? fmtPrice(snap.mid, snap.tick) : "—"}
          sub={snap ? `спред ${snap.spread_bp.toFixed(1)} б.п.` : ""}
        />
        <Stat
          label="Дельта ленты"
          value={tape ? (tape.delta >= 0 ? "+" : "") + fmtSize(tape.delta) : "—"}
          tone={tape ? (tape.delta >= 0 ? "up" : "down") : undefined}
          sub={tape ? `${fmtSize(tape.buy_volume)} / ${fmtSize(tape.sell_volume)}` : ""}
        />
        <Stat
          label="Объём стакана"
          value={snap ? fmtSize(snap.bid_volume + snap.ask_volume) : "—"}
          sub={snap ? `шаг ${fmtPrice(snap.tick, snap.tick)}` : ""}
        />
        <Stat
          label="Плиты"
          value={snap ? String(snap.bid_walls.length + snap.ask_walls.length) : "—"}
          sub={snap ? `${snap.bid_walls.length} снизу / ${snap.ask_walls.length} сверху` : ""}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <PressureBar
          label="Перевес стакана"
          ratio={snap?.book_ratio ?? 0.5}
          left={snap ? fmtSize(snap.bid_volume) : "—"}
          right={snap ? fmtSize(snap.ask_volume) : "—"}
          hint="лимитные заявки"
        />
        <PressureBar
          label="Давление по ленте"
          ratio={tape?.buy_ratio ?? 0.5}
          left={tape ? fmtSize(tape.buy_volume) : "—"}
          right={tape ? fmtSize(tape.sell_volume) : "—"}
          hint="рыночные сделки"
        />
      </div>

      {/* ── Карта ликвидности ─────────────────────────────────────────── */}
      <LiquidityHeatmap history={history} />

      {/* ── Стакан и лента ────────────────────────────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <DomLadder data={snap} />
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-muted">
            <Activity className="h-3 w-3" />
            Лента сделок
          </div>
          <Tape trades={snap?.trades ?? []} tick={snap?.tick ?? 0.01} />
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-text-muted">
        Уровни с полосой сбоку — имбаланс: объём стороны превышает противоположную
        в {imbalance}% и более. Золотая цена — плита, объём кратно выше среднего по
        стороне. На карте ликвидности яркость показывает плотность заявок, белая
        линия — движение цены.
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
    <div className="rounded-xl border border-border/60 bg-bg-panel p-3">
      <div className="text-[10px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`mt-1 font-mono text-lg tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 font-mono text-[11px] text-text-muted">{sub}</div>}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity } from "lucide-react";

import { API_URL } from "@/lib/api";
import { useMentorToken } from "@/components/admin/AdminShell";

/**
 * Приборная панель бирж.
 *
 * До неё разбор любой поломки начинался с просьбы прислать лог из окна
 * сервера, и начинался уже после того, как поломка стоила денег. Здесь те же
 * события числами: как быстро отвечает биржа, часто ли отказывает и чем, жив
 * ли её приватный поток, успевает ли сопровождение за своим кругом.
 */

interface Venue {
  exchange: string;
  calls: number;
  errors: number;
  error_share: number;
  ms_median: number;
  ms_worst: number;
  codes: { code: string; times: number }[];
  streams: number;
  stream_drops: number;
  stream_minutes: number;
  last_error: string;
  last_error_ago: number | null;
}

interface Health {
  window: number;
  venues: Venue[];
  watcher: { passes?: number; seconds_median?: number; seconds_worst?: number };
}

const REFRESH_MS = 10_000;
// Доля отказов, после которой биржу подсвечиваем: одна ошибка из двадцати это
// уже не случайность, а разговор с поддержкой.
const BAD_SHARE = 0.05;
// Задержка, после которой ответ биржи считается медленным.
const SLOW_MS = 1500;

const TITLES: Record<string, string> = {
  weex: "WEEX",
  okx: "OKX",
  bingx: "BingX",
  mexc: "MEXC",
  binance: "Binance",
};

export default function HealthPage() {
  const token = useMentorToken();
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/trading/health`, {
        headers: { Authorization: `Bearer ${token}`, "ngrok-skip-browser-warning": "1" },
      });
      if (!res.ok) {
        setError(`Сервер ответил ${res.status}`);
        return;
      }
      setHealth((await res.json()) as Health);
      setError(null);
    } catch {
      setError("Сервер не отвечает");
    }
  }, [token]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const minutes = Math.round((health?.window ?? 300) / 60);

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <Activity className="h-5 w-5 text-accent-cyan" />
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Здоровье бирж</h1>
          <p className="text-sm text-text-muted">
            Числа за последние {minutes} минут. Обновляются каждые 10 секунд.
          </p>
        </div>
      </header>

      {error && (
        <p className="rounded-xl border border-border bg-bg-panel/60 px-4 py-3 text-sm text-text-secondary">
          {error}
        </p>
      )}

      {health && health.venues.length === 0 && (
        <p className="rounded-xl border border-border bg-bg-panel/60 px-4 py-3 text-sm text-text-secondary">
          Запросов к биржам пока не было. Панель наливается, как только кто-то
          откроет терминал или пойдёт сделка.
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {(health?.venues ?? []).map((venue) => (
          <VenueCard key={venue.exchange} venue={venue} />
        ))}
      </div>

      {health?.watcher?.passes ? (
        <section className="rounded-xl border border-border bg-bg-panel/60 p-4">
          <h2 className="text-sm font-semibold text-text-primary">Сопровождение сделок</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Обходов: {health.watcher.passes}. Обычный занимает{" "}
            {took(health.watcher.seconds_median)}, самый долгий{" "}
            {took(health.watcher.seconds_worst)}.
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Круг идёт раз в 5 секунд: если самый долгий подбирается к этому числу,
            сопровождение перестаёт успевать.
          </p>
        </section>
      ) : null}
    </div>
  );
}

function VenueCard({ venue }: { venue: Venue }) {
  const bad = venue.error_share >= BAD_SHARE;
  const slow = venue.ms_worst >= SLOW_MS;
  return (
    <section
      className={`rounded-xl border p-4 ${
        bad ? "border-accent-red/50 bg-accent-red/5" : "border-border bg-bg-panel/60"
      }`}
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-text-primary">
          {TITLES[venue.exchange] ?? venue.exchange.toUpperCase()}
        </h2>
        <span className="text-xs text-text-muted">запросов {venue.calls}</span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Row label="Отказы" value={`${venue.errors} (${Math.round(venue.error_share * 100)}%)`} alarm={bad} />
        <Row label="Ответ обычно" value={`${venue.ms_median} мс`} />
        <Row label="Худший ответ" value={`${venue.ms_worst} мс`} alarm={slow} />
        <Row
          label="Поток"
          value={
            venue.streams > 0
              ? `${venue.streams}, живёт ${venue.stream_minutes} мин`
              : "не поднят"
          }
        />
        <Row label="Обрывов потока" value={String(venue.stream_drops)} alarm={venue.stream_drops > 5} />
      </dl>

      {venue.codes.length > 0 && (
        <p className="mt-3 text-xs text-text-muted">
          Причины отказов:{" "}
          {venue.codes.map((one) => `${one.code} (${one.times})`).join(", ")}
        </p>
      )}

      {venue.last_error && (
        <p className="mt-1 text-xs text-text-secondary">
          Последний отказ: {venue.last_error}
          {venue.last_error_ago !== null ? `, ${venue.last_error_ago} с назад` : ""}
        </p>
      )}
    </section>
  );
}

/** Длительность словами: доли секунды читаются как «0.0 с» и выглядят нулём. */
function took(seconds: number | undefined): string {
  const value = seconds ?? 0;
  return value < 1 ? `${Math.round(value * 1000)} мс` : `${value.toFixed(1)} с`;
}

function Row({ label, value, alarm }: { label: string; value: string; alarm?: boolean }) {
  return (
    <>
      <dt className="text-text-muted">{label}</dt>
      <dd className={alarm ? "text-accent-red" : "text-text-primary"}>{value}</dd>
    </>
  );
}

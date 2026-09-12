"use client";

// Календарь событий - свой, вместо встроенного скрипта TradingView.
//
// Только то, что двигает крипту: важность высокая и средняя, доллар и евро.
// Решение Резервного банка Новой Зеландии биткоин не двигает, а список из
// сотни строк никто не читает.
//
// Время - в поясе ученика, а не в UTC и не в нью-йоркском: «CPI в 12:30» ничего
// не значит тому, кто сидит в Киеве или в Алматы.

import { useT } from "@/lib/i18n";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";

import { api } from "@/lib/api";
import {
  clock,
  dayKey,
  factTone,
  groupByDay,
  impactDots,
  type CalendarEvent,
} from "@/lib/econCalendar";
import Pane, { PaneLabel, type PaneState } from "./Pane";
import SourceMark from "./SourceMark";
import type { Origin } from "@/lib/marketOrigin";

/** Как часто спрашиваем. Источник публичный, ходим редко. */
const POLL_MS = 5 * 60_000;

const TONE_CLASS: Record<string, string> = {
  up: "text-[var(--pane-up)]",
  down: "text-[var(--pane-down)]",
  flat: "text-[var(--pane-text)]",
};

/** Важность точками: три у высокой, две у средней. */
function Impact({ importance }: { importance: CalendarEvent["importance"] }) {
  const count = impactDots(importance);
  return (
    <span className="flex shrink-0 items-center gap-[3px]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-[5px] w-[5px] rounded-full"
          style={{
            background:
              i < count
                ? importance === "high"
                  ? "var(--pane-down)"
                  : "var(--pane-gold)"
                : "var(--pane-border)",
          }}
        />
      ))}
    </span>
  );
}

function Row({ event, zone }: { event: CalendarEvent; zone: string | undefined }) {
  const t = useT();
  const tone = factTone(event.actual, event.forecast);

  return (
    <li className="flex items-baseline gap-2 py-1.5">
      <span className="w-11 shrink-0 font-mono text-[11px] tabular-nums text-[var(--pane-muted)]">
        {clock(event.time, zone)}
      </span>
      <Impact importance={event.importance} />
      <span className="w-8 shrink-0 text-[10px] font-semibold text-[var(--pane-muted)]">
        {event.currency}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--pane-text)]" title={event.title}>
        {event.title}
      </span>
      <span className="shrink-0 text-right font-mono text-[11px] tabular-nums">
        {event.actual ? (
          <span className={tone ? TONE_CLASS[tone] : "text-[var(--pane-text)]"}>{event.actual}</span>
        ) : (
          <span className="text-[var(--pane-muted)]">{event.forecast || "—"}</span>
        )}
      </span>
      <span
        className="hidden w-16 shrink-0 text-right font-mono text-[10px] tabular-nums text-[var(--pane-muted)] sm:inline"
        title={t.market.calendar.previousTitle}
      >
        {event.previous || ""}
      </span>
    </li>
  );
}

export default function CalendarPane({ className = "" }: { className?: string }) {
  const t = useT();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [state, setState] = useState<PaneState>("loading");

  // Пояс ученика: берём у браузера один раз, руками его никто не задаёт.
  const zone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return undefined;
    }
  }, []);

  useEffect(() => {
    let dropped = false;
    function load() {
      api
        .marketCalendar()
        .then((r) => {
          if (dropped) return;
          const list = (r.events ?? []) as CalendarEvent[];
          setEvents(list);
          setOrigin({ source: r.source ?? null, stale: r.stale });
          setState(list.length ? "ready" : "error");
        })
        .catch(() => {
          if (!dropped) setState("error");
        });
    }
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      dropped = true;
      clearInterval(timer);
    };
  }, []);

  const days = useMemo(() => groupByDay(events, zone), [events, zone]);
  const today = useMemo(() => dayKey(new Date().toISOString(), zone), [zone]);

  return (
    <Pane
      icon={<CalendarDays className="h-3.5 w-3.5" />}
      title={t.market.widgets.calendar.title}
      hint={t.market.widgets.calendar.hint}
      badge={<SourceMark origin={origin} home="faireconomy" />}
      state={state}
      emptyNote={t.market.calendar.emptyNote}
      className={className}
    >
      <div className="space-y-3">
        {days.map((day) => (
          <section key={day.key}>
            <header className="flex items-baseline gap-2 border-b border-[var(--pane-border)] pb-1">
              <PaneLabel>{t.market.calendar.day(day.key)}</PaneLabel>
              {day.key === today && (
                <span className="text-[10px] font-semibold text-[var(--pane-gold)]">
                  {t.market.calendar.today}
                </span>
              )}
            </header>
            <ul className="divide-y divide-[var(--pane-border)]">
              {day.events.map((event) => (
                <Row key={`${event.time}-${event.title}`} event={event} zone={zone} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Pane>
  );
}

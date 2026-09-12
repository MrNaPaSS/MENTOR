// Календарь событий: группировка по дням и сравнение факта с прогнозом.
//
// Бэкенд отдаёт события недели в UTC. Ученик живёт в своём часовом поясе, и
// «CPI в 12:30» для него ничего не значит, если он в Киеве или в Алматы.
// Поэтому время переводится в пояс браузера, а дни группируются уже после
// перевода: событие в 23:30 UTC у кого-то приходится на следующий день.

export interface CalendarEvent {
  /** Время в UTC, ISO. */
  time: string;
  currency: string;
  title: string;
  importance: "high" | "medium";
  forecast: string;
  previous: string;
  actual: string;
}

export interface CalendarDay {
  /** Ключ дня в поясе ученика: 2026-09-15. */
  key: string;
  events: CalendarEvent[];
}

export type FactTone = "up" | "down" | "flat" | null;

/** Ключ дня в заданном поясе. Без пояса - в поясе браузера. */
export function dayKey(iso: string, timeZone?: string): string {
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return "";
  // `en-CA` даёт как раз 2026-09-15, без разбора частей вручную.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(moment);
}

/** Время события часами и минутами в поясе ученика. */
export function clock(iso: string, timeZone?: string): string {
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(moment);
}

/**
 * События по дням, дни по возрастанию, события внутри дня - тоже.
 *
 * Пустых дней не делаем: календарь показывает, что есть, а не сетку недели.
 */
export function groupByDay(events: CalendarEvent[], timeZone?: string): CalendarDay[] {
  const days = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = dayKey(event.time, timeZone);
    if (!key) continue;
    const bucket = days.get(key);
    if (bucket) bucket.push(event);
    else days.set(key, [event]);
  }
  return [...days.entries()]
    .map(([key, list]) => ({
      key,
      events: [...list].sort((a, b) => a.time.localeCompare(b.time)),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** Число из значения вида «0.3%», «2.15%», «-1,2», «1.2M». */
export function parseValue(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const text = String(raw).trim().replace(",", ".");
  const match = text.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const value = Number.parseFloat(match[0]);
  if (!Number.isFinite(value)) return null;
  const suffix = text.slice(match.index! + match[0].length).trim().toUpperCase();
  if (suffix.startsWith("K")) return value * 1e3;
  if (suffix.startsWith("M")) return value * 1e6;
  if (suffix.startsWith("B")) return value * 1e9;
  return value;
}

/**
 * Факт против прогноза.
 *
 * `null` - сравнивать нечего: факта ещё нет или прогноза не было. Это не
 * «ноль» и не «одинаково», и на экране такое событие красить нельзя.
 */
export function factTone(actual: string, forecast: string): FactTone {
  const fact = parseValue(actual);
  const plan = parseValue(forecast);
  if (fact === null || plan === null) return null;
  if (fact > plan) return "up";
  if (fact < plan) return "down";
  return "flat";
}

/** Сколько точек важности рисовать: три у высокой, две у средней. */
export function impactDots(importance: CalendarEvent["importance"]): number {
  return importance === "high" ? 3 : 2;
}

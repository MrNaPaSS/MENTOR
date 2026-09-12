import { describe, expect, it } from "vitest";
import {
  clock,
  dayKey,
  factTone,
  groupByDay,
  impactDots,
  parseValue,
  type CalendarEvent,
} from "@/lib/econCalendar";

function event(time: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    time,
    currency: "USD",
    title: "Core CPI m/m",
    importance: "high",
    forecast: "",
    previous: "",
    actual: "",
    ...extra,
  };
}

describe("grouping by day", () => {
  it("groups in the student's own timezone, not in UTC", () => {
    // 23:30 UTC is already the next day in Kyiv.
    const late = event("2026-09-15T23:30:00+00:00");
    expect(dayKey(late.time, "UTC")).toBe("2026-09-15");
    expect(dayKey(late.time, "Europe/Kyiv")).toBe("2026-09-16");
  });

  it("keeps days in order and events inside a day in order", () => {
    const days = groupByDay(
      [
        event("2026-09-16T10:00:00+00:00"),
        event("2026-09-15T14:00:00+00:00"),
        event("2026-09-15T09:00:00+00:00"),
      ],
      "UTC",
    );
    expect(days.map((d) => d.key)).toEqual(["2026-09-15", "2026-09-16"]);
    expect(days[0].events.map((e) => e.time)).toEqual([
      "2026-09-15T09:00:00+00:00",
      "2026-09-15T14:00:00+00:00",
    ]);
  });

  it("makes no empty days: the panel shows what exists, not a week grid", () => {
    const days = groupByDay([event("2026-09-15T09:00:00+00:00")], "UTC");
    expect(days).toHaveLength(1);
  });

  it("shows the clock in the student's timezone", () => {
    expect(clock("2026-09-15T12:30:00+00:00", "UTC")).toBe("12:30");
    expect(clock("2026-09-15T12:30:00+00:00", "Europe/Kyiv")).toBe("15:30");
  });

  it("ignores a broken timestamp instead of drawing an invalid day", () => {
    expect(groupByDay([event("не время")], "UTC")).toEqual([]);
  });
});

describe("fact against forecast", () => {
  it("marks a beat and a miss", () => {
    expect(factTone("0.4%", "0.3%")).toBe("up");
    expect(factTone("0.2%", "0.3%")).toBe("down");
    expect(factTone("0.3%", "0.3%")).toBe("flat");
  });

  it("says nothing when the fact is not out yet", () => {
    expect(factTone("", "0.3%")).toBeNull();
    expect(factTone("0.3%", "")).toBeNull();
  });

  it("reads negative values and thousands", () => {
    expect(parseValue("-1,2%")).toBe(-1.2);
    expect(parseValue("250K")).toBe(250000);
    expect(parseValue("1.4M")).toBe(1400000);
    expect(parseValue("нет")).toBeNull();
  });
});

describe("importance", () => {
  it("gives three dots to high impact and two to medium", () => {
    expect(impactDots("high")).toBe(3);
    expect(impactDots("medium")).toBe(2);
  });
});

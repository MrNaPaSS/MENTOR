"use client";

// План трейдера на неделю: что торгуем и по каким правилам.
//
// Пишет его сам трейдер, себе. Лежит рядом с журналом, потому что смотрят его
// вместе: в понедельник записал правила, к пятнице видно, сколько раз их
// нарушил.
//
// Неделя считается по ISO - `2026-W38`. Не датой начала: неделя у разных стран
// начинается по-разному, а номер по ISO один и тот же везде.

import { authReq } from "./api";
import { getAccessToken } from "./auth";

export interface WeekPlan {
  week: string;
  text: string;
  updated_at: string | null;
}

/** Номер недели по ISO для этой даты: `2026-W38`. */
export function isoWeek(at: Date = new Date()): string {
  // Считаем по четвергу той же недели - так определяет номер сам стандарт:
  // год недели это год её четверга, и декабрьские дни попадают в первую
  // неделю января, если четверг уже там.
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const shift = (day.getUTCDay() + 6) % 7; // понедельник - ноль
  day.setUTCDate(day.getUTCDate() - shift + 3);
  const firstThursday = new Date(Date.UTC(day.getUTCFullYear(), 0, 4));
  const firstShift = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstShift + 3);
  const week =
    1 + Math.round((day.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** План недели. Пусто - трейдер ещё не писал. */
export async function loadPlan(week = ""): Promise<WeekPlan | null> {
  const token = getAccessToken();
  if (!token) return null;
  const query = week ? `?week=${encodeURIComponent(week)}` : "";
  try {
    return await authReq<WeekPlan>(`/api/journal/plan${query}`, token);
  } catch {
    // Сервер старее этой возможности или не ответил: плана просто не будет.
    return null;
  }
}

/** Записать план недели. Одна запись на неделю - её правят, а не плодят. */
export async function savePlan(text: string, week = ""): Promise<WeekPlan | null> {
  const token = getAccessToken();
  if (!token) return null;
  try {
    return await authReq<WeekPlan>("/api/journal/plan", token, {
      method: "PUT",
      body: JSON.stringify({ text, week }),
    });
  } catch {
    return null;
  }
}

/** Понедельник недели по ISO-номеру `2026-W38`. Пусто - номер испорчен. */
export function weekStart(week: string): Date | null {
  const parts = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!parts) return null;
  const year = Number(parts[1]);
  const number = Number(parts[2]);
  // Четвёртое января всегда лежит в первой неделе года - от него и считаем.
  const fourth = new Date(Date.UTC(year, 0, 4));
  const shift = (fourth.getUTCDay() + 6) % 7;
  const first = new Date(fourth);
  first.setUTCDate(fourth.getUTCDate() - shift);
  first.setUTCDate(first.getUTCDate() + (number - 1) * 7);
  return first;
}

/** Соседняя неделя: `-1` - прошлая, `1` - следующая. */
export function weekShift(week: string, step: number): string {
  const start = weekStart(week);
  if (!start) return week;
  const moved = new Date(start);
  moved.setUTCDate(moved.getUTCDate() + step * 7);
  return isoWeek(moved);
}

/** Первый и последний день недели: их показывают рядом с номером. */
export function weekRange(week: string): { from: Date; to: Date } | null {
  const from = weekStart(week);
  if (!from) return null;
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 6);
  return { from, to };
}

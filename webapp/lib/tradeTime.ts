"use client";

// Сколько сделка простояла открытой.
//
// Это та цифра, которую трейдер никогда не помнит и которая объясняет
// половину журнала: сделка, взявшая цель за четыре минуты, и сделка, которую
// держали шесть часов до того же плюса, - разная работа и разный риск.
//
// Считается из того, что уже записано: время открытия и закрытия ставит
// сервер сам, когда биржа подтверждает вход и выход.

/** Секунды в сделке. Ноль - времени открытия нет или оно испорчено. */
export function heldSeconds(
  trade: { opened_at: string | null; closed_at: string | null },
  now: number = Date.now(),
): number {
  if (!trade.opened_at) return 0;
  const born = new Date(trade.opened_at).getTime();
  if (Number.isNaN(born)) return 0;
  // Идущая сделка считается до сейчас: её время ещё набегает.
  const done = trade.closed_at ? new Date(trade.closed_at).getTime() : now;
  if (Number.isNaN(done) || done < born) return 0;
  return Math.round((done - born) / 1000);
}

/**
 * Время в сделке словами: `2 ч 14 мин`, `14 мин`, `48 с`.
 *
 * Единицы подставляет вызывающий - они переводятся. Мелкие доли отбрасываем
 * намеренно: «2 ч 14 мин 09 с» никто не читает, а секунды важны только там,
 * где вся сделка уложилась в минуту.
 */
export function heldLabel(
  seconds: number,
  units: { h: string; m: string; s: string },
): string {
  if (seconds <= 0) return "-";
  if (seconds < 60) return `${seconds} ${units.s}`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} ${units.m}`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest === 0
    ? `${hours} ${units.h}`
    : `${hours} ${units.h} ${rest} ${units.m}`;
}

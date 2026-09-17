"use client";

// Где стоял график, когда его оставили.
//
// Трейдер отматывает график к утреннему движению, уходит в аналитику за
// цифрой и возвращается - а график снова у правого края, и место приходится
// искать заново. То же самое после перезагрузки страницы. На скальпе это
// стоит десятков секунд в час и сбивает с мысли ровно тогда, когда мысль
// была.
//
// Положение помнится недолго и намеренно: вчерашний участок сегодня не нужен,
// и открывать утренний терминал на позавчерашнем движении - хуже, чем
// открывать его на свежих свечах. Поэтому хранилище сеансовое: закрыли
// вкладку - забыли, а перезагрузка и переходы по разделам переживаются.

/** Сколько живёт запомненное положение. Дольше - это уже другой день торговли. */
export const VIEW_TTL_MS = 3 * 60 * 60 * 1000;

const KEY = "nmnh.chart.view";

export interface ChartView {
  /** Время первой и последней видимой свечи, секунды UTC. */
  from: number;
  to: number;
  /** Когда запомнили: старое положение не восстанавливаем. */
  at: number;
}

function keyOf(symbol: string, interval: string): string {
  return `${symbol}:${interval}`;
}

function readAll(): Record<string, ChartView> {
  try {
    const raw = sessionStorage.getItem(KEY);
    const body = raw ? JSON.parse(raw) : null;
    return body && typeof body === "object" ? (body as Record<string, ChartView>) : {};
  } catch {
    // Приватное окно или запрет на хранилище: положение просто не помнится.
    return {};
  }
}

/** Запомнить, где стоит график. */
export function keepView(symbol: string, interval: string, from: number, to: number): void {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return;
  try {
    const all = readAll();
    all[keyOf(symbol, interval)] = { from, to, at: Date.now() };
    sessionStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Хранилище переполнено или закрыто - терять из-за этого график нельзя.
  }
}

/** Где стоял график. Пусто - не помним или помним слишком давно. */
export function readView(symbol: string, interval: string): ChartView | null {
  const one = readAll()[keyOf(symbol, interval)];
  if (!one) return null;
  if (!Number.isFinite(one.at) || Date.now() - one.at > VIEW_TTL_MS) return null;
  if (!Number.isFinite(one.from) || !Number.isFinite(one.to) || one.to <= one.from) return null;
  return one;
}

/**
 * Подходит ли запомненное положение к тем свечам, что пришли.
 *
 * Свечей у нас всегда ограниченная пачка. Если запомненный участок в неё не
 * попадает - монету не открывали полдня, - восстанавливать нечего: график
 * встанет в пустоту, и трейдер увидит белое поле вместо рынка.
 */
export function viewFits(view: ChartView, first: number, last: number): boolean {
  return view.from >= first && view.to <= last + (view.to - view.from);
}
